'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WorkflowOrchestrator } = require('../src/main/workflow/orchestrator');
const { SCAN_CHECKS } = require('../src/shared/catalog');

const APPROVE_CHECKS = [
  { id: 'os-info', name: 'Operating system', timeout: 1000 },
  { id: 'disk-space', name: 'System drive space', timeout: 1000 },
  { id: 'battery', name: 'Battery health', timeout: 1000 }
];

function fakePlatform({ repairOutcome = 'success' } = {}) {
  const repairs = [];
  return {
    platform: 'win32',
    repairs,
    async runCheck(check) {
      if (check.id === 'disk-space') {
        return {
          status: 'fail',
          finding: '2.1 GB free on C:',
          evidence: 'Free: 2.1 GB',
          explanation: 'Less than 5% free space is a failure.',
          nextStep: 'Remove files.'
        };
      }
      if (check.id === 'battery') {
        return {
          status: 'skip',
          finding: 'No battery detected.',
          evidence: 'Win32_Battery returned no battery.',
          explanation: 'Desktop.',
          nextStep: 'No action.'
        };
      }
      return {
        status: 'info',
        finding: 'Windows 11 Pro',
        evidence: 'Build 26100',
        explanation: 'Edition info.',
        nextStep: 'No action.'
      };
    },
    async getRepairAvailability() {
      return {
        'enable-firewall': { available: true, reason: '' },
        'restart-spooler': { available: true, reason: '' },
        'restart-audio': { available: true, reason: '' },
        'clear-temp': { available: true, reason: '' },
        'flush-dns': { available: true, reason: '' },
        'rebuild-icons': { available: true, reason: '' }
      };
    },
    async runRepair(repair) {
      repairs.push(repair.id);
      if (repairOutcome === 'fail') {
        return { ok: false, summary: 'Repair failed for the test.', details: 'test failure', rollback: 'No change.' };
      }
      return { ok: true, summary: 'Repair completed for the test.', details: 'test output', rollback: 'No rollback needed.' };
    }
  };
}

function makeOrchestrator(platform, overrides = {}) {
  const events = [];
  const written = [];
  const orchestrator = new WorkflowOrchestrator({
    platform,
    emit: (event) => events.push(event),
    writer: async (payload) => {
      written.push(payload);
      return {
        directory: '/usb/reports',
        root: '/usb',
        fallback: false,
        warning: '',
        reports: [
          { format: 'html', name: 'report.html', path: '/usb/reports/report.html' },
          { format: 'txt', name: 'report.txt', path: '/usb/reports/report.txt' },
          { format: 'json', name: 'report.json', path: '/usb/reports/report.json' }
        ]
      };
    },
    checkList: APPROVE_CHECKS,
    stepDelayMs: 0,
    ...overrides
  });
  return { orchestrator, events, written };
}

test('start runs Lead, Scanner, and Repair in order and stops at approval', async () => {
  const platform = fakePlatform();
  const { orchestrator, events } = makeOrchestrator(platform);
  const state = await orchestrator.start({ systemInfo: { computerName: 'TEST-PC' } });

  assert.equal(state.phase, 'awaiting_approval');
  assert.equal(orchestrator.proposal.repairId, 'clear-temp');
  assert.equal(events[0].type, 'job.start');

  const handoffs = events.filter((event) => event.type === 'handoff').map((event) => `${event.payload.from}->${event.payload.to}`);
  assert.deepEqual(handoffs, ['lead->scanner', 'scanner->repair']);
  assert.equal(events.filter((event) => event.type === 'scan.check.result').length, 3);
  assert.equal(platform.repairs.length, 0, 'no repair may run before approval');

  const skip = events.find((event) => event.type === 'scan.check.result' && event.payload.checkId === 'battery');
  assert.equal(skip.payload.status, 'skip');
  assert.equal(skip.payload.unavailable, true);
  const failure = events.find((event) => event.type === 'scan.check.result' && event.payload.checkId === 'disk-space');
  assert.equal(failure.payload.status, 'fail');

  const proposed = events.find((event) => event.type === 'repair.proposed');
  assert.equal(proposed.payload.name, 'Clear temporary files');
  assert.equal(proposed.payload.available, true);
  assert.ok(proposed.payload.rationale.includes('disk'));
});

test('approving consumes a single-use token, runs once, and writes a report', async () => {
  const platform = fakePlatform();
  const { orchestrator, events, written } = makeOrchestrator(platform);
  await orchestrator.start({ systemInfo: {} });
  const proposalId = orchestrator.proposal.proposalId;

  const state = await orchestrator.decide(proposalId, 'approve');
  assert.equal(state.phase, 'done');
  assert.deepEqual(platform.repairs, ['clear-temp']);
  assert.equal(orchestrator.decision, 'approved');
  assert.equal(written.length, 1);
  assert.equal(written[0].decision, 'approved');
  assert.equal(written[0].repair.outcome, 'success');
  assert.equal(written[0].proposal.token, undefined);

  const decisions = events.filter((event) => event.type === 'repair.decision');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].payload.decision, 'approved');
  assert.ok(events.some((event) => event.type === 'report.saved' && event.payload.reports.length === 3));
  assert.ok(events.some((event) => event.type === 'job.done' && event.payload.outcome === 'completed'));

  await assert.rejects(() => orchestrator.decide(proposalId, 'approve'), /no repair proposal waiting/i);
  assert.equal(platform.repairs.length, 1, 'the repair must never run twice');
});

test('declining runs no repair command but still finalizes the report', async () => {
  const platform = fakePlatform();
  const { orchestrator, events, written } = makeOrchestrator(platform);
  await orchestrator.start({ systemInfo: {} });

  const state = await orchestrator.decide(orchestrator.proposal.proposalId, 'decline');
  assert.equal(state.phase, 'done');
  assert.equal(orchestrator.decision, 'declined');
  assert.equal(platform.repairs.length, 0);
  assert.equal(written.length, 1);
  assert.equal(written[0].repair.outcome, 'declined');
  const done = events.find((event) => event.type === 'job.done');
  assert.equal(done.payload.outcome, 'declined');
});

test('a stale or mismatched proposal id is rejected without running anything', async () => {
  const platform = fakePlatform();
  const { orchestrator } = makeOrchestrator(platform);
  await orchestrator.start({ systemInfo: {} });
  await assert.rejects(() => orchestrator.decide('fix-not-this-one', 'approve'), /does not match/i);
  assert.equal(platform.repairs.length, 0);
  assert.equal(orchestrator.phase, 'awaiting_approval');
});

test('a failed repair is reported as failed and still produces a report', async () => {
  const platform = fakePlatform({ repairOutcome: 'fail' });
  const { orchestrator, events, written } = makeOrchestrator(platform);
  await orchestrator.start({ systemInfo: {} });
  await orchestrator.decide(orchestrator.proposal.proposalId, 'approve');
  assert.equal(orchestrator.phase, 'done');
  assert.equal(written[0].repair.outcome, 'failed');
  const done = events.find((event) => event.type === 'job.done');
  assert.equal(done.payload.outcome, 'failed');
});

test('every published event validates against the frozen contract', async () => {
  const platform = fakePlatform();
  const { orchestrator, events } = makeOrchestrator(platform);
  await orchestrator.start({ systemInfo: {} });
  await orchestrator.decide(orchestrator.proposal.proposalId, 'approve');
  for (const event of events) {
    assert.ok(event.type, 'event type');
    assert.ok(event.seq > 0, 'event sequence');
    assert.ok(event.at, 'event timestamp');
  }
  assert.equal(new Set(events.map((event) => event.seq)).size, events.length);
});
