'use strict';

/**
 * Development/test platform. Windows builds never load this module: main.js
 * selects platform/windows.js on win32. The UI labels these runs SIMULATED so a
 * Linux development session can never be mistaken for a real Windows scan.
 */

const { SCAN_CHECKS } = require('../../shared/catalog');

const SCENARIOS = {
  degraded: {
    'os-info': {
      status: 'info',
      finding: 'Windows 11 Pro build 26100 (64-bit)',
      evidence: 'Edition: Windows 11 Pro\nVersion: 10.0.26100\nBuild: 26100\nArchitecture: 64-bit\nComputer: FEATHER-SIM\nModel: Test Workstation',
      explanation: 'Identifies the Windows edition and build the checks are running on.',
      nextStep: 'No action required.'
    },
    'cpu-memory': {
      status: 'warn',
      finding: 'Intel Core i5 — 4 cores, 16 GB RAM (91% used)',
      evidence: 'CPU: Intel Core i5 (8 logical processors)\nMemory: 14.6 GB used of 16 GB (91%)',
      explanation: 'Memory use at or above 90% can cause slowdowns and failed operations.',
      nextStep: 'Close unused memory-heavy programs.'
    },
    'disk-space': {
      status: 'warn',
      finding: '11 GB free on C: (12% available)',
      evidence: 'Drive: C:\nTotal: 95 GB\nFree: 11 GB',
      explanation: 'Less than 15% free space can prevent updates and logging.',
      nextStep: 'Remove unneeded files or move large files to external storage.'
    },
    'time-sync': {
      status: 'pass',
      finding: 'Clock source: time.windows.com',
      evidence: 'w32time service: Running (Automatic)\nSource: time.windows.com\nLast successful sync: 2026-11-14T20:00:00Z',
      explanation: 'Accurate time is required for certificate validation and log correlation.',
      nextStep: 'No action required.'
    },
    'pending-reboot': {
      status: 'warn',
      finding: 'A restart is pending to finish installed updates.',
      evidence: 'Component Based Servicing reboot pending: True\nWindows Update reboot required: False',
      explanation: 'A pending restart can leave security updates inactive.',
      nextStep: 'Save your work and restart at a convenient time.'
    },
    'failed-services': {
      status: 'warn',
      finding: '2 automatic services are not running.',
      evidence: 'Spooler (Print Spooler): Stopped, start mode Auto\nAudiosrv (Windows Audio): Stopped, start mode Auto',
      explanation: 'A stopped automatic service can indicate a failed component or update.',
      nextStep: 'Review the service in Services, or restart the specific failed service.'
    },
    antivirus: {
      status: 'warn',
      finding: '2 recent Defender threat detection entries recorded.',
      evidence: 'Defender service: enabled\nReal-time protection: enabled\nSignature age: 2 days (version 1.431.12.0)\nRecent threat detection entries: 2',
      explanation: 'A detection entry records what Defender observed and attempted.',
      nextStep: 'Review recent detections in Windows Security.'
    },
    firewall: {
      status: 'warn',
      finding: 'Private firewall profile is disabled.',
      evidence: 'Domain: enabled, inbound Block\nPrivate: disabled, inbound Allow\nPublic: enabled, inbound Block',
      explanation: 'A disabled profile can expose services on that type of network.',
      nextStep: 'Turn on the disabled profile in Windows Security unless a managed policy requires it off.'
    },
    'secure-boot': {
      status: 'skip',
      finding: 'Secure Boot state is not available (legacy BIOS or unsupported firmware).',
      evidence: 'Confirm-SecureBootUEFI: cmdlet not supported on this platform.',
      explanation: 'Secure Boot requires UEFI firmware.',
      nextStep: 'No action required unless you plan to use UEFI Secure Boot.'
    },
    'network-adapters': {
      status: 'info',
      finding: '1 active IPv4 interface.',
      evidence: 'Ethernet: 192.168.1.44; gateway 192.168.1.1; DNS 192.168.1.1',
      explanation: 'Lists local interface state. It does not contact the internet.',
      nextStep: 'No action required.'
    },
    battery: {
      status: 'skip',
      finding: 'No battery detected (desktop or virtual machine).',
      evidence: 'Win32_Battery returned no battery.',
      explanation: 'Battery checks apply to laptops.',
      nextStep: 'No action required.'
    }
  },
  clean: {},
  disk: {}
};

