'use strict';

const crypto = require('node:crypto');
const { makeCapCtx } = require('./capGate');
const { createBus } = require('./events');
const { ApprovalStore } = require('../approval');
const { makeResult } = require('../results');
const {
  AGENTS,
  SCAN_CHECKS,
  repairMap,
  proposalFor,
  summarizeResults
} = require('../../shared/catalog');

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'CHECK_TIMEOUT' })), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function statusTone(status) {
  if (status === 'pass') return 'good';
  if (status === 'warn') return 'warn';
  if (status === 'fail' || status === 'error') return 'bad';
  return 'info';
}

function activityForResult(result) {
  if (result.status === 'skip') return { text: `Unavailable — ${result.name}: ${result.finding}`, tone: 'info' };
  if (result.status === 'error') return { text: `Failed — ${result.name}: ${result.finding}`, tone: 'bad' };
  if (result.status === 'fail') return { text: `Fail — ${result.name}: ${result.finding}`, tone: 'bad' };
  if (result.status === 'warn') return { text: `Warning — ${result.name}: ${result.finding}`, tone: 'warn' };
  if (result.status === 'info') return { text: `${result.name}: ${result.finding}`, tone: 'info' };
  return { text: `${result.name}: pass`, tone: 'good' };
}

class WorkflowOrchestrator {
  constructor({
    platform,
    emit = () => {},
    audit = () => {},
    writer = null,
    approvalStore = new ApprovalStore({ ttlMs: 120000 }),
    checkList = SCAN_CHECKS,
    clock = () => new Date(),
    stepDelayMs = Number(process.env.FEATHER_STEP_DELAY_MS || 140)
  } = {}) {
    if (!platform) throw new Error('A platform adapter is required.');
    this.platform = platform;
    this.emit = emit;
    this.audit = audit;
    this.writer = writer;
    this.approvalStore = approvalStore;
    this.checkList = checkList;
    this.clock = clock;
    this.stepDelayMs = Math.max(0, Number(stepDelayMs) || 0);
    this.bus = createBus({ sink: (event) => this.emit(event) });
    this.capabilities = Object.fromEntries(
      Object.entries(AGENTS).map(([id, agent]) => [
        id,
        makeCapCtx({
          agentId: id,
          room: 'feather-lab',
          tools: agent.tools,
          hasCompute: true,
          deferred: [],
          approvalRules: id === 'repair' ? { apply_repair: 'explicit-user-approval' } : {}
        })
      ])
    );
    this.controller = null;
    this.resetState();
  }

  resetState() {
    this.phase = 'idle';
    this.jobId = null;
    this.startedAt = null;
    this.finishedAt = null;
    this.results = [];
    this.scanRun = null;
    this.proposal = null;
    this.pending = null;
    this.repairRecord = null;
    this.decision = null;
    this.report = null;
    this.error = null;
  }

  publish(name, payload) {
    return this.bus.publish(name, payload);
  }

  assertCapability(agentId, toolName) {
    const context = this.capabilities[agentId];
    const gate = context && context.canUse({ name: toolName });
    if (!gate || !gate.ok) {
      const reason = gate ? gate.reason : `unknown agent ${agentId}`;
      const error = new Error(`Capability denied: ${agentId} may not call ${toolName} (${reason}).`);
      error.code = 'CAPABILITY_DENIED';
      throw error;
    }
    return true;
  }

  setStatus(agentId, status, task = '') {
    this.publish('agent.status', { agentId, status, ...(task ? { task } : {}) });
  }

  activity(agentId, text, tone = 'info') {
    this.publish('agent.activity', { agentId, text, tone });
  }

  handoff(from, to, reason, summary = '') {
    const id = `handoff-${crypto.randomBytes(4).toString('hex')}`;
    this.publish('handoff', { id, from, to, reason, ...(summary ? { summary } : {}) });
    this.audit('handoff', `${from} -> ${to}: ${reason}`);
    return id;
  }

