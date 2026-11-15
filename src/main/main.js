'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, screen } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { WorkflowOrchestrator } = require('./workflow/orchestrator');
const { buildHtmlReport, buildTextReport, buildJsonReport, reportBaseName } = require('./workflow/report');
const { createAudit } = require('./audit');
const { loadSettings, saveSettings } = require('./settings');
const { reportDestination, reportsDir, getPortableRoot } = require('./paths');
const { isInsideDirectory } = require('./reports');
const { SCAN_CHECKS, AGENTS } = require('../shared/catalog');

const useSimulation = process.env.FEATHER_PLATFORM === 'sim' || process.platform !== 'win32';
const platform = useSimulation ? require('./platform/simulated') : require('./platform/windows');

app.disableHardwareAcceleration();
app.setAppUserModelId('org.feecasso.featherai2');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

let win = null;
let settings = null;
let audit = null;
let orchestrator = null;
let systemInfoCache = null;
const knownReportPaths = new Set();

function bootstrap() {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    audit = createAudit();
    systemInfoCache = await getSystemInfo(true);
    orchestrator = new WorkflowOrchestrator({
      platform,
      emit: sendEvent,
      audit,
      writer: saveReportBundle
    });
    registerIpc();
    Menu.setApplicationMenu(null);
    createWindow();
    audit('app-start', `Feather AI 2.0 ${app.getVersion()} on ${process.platform}; platform ${platform.platform}; root ${getPortableRoot()}`);
  });

  app.on('window-all-closed', () => app.quit());
}

function createWindow() {
  const saved = settings.window || {};
  const width = Math.max(1120, Number(saved.width) || 1360);
  const height = Math.max(720, Number(saved.height) || 860);
  const options = {
    width,
    height,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    backgroundColor: '#070907',
    title: 'Feather AI 2.0',
    icon: path.join(__dirname, '../../assets/icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const displays = screen.getAllDisplays();
    const visible = displays.some((display) => {
      const b = display.workArea;
      return saved.x >= b.x - 50 && saved.y >= b.y - 50 && saved.x < b.x + b.width - 100 && saved.y < b.y + b.height - 100;
    });
    if (visible) {
      options.x = saved.x;
      options.y = saved.y;
    }
  }

  win = new BrowserWindow(options);
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    win.show();
  });

  win.on('maximize', () => sendEvent({ type: 'window:maximized', payload: { maximized: true } }));
  win.on('unmaximize', () => sendEvent({ type: 'window:maximized', payload: { maximized: false } }));
  win.on('resize', saveWindowSettings);
  win.on('move', saveWindowSettings);
  win.on('close', saveWindowSettings);
  win.webContents.on('did-finish-load', () => {
    if (process.argv.includes('--smoke-test')) runSmokeTest();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.on('closed', () => {
    win = null;
  });
}

let saveTimer = null;
function saveWindowSettings() {
  if (!win || !settings) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const bounds = win.getBounds();
      settings.window = { ...bounds, maximized: win.isMaximized() };
      saveSettings(settings);
    } catch {
      /* window may be closing */
    }
  }, 400);
}

function sendEvent(event) {
  if (!event || typeof event.type !== 'string') return;
  if (win && !win.isDestroyed()) {
    win.webContents.send('feather:event', event);
  }
}

async function getSystemInfo(force = false) {
  if (!systemInfoCache || force) {
    systemInfoCache = await platform.getSystemInfo().catch((error) => ({
      computerName: 'Unknown',
      osName: process.platform === 'win32' ? 'Windows' : 'Development host',
      osDetail: 'System information unavailable',
      admin: false,
      elevation: process.platform === 'win32' ? 'uac' : 'none',
      mode: 'Offline - local only',
      user: 'unknown',
      inAdminGroup: false,
      simulated: platform.platform !== 'win32',
      error: error.message
    }));
  }
  return systemInfoCache;
}

