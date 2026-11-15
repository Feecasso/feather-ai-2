'use strict';

/**
 * Feather AI 2.0 catalog.
 *
 * Scanner checks are read-only and come from Feather AI 1.0's Windows platform
 * module. Repairs are a deliberately small, predefined list. Nothing in this
 * file executes anything; the workflow gate in src/main/workflow/orchestrator.js
 * decides whether Repair may run a predefined action.
 */

const AGENTS = {
  lead: {
    id: 'lead',
    name: 'Lead',
    role: 'Job control',
    color: '#b8ff38',
    tools: ['job.plan', 'handoff', 'report.write'],
    description: 'Opens the job, sequences the handoffs, and closes the report.'
  },
  scanner: {
    id: 'scanner',
    name: 'Scanner',
    role: 'Read-only diagnostics',
    color: '#66e0ff',
    tools: ['diag.run', 'handoff'],
    description: 'Runs Windows diagnostics that only read local state.'
  },
  repair: {
    id: 'repair',
    name: 'Repair',
    role: 'Predefined fixes',
    color: '#ffb347',
    tools: ['repair.propose', 'repair.apply', 'handoff'],
    description: 'Turns findings into one predefined fix, then waits for approval.'
  }
};

const SCAN_CHECKS = [
  {
    id: 'os-info',
    name: 'Operating system',
    description: 'Windows edition, build, architecture, computer name, and model.',
    timeout: 20000
  },
  {
    id: 'cpu-memory',
    name: 'Processor and memory',
    description: 'CPU model, cores, installed memory, and current memory pressure.',
    timeout: 20000
  },
  {
    id: 'disk-space',
    name: 'System drive space',
    description: 'Free space on the drive that holds Windows.',
    timeout: 20000
  },
  {
    id: 'time-sync',
    name: 'Clock synchronization',
    description: 'Whether the Windows time service has a usable time source.',
    timeout: 25000
  },
  {
    id: 'pending-reboot',
    name: 'Pending restart',
    description: 'Whether an update or installer is waiting for a restart.',
    timeout: 15000
  },
  {
    id: 'failed-services',
    name: 'Automatic services',
    description: 'Services set to start automatically that are not running.',
    timeout: 30000
  },
  {
    id: 'antivirus',
    name: 'Malware protection',
    description: 'Defender status, registered antivirus, and recent detections.',
    timeout: 45000
  },
  {
    id: 'firewall',
    name: 'Host firewall',
    description: 'Whether each Windows firewall profile is enabled.',
    timeout: 25000
  },
  {
    id: 'secure-boot',
    name: 'Secure Boot',
    description: 'Whether UEFI Secure Boot is enabled or unavailable.',
    timeout: 15000
  },
  {
    id: 'network-adapters',
    name: 'Network adapters',
    description: 'Active IPv4 interfaces, addresses, gateways, and DNS servers.',
    timeout: 20000
  },
  {
    id: 'battery',
    name: 'Battery health',
    description: 'Battery presence and charge (laptops only; unavailable on desktops).',
    timeout: 15000
  }
];

const REPAIRS = [
  {
    id: 'enable-firewall',
    name: 'Re-enable Windows Firewall',
    description: 'Turn on every Windows Firewall profile that is currently disabled.',
    impact: 'Inbound traffic is filtered again on all network profiles. Managed policies may re-disable it.',
    rationaleHint: 'A firewall profile was reported disabled. Re-enabling it restores the built-in inbound filter.',
    risk: 'Moderate',
    admin: true,
    reboot: false,
    timeout: 60000
  },
  {
    id: 'restart-spooler',
    name: 'Restart Print Spooler',
    description: 'Restart the Windows print spooler service without deleting queued jobs.',
    impact: 'Printing pauses for a few seconds. The queue is preserved.',
    rationaleHint: 'The Print Spooler automatic service was reported stopped.',
    risk: 'Low',
    admin: true,
    reboot: false,
    timeout: 60000
  },
  {
    id: 'restart-audio',
    name: 'Restart Windows Audio',
    description: 'Restart the Windows Audio and Audio Endpoint Builder services.',
    impact: 'Sound stops for a few seconds. Applications may need to reselect the output device.',
    rationaleHint: 'A Windows audio service was reported stopped.',
    risk: 'Low',
    admin: true,
    reboot: false,
    timeout: 60000
  },
  {
    id: 'clear-temp',
    name: 'Clear temporary files',
    description: 'Delete temporary files older than two days that belong to the current user.',
    impact: 'Frees disk space. Files in use are skipped. Other users are not touched.',
    rationaleHint: 'System drive free space is below the warning threshold. Clearing old temporary files is a low-risk way to reclaim space.',
    risk: 'Low',
    admin: false,
    reboot: false,
    timeout: 120000
  },
  {
    id: 'flush-dns',
    name: 'Flush DNS cache',
    description: 'Clear the Windows DNS resolver cache.',
    impact: 'New connections look names up again. Existing connections are not interrupted.',
    rationaleHint: 'This is a low-risk network cleanup that clears stale local name-resolution data.',
    risk: 'Low',
    admin: false,
    reboot: false,
    timeout: 30000
  },
  {
    id: 'rebuild-icons',
    name: 'Rebuild icon cache',
    description: 'Ask Windows to refresh the desktop icon and thumbnail cache.',
    impact: 'Icons may briefly redraw. No documents or application data are changed.',
    rationaleHint: 'No target-specific repair matched, so this low-risk cache refresh is offered as maintenance.',
    risk: 'Low',
    admin: false,
    reboot: false,
    timeout: 45000
  }
];