  getPublicState() {
    return {
      phase: this.phase,
      jobId: this.jobId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      results: this.results,
      scan: this.scanRun,
      proposal: this.proposal
        ? {
            proposalId: this.proposal.proposalId,
            repairId: this.proposal.repairId,
            name: this.proposal.name,
            description: this.proposal.description,
            impact: this.proposal.impact,
            risk: this.proposal.risk,
            admin: this.proposal.admin,
            reboot: this.proposal.reboot,
            rationale: this.proposal.rationale,
            linkedCheckIds: this.proposal.linkedCheckIds,
            available: this.proposal.available,
            unavailableReason: this.proposal.unavailableReason,
            preventive: this.proposal.preventive,
            status: this.proposal.status
          }
        : null,
      decision: this.decision,
      repair: this.repairRecord,
      report: this.report,
      error: this.error,
      events: this.bus.history.slice()
    };
  }

  async start({ systemInfo = {} } = {}) {
    if (!['idle', 'done', 'error'].includes(this.phase)) {
      throw new Error('A workflow is already running. Finish or reset it before starting another.');
    }
    this.resetState();
    this.systemInfo = systemInfo;
    this.controller = new AbortController();
    this.jobId = `job-${this.clock().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    this.startedAt = this.clock().toISOString();
    this.phase = 'scanning';

    this.publish('job.start', {
      jobId: this.jobId,
      startedAt: this.startedAt,
      checkCount: this.checkList.length
    });
    this.publish('workflow.state', { phase: 'scanning', message: 'Lead opened the job. Scanner is taking over.' });

    try {
      this.assertCapability('lead', 'job.plan');
      this.setStatus('lead', 'working', 'Opening the job');
      this.activity('lead', `Job ${this.jobId} opened. Handing the read-only checklist to Scanner.`, 'good');
      await sleep(this.stepDelayMs);

      this.setStatus('lead', 'idle', 'Waiting for Scanner');
      this.handoff('lead', 'scanner', 'Run the read-only Windows diagnostics', `${this.checkList.length} checks`);
      this.setStatus('scanner', 'working', 'Running read-only diagnostics');
      this.activity('scanner', `Starting ${this.checkList.length} read-only checks. No settings will be changed.`, 'info');
      await sleep(this.stepDelayMs);

      const results = [];
      for (let index = 0; index < this.checkList.length; index += 1) {
        if (this.controller.signal.aborted) throw Object.assign(new Error('The job was cancelled.'), { code: 'CANCELLED' });
        const check = this.checkList[index];
        this.assertCapability('scanner', 'diag.run');
        this.publish('scan.check.start', {
          checkId: check.id,
          name: check.name,
          index: index + 1,
          total: this.checkList.length
        });
        this.activity('scanner', `Reading ${check.name.toLowerCase()}…`, 'info');
        this.audit('scan-check-start', `${check.id} (${index + 1}/${this.checkList.length})`);

        const started = Date.now();
        let data;
        try {
          data = await withTimeout(
            Promise.resolve(this.platform.runCheck(check, { signal: this.controller.signal })),
            Math.max(5000, Number(check.timeout) || 20000) + 8000,
            `${check.name} did not finish within its time limit.`
          );
        } catch (error) {
          if (error.code === 'CANCELLED' || this.controller.signal.aborted) {
            throw Object.assign(new Error('The job was cancelled.'), { code: 'CANCELLED' });
          }
          data = {
            status: 'error',
            finding:
              error.code === 'CHECK_TIMEOUT'
                ? `${check.name} timed out.`
                : `${check.name} could not complete.`,
            evidence: error.message || String(error),
            explanation:
              'The check did not finish, so Feather AI is not reporting a pass or a problem for it.',
            nextStep:
              'Run the check again. If it keeps failing, run Feather AI as administrator or review the component involved.'
          };
        }

        if (this.controller.signal.aborted) throw Object.assign(new Error('The job was cancelled.'), { code: 'CANCELLED' });

        const result = makeResult({ ...check, tool: 'scan' }, {
          ...data,
          durationMs: Date.now() - started,
          measuredAt: this.clock().toISOString()
        });
        results.push(result);
        this.publish('scan.check.result', {
          checkId: result.id,
          name: result.name,
          status: result.status,
          finding: result.finding,
          evidence: result.evidence,
          explanation: result.explanation,
          nextStep: result.nextStep,
          durationMs: result.durationMs,
          unavailable: result.status === 'skip'
        });
        const activity = activityForResult(result);
        this.activity('scanner', activity.text, activity.tone);
        this.audit('scan-check-result', `${result.id}: ${result.status} - ${result.finding}`);
        await sleep(this.stepDelayMs);
      }

      this.results = results;
      const summary = summarizeResults(results);
      this.scanRun = {
        startedAt: this.startedAt,
        finishedAt: this.clock().toISOString(),
        results,
        summary
      };
      this.publish('scan.done', { summary, durationMs: this.checkList.length * this.stepDelayMs });
      this.setStatus('scanner', 'done', `${summary.total} checks read`);
      this.activity(
        'scanner',
        `Scan complete: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.error} error, ${summary.unavailable} unavailable.`,
        summary.attention ? 'warn' : 'good'
      );

      await this.proposeFix();
      this.phase = 'awaiting_approval';
      this.publish('workflow.state', {
        phase: 'awaiting_approval',
        message: 'Repair proposed one fix. It will not run without your approval.'
      });
      return this.getPublicState();
    } catch (error) {
      await this.failJob(error, 'scan');
      throw error;
    }
  }

  async proposeFix() {
    this.assertCapability('repair', 'repair.propose');
    this.handoff(
      'scanner',
      'repair',
      'Hand over measured findings for a repair proposal',
      `${this.results.length} results`
    );
    this.setStatus('repair', 'working', 'Reading the findings');
    this.activity('repair', 'Received the findings. Matching them against the predefined repair list.', 'info');
    await sleep(this.stepDelayMs);

    const availability = await this.platform.getRepairAvailability();
    const proposal = proposalFor(this.results, availability);
    const repair = repairMap[proposal.repairId];
    if (!repair) throw new Error(`The proposed repair ${proposal.repairId} is not in the catalog.`);

    const proposalId = `fix-${crypto.randomBytes(4).toString('hex')}`;
    const approval = this.approvalStore.approve(repair.id, {
      jobId: this.jobId,
      proposalId,
      name: repair.name
    });

    this.proposal = {
      proposalId,
      ...proposal,
      token: approval.token,
      status: 'pending',
      createdAt: this.clock().toISOString()
    };
    this.pending = this.proposal;

    this.publish('repair.proposed', {
      proposalId,
      repairId: repair.id,
      name: repair.name,
      description: repair.description,
      risk: repair.risk,
      rationale: proposal.rationale,
      impact: proposal.impact,
      evidence: proposal.available ? '' : proposal.unavailableReason,
      available: proposal.available,
      linkedCheckIds: proposal.linkedCheckIds,
      preventive: proposal.preventive
    });
    this.activity('repair', `Proposed: ${repair.name}. Waiting for your decision — Review fix.`, 'warn');
    this.setStatus('repair', 'waiting', 'Waiting for approval');
    this.setStatus('lead', 'waiting', 'Waiting for approval');
    this.audit('repair-proposed', `${repair.name} (${repair.risk}); awaiting user decision`);
  }

  async decide(proposalId, decision) {
    if (this.phase !== 'awaiting_approval' || !this.proposal || this.proposal.status !== 'pending') {
      throw new Error('There is no repair proposal waiting for a decision.');
    }
    if (typeof proposalId !== 'string' || proposalId !== this.proposal.proposalId) {
      throw new Error('This decision does not match the pending repair proposal.');
    }
    if (!['approve', 'decline'].includes(decision)) {
      throw new Error('Decision must be approve or decline.');
    }

    if (decision === 'decline') {
      this.proposal.status = 'declined';
      this.decision = 'declined';
      this.publish('repair.decision', { proposalId, decision: 'declined' });
      this.activity('lead', 'Repair was declined. Nothing will be changed on this computer.', 'info');
      this.setStatus('repair', 'done', 'Proposal declined');
      this.repairRecord = {
        repairId: this.proposal.repairId,
        name: this.proposal.name,
        risk: this.proposal.risk,
        outcome: 'declined',
        summary: 'The proposed repair was reviewed and declined. No repair command was run.',
        details: '',
        rollback: '',
        startedAt: null,
        finishedAt: this.clock().toISOString()
      };
      this.publish('repair.done', {
        repairId: this.repairRecord.repairId,
        outcome: 'declined',
        summary: this.repairRecord.summary
      });
      this.audit('repair-declined', `${this.proposal.name}; no command was run`);
      await this.finalize('declined');
      return this.getPublicState();
    }

    // Consume the single-use approval before executing anything. A second click,
    // a stale proposal id, or an expired token cannot run the repair again.
    this.approvalStore.consume(this.proposal.token, this.proposal.repairId);
    this.proposal.status = 'approved';
    this.decision = 'approved';
    this.publish('repair.decision', { proposalId, decision: 'approved' });
    this.phase = 'repairing';
    this.publish('workflow.state', { phase: 'repairing', message: 'Repair is running the approved fix.' });

    try {
      this.assertCapability('repair', 'repair.apply');
      this.setStatus('lead', 'working', 'Approval recorded');
      this.setStatus('repair', 'working', this.proposal.name);
      this.activity('lead', 'Approval recorded. Repair may run this one predefined action.', 'good');
      this.handoff('lead', 'repair', 'Run the approved repair', this.proposal.name);
      this.publish('repair.start', { repairId: this.proposal.repairId, name: this.proposal.name });
      this.activity('repair', `Approved. Running ${this.proposal.name}…`, 'warn');
      this.audit('repair-start', `${this.proposal.name}; risk ${this.proposal.risk}`);

      const startedAt = this.clock().toISOString();
      let result;
      try {
        const repair = repairMap[this.proposal.repairId];
        result = await withTimeout(
          Promise.resolve(this.platform.runRepair(repair, { signal: this.controller.signal })),
          Math.max(30000, Number(repair.timeout) || 60000) + 15000,
          'The repair did not finish within its time limit.'
        );
      } catch (error) {
        result = {
          ok: false,
          summary: 'The repair stopped with an error.',
          details: error.message || String(error),
          rollback: ''
        };
      }

      const outcome = this.controller.signal.aborted
        ? 'cancelled'
        : result.ok
          ? 'success'
          : 'failed';
      this.repairRecord = {
        repairId: this.proposal.repairId,
        name: this.proposal.name,
        risk: this.proposal.risk,
        outcome,
        summary: result.summary || '',
        details: result.details || '',
        rollback: result.rollback || '',
        startedAt,
        finishedAt: this.clock().toISOString()
      };
      this.publish('repair.done', {
        repairId: this.repairRecord.repairId,
        outcome,
        summary: this.repairRecord.summary,
        ...(this.repairRecord.details ? { details: this.repairRecord.details } : {}),
        ...(this.repairRecord.rollback ? { rollback: this.repairRecord.rollback } : {})
      });
      this.setStatus('repair', outcome === 'success' ? 'done' : 'error', outcome);
      this.activity(
        'repair',
        outcome === 'success' ? `Fix complete: ${this.repairRecord.summary}` : `Fix ${outcome}: ${this.repairRecord.summary}`,
        outcome === 'success' ? 'good' : 'bad'
      );
      this.audit('repair-finish', `${this.proposal.name}: ${outcome} - ${this.repairRecord.summary}`);
      await this.finalize(outcome === 'success' ? 'completed' : 'failed');
      return this.getPublicState();
    } catch (error) {
      await this.failJob(error, 'repair');
      throw error;
    }
  }

  async finalize(outcome) {
    this.assertCapability('lead', 'report.write');
    this.setStatus('lead', 'working', 'Writing the report');
    this.activity('lead', 'Collecting check evidence, the repair decision, and the audit trail.', 'info');
    this.handoff('repair', 'lead', 'Return the outcome for the USB report', outcome);
    this.phase = 'writing_report';
    this.publish('workflow.state', { phase: 'writing_report', message: 'Lead is writing the report to the USB drive.' });
    await sleep(this.stepDelayMs);

    const payload = {
      job: {
        id: this.jobId,
        startedAt: this.startedAt,
        finishedAt: this.clock().toISOString(),
        platform: this.platform.platform,
        simulated: this.platform.platform !== 'win32',
        checks: this.results
      },
      systemInfo: this.systemInfo || {},
      scan: this.scanRun,
      proposal: this.proposal
        ? {
            ...this.proposal,
            token: undefined
          }
        : null,
      decision: this.decision,
      repair: this.repairRecord,
      events: this.bus.history.slice(),
      capabilities: Object.fromEntries(
        Object.entries(AGENTS).map(([id, agent]) => [id, { tools: agent.tools, room: 'feather-lab' }])
      )
    };

    let saved = null;
    if (this.writer) {
      try {
        saved = await this.writer(payload);
      } catch (error) {
        this.audit('report-error', error.message || String(error));
        this.publish('job.error', { message: `The report could not be written: ${error.message}`, where: 'report' });
        this.error = error.message;
        this.phase = 'error';
        this.setStatus('lead', 'error', 'Report failed');
        this.activity('lead', `Report failed: ${error.message}`, 'bad');
        throw error;
      }
    }

    this.report = saved;
    if (saved) {
      this.publish('report.saved', {
        reports: saved.reports || [],
        directory: saved.directory || '',
        fallback: Boolean(saved.fallback),
        ...(saved.warning ? { warning: saved.warning } : {})
      });
      this.activity(
        'lead',
        saved.warning ? `Report saved with a warning: ${saved.warning}` : `Report saved to ${saved.directory}.`,
        saved.warning ? 'warn' : 'good'
      );
    }
    this.finishedAt = this.clock().toISOString();
    this.phase = 'done';
    this.publish('job.done', {
      jobId: this.jobId,
      outcome,
      summary:
        outcome === 'completed'
          ? 'Diagnostics and the approved repair finished. Report written.'
          : outcome === 'declined'
            ? 'Diagnostics finished. The repair was declined and nothing was changed. Report written.'
            : 'Diagnostics finished. The repair did not complete successfully. Report written.',
      reports: saved ? saved.reports || [] : []
    });
    this.publish('workflow.state', { phase: 'done', message: 'Job complete.' });
    this.setStatus('lead', 'done', 'Job complete');
    this.setStatus('scanner', 'done', 'Scan complete');
    this.audit('job-done', `${this.jobId}: ${outcome}`);
    return this.getPublicState();
  }

  async failJob(error, where) {
    this.error = error.message || String(error);
    this.phase = 'error';
    this.publish('job.error', { message: this.error, where });
    this.publish('workflow.state', { phase: 'error', message: this.error });
    this.setStatus('lead', 'error', 'Job stopped');
    this.setStatus('scanner', 'idle', 'Stopped');
    this.setStatus('repair', 'idle', 'Stopped');
    this.activity('lead', `Job stopped: ${this.error}`, 'bad');
    this.audit('job-error', `${where}: ${this.error}`);
  }

  cancel() {
    if (this.controller) this.controller.abort();
    this.audit('job-cancel', 'Cancellation requested');
    this.publish('job.error', { message: 'Cancellation requested.', where: 'user' });
  }

  reset() {
    if (!['done', 'error', 'idle'].includes(this.phase)) {
      throw new Error('The current job is still active.');
    }
    this.resetState();
    this.bus.history.length = 0;
    this.publish('workflow.state', { phase: 'idle', message: 'Workflow reset.' });
    return this.getPublicState();
  }
}

module.exports = { WorkflowOrchestrator, withTimeout };