async function listReports() {
  const dir = reportsDir();
  const entries = [];
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (!/\.(html|txt|json)$/i.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fsp.stat(full);
      if (!stat.isFile()) continue;
      knownReportPaths.add(full);
      entries.push({ name, path: full, size: stat.size, modified: stat.mtime.toISOString() });
    } catch {
      /* skip unreadable files */
    }
  }
  return entries.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

async function saveReportBundle(data) {
  const generatedAt = new Date().toISOString();
  const destination = reportDestination();
  const full = {
    ...data,
    version: app.getVersion(),
    generatedAt,
    audit: audit.recent(300)
  };
  const base = reportBaseName(data.job.id, new Date(generatedAt));
  const files = [
    { format: 'html', name: `${base}.html`, content: buildHtmlReport(full) },
    { format: 'txt', name: `${base}.txt`, content: buildTextReport(full) },
    { format: 'json', name: `${base}.json`, content: buildJsonReport(full) }
  ];

  const writeAll = async (dir) => {
    await fsp.mkdir(dir, { recursive: true });
    const written = [];
    for (const file of files) {
      const target = path.join(dir, file.name);
      await fsp.writeFile(target, file.content, { encoding: 'utf8', mode: 0o644 });
      knownReportPaths.add(target);
      const stat = await fsp.stat(target);
      written.push({ format: file.format, name: file.name, path: target, size: stat.size });
    }
    return written;
  };

  try {
    const written = await writeAll(destination.directory);
    return {
      directory: destination.directory,
      root: destination.root,
      fallback: destination.fallback,
      warning: destination.warning,
      reports: written
    };
  } catch (primaryError) {
    // A removable drive can disappear or turn read-only after the probe. Try the
    // Documents fallback once so the job still leaves a report behind.
    const fallback = path.join(app.getPath('documents'), 'Feather AI 2 Reports');
    if (path.resolve(destination.directory) === path.resolve(fallback)) throw primaryError;
    const written = await writeAll(fallback);
    return {
      directory: fallback,
      root: destination.root,
      fallback: true,
      warning: `The USB report folder could not be written (${primaryError.message}). Reports went to ${fallback} instead.`,
      reports: written
    };
  }
}

function isKnownReport(filePath) {
  if (typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath);
  if (!/\.(html|txt|json)$/i.test(resolved)) return false;
  if (knownReportPaths.has(resolved)) return true;
  if (isInsideDirectory(reportsDir(), resolved) && fs.existsSync(resolved)) {
    knownReportPaths.add(resolved);
    return true;
  }
  return false;
}

function bootstrapPayload() {
  const destination = reportDestination();
  return {
    platform: platform.platform,
    simulated: platform.platform !== 'win32',
    version: app.getVersion(),
    checks: SCAN_CHECKS,
    agents: AGENTS,
    repairs: require('../shared/catalog').REPAIRS,
    systemInfo: systemInfoCache,
    state: orchestrator.getPublicState(),
    usb: {
      root: destination.root,
      reportsDir: destination.directory,
      fallback: destination.fallback,
      warning: destination.warning
    },
    reports: [],
    portableRoot: getPortableRoot(),
    isPackaged: app.isPackaged
  };
}