const repairMap = Object.fromEntries(REPAIRS.map((repair) => [repair.id, repair]));
const checkMap = Object.fromEntries(SCAN_CHECKS.map((check) => [check.id, check]));

function resultById(results, id) {
  return (results || []).find((result) => result.id === id) || null;
}

function evidenceMentions(result, pattern) {
  if (!result) return false;
  return pattern.test(`${result.finding || ''}\n${result.evidence || ''}`);
}

/**
 * Repair planning is pure and deterministic: the same findings always produce
 * the same first choice. The orchestrator applies availability limits after
 * this function returns.
 */
function rankRepairCandidates(results) {
  const candidates = [];
  const push = (repairId, score, linkedCheckIds, rationale) => {
    candidates.push({ repairId, score, linkedCheckIds, rationale });
  };

  const firewall = resultById(results, 'firewall');
  if (firewall && (firewall.status === 'warn' || firewall.status === 'fail')) {
    push(
      'enable-firewall',
      100,
      ['firewall'],
      `Repair selected from the firewall finding: ${firewall.finding} ${repairMap['enable-firewall'].rationaleHint}`
    );
  }

  const services = resultById(results, 'failed-services');
  if (services && (services.status === 'warn' || services.status === 'fail')) {
    if (evidenceMentions(services, /spooler|print/i)) {
      push(
        'restart-spooler',
        90,
        ['failed-services'],
        `Repair selected from the stopped-service finding: ${services.finding} ${repairMap['restart-spooler'].rationaleHint}`
      );
    }
    if (evidenceMentions(services, /audiosrv|audio|audioservice/i)) {
      push(
        'restart-audio',
        85,
        ['failed-services'],
        `Repair selected from the stopped-service finding: ${services.finding} ${repairMap['restart-audio'].rationaleHint}`
      );
    }
  }

  const disk = resultById(results, 'disk-space');
  if (disk && (disk.status === 'warn' || disk.status === 'fail')) {
    push(
      'clear-temp',
      80,
      ['disk-space'],
      `Repair selected from the disk finding: ${disk.finding} ${repairMap['clear-temp'].rationaleHint}`
    );
  }

  const pending = resultById(results, 'pending-reboot');
  if (pending && pending.status === 'warn') {
    push(
      'clear-temp',
      30,
      ['pending-reboot'],
      `A restart is pending. No automatic action can complete an update restart, so the low-risk temp cleanup is offered instead. ${pending.finding}`
    );
  }

  const antivirus = resultById(results, 'antivirus');
  if (antivirus && antivirus.status === 'warn') {
    push(
      'flush-dns',
      20,
      ['antivirus'],
      `Malware protection needs human review. Feather does not change antivirus settings automatically; only a low-risk DNS cache flush is offered. ${antivirus.finding}`
    );
  }

  if (!candidates.length) {
    push(
      'clear-temp',
      1,
      [],
      'No targeted repair matched the findings. Clear temporary files is the only low-risk predefined action offered; it does not change system settings.'
    );
  }

  candidates.push({
    repairId: 'rebuild-icons',
    score: 0,
    linkedCheckIds: [],
    rationale: `Fallback maintenance: ${repairMap['rebuild-icons'].rationaleHint}`
  });

  return candidates.sort((a, b) => b.score - a.score);
}

function proposalFor(results, availability = {}) {
  const ranked = rankRepairCandidates(results);
  const usable = ranked.find((candidate) => {
    const state = availability[candidate.repairId];
    return !state || state.available !== false;
  });
  const chosen = usable || ranked[0];
  const repair = repairMap[chosen.repairId];
  const state = availability[chosen.repairId] || { available: true, reason: '' };
  return {
    repairId: repair.id,
    name: repair.name,
    description: repair.description,
    impact: repair.impact,
    risk: repair.risk,
    admin: repair.admin,
    reboot: repair.reboot,
    rationale: chosen.rationale,
    linkedCheckIds: chosen.linkedCheckIds,
    available: state.available !== false,
    unavailableReason: state.reason || '',
    preventive: chosen.score <= 1,
    alternatives: ranked.slice(1).map((candidate) => candidate.repairId)
  };
}

function summarizeResults(results = []) {
  const counts = { pass: 0, info: 0, warn: 0, fail: 0, error: 0, skip: 0 };
  for (const result of results) {
    if (counts[result.status] !== undefined) counts[result.status] += 1;
  }
  return {
    total: results.length,
    ...counts,
    unavailable: counts.skip,
    attention: counts.warn + counts.fail + counts.error
  };
}

module.exports = {
  AGENTS,
  SCAN_CHECKS,
  REPAIRS,
  repairMap,
  checkMap,
  rankRepairCandidates,
  proposalFor,
  summarizeResults
};
