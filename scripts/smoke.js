'use strict';

/**
 * Local UI smoke test for Feather AI 2.0.
 *
 * Runs Electron against the simulated adapter, drives one complete workflow,
 * captures a screenshot and result.json, then exits. The real Windows test is
 * scripts/live-windows-test.js and runs only on a Windows host.
 *
 *   FEATHER_SMOKE_DECISION=approve npm run smoke
 *   FEATHER_SMOKE_DECISION=decline npm run smoke
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const out = path.resolve(process.env.FEATHER_SMOKE_OUT || path.join(ROOT, 'smoke', process.env.FEATHER_SMOKE_DECISION || 'approve'));
const decision = (process.env.FEATHER_SMOKE_DECISION || 'approve').toLowerCase();
const timeoutMs = Number(process.env.FEATHER_SMOKE_TIMEOUT_MS || 180000);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const electron = require('electron');
const args = [ROOT, '--smoke-test', '--no-sandbox', '--disable-gpu'];
const env = {
  ...process.env,
  FEATHER_PLATFORM: 'sim',
  FEATHER_SCENARIO: process.env.FEATHER_SCENARIO || 'degraded',
  FEATHER_STEP_DELAY_MS: process.env.FEATHER_STEP_DELAY_MS || '5',
  FEATHER_SIM_DELAY_MS: process.env.FEATHER_SIM_DELAY_MS || '20',
  FEATHER_SIM_REPAIR_DELAY_MS: process.env.FEATHER_SIM_REPAIR_DELAY_MS || '60',
  FEATHER_SMOKE_DECISION: decision,
  FEATHER_SMOKE_OUT: out,
  FEATHER_SMOKE_SHOT: 'feather-smoke.png',
  FEATHER_SMOKE_DELAY_MS: process.env.FEATHER_SMOKE_DELAY_MS || '700',
  FEATHER_REPORT_DIR: path.join(out, 'usb-root')
};

let command = electron;
let commandArgs = args;
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
  if (xvfb.status === 0 && xvfb.stdout.trim()) {
    command = xvfb.stdout.trim();
    commandArgs = ['-a', electron, ...args];
  } else {
    console.error('No DISPLAY/WAYLAND_DISPLAY and no xvfb-run; cannot run the Electron smoke test.');
    process.exit(2);
  }
}

console.log(`Smoke decision: ${decision}`);
console.log(`Smoke output:   ${out}`);

const child = spawn(command, commandArgs, {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
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
  console.error(`Smoke test exceeded ${timeoutMs} ms; terminating.`);
  child.kill('SIGKILL');
}, timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  const resultPath = path.join(out, 'result.json');
  const shotPath = path.join(out, 'feather-smoke.png');
  if (!fs.existsSync(resultPath)) {
    console.error(`Smoke test produced no result.json (exit ${code}, signal ${signal}).`);
    if (stderr.trim()) console.error(stderr.trim().split('\n').slice(-40).join('\n'));
    process.exit(1);
  }

  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const problems = [];
  if (!result.ok) problems.push(...(result.errors || ['smoke result not ok']));
  if (result.simulated !== true || result.platform !== 'simulation') problems.push('simulated platform was not recorded');
  if (!result.dom) problems.push('renderer DOM snapshot was not captured');
  if (result.dom) {
    if (result.dom.checkRows < 10) problems.push(`expected at least 10 check rows, saw ${result.dom.checkRows}`);
    if (result.dom.activityCount < 5) problems.push(`expected workflow activity, saw ${result.dom.activityCount}`);
    if (result.dom.unavailableRows < 1) problems.push('no unavailable check was rendered as unavailable');
  }
  if (decision === 'approve' || decision === 'decline') {
    if (!result.proposal) problems.push('no repair proposal was recorded');
    if (result.decision !== (decision === 'approve' ? 'approved' : 'declined')) problems.push(`decision mismatch: ${result.decision}`);
  }
  if (!result.report || !Array.isArray(result.report.reports) || result.report.reports.length !== 3) {
    problems.push('report bundle did not contain HTML, TXT, and JSON');
  } else {
    for (const entry of result.report.reports) {
      if (!fs.existsSync(entry.path)) problems.push(`missing report file: ${entry.path}`);
    }
    if (!path.resolve(result.report.directory).startsWith(path.resolve(env.FEATHER_REPORT_DIR))) {
      problems.push(`report was not written under the USB test root: ${result.report.directory}`);
    }
  }
  if (!fs.existsSync(shotPath)) problems.push('screenshot was not captured');

  console.log(`Smoke phase:    ${result.phase}`);
  console.log(`Smoke decision: ${result.decision}`);
  console.log(`Smoke report:   ${result.report ? result.report.directory : 'none'}`);
  console.log(`Screenshot:     ${shotPath}`);
  console.log(`Result:         ${resultPath}`);

  if (problems.length) {
    console.error('SMOKE FAILED');
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
  console.log('SMOKE PASSED');
  process.exit(0);
});
