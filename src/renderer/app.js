'use strict';

/**
 * Feather AI 2.0 dashboard controller.
 *
 * The UI never invents workflow progress. It renders the bootstrap snapshot and
 * then folds the frozen event stream from the main process into the same state.
 * Failed, errored, and unavailable checks keep their measured status.
 */
const UI = (() => {
  const $ = (selector) => document.querySelector(selector);
  const api = window.feather;
  const lab = window.Lab;

  const STATUS_LABEL = {
    pass: 'PASS',
    info: 'INFO',
    warn: 'WARN',
    fail: 'FAIL',
    error: 'ERROR',
    skip: 'UNAVAILABLE'
  };
  const STATUS_ORDER = ['pass', 'info', 'warn', 'fail', 'error', 'skip'];
  const BUSY_PHASES = new Set(['scanning', 'awaiting_approval', 'repairing', 'writing_report']);
  const PHASE_LABEL = {
    idle: 'IDLE',
    scanning: 'SCANNING',
    awaiting_approval: 'AWAITING APPROVAL',
    repairing: 'REPAIRING',
    writing_report: 'WRITING REPORT',
    done: 'COMPLETE',
    error: 'STOPPED'
  };
  const AGENT_NAME = { lead: 'LEAD', scanner: 'SCANNER', repair: 'REPAIR', system: 'SYSTEM' };

  const state = {
    bootstrapped: false,
    queued: [],
    lastSeq: 0,
    phase: 'idle',
    jobId: null,
    total: 0,
    rows: new Map(),
    rowOrder: [],
    results: new Map(),
    proposal: null,
    decision: null,
    repair: null,
    report: null,
    reviewing: false,
    busy: false,
    starting: false,
    deciding: false,
    version: '2.0.0'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shortClock(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '--:--:--';
    return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function baseName(fullPath) {
    if (!fullPath) return '—';
    const parts = String(fullPath).split(/[\\/]/).filter(Boolean);
    return parts.slice(-2).join('/') || fullPath;
  }

  function setText(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text;
  }

  function setHidden(selector, hidden) {
    const node = $(selector);
    if (node) node.hidden = hidden;
  }

  // ---------------------------------------------------------------- activity

  function addActivity(agentId, text, tone = 'info', at = null) {
    const feed = $('#activity');
    if (!feed) return;
    feed.querySelector('.activity-empty')?.remove();

    const item = document.createElement('div');
    item.className = `activity-item tone-${['good', 'warn', 'bad', 'info'].includes(tone) ? tone : 'info'}`;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = shortClock(at);

    const msg = document.createElement('div');
    msg.className = 'msg';
    const tag = document.createElement('span');
    tag.className = `agent-tag ${AGENT_NAME[agentId] ? agentId : 'system'}`;
    tag.textContent = AGENT_NAME[agentId] || 'SYSTEM';
    msg.appendChild(tag);
    msg.appendChild(document.createTextNode(String(text ?? '')));

    item.append(time, msg);
    feed.appendChild(item);
    while (feed.querySelectorAll('.activity-item').length > 250) {
      feed.querySelector('.activity-item')?.remove();
    }
    feed.scrollTop = feed.scrollHeight;
    setText('#activity-count', String(feed.querySelectorAll('.activity-item').length));
  }

  function clearActivity() {
    const feed = $('#activity');
    if (!feed) return;
    feed.replaceChildren();
    setText('#activity-count', '0');
  }

  // ------------------------------------------------------------------ checks

  function ensureChecks(checks) {
    const host = $('#checks');
    if (!host) return;
    host.replaceChildren();
    state.rows.clear();
    state.rowOrder = [];
    for (const check of checks || []) addCheckRow(check);
    setHidden('#checks-empty', Boolean((checks || []).length));
    updateProgress();
  }

  function addCheckRow(check) {
    const host = $('#checks');
    if (!host) return null;
    const row = document.createElement('details');
    row.className = 'check-row';
    row.dataset.status = 'queued';
    row.dataset.checkId = check.id;
    row.dataset.unavailable = 'false';
    row.dataset.failed = 'false';

    const summary = document.createElement('summary');
    const dot = document.createElement('span');
    dot.className = 'check-dot';
    const main = document.createElement('span');
    main.className = 'check-main';
    const name = document.createElement('span');
    name.className = 'check-name';
    name.textContent = check.name;
    const finding = document.createElement('span');
    finding.className = 'check-finding';
    finding.textContent = check.description || 'Waiting for Scanner.';
    main.append(name, finding);
    const badge = document.createElement('span');
    badge.className = 'check-badge';
    badge.textContent = 'QUEUED';
    summary.append(dot, main, badge);

    const evidence = document.createElement('div');
    evidence.className = 'check-evidence';
    evidence.hidden = true;

    row.append(summary, evidence);
    host.appendChild(row);
    state.rows.set(check.id, row);
    state.rowOrder.push(check.id);
    return row;
  }

  function updateCheckRow(checkId, patch = {}) {
    let row = state.rows.get(checkId);
    if (!row) {
      addCheckRow({ id: checkId, name: patch.name || checkId, description: '' });
      row = state.rows.get(checkId);
      if (!row) return;
    }
    const status = STATUS_LABEL[patch.status] ? patch.status : 'info';
    row.dataset.status = status;
    row.dataset.unavailable = String(status === 'skip');
    row.dataset.failed = String(status === 'fail' || status === 'error');

    const badge = row.querySelector('.check-badge');
    if (badge) badge.textContent = STATUS_LABEL[status] || String(status).toUpperCase();
    const name = row.querySelector('.check-name');
    if (name && patch.name) name.textContent = patch.name;
    const finding = row.querySelector('.check-finding');
    if (finding) finding.textContent = patch.finding || STATUS_LABEL[status];

    const evidence = row.querySelector('.check-evidence');
    if (evidence) {
      if (patch.evidence || patch.explanation || patch.nextStep) {
        const explanation = patch.explanation || '';
        const nextStep = patch.nextStep || '';
        evidence.innerHTML = `
          <div class="ev-label">OBSERVED EVIDENCE</div>
          <pre>${escapeHtml(patch.evidence || 'No evidence was returned.')}</pre>
          ${explanation ? `<p><strong>Why:</strong> ${escapeHtml(explanation)}</p>` : ''}
          ${nextStep ? `<p><strong>Next step:</strong> ${escapeHtml(nextStep)}</p>` : ''}`;
        evidence.hidden = false;
      }
    }
  }

  function summarizeRows() {
    const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
    for (const status of state.results.values()) {
      if (counts[status] !== undefined) counts[status] += 1;
    }
    for (const status of STATUS_ORDER) {
      const chip = $(`[data-chip="${status}"]`);
      if (chip) chip.textContent = `${status === 'skip' ? 'UNAVAILABLE' : status.toUpperCase()} ${counts[status]}`;
    }
    const done = state.results.size;
    setText('#result-count', `${done}/${state.total || state.rowOrder.length}`);
    setText('#scan-chip', `SCAN ${done}/${state.total || state.rowOrder.length}`);
    const bar = $('#progress-bar');
    if (bar) {
      const total = state.total || state.rowOrder.length || 0;
      bar.style.width = `${total ? Math.min(100, Math.round((done / total) * 100)) : 0}%`;
    }
    return counts;
  }

  function updateProgress() {
    summarizeRows();
  }

  // ------------------------------------------------------------------ phases

  function setPhase(phase, message) {
    const next = PHASE_LABEL[phase] ? phase : 'idle';
    state.phase = next;
    state.busy = BUSY_PHASES.has(next);
    setText('#phase-label', PHASE_LABEL[next]);
    if (message) setText('#lab-message', message);
    const startButton = $('#btn-start');
    if (startButton) {
      startButton.disabled = state.busy || state.starting || state.deciding;
      startButton.textContent =
        next === 'done' || next === 'error'
          ? '▶ START NEW PROCESS'
          : state.busy
            ? next === 'awaiting_approval'
              ? 'AWAITING APPROVAL'
              : 'RUNNING…'
            : '▶ START PROCESS';
    }
  }

  function setStartButtonIdleLabel() {
    const startButton = $('#btn-start');
    if (!startButton) return;
    startButton.disabled = state.busy || state.starting || state.deciding;
    startButton.textContent = state.busy
      ? state.phase === 'awaiting_approval'
        ? 'AWAITING APPROVAL'
        : 'RUNNING…'
      : '▶ START PROCESS';
  }

  function setStatus(agentId, status, task) {
    const node = $(`#status-${agentId}`);
    const hud = document.querySelector(`.agent-hud[data-agent="${agentId}"]`);
    if (node) node.textContent = String(task || status || 'IDLE').toUpperCase().slice(0, 46);
    if (hud) {
      hud.classList.remove('working', 'waiting', 'done', 'error');
      if (['working', 'waiting', 'done', 'error'].includes(status)) hud.classList.add(status);
    }
    lab?.setStatus(agentId, status);
  }

  function setStatuses(map) {
    for (const [agentId, value] of Object.entries(map || {})) {
      const status = value && typeof value === 'object' ? value.status : value;
      const task = value && typeof value === 'object' ? value.task : '';
      setStatus(agentId, status, task);
    }
  }

  // ------------------------------------------------------------- repair card

  function proposalMeta(proposal) {
    const parts = [
      `<span class="risk">RISK: ${escapeHtml(proposal.risk || 'UNKNOWN')}</span>`,
      `<span>${proposal.admin ? 'ADMIN REQUIRED' : 'NO ELEVATION'}</span>`,
      `<span>${proposal.reboot ? 'RESTART NEEDED' : 'NO RESTART'}</span>`
    ];
    if (proposal.preventive) parts.push('<span>PREVENTIVE</span>');
    return `<div class="repair-meta">${parts.join('')}</div>`;
  }

  function renderRepairIdle() {
    const card = $('#repair-card');
    if (card) card.dataset.state = 'idle';
    setText('#gate-badge', 'LOCKED');
    setHidden('#gate-badge', false);
    const body = $('#repair-body');
    if (!body) return;
    body.innerHTML = `
      <div class="idle-glyph small">▣</div>
      <p class="repair-idle">Repair cannot act yet. Scanner must finish a read-only pass first. Any proposed fix stays behind <strong>Review fix</strong>.</p>`;
  }

  function renderProposal(proposal, options = {}) {
    const card = $('#repair-card');
    const body = $('#repair-body');
    if (!card || !body) return;
    state.proposal = proposal;
    state.reviewing = Boolean(options.reviewing);
    const available = proposal.available !== false;
    card.dataset.state = proposal.status === 'approved' ? 'approved' : proposal.status === 'declined' ? 'declined' : 'proposed';
    setText('#gate-badge', proposal.status === 'approved' ? 'APPROVED' : proposal.status === 'declined' ? 'DECLINED' : available ? 'READY FOR REVIEW' : 'UNAVAILABLE');

    const linked = (proposal.linkedCheckIds || []).length
      ? `<p class="detail-line"><strong>Linked checks:</strong> ${escapeHtml((proposal.linkedCheckIds || []).join(', '))}</p>`
      : '';
    const unavailable = available
      ? ''
      : `<p class="detail-line"><strong>Unavailable here:</strong> ${escapeHtml(proposal.unavailableReason || proposal.evidence || 'This fix is not available on this computer.')}</p>`;

    body.innerHTML = `
      <div class="eyebrow">PROPOSED BY REPAIR</div>
      <div class="repair-title">${escapeHtml(proposal.name)}</div>
      <p class="repair-why">${escapeHtml(proposal.rationale || '')}</p>
      ${proposalMeta(proposal)}
      <div class="review-row">
        <button id="btn-review" class="pixel-btn secondary" ${options.reviewing ? 'hidden' : ''}>REVIEW FIX</button>
        <span class="review-hint">Nothing is executed until you review this specific fix and approve it.</span>
      </div>
      <div id="repair-details" class="repair-details" ${options.reviewing ? '' : 'hidden'}>
        <p class="detail-line"><strong>What it does:</strong> ${escapeHtml(proposal.description || '')}</p>
        <p class="detail-line"><strong>Impact if approved:</strong> ${escapeHtml(proposal.impact || '')}</p>
        ${linked}
        ${unavailable}
        <div class="decision-row">
          <button id="btn-approve" class="pixel-btn" ${available ? '' : 'disabled'}>APPROVE FIX</button>
          <button id="btn-decline" class="pixel-btn danger">DECLINE</button>
        </div>
        <p class="review-hint" style="margin-top:7px">${available ? 'Approval is single-use. The action runs once, then the outcome is written to the USB report.' : 'Repair is not available here, so approval is disabled. You can decline and still keep the diagnostic report.'}</p>
      </div>`;

    $('#btn-review')?.addEventListener('click', () => {
      state.reviewing = true;
      renderProposal(proposal, { reviewing: true });
      $('#btn-approve')?.focus();
    });
    $('#btn-approve')?.addEventListener('click', () => decide('approve'));
    $('#btn-decline')?.addEventListener('click', () => decide('decline'));
  }

  function renderDecisionPending(decision) {
    const card = $('#repair-card');
    const body = $('#repair-body');
    if (!card || !body || !state.proposal) return;
    card.dataset.state = decision === 'approved' ? 'approved' : 'declined';
    setText('#gate-badge', decision === 'approved' ? 'APPROVED' : 'DECLINED');
    const proposal = state.proposal;
    body.innerHTML = `
      <div class="eyebrow">${decision === 'approved' ? 'APPROVED BY YOU' : 'DECLINED BY YOU'}</div>
      <div class="repair-title">${escapeHtml(proposal.name)}</div>
      ${proposalMeta(proposal)}
      <div class="outcome-box ${decision === 'approved' ? 'success' : 'declined'}">
        <div class="outcome-head"><strong>${decision === 'approved' ? 'RUNNING' : 'NO CHANGES'}</strong><span>${escapeHtml(shortClock())}</span></div>
        <p>${decision === 'approved' ? 'Repair is running the single approved action. Waiting for the outcome…' : 'Repair was declined. No repair command was run and nothing on this computer was changed.'}</p>
      </div>`;
  }

  function renderRepairOutcome(repair, proposal) {
    const card = $('#repair-card');
    const body = $('#repair-body');
    if (!card || !body) return;
    const outcome = repair.outcome || 'failed';
    card.dataset.state = outcome === 'success' ? 'done' : outcome === 'declined' ? 'declined' : 'proposed';
    setText('#gate-badge', String(outcome).toUpperCase());
    const tone = outcome === 'success' ? 'success' : outcome === 'declined' ? 'declined' : 'failed';
    const details = repair.details
      ? `<pre>${escapeHtml(repair.details)}</pre>`
      : '';
    const rollback = repair.rollback
      ? `<p><strong>Rollback:</strong> ${escapeHtml(repair.rollback)}</p>`
      : '';
    body.innerHTML = `
      <div class="eyebrow">REPAIR OUTCOME</div>
      <div class="repair-title">${escapeHtml(repair.name || proposal?.name || 'Repair')}</div>
      ${proposal ? proposalMeta(proposal) : ''}
      <div class="outcome-box ${tone}">
        <div class="outcome-head"><strong>${escapeHtml(String(outcome).toUpperCase())}</strong><span>${escapeHtml(shortClock(repair.finishedAt))}</span></div>
        <p>${escapeHtml(repair.summary || '')}</p>
        ${details}
        ${rollback}
      </div>`;
  }

  async function decide(decision) {
    if (state.deciding || !state.proposal || state.proposal.status !== 'pending') return;
    state.deciding = true;
    setStartButtonIdleLabel();
    document.querySelectorAll('#btn-approve, #btn-decline').forEach((button) => {
      button.disabled = true;
    });
    renderDecisionPending(decision);
    try {
      const result = await api.decide({ proposalId: state.proposal.proposalId, decision });
      if (!result.ok) throw new Error(result.error || 'The decision could not be recorded.');
      if (result.state) syncState(result.state);
    } catch (error) {
      addActivity('system', `Decision failed: ${error.message}`, 'bad');
      setText('#lab-message', `DECISION FAILED: ${error.message}`);
      if (state.proposal) renderProposal(state.proposal, { reviewing: true });
    } finally {
      state.deciding = false;
      setStartButtonIdleLabel();
    }
  }

  // -------------------------------------------------------------- report card

  function renderReport(report) {
    if (!report) return;
    state.report = report;
    const fallback = Boolean(report.fallback);
    setText('#report-status', fallback ? 'Report saved to the Documents fallback.' : 'Report saved to the USB report folder.');
    setText('#report-path', report.directory || '—');
    const warning = $('#report-warning');
    if (warning) {
      warning.hidden = !report.warning;
      warning.textContent = report.warning || '';
    }
    const files = $('#report-files');
    if (files) {
      files.replaceChildren();
      for (const entry of report.reports || []) {
        const link = document.createElement('a');
        link.href = '#';
        link.dataset.path = entry.path;
        link.textContent = `${String(entry.format || '').toUpperCase()} ${entry.name || ''}`.trim();
        link.title = entry.path;
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            await api.openReport(entry.path);
          } catch (error) {
            addActivity('system', `Could not open the report: ${error.message}`, 'bad');
          }
        });
        files.appendChild(link);
      }
    }
  }

  function renderUsb(usb) {
    if (!usb) return;
    const label = $('#usb-label');
    const pill = $('#usb-pill');
    if (label) label.textContent = usb.fallback ? 'DOCUMENTS FALLBACK' : baseName(usb.reportsDir || usb.root);
    if (pill) pill.title = `Reports: ${usb.reportsDir || 'unknown'}`;
    if (usb.warning) {
      const warning = $('#report-warning');
      if (warning) {
        warning.hidden = false;
        warning.textContent = usb.warning;
      }
    }
  }

  // ------------------------------------------------------------- boot/sync

  function syncState(snapshot) {
    if (!snapshot) return;
    if (Array.isArray(snapshot.results)) {
      for (const result of snapshot.results) applyResult({ ...result, unavailable: result.status === 'skip' });
    }
    if (snapshot.phase) {
      const phaseMap = {
        idle: 'idle',
        scanning: 'scanning',
        awaiting_approval: 'awaiting_approval',
        repairing: 'repairing',
        writing_report: 'writing_report',
        done: 'done',
        error: 'error'
      };
      setPhase(phaseMap[snapshot.phase] || 'idle');
    }
    if (snapshot.proposal) {
      state.proposal = { ...snapshot.proposal };
      if (snapshot.proposal.status === 'pending') renderProposal(state.proposal, { reviewing: state.reviewing });
      else if (snapshot.repair) renderRepairOutcome(snapshot.repair, state.proposal);
      else renderDecisionPending(snapshot.proposal.status === 'approved' ? 'approved' : 'declined');
    }
    if (snapshot.repair) {
      state.repair = snapshot.repair;
      renderRepairOutcome(snapshot.repair, state.proposal);
    }
    if (snapshot.report) renderReport(snapshot.report);
    if (snapshot.jobId) {
      state.jobId = snapshot.jobId;
      setText('#job-chip', `JOB ${String(snapshot.jobId).slice(-8).toUpperCase()}`);
    }
  }

  function hydrate(data) {
    state.version = data.version || state.version;
    setText('#version-label', state.version);
    setText('#machine-label', data.systemInfo?.computerName || '—');
    setText('#mode-label', data.simulated ? 'SIMULATED / OFFLINE' : 'OFFLINE / LOCAL ONLY');

    if (data.simulated) {
      setText('#platform-label', 'SIMULATION — NO WINDOWS CHANGES');
      const badge = $('#sim-badge');
      if (badge) badge.hidden = false;
      const sub = $('#stage-sub');
      if (sub) sub.textContent = 'Simulated platform on this development host. The real Windows read-only checks run only in a Windows build.';
    } else {
      setText('#platform-label', 'WINDOWS READ-ONLY SCANNER');
    }

    renderUsb(data.usb);
    ensureChecks(data.checks || []);
    state.total = (data.checks || []).length;
    state.lastSeq = Math.max(0, ...((data.state?.events || []).map((event) => Number(event.seq) || 0)));

    const snapshot = data.state || {};
    if (snapshot.jobId) {
      state.jobId = snapshot.jobId;
      setText('#job-chip', `JOB ${String(snapshot.jobId).slice(-8).toUpperCase()}`);
    }
    syncState(snapshot);

    if (!snapshot.events || !snapshot.events.length) {
      renderRepairIdle();
      setPhase('idle');
    } else {
      // A reloaded window rebuilds the activity feed from the real event history.
      for (const event of snapshot.events) {
        if (event.type === 'agent.activity' || event.type === 'handoff' || event.type === 'job.start' || event.type === 'job.done') {
          addActivityFromEvent(event, false);
        }
      }
      setPhase(snapshot.phase || 'idle');
    }

    if (data.reports?.length) {
      const latest = data.reports[0];
      setText('#report-status', `${data.reports.length} earlier report${data.reports.length === 1 ? '' : 's'} in this folder. Latest: ${latest.name}`);
      setText('#report-path', data.usb?.reportsDir || baseName(latest.path));
    }

    state.bootstrapped = true;
    for (const event of state.queued) {
      if (!event.seq || event.seq > state.lastSeq) applyEvent(event, false);
    }
    state.queued.length = 0;
  }

  async function bootstrap() {
    try {
      const data = await api.bootstrap();
      hydrate(data);
    } catch (error) {
      addActivity('system', `Startup failed: ${error.message}`, 'bad');
      setText('#lab-message', `STARTUP FAILED: ${error.message}`);
      setPhase('error');
    }
  }

  // ------------------------------------------------------------ event folds

  function activityFromEvent(event) {
    const p = event.payload || {};
    if (event.type === 'agent.activity') return { agentId: p.agentId, text: p.text, tone: p.tone, at: event.at };
    if (event.type === 'handoff') {
      return {
        agentId: 'system',
        text: `HANDOFF ${AGENT_NAME[p.from]} → ${AGENT_NAME[p.to]}: ${p.reason}${p.summary ? ` (${p.summary})` : ''}`,
        tone: 'info',
        at: event.at
      };
    }
    if (event.type === 'job.start') return { agentId: 'lead', text: `Job opened with ${p.checkCount} read-only checks.`, tone: 'info', at: event.at };
    if (event.type === 'job.done') return { agentId: 'lead', text: `Job ${p.outcome}: ${p.summary}`, tone: p.outcome === 'completed' ? 'good' : 'warn', at: event.at };
    return null;
  }

  function addActivityFromEvent(event, scroll = true) {
    const entry = activityFromEvent(event);
    if (!entry) return;
    if (!scroll) {
      const feed = $('#activity');
      if (feed) {
        feed.querySelector('.activity-empty')?.remove();
        const item = document.createElement('div');
        item.className = `activity-item tone-${entry.tone || 'info'}`;
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = shortClock(entry.at);
        const msg = document.createElement('div');
        msg.className = 'msg';
        const tag = document.createElement('span');
        tag.className = `agent-tag ${AGENT_NAME[entry.agentId] ? entry.agentId : 'system'}`;
        tag.textContent = AGENT_NAME[entry.agentId] || 'SYSTEM';
        msg.append(tag, document.createTextNode(entry.text));
        item.append(time, msg);
        feed.appendChild(item);
        setText('#activity-count', String(feed.querySelectorAll('.activity-item').length));
        return;
      }
    }
    addActivity(entry.agentId, entry.text, entry.tone, entry.at);
  }

  function applyResult(result) {
    const id = result.checkId || result.id;
    if (!id) return;
    state.results.set(id, result.status);
    updateCheckRow(id, result);
    updateProgress();
  }

  function applyEvent(event, live = true) {
    if (!event || typeof event.type !== 'string') return;
    state.lastSeq = Math.max(state.lastSeq, Number(event.seq) || 0);
    const p = event.payload || {};

    switch (event.type) {
      case 'job.start':
        state.jobId = p.jobId;
        state.total = Number(p.checkCount) || state.rowOrder.length;
        state.results.clear();
        state.proposal = null;
        state.decision = null;
        state.repair = null;
        state.report = null;
        state.reviewing = false;
        clearActivity();
        setText('#job-chip', `JOB ${String(p.jobId || '').slice(-8).toUpperCase()}`);
        setText('#report-status', 'No report written yet.');
        setText('#report-path', '—');
        const files = $('#report-files');
        if (files) files.replaceChildren();
        setHidden('#report-warning', true);
        for (const [id, row] of state.rows) {
          row.dataset.status = 'queued';
          row.dataset.unavailable = 'false';
          row.dataset.failed = 'false';
          row.querySelector('.check-badge').textContent = 'QUEUED';
          row.querySelector('.check-finding').textContent = 'Waiting for Scanner.';
        }
        renderRepairIdle();
        setStatuses({ lead: 'working', scanner: 'idle', repair: 'idle' });
        setPhase('scanning', 'LEAD OPENED THE JOB');
        addActivityFromEvent(event);
        break;

      case 'agent.status':
        setStatus(p.agentId, p.status, p.task);
        break;

      case 'agent.activity':
        addActivityFromEvent(event);
        break;

      case 'handoff':
        lab?.handoff(p.from, p.to);
        addActivityFromEvent(event);
        setText('#lab-message', `${AGENT_NAME[p.from] || p.from} → ${AGENT_NAME[p.to] || p.to}: ${p.reason}`);
        break;

      case 'scan.check.start':
        setText('#scan-chip', `SCAN ${p.index}/${p.total}`);
        setText('#lab-message', `SCANNER READING ${String(p.name).toUpperCase()}…`);
        {
          const row = state.rows.get(p.checkId);
          if (row) {
            row.dataset.status = 'queued';
            const badge = row.querySelector('.check-badge');
            if (badge) badge.textContent = 'READING';
          }
        }
        break;

      case 'scan.check.result':
        applyResult(p);
        break;

      case 'scan.done': {
        const summary = p.summary || {};
        setText(
          '#lab-message',
          `SCAN COMPLETE // ${summary.pass || 0} PASS · ${summary.warn || 0} WARN · ${summary.fail || 0} FAIL · ${summary.error || 0} ERROR · ${summary.unavailable || 0} UNAVAILABLE`
        );
        break;
      }

      case 'repair.proposed':
        state.proposal = {
          proposalId: p.proposalId,
          repairId: p.repairId,
          name: p.name,
          risk: p.risk,
          rationale: p.rationale,
          impact: p.impact,
          description: p.description || '',
          linkedCheckIds: p.linkedCheckIds || [],
          preventive: Boolean(p.preventive),
          available: p.available !== false,
          unavailableReason: p.evidence || '',
          status: 'pending'
        };
        state.reviewing = false;
        renderProposal(state.proposal, { reviewing: false });
        setText('#lab-message', 'REPAIR PROPOSED A FIX — REVIEW REQUIRED');
        setPhase('awaiting_approval');
        addActivityFromEvent(event);
        break;

      case 'repair.decision':
        state.decision = p.decision;
        renderDecisionPending(p.decision);
        setText('#lab-message', p.decision === 'approved' ? 'REPAIR APPROVED — RUNNING THE SINGLE ACTION' : 'REPAIR DECLINED — NOTHING WILL BE CHANGED');
        addActivity('system', `User ${p.decision} the proposed repair.`, p.decision === 'approved' ? 'good' : 'info', event.at);
        break;

      case 'repair.start':
        setText('#lab-message', `REPAIR RUNNING: ${String(p.name).toUpperCase()}`);
        setPhase('repairing');
        break;

      case 'repair.done':
        state.repair = {
          repairId: p.repairId,
          name: state.proposal?.name || p.repairId,
          outcome: p.outcome,
          summary: p.summary,
          details: p.details || '',
          rollback: p.rollback || '',
          finishedAt: event.at || new Date().toISOString()
        };
        renderRepairOutcome(state.repair, state.proposal);
        setText('#lab-message', `REPAIR ${String(p.outcome).toUpperCase()}: ${p.summary}`);
        break;

      case 'report.saved':
        renderReport({ reports: p.reports || [], directory: p.directory || '', fallback: Boolean(p.fallback), warning: p.warning || '' });
        setText('#lab-message', p.fallback ? 'REPORT SAVED TO DOCUMENTS FALLBACK' : 'REPORT SAVED TO THE USB REPORT FOLDER');
        addActivityFromEvent(event);
        break;

      case 'job.done':
        setPhase(p.outcome === 'completed' ? 'done' : p.outcome === 'declined' ? 'done' : 'error', `JOB ${String(p.outcome).toUpperCase()}`);
        setText('#phase-label', p.outcome === 'completed' ? 'COMPLETE' : p.outcome === 'declined' ? 'DECLINED' : p.outcome === 'cancelled' ? 'CANCELLED' : 'FAILED');
        addActivityFromEvent(event);
        break;

      case 'job.error':
        addActivity('system', `${String(p.where || 'job').toUpperCase()}: ${p.message}`, 'bad', event.at);
        setText('#lab-message', `STOPPED: ${p.message}`);
        setPhase('error');
        break;

      case 'workflow.state':
        setPhase(p.phase, p.message ? String(p.message).toUpperCase() : '');
        break;

      case 'usb.status':
        renderUsb({ root: p.root, reportsDir: p.reportsDir, fallback: false, warning: p.writable ? '' : 'The USB report folder is not writable.' });
        break;

      case 'window:maximized': {
        const button = $('#btn-max');
        if (button) button.textContent = p.maximized ? '❐' : '□';
        break;
      }

      default:
        break;
    }
    return live;
  }

  // -------------------------------------------------------------- interactions

  async function start() {
    if (state.starting || state.busy) return;
    state.starting = true;
    setPhase('scanning', 'LEAD IS OPENING THE JOB…');
    $('#btn-start').textContent = 'STARTING…';
    try {
      const result = await api.start();
      if (!result.ok) {
        addActivity('system', `Job failed to start: ${result.error}`, 'bad');
        setPhase('error', `START FAILED: ${result.error}`);
        return;
      }
      if (result.state) syncState(result.state);
    } catch (error) {
      addActivity('system', `Job failed to start: ${error.message}`, 'bad');
      setPhase('error', `START FAILED: ${error.message}`);
    } finally {
      state.starting = false;
      setStartButtonIdleLabel();
    }
  }

  function wireControls() {
    $('#btn-start')?.addEventListener('click', start);
    $('#btn-min')?.addEventListener('click', () => api.window.minimize());
    $('#btn-max')?.addEventListener('click', async () => {
      const maximized = await api.window.toggleMaximize();
      const button = $('#btn-max');
      if (button) button.textContent = maximized ? '❐' : '□';
    });
    $('#btn-close')?.addEventListener('click', () => api.window.close());
    $('#btn-reports')?.addEventListener('click', async () => {
      try {
        await api.openReportsFolder();
      } catch (error) {
        addActivity('system', `Could not open the reports folder: ${error.message}`, 'bad');
      }
    });
  }

  function init() {
    wireControls();
    lab?.start();
    api.onEvent((event) => {
      if (!state.bootstrapped) {
        state.queued.push(event);
        return;
      }
      applyEvent(event);
    });
    bootstrap();
  }

  return { init, start, state };
})();

window.addEventListener('DOMContentLoaded', () => UI.init());