SCENARIOS.clean = Object.fromEntries(
  SCAN_CHECKS.map((check) => [
    check.id,
    check.id === 'battery'
      ? {
          status: 'skip',
          finding: 'No battery detected (desktop).',
          evidence: 'Win32_Battery returned no battery.',
          explanation: 'Battery checks apply to laptops.',
          nextStep: 'No action required.'
        }
      : {
          status: check.id === 'os-info' || check.id === 'network-adapters' ? 'info' : 'pass',
          finding: `${check.name} is within the expected range.`,
          evidence: `${check.name}: simulated healthy evidence.\nNo problem measured.`,
          explanation: 'The measured value is within the documented range.',
          nextStep: 'No action required.'
        }
  ])
);

SCENARIOS.disk = JSON.parse(JSON.stringify(SCENARIOS.clean));
SCENARIOS.disk['disk-space'] = {
  status: 'fail',
  finding: '2.1 GB free on C: (3% available)',
  evidence: 'Drive: C:\nTotal: 95 GB\nFree: 2.1 GB',
  explanation: 'Less than 5% free space is treated as a failure.',
  nextStep: 'Remove unneeded files before installing updates.'
};
SCENARIOS.disk['failed-services'] = SCENARIOS.clean['failed-services'];

function scenario() {
  const name = process.env.FEATHER_SCENARIO || 'degraded';
  return SCENARIOS[name] || SCENARIOS.degraded;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSystemInfo() {
  const simulated = process.env.FEATHER_PLATFORM === 'sim';
  return {
    computerName: simulated ? 'FEATHER-SIM' : 'Feather development host',
    osName: 'Windows 11 Pro (build 26100) — simulated',
    osDetail: '64-bit Windows simulation for development and UI tests',
    admin: false,
    elevation: 'uac',
    mode: 'Offline - local only (simulated)',
    user: 'Feather Tester',
    inAdminGroup: false,
    simulated: true
  };
}

async function runCheck(check) {
  const configured = Number(process.env.FEATHER_SIM_DELAY_MS);
  const wait = Number.isFinite(configured) ? Math.max(0, configured) : 180;
  if (wait) await delay(wait);
  const data = scenario()[check.id];
  if (!data) {
    return {
      status: 'error',
      finding: `${check.name} could not complete.`,
      evidence: 'The simulated platform has no result for this check.',
      explanation: 'The check did not finish, so no pass or problem is reported.',
      nextStep: 'Run the check again.'
    };
  }
  return JSON.parse(JSON.stringify(data));
}

async function getRepairAvailability() {
  return Object.fromEntries(
    ['enable-firewall', 'restart-spooler', 'restart-audio', 'clear-temp', 'flush-dns', 'rebuild-icons'].map((id) => [
      id,
      { available: true, reason: '' }
    ])
  );
}

async function runRepair(repair) {
  const configured = Number(process.env.FEATHER_SIM_REPAIR_DELAY_MS);
  await delay(Number.isFinite(configured) ? Math.max(0, configured) : 650);
  if (process.env.FEATHER_SIM_REPAIR === 'fail') {
    return {
      ok: false,
      summary: `${repair.name} failed in the simulated environment.`,
      details: 'Simulated repair failure requested by FEATHER_SIM_REPAIR=fail.',
      rollback: 'No changes were made.'
    };
  }
  return {
    ok: true,
    summary: `${repair.name} completed in the simulated environment.`,
    details: `Simulated repair id: ${repair.id}\nAdministrator required: ${repair.admin ? 'yes' : 'no'}\nNo real system settings were changed.`,
    rollback: 'Simulation only. No rollback is required.'
  };
}

module.exports = {
  platform: 'simulation',
  getSystemInfo,
  runCheck,
  getRepairAvailability,
  runRepair,
  SCENARIOS
};
