'use strict';

/**
 * Genuine Windows acceptance test.
 *
 * This script runs only on win32. It copies the packaged application into a
 * folder that stands in for a USB drive (the executable sits at that folder's
 * root), launches FeatherAI.exe twice, and validates:
 *
 *   1. the real Windows platform adapter ran (not the simulated one),
 *   2. all read-only checks completed and failure/unavailable states are honest,
 *   3. approval runs the single proposed repair exactly once,
 *   4. declining runs no repair and still writes the report,
 *   5. HTML/TXT/JSON reports are written to <usb>/reports.
 *
 *   node scripts/live-windows-test.js --app-dir release/win-unpacked --usb-dir %RUNNER_TEMP%\FeatherUSB
 *
 * A real removable drive cannot be attached to a CI runner, so the copied
 * folder is the accepted substitute; the executable and reports live in the
 * same portable-root layout a USB stick would use.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function resolveArg(value) {
  return path.resolve(value.replace(/%([^%]+)%/g, (_, key) => process.env[key] || ''));
}

const appDir = resolveArg(arg('--app-dir', path.join(ROOT, 'release', 'win-unpacked')));
const usbDir = resolveArg(arg('--usb-dir', path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'FeatherUSB')));
const timeoutMs = Number(process.env.FEATHER_LIVE_TIMEOUT_MS || 900000);
const allowRepairFailure = process.env.FEATHER_LIVE_ALLOW_REPAIR_FAILURE === '1';

function fail(message) {
  console.error(`LIVE TEST FAILED: ${message}`);
  process.exitCode = 1;
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function runPass(decision, passIndex) {
  return new Promise((resolve, reject) => {
    const out = path.join(usbDir, 'smoke', `${passIndex}-${decision}`);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const exe = path.join(usbDir, 'FeatherAI.exe');
    const env = {
      ...process.env,
      FEATHER_REPORT_DIR: usbDir,
      FEATHER_SMOKE_OUT: out,
      FEATHER_SMOKE_SHOT: `feather-windows-${decision}.png`,
      FEATHER_SMOKE_DECISION: decision,
      FEATHER_SMOKE_DELAY_MS: process.env.FEATHER_SMOKE_DELAY_MS || '1200',
      FEATHER_STEP_DELAY_MS: '0'
    };
    for (const key of ['FEATHER_PLATFORM', 'FEATHER_SCENARIO', 'FEATHER_SIM_DELAY_MS', 'FEATHER_SIM_REPAIR', 'FEATHER_SIM_REPAIR_DELAY_MS']) {
      delete env[key];
    }

    console.log(`\n=== Windows live pass ${passIndex}: ${decision} ===`);
    console.log(`Executable: ${exe}`);
    console.log(`USB root:   ${usbDir}`);

    const child = spawn(exe, ['--smoke-test'], {
      cwd: usbDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`pass ${passIndex} (${decision}) exceeded ${timeoutMs} ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const resultPath = path.join(out, 'result.json');
      if (!fs.existsSync(resultPath)) {
        reject(new Error(`pass ${passIndex} produced no result.json (exit ${code}, signal ${signal})\n${stderr.slice(-4000)}`));
        return;
      }
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      resolve({ result, out, stdout, stderr, code, signal });
    });
  });
}

function verifyPass(pass, decision, problems) {
  const { result, out } = pass;
  assert(result.ok, `${decision}: smoke result was not ok: ${(result.errors || []).join('; ')}`, problems);
  assert(result.platform === 'win32', `${decision}: platform was ${result.platform}, expected win32`, problems);
  assert(result.simulated === false, `${decision}: run was marked simulated`, problems);
  assert(result.phase === 'done', `${decision}: workflow phase was ${result.phase}`, problems);
  assert(result.dom, `${decision}: no renderer DOM snapshot`, problems);
  if (result.dom) {
    assert(result.dom.checkRows >= 10, `${decision}: only ${result.dom.checkRows} check rows rendered`, problems);
    assert(result.dom.activityCount >= 5, `${decision}: only ${result.dom.activityCount} activity items rendered`, problems);
    assert(result.dom.reportPath && result.dom.reportPath !== '—', `${decision}: report path was not shown in the UI`, problems);
    const summary = result.scan || {};
    assert(result.dom.unavailableRows === Number(summary.unavailable || 0), `${decision}: unavailable UI rows did not match the measured summary`, problems);
    assert(result.dom.failedRows === Number(summary.fail || 0) + Number(summary.error || 0), `${decision}: failed UI rows did not match the measured summary`, problems);
  }
  assert(fs.existsSync(path.join(out, `feather-windows-${decision}.png`)), `${decision}: screenshot was not captured`, problems);

  assert(result.decision === (decision === 'approve' ? 'approved' : 'declined'), `${decision}: recorded decision was ${result.decision}`, problems);
  assert(result.proposal && result.proposal.repairId, `${decision}: no repair proposal was recorded`, problems);
  assert(result.repair && result.repair.outcome, `${decision}: no repair outcome was recorded`, problems);
  if (result.repair) {
    if (decision === 'decline') {
      assert(result.repair.outcome === 'declined', `${decision}: repair outcome was ${result.repair.outcome}, expected declined`, problems);
    } else {
      assert(result.repair.outcome !== 'declined' && result.repair.outcome !== 'cancelled', `${decision}: repair outcome was ${result.repair.outcome}`, problems);
      if (!allowRepairFailure) {
        assert(result.repair.outcome === 'success', `${decision}: repair outcome was ${result.repair.outcome}; ${result.repair.summary || ''}`, problems);
      }
    }
  }

  const report = result.report;
  const liveTypes = new Set(result.eventTypes || []);
  for (const required of ['report.saved', 'job.done']) {
    assert(liveTypes.has(required), `${decision}: live event stream is missing ${required}`, problems);
  }
  assert(report && Array.isArray(report.reports) && report.reports.length === 3, `${decision}: report bundle did not contain three files`, problems);
  if (report && Array.isArray(report.reports)) {
    const expectedDir = path.resolve(usbDir, 'reports');
    assert(path.resolve(report.directory) === expectedDir, `${decision}: report directory was ${report.directory}, expected ${expectedDir}`, problems);
    for (const entry of report.reports) {
      assert(fs.existsSync(entry.path), `${decision}: missing report file ${entry.path}`, problems);
      assert(path.resolve(entry.path).startsWith(expectedDir), `${decision}: report escaped the USB folder: ${entry.path}`, problems);
    }
    const jsonEntry = report.reports.find((entry) => entry.format === 'json');
    if (jsonEntry && fs.existsSync(jsonEntry.path)) {
      let payload = null;
      try {
        payload = JSON.parse(fs.readFileSync(jsonEntry.path, 'utf8'));
      } catch (error) {
        problems.push(`${decision}: JSON report could not be parsed: ${error.message}`);
      }
      if (payload) {
        assert(payload.job && payload.job.simulated === false, `${decision}: JSON report marked the job simulated`, problems);
        assert(payload.systemInfo && /windows/i.test(payload.systemInfo.osName || ''), `${decision}: report OS was not Windows`, problems);
        assert(Array.isArray(payload.scan?.results) && payload.scan.results.length >= 10, `${decision}: JSON report had too few check results`, problems);
        for (const entry of payload.scan?.results || []) {
          assert(['pass', 'info', 'warn', 'fail', 'error', 'skip'].includes(entry.status), `${decision}: invalid check status ${entry.status} for ${entry.id}`, problems);
        }
        const types = new Set((payload.events || []).map((event) => event.type));
        // The report is written before its own save event can exist, so the
        // persisted timeline ends at repair.done/workflow.state. The terminal
        // report.saved and job.done events are verified from the live bus below.
        for (const required of ['job.start', 'handoff', 'scan.done', 'repair.proposed', 'repair.decision', 'repair.done']) {
          assert(types.has(required), `${decision}: event timeline is missing ${required}`, problems);
        }
      }
    }
  }
  console.log(`Pass ${decision}: phase=${result.phase} decision=${result.decision} repair=${result.repair?.outcome} checks=${result.scan?.total} report=${report?.directory}`);
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('live-windows-test.js must run on Windows. Local Linux runs use scripts/smoke.js.');
    process.exitCode = 2;
    return;
  }
  if (!fs.existsSync(path.join(appDir, 'FeatherAI.exe'))) {
    fail(`packaged executable not found: ${path.join(appDir, 'FeatherAI.exe')}`);
    return;
  }

  if (path.resolve(appDir) !== path.resolve(usbDir)) {
    fs.rmSync(usbDir, { recursive: true, force: true });
    fs.mkdirSync(usbDir, { recursive: true });
    fs.cpSync(appDir, usbDir, { recursive: true });
  }
  fs.mkdirSync(path.join(usbDir, 'reports'), { recursive: true });
  console.log(`Copied packaged app to removable-drive substitute: ${usbDir}`);

  const problems = [];
  for (const [index, decision] of ['approve', 'decline'].entries()) {
    const pass = await runPass(decision, index + 1);
    verifyPass(pass, decision, problems);
  }

  const reports = fs.readdirSync(path.join(usbDir, 'reports')).filter((name) => /\.(html|txt|json)$/i.test(name));
  assert(reports.length >= 6, `expected at least six report files on the USB substitute, saw ${reports.length}`, problems);
  console.log(`\nReports on USB substitute: ${reports.length}`);

  if (problems.length) {
    console.error('\nLIVE TEST FAILED');
    for (const problem of problems) console.error(` - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nLIVE WINDOWS TEST PASSED');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
