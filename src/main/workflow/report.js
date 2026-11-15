'use strict';

const { escapeHtml, formatDate } = require('../reports');

const STATUS_LABEL = {
  pass: 'PASS',
  info: 'INFO',
  warn: 'WARNING',
  fail: 'FAIL',
  error: 'ERROR',
  skip: 'UNAVAILABLE'
};

const STATUS_CLASS = {
  pass: 'pass',
  info: 'info',
  warn: 'warn',
  fail: 'fail',
  error: 'error',
  skip: 'skip'
};

function reportStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function reportBaseName(jobId, date = new Date()) {
  const safe = String(jobId || 'job').replace(/[^a-z0-9-]/gi, '').slice(0, 48);
  return `FeatherAI2-${safe}-${reportStamp(date)}`;
}

function agentName(id) {
  return { lead: 'Lead', scanner: 'Scanner', repair: 'Repair' }[id] || id;
}

function buildHtmlReport(data) {
  const { job = {}, systemInfo = {}, scan = {}, proposal = null, repair = null, decision = null, events = [], audit = [], version = '2.0.0', generatedAt = new Date().toISOString() } = data;
  const results = job.checks || scan.results || [];
  const summary = scan.summary || {};
  const counts = {
    pass: summary.pass || 0,
    info: summary.info || 0,
    warn: summary.warn || 0,
    fail: summary.fail || 0,
    error: summary.error || 0,
    skip: summary.skip || 0
  };

  const rows = results
    .map((result) => {
      const status = STATUS_CLASS[result.status] || 'info';
      return `<tr class="status-${status}">
        <td>${escapeHtml(result.name)}</td>
        <td><span class="badge ${status}">${escapeHtml(STATUS_LABEL[result.status] || result.status)}</span></td>
        <td>${escapeHtml(result.finding)}</td>
        <td class="num">${Number(result.durationMs || 0)} ms</td>
      </tr>`;
    })
    .join('\n');

  const details = results
    .map((result) => {
      const status = STATUS_CLASS[result.status] || 'info';
      return `<section class="detail">
        <h3>${escapeHtml(result.name)} <span class="badge ${status}">${escapeHtml(STATUS_LABEL[result.status] || result.status)}</span></h3>
        <p><strong>Finding:</strong> ${escapeHtml(result.finding)}</p>
        <h4>Observed evidence</h4>
        <pre>${escapeHtml(result.evidence)}</pre>
        <h4>Explanation</h4>
        <p>${escapeHtml(result.explanation)}</p>
        <h4>Suggested next step</h4>
        <p>${escapeHtml(result.nextStep)}</p>
      </section>`;
    })
    .join('\n');

  const proposalBlock = proposal
    ? `<div class="decision-card">
        <div class="decision-head">
          <span class="kicker">REPAIR PROPOSAL</span>
          <span class="badge ${decision === 'approved' ? 'pass' : decision === 'declined' ? 'skip' : 'warn'}">${escapeHtml((decision || 'pending').toUpperCase())}</span>
        </div>
        <h3>${escapeHtml(proposal.name)} <small>${escapeHtml(proposal.risk)} risk · ${proposal.admin ? 'administrator required' : 'no elevation'}</small></h3>
        <p><strong>Why this fix:</strong> ${escapeHtml(proposal.rationale)}</p>
        <p><strong>Impact if approved:</strong> ${escapeHtml(proposal.impact || '')}</p>
        <p><strong>Type:</strong> ${proposal.preventive ? 'Preventive / fallback maintenance' : 'Targeted repair'}${proposal.linkedCheckIds && proposal.linkedCheckIds.length ? ` · linked checks: ${escapeHtml(proposal.linkedCheckIds.join(', '))}` : ''}</p>
        <p><strong>User decision:</strong> ${escapeHtml(decision || 'not recorded')}</p>
      </div>`
    : '<p class="notice">No repair proposal was recorded for this job.</p>';

  const repairBlock = repair
    ? `<table class="kv">
        <tr><th>Action</th><td>${escapeHtml(repair.name)}</td></tr>
        <tr><th>Outcome</th><td><span class="badge ${repair.outcome === 'success' ? 'pass' : repair.outcome === 'declined' ? 'skip' : 'error'}">${escapeHtml(String(repair.outcome).toUpperCase())}</span></td></tr>
        <tr><th>Summary</th><td>${escapeHtml(repair.summary)}</td></tr>
        ${repair.startedAt ? `<tr><th>Started</th><td>${formatDate(repair.startedAt)}</td></tr>` : ''}
        <tr><th>Finished</th><td>${formatDate(repair.finishedAt)}</td></tr>
        ${repair.rollback ? `<tr><th>Rollback</th><td>${escapeHtml(repair.rollback)}</td></tr>` : ''}
      </table>
      ${repair.details ? `<h4>Repair output</h4><pre>${escapeHtml(repair.details)}</pre>` : ''}`
    : '<p class="notice">No repair command was run.</p>';

  const timeline = events
    .map(
      (event) => `<tr>
        <td class="mono">${escapeHtml(String(event.seq).padStart(3, '0'))}</td>
        <td class="mono">${escapeHtml(event.at)}</td>
        <td class="mono">${escapeHtml(event.type)}</td>
        <td>${escapeHtml(eventText(event))}</td>
      </tr>`
    )
    .join('\n');

  const auditRows = audit.length
    ? audit
        .map((entry) => `<tr><td>${formatDate(entry.at)}</td><td class="mono">${escapeHtml(entry.event)}</td><td>${escapeHtml(entry.detail || '')}</td></tr>`)
        .join('\n')
    : '<tr><td colspan="3">No separate audit entries.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feather AI 2.0 Report - ${escapeHtml(job.id || 'job')}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#070907; color:#d8e4cf; font:14px/1.55 "Segoe UI", Tahoma, Arial, sans-serif; }
  .wrap { max-width:1040px; margin:0 auto; padding:28px 24px 48px; }
  header { border:2px solid #b8ff38; background:#0d120a; padding:18px 20px; margin-bottom:22px; box-shadow:0 0 24px rgba(184,255,56,.08); }
  .brand { color:#b8ff38; font:700 12px/1 "Courier New", monospace; letter-spacing:.22em; }
  h1 { margin:8px 0 4px; font:700 27px/1.15 "Courier New", monospace; color:#f3ffe6; letter-spacing:.02em; }
  .sub { color:#91a686; font:12px/1.5 "Courier New", monospace; }
  h2 { color:#b8ff38; font:700 13px/1.3 "Courier New", monospace; letter-spacing:.16em; margin:30px 0 10px; padding-bottom:6px; border-bottom:1px solid #26351f; }
  h3 { font-size:15px; margin:0 0 8px; color:#efffe2; }
  h3 small { color:#91a686; font-weight:400; font-size:12px; }
  h4 { color:#b8ff38; font:700 11px/1.3 "Courier New", monospace; letter-spacing:.12em; margin:14px 0 5px; text-transform:uppercase; }
  table { width:100%; border-collapse:collapse; margin:8px 0 16px; }
  th, td { border:1px solid #26351f; padding:7px 9px; text-align:left; vertical-align:top; }
  th { background:#111a0d; color:#b8ff38; font:700 11px/1.3 "Courier New", monospace; letter-spacing:.08em; }
  tr.status-warn td { background:rgba(255,179,71,.06); }
  tr.status-fail td, tr.status-error td { background:rgba(255,80,80,.07); }
  tr.status-skip td { color:#829277; }
  .badge { display:inline-block; padding:1px 7px; border:1px solid currentColor; font:700 10px/1.6 "Courier New", monospace; letter-spacing:.08em; white-space:nowrap; }
  .badge.pass { color:#b8ff38; } .badge.info { color:#66e0ff; } .badge.warn { color:#ffb347; }
  .badge.fail, .badge.error { color:#ff6b6b; } .badge.skip { color:#8a9b80; }
  .num { text-align:right; white-space:nowrap; color:#91a686; }
  .mono { font-family:"Courier New", monospace; }
  .notice { border-left:3px solid #b8ff38; background:#0d120a; padding:10px 12px; color:#b7c9ac; }
  .decision-card { border:2px solid #ffb347; background:#120f08; padding:16px 18px; margin:12px 0 18px; }
  .decision-head { display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .kicker { color:#ffb347; font:700 11px/1 "Courier New", monospace; letter-spacing:.18em; }
  .kv th { width:150px; }
  pre { background:#0b1008; border:1px solid #26351f; padding:10px; white-space:pre-wrap; word-break:break-word; font:12px/1.5 "Courier New", monospace; color:#c7d8bd; }
  .detail { border-top:1px solid #1d2818; padding:14px 0 4px; }
  footer { border-top:1px solid #26351f; color:#77856e; font:11px/1.6 "Courier New", monospace; margin-top:34px; padding-top:12px; }
  .sim { border:1px solid #ffb347; color:#ffb347; padding:8px 12px; margin:0 0 18px; font-family:"Courier New", monospace; font-size:12px; }
  @media print { body { background:#fff; color:#111; } .wrap { max-width:none; } header, .decision-card { box-shadow:none; } h1,h2,h3,h4,.brand { color:#111; } th { background:#eee; color:#111; } td,th { border-color:#bbb; } pre { background:#f5f5f5; color:#111; border-color:#ccc; } }
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand">FEATHER AI // 2.0 // OFFLINE USB REPAIR</div>
  <h1>Diagnostic &amp; Repair Report</h1>
  <div class="sub">Job ${escapeHtml(job.id || 'unknown')} · generated ${escapeHtml(formatDate(generatedAt))} · Feather AI ${escapeHtml(version)}</div>
</header>

${job.simulated ? '<div class="sim">SIMULATED RUN — this report came from the development platform, not a real Windows diagnostic scan.</div>' : ''}

<section>
  <h2>MACHINE</h2>
  <table class="kv">
    <tr><th>Computer name</th><td>${escapeHtml(systemInfo.computerName || 'unknown')}</td></tr>
    <tr><th>Operating system</th><td>${escapeHtml(systemInfo.osName || 'unknown')}</td></tr>
    <tr><th>Details</th><td>${escapeHtml(systemInfo.osDetail || 'unknown')}</td></tr>
    <tr><th>Current user</th><td>${escapeHtml(systemInfo.user || 'unknown')}</td></tr>
    <tr><th>Administrator rights</th><td>${systemInfo.admin ? 'Yes' : 'No'}</td></tr>
    <tr><th>Mode</th><td>${escapeHtml(systemInfo.mode || 'Offline - local only')}</td></tr>
    <tr><th>Platform adapter</th><td>${escapeHtml(job.platform || 'unknown')}</td></tr>
    <tr><th>Check window</th><td>${escapeHtml(formatDate(job.startedAt))} → ${escapeHtml(formatDate(job.finishedAt))}</td></tr>
  </table>
</section>

<section>
  <h2>WORKFLOW</h2>
  <table>
    <tr><th>Lead</th><td>Opened the job, sequenced both handoffs, and wrote this report.</td></tr>
    <tr><th>Scanner</th><td>Ran ${results.length} read-only diagnostics. No repair commands were available to Scanner.</td></tr>
    <tr><th>Repair</th><td>${proposal ? escapeHtml(proposal.name) : 'No proposal'} · ${escapeHtml(decision || 'no decision')}${repair ? ` · ${escapeHtml(repair.outcome)}` : ''}</td></tr>
  </table>
</section>

<section>
  <h2>SUMMARY</h2>
  <table>
    <thead><tr><th>Total</th><th>Pass</th><th>Info</th><th>Warning</th><th>Fail</th><th>Error</th><th>Unavailable</th></tr></thead>
    <tbody><tr>
      <td>${results.length}</td><td>${counts.pass}</td><td>${counts.info}</td><td>${counts.warn}</td>
      <td>${counts.fail}</td><td>${counts.error}</td><td>${counts.skip}</td>
    </tr></tbody>
  </table>
  <p class="notice">A warning or failure is a measured condition, not proof of compromise. "Unavailable" means the check did not apply or could not be measured; it is not a pass.</p>
</section>

<section>
  <h2>DIAGNOSTIC RESULTS</h2>
  <table>
    <thead><tr><th style="width:26%">Check</th><th style="width:12%">Status</th><th>Finding</th><th style="width:9%">Time</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No results.</td></tr>'}</tbody>
  </table>
</section>

<section>
  <h2>REPAIR PROPOSAL AND DECISION</h2>
  ${proposalBlock}
  ${repairBlock}
</section>

<section>
  <h2>EVIDENCE AND GUIDANCE</h2>
  ${details || '<p>No evidence sections.</p>'}
</section>

<section>
  <h2>WORKFLOW EVENT TIMELINE</h2>
  <table>
    <thead><tr><th style="width:50px">#</th><th style="width:190px">Time</th><th style="width:190px">Event</th><th>Detail</th></tr></thead>
    <tbody>${timeline || '<tr><td colspan="4">No events.</td></tr>'}</tbody>
  </table>
</section>

<section>
  <h2>AUDIT TRAIL</h2>
  <table>
    <thead><tr><th style="width:190px">Time</th><th style="width:180px">Event</th><th>Detail</th></tr></thead>
    <tbody>${auditRows}</tbody>
  </table>
</section>

<footer>
  Generated locally by Feather AI 2.0. No telemetry was uploaded and no network request is required. This report contains local system information; store it appropriately.
  Read-only checks were run by Scanner. Repair could only run the single predefined action shown above, only after an explicit approval, and only once.
</footer>
</div>
</body>
</html>`;
}

function eventText(event) {
  const p = event.payload || {};
  switch (event.type) {
    case 'agent.status':
      return `${agentName(p.agentId)} → ${p.status}${p.task ? ` (${p.task})` : ''}`;
    case 'agent.activity':
      return `${agentName(p.agentId)}: ${p.text}`;
    case 'handoff':
      return `${agentName(p.from)} → ${agentName(p.to)}: ${p.reason}${p.summary ? ` [${p.summary}]` : ''}`;
    case 'job.start':
      return `${p.jobId} · ${p.checkCount} checks`;
    case 'scan.check.start':
      return `${p.index}/${p.total} ${p.name}`;
    case 'scan.check.result':
      return `${p.name}: ${String(p.status).toUpperCase()} — ${p.finding}`;
    case 'scan.done':
      return `Scan complete: ${p.summary.pass} pass, ${p.summary.warn} warn, ${p.summary.fail} fail, ${p.summary.error} error, ${p.summary.unavailable} unavailable`;
    case 'repair.proposed':
      return `${p.name} (${p.risk}) — ${p.rationale}`;
    case 'repair.decision':
      return `User ${p.decision} the proposed repair`;
    case 'repair.start':
      return `${p.name} started`;
    case 'repair.done':
      return `${p.outcome}: ${p.summary}`;
    case 'report.saved':
      return `${(p.reports || []).map((entry) => entry.name || entry.path || entry).join(', ')} in ${p.directory}`;
    case 'job.done':
      return `${p.outcome}: ${p.summary}`;
    case 'job.error':
      return `${p.where || 'job'}: ${p.message}`;
    case 'workflow.state':
      return `${p.phase}: ${p.message || ''}`;
    case 'usb.status':
      return `USB root ${p.root} · reports ${p.reportsDir} · writable ${p.writable}`;
    default:
      return JSON.stringify(p);
  }
}

function buildTextReport(data) {
  const { job = {}, systemInfo = {}, scan = {}, proposal = null, repair = null, decision = null, events = [], version = '2.0.0', generatedAt = new Date().toISOString() } = data;
  const results = job.checks || scan.results || [];
  const summary = scan.summary || {};
  const lines = [];
  lines.push('FEATHER AI 2.0 — DIAGNOSTIC & REPAIR REPORT');
  lines.push('='.repeat(78));
  lines.push(`Job: ${job.id || 'unknown'}`);
  lines.push(`Generated: ${formatDate(generatedAt)}`);
  lines.push(`Version: ${version}`);
  lines.push(`Computer: ${systemInfo.computerName || 'unknown'}`);
  lines.push(`Operating system: ${systemInfo.osName || 'unknown'}`);
  lines.push(`Details: ${systemInfo.osDetail || 'unknown'}`);
  lines.push(`User: ${systemInfo.user || 'unknown'}`);
  lines.push(`Administrator: ${systemInfo.admin ? 'yes' : 'no'}`);
  lines.push(`Platform: ${job.platform || 'unknown'}${job.simulated ? ' (SIMULATED)' : ''}`);
  lines.push(`Started: ${formatDate(job.startedAt)}`);
  lines.push(`Finished: ${formatDate(job.finishedAt)}`);
  lines.push('');
  lines.push(`SUMMARY: ${results.length} checks | pass ${summary.pass || 0} | info ${summary.info || 0} | warn ${summary.warn || 0} | fail ${summary.fail || 0} | error ${summary.error || 0} | unavailable ${summary.skip || 0}`);
  lines.push('');
  for (const result of results) {
    lines.push('-'.repeat(78));
    lines.push(`[${STATUS_LABEL[result.status] || result.status}] ${result.name}`);
    lines.push(`Finding: ${result.finding}`);
    lines.push('Evidence:');
    lines.push(String(result.evidence).split('\n').map((line) => `  ${line}`).join('\n'));
    lines.push(`Explanation: ${result.explanation}`);
    lines.push(`Next step: ${result.nextStep}`);
    lines.push('');
  }
  lines.push('-'.repeat(78));
  lines.push('REPAIR PROPOSAL');
  if (proposal) {
    lines.push(`Action: ${proposal.name}`);
    lines.push(`Risk: ${proposal.risk} | Administrator: ${proposal.admin ? 'yes' : 'no'} | Reboot: ${proposal.reboot ? 'yes' : 'no'}`);
    lines.push(`Why: ${proposal.rationale}`);
    lines.push(`Impact: ${proposal.impact}`);
    lines.push(`Decision: ${decision || 'not recorded'}`);
  } else {
    lines.push('None.');
  }
  lines.push('');
  lines.push('REPAIR OUTCOME');
  if (repair) {
    lines.push(`${repair.outcome.toUpperCase()} — ${repair.summary}`);
    if (repair.startedAt) lines.push(`Started: ${formatDate(repair.startedAt)}`);
    if (repair.finishedAt) lines.push(`Finished: ${formatDate(repair.finishedAt)}`);
    if (repair.details) {
      lines.push('Details:');
      lines.push(String(repair.details).split('\n').map((line) => `  ${line}`).join('\n'));
    }
    if (repair.rollback) lines.push(`Rollback: ${repair.rollback}`);
  } else {
    lines.push('No repair command was run.');
  }
  lines.push('');
  lines.push('EVENT TIMELINE');
  for (const event of events) {
    lines.push(`  ${String(event.seq).padStart(3, '0')} ${event.at} ${event.type}: ${eventText(event)}`);
  }
  lines.push('');
  lines.push('Generated locally by Feather AI 2.0. No telemetry was uploaded.');
  lines.push('');
  return lines.join('\n');
}

function buildJsonReport(data) {
  return JSON.stringify(
    {
      product: 'Feather AI 2.0',
      schema: 'feather-ai-2/report@1',
      version: data.version || '2.0.0',
      generatedAt: data.generatedAt || new Date().toISOString(),
      job: data.job || {},
      systemInfo: data.systemInfo || {},
      scan: data.scan || {},
      proposal: data.proposal || null,
      decision: data.decision || null,
      repair: data.repair || null,
      capabilities: data.capabilities || {},
      events: data.events || [],
      audit: data.audit || []
    },
    null,
    2
  );
}

module.exports = { buildHtmlReport, buildTextReport, buildJsonReport, reportBaseName, reportStamp, STATUS_LABEL };
