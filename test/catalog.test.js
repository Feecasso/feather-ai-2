'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeResults, proposalFor, rankRepairCandidates, REPAIRS } = require('../src/shared/catalog');

function result(id, status, finding = '', evidence = '') {
  return { id, status, finding, evidence };
}

test('summarizeResults counts every status and never folds skip into pass', () => {
  const summary = summarizeResults([
    result('a', 'pass'),
    result('b', 'info'),
    result('c', 'warn'),
    result('d', 'fail'),
    result('e', 'error'),
    result('f', 'skip'),
    result('g', 'skip')
  ]);
  assert.deepEqual(summary, { total: 7, pass: 1, info: 1, warn: 1, fail: 1, error: 1, skip: 2, unavailable: 2, attention: 3 });
});

test('a disabled firewall ranks the firewall repair first', () => {
  const proposal = proposalFor([
    result('firewall', 'warn', 'Private profile disabled'),
    result('disk-space', 'pass')
  ]);
  assert.equal(proposal.repairId, 'enable-firewall');
  assert.deepEqual(proposal.linkedCheckIds, ['firewall']);
  assert.equal(proposal.risk, 'Moderate');
  assert.equal(proposal.preventive, false);
});

test('a stopped print spooler selects the spooler restart', () => {
  const proposal = proposalFor([
    result('failed-services', 'warn', 'Spooler is stopped', 'Spooler (Print Spooler): Stopped')
  ]);
  assert.equal(proposal.repairId, 'restart-spooler');
});

test('low disk space selects temporary file cleanup', () => {
  const proposal = proposalFor([result('disk-space', 'fail', '2.1 GB free on C:')]);
  assert.equal(proposal.repairId, 'clear-temp');
  assert.equal(proposal.admin, false);
});

test('unavailable alternatives are skipped when ranking', () => {
  const proposal = proposalFor(
    [result('firewall', 'fail', 'Firewall disabled'), result('disk-space', 'warn', 'Low space')],
    { 'enable-firewall': { available: false, reason: 'Group Policy manages this profile.' } }
  );
  assert.equal(proposal.repairId, 'clear-temp');
  assert.equal(proposal.available, true);
});

test('no findings produces low-risk preventive maintenance rather than a fake fix', () => {
  const proposal = proposalFor([result('firewall', 'pass'), result('disk-space', 'pass')]);
  assert.equal(proposal.repairId, 'clear-temp');
  assert.equal(proposal.preventive, true);
  assert.equal(proposal.available, true);
});

test('the catalog is a small predefined list with unique ids', () => {
  assert.ok(REPAIRS.length >= 4);
  assert.equal(new Set(REPAIRS.map((repair) => repair.id)).size, REPAIRS.length);
  for (const repair of REPAIRS) {
    assert.ok(['Low', 'Moderate', 'High'].includes(repair.risk));
    assert.equal(typeof repair.name, 'string');
    assert.ok(repair.name.length > 3);
  }
  const ranked = rankRepairCandidates([]);
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].repairId, 'clear-temp');
});
