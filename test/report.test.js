'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHtmlReport, buildTextReport, buildJsonReport, reportBaseName } = require('../src/main/workflow/report');
const { makeResult } = require('../src/main/results');
const { summarizeResults } = require('../src/shared/catalog');

function sample() {
  const checks = [
    makeResult(
      { id: 'battery', name: 'Battery health', tool: 'scan' },
      {
        status: 'skip',
        finding: 'No battery detected.',
        evidence: 'Win32_Battery returned no battery.',
        explanation: 'Battery checks apply to laptops.',
        nextStep: 'No action required.',
        durationMs: 4
      }
    ),
    makeResult(
      { id: 'disk-space', name: 'System drive space', tool: 'scan' },
      {
        status: 'fail',
        finding: '2.1 GB free on C:',
        evidence: 'Free: 2.1 GB',
        explanation: 'Below the failure threshold.',
        nextStep: 'Remove files.',
        durationMs: 8
      }
    )
  ];
  const summary = summarizeResults(checks);
  return {
    version: '2.0.0',
    generatedAt: '2026-11-14T12:00:00.000Z',
    systemInfo: { computerName: 'TEST-PC', osName: 'Windows 11 Pro', user: 'Tester', admin: false },
    job: {
      id: 'job-20261114120000-abc123',
      startedAt: '2026-11-14T12:00:00.000Z',
      finishedAt: '2026-11-14T12:01:00.000Z',
      platform: 'win32',
      simulated: false,
      checks
    },
    scan: { results: checks, summary },
    proposal: {
      name: 'Clear temporary files',
      risk: 'Low',
      rationale: 'Low disk space.',
      impact: 'Frees space.',
      admin: false,
      preventive: false,
      linkedCheckIds: ['disk-space']
    },
    decision: 'declined',
    repair: {
      name: 'Clear temporary files',
      outcome: 'declined',
      summary: 'The proposed repair was reviewed and declined. No repair command was run.',
      details: '',
      rollback: '',
      startedAt: null,
      finishedAt: '2026-11-14T12:01:00.000Z'
    },
    events: [
      { seq: 1, at: '2026-11-14T12:00:00.000Z', type: 'job.start', payload: { jobId: 'job-1', checkCount: 2 } },
      { seq: 2, at: '2026-11-14T12:00:02.000Z', type: 'scan.check.result', payload: { name: 'Battery health', status: 'skip', finding: 'No battery detected.' } },
      { seq: 3, at: '2026-11-14T12:01:00.000Z', type: 'job.done', payload: { outcome: 'declined', summary: 'Declined.' } }
    ],
    audit: [{ at: '2026-11-14T12:00:00.000Z', event: 'job-start', detail: 'job-1' }],
    capabilities: {}
  };
}

test('the text report preserves unavailable and failed statuses', () => {
  const text = buildTextReport(sample());
  assert.match(text, /\[UNAVAILABLE\] Battery health/);
  assert.match(text, /\[FAIL\] System drive space/);
  assert.doesNotMatch(text, /\[PASS\] Battery health/);
  assert.match(text, /Decision: declined/);
  assert.match(text, /No repair command was run/);
});

test('the HTML report labels skipped checks as unavailable, not pass', () => {
  const data = sample();
  data.job.simulated = true;
  const html = buildHtmlReport(data);
  assert.match(html, /UNAVAILABLE/);
  assert.match(html, /Battery health/);
  assert.match(html, /SIMULATED RUN/);
  assert.match(html, /DECLINED/);
});

test('the JSON report keeps the measured status values and decision', () => {
  const payload = JSON.parse(buildJsonReport(sample()));
  assert.equal(payload.schema, 'feather-ai-2/report@1');
  assert.equal(payload.scan.results[0].status, 'skip');
  assert.equal(payload.scan.results[1].status, 'fail');
  assert.equal(payload.decision, 'declined');
  assert.equal(payload.repair.outcome, 'declined');
  assert.equal(payload.events.length, 3);
});

test('report names are safe for a removable drive', () => {
  const name = reportBaseName('job-2026/../../bad id!', new Date('2026-11-14T12:34:56'));
  assert.match(name, /^FeatherAI2-job-2026badid-20261114-123456$/);
  assert.doesNotMatch(name, /\.\.|\/|\\/);
});
