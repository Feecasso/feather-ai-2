'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SCHEMA_VERSION, EVENTS, validate, names, createBus, deepFreeze } = require('../src/main/workflow/events');

test('frozen contract exposes the expected workflow events', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.ok(names().includes('job.start'));
  assert.ok(names().includes('scan.check.result'));
  assert.ok(names().includes('repair.proposed'));
  assert.ok(names().includes('report.saved'));
  assert.ok(Object.isFrozen(EVENTS));
  assert.throws(() => {
    EVENTS['job.start'].required.push('nope');
  }, TypeError);
});

test('validate accepts a well-formed event and rejects missing fields', () => {
  const good = validate('scan.check.result', {
    checkId: 'disk-space',
    name: 'System drive space',
    status: 'skip',
    finding: 'Not available',
    evidence: 'Win32_LogicalDisk returned nothing',
    explanation: 'The check did not apply.',
    nextStep: 'No action required.',
    durationMs: 12,
    unavailable: true
  });
  assert.deepEqual(good, { ok: true, errors: [] });

  const missing = validate('scan.check.result', { checkId: 'disk-space' });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes('status')));
  assert.ok(missing.errors.some((error) => error.includes('finding')));
});

test('unknown events and wrong enum values fail at the boundary', () => {
  assert.equal(validate('workflow:reset', {}).ok, false);
  const badStatus = validate('scan.check.result', {
    checkId: 'x',
    name: 'X',
    status: 'great',
    finding: 'f',
    evidence: 'e',
    durationMs: 1
  });
  assert.equal(badStatus.ok, false);
  assert.ok(badStatus.errors.some((error) => error.includes('must be one of')));
});

test('the bus validates, freezes, sequences, and isolates listener failures', () => {
  const seen = [];
  const bus = createBus({
    clock: () => '2026-11-14T00:00:00.000Z',
    sink: (event) => seen.push(event)
  });
  bus.subscribe(() => {
    throw new Error('a broken listener must not stop the job');
  });
  const event = bus.publish('job.start', { jobId: 'job-1', startedAt: 'now', checkCount: 11 });
  assert.equal(event.seq, 1);
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.payload));
  assert.equal(seen.length, 1);
  assert.throws(() => bus.publish('scan.check.result', { checkId: 'x' }), /Invalid scan\.check\.result/);
});

test('deepFreeze freezes nested contract objects', () => {
  const value = deepFreeze({ a: { b: [1, 2] } });
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.a));
  assert.ok(Object.isFrozen(value.a.b));
});
