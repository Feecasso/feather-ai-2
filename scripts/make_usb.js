'use strict';

/**
 * Assemble a removable-drive layout from the unpacked Windows build.
 *
 *   node scripts/make_usb.js win
 *   node scripts/make_usb.js win --from release/win-unpacked --out usb
 *
 * The resulting folder has FeatherAI.exe at its root, so the tester can copy
 * the folder to a USB drive and double-click the executable with no installer.
 * Reports are written to <usb root>/reports by src/main/paths.js.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function main() {
  const from = path.resolve(ROOT, arg('--from', 'release/win-unpacked'));
  const outRoot = path.resolve(ROOT, arg('--out', 'usb'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const folder = path.join(outRoot, `FeatherAI-${pkg.version}-Windows-x64`);
  const exe = path.join(from, 'FeatherAI.exe');

  if (!fs.existsSync(exe)) {
    console.error(`Cannot assemble USB layout: ${exe} was not found. Run npm run dist:win first.`);
    process.exitCode = 1;
    return;
  }

  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.cpSync(from, folder, { recursive: true });
  fs.mkdirSync(path.join(folder, 'reports'), { recursive: true });

  const docsSource = path.join(ROOT, 'docs');
  if (fs.existsSync(docsSource)) {
    fs.cpSync(docsSource, path.join(folder, 'docs'), { recursive: true });
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    if (fs.existsSync(path.join(ROOT, file))) fs.copyFileSync(path.join(ROOT, file), path.join(folder, file));
  }

  fs.writeFileSync(
    path.join(folder, 'START-HERE.txt'),
    [
      'FEATHER AI 2.0 - OFFLINE USB REPAIR STATION',
      '',
      '1. Copy this whole folder to the USB drive.',
      '2. On the Windows computer, open the folder and double-click FeatherAI.exe.',
      '3. No installer, network connection, API key, or local model is required.',
      '4. Click START PROCESS. Approve or decline the proposed fix only after REVIEW FIX.',
      '5. Reports are written to the reports folder beside FeatherAI.exe.',
      '',
      'If the USB drive is read-only, reports go to Documents\\Feather AI 2 Reports.',
      'Scanner is read-only. Repair runs at most one predefined action, once, only after approval.',
      '',
      `Version: ${pkg.version}`,
      `Built: ${new Date().toISOString()}`,
      ''
    ].join('\r\n'),
    'utf8'
  );

  const manifest = {
    product: 'Feather AI 2.0',
    version: pkg.version,
    executable: 'FeatherAI.exe',
    executableSha256: sha256(path.join(folder, 'FeatherAI.exe')),
    layout: 'portable USB folder',
    reports: 'reports/',
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(folder, 'usb-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`USB layout: ${folder}`);
  console.log(`Executable: ${path.join(folder, 'FeatherAI.exe')}`);
  console.log(`SHA-256: ${manifest.executableSha256}`);
}

main();
