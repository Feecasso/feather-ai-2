#!/usr/bin/env node
'use strict';

// Cross-platform test entry point.
//
// `node --test test/` is not portable: some Node builds resolve the argument as
// a module instead of a directory (seen on Node 22.23 on both Linux and
// Windows CI). `node --test` without arguments also picks up non-test helpers
// under scripts/. Discover the test files ourselves and pass explicit paths.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(__dirname, '..', 'test');

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collect(full);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [full] : [];
    });
}

const files = collect(testDir);
if (files.length === 0) {
  console.error(`No *.test.js files found under ${testDir}`);
  process.exit(1);
}

console.log(`Running ${files.length} test files with ${process.execPath}`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