function registerIpc() {
  ipcMain.handle('feather:bootstrap', async () => {
    const payload = bootstrapPayload();
    payload.reports = await listReports();
    payload.systemInfo = await getSystemInfo(true);
    return payload;
  });

  ipcMain.handle('feather:start', async () => {
    try {
      const state = await orchestrator.start({ systemInfo: await getSystemInfo() });
      return { ok: true, state };
    } catch (error) {
      return { ok: false, error: error.message || String(error), state: orchestrator.getPublicState() };
    }
  });

  ipcMain.handle('feather:decide', async (_event, payload = {}) => {
    try {
      if (typeof payload.proposalId !== 'string' || !['approve', 'decline'].includes(payload.decision)) {
        throw new Error('Invalid repair decision request.');
      }
      const state = await orchestrator.decide(payload.proposalId, payload.decision);
      return { ok: true, state };
    } catch (error) {
      return { ok: false, error: error.message || String(error), state: orchestrator.getPublicState() };
    }
  });

  ipcMain.handle('feather:reports', async () => listReports());

  ipcMain.handle('feather:openReportsFolder', async () => {
    const error = await shell.openPath(reportsDir());
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('feather:openReport', async (_event, filePath) => {
    if (!isKnownReport(filePath)) throw new Error('Only reports created or listed by Feather AI can be opened here.');
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('window:minimize', () => win?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => win?.close());
}

function runSmokeTest() {
  const outDir = path.resolve(process.env.FEATHER_SMOKE_OUT || path.join(process.cwd(), 'smoke'));
  fs.mkdirSync(outDir, { recursive: true });
  const resultPath = path.join(outDir, 'result.json');
  const shotPath = path.join(outDir, process.env.FEATHER_SMOKE_SHOT || 'feather-smoke.png');
  const decisionMode = (process.env.FEATHER_SMOKE_DECISION || 'approve').toLowerCase();
  const delay = Number(process.env.FEATHER_SMOKE_DELAY_MS || 900);

  setTimeout(async () => {
    const result = {
      startedAt: new Date().toISOString(),
      platform: platform.platform,
      simulated: platform.platform !== 'win32',
      decisionMode,
      ok: false,
      errors: []
    };
    try {
      if (!win) throw new Error('The application window was closed before the smoke test.');
      await getSystemInfo(true);
      await orchestrator.start({ systemInfo: systemInfoCache });
      if (decisionMode === 'approve' || decisionMode === 'decline') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await orchestrator.decide(orchestrator.proposal.proposalId, decisionMode);
      }
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const image = await win.webContents.capturePage();
      fs.writeFileSync(shotPath, image.toPNG());
      const dom = await win.webContents.executeJavaScript(`(() => {
        const text = (selector) => (document.querySelector(selector)?.textContent || '').trim();
        const count = (selector) => document.querySelectorAll(selector).length;
        const visible = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        };
        return {
          title: document.title,
          phase: text('#phase-label'),
          startLabel: text('#btn-start'),
          activityCount: count('.activity-item'),
          checkRows: count('.check-row'),
          unavailableRows: count('.check-row[data-unavailable="true"]'),
          failedRows: count('.check-row[data-failed="true"]'),
          repairCardVisible: visible('#repair-card'),
          reviewButtonVisible: visible('#btn-review'),
          approveButtonVisible: visible('#btn-approve'),
          reportPath: text('#report-path'),
          viewport: { w: window.innerWidth, h: window.innerHeight }
        };
      })()`);
      result.dom = dom;
      result.phase = orchestrator.phase;
      result.decision = orchestrator.decision;
      result.proposal = orchestrator.proposal
        ? { repairId: orchestrator.proposal.repairId, status: orchestrator.proposal.status, name: orchestrator.proposal.name }
        : null;
      result.repair = orchestrator.repairRecord;
      result.scan = orchestrator.scanRun ? orchestrator.scanRun.summary : null;
      result.report = orchestrator.report;
      result.eventTypes = orchestrator.bus.history.map((event) => event.type);
      result.ok = true;
    } catch (error) {
      result.errors.push(error.stack || error.message);
      try {
        if (win) {
          const image = await win.webContents.capturePage();
          fs.writeFileSync(shotPath, image.toPNG());
        }
      } catch {
        /* best effort */
      }
      result.phase = orchestrator ? orchestrator.phase : 'unknown';
      result.report = orchestrator ? orchestrator.report : null;
    } finally {
      result.finishedAt = new Date().toISOString();
      try {
        fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('SMOKE_RESULT_WRITE_ERROR', error.message);
      }
      console.log(`SMOKE_RESULT ${resultPath}`);
      console.log(`SMOKE_SCREENSHOT ${shotPath}`);
      if (!result.ok) console.error('SMOKE_ERROR', result.errors.join('\n'));
      app.quit();
      if (!result.ok) process.exitCode = 1;
    }
  }, delay);
}
