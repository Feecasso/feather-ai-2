'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canAgentUse, attenuate, makeCapCtx } = require('../src/main/workflow/capGate');

test('canAgentUse only grants tools present in the resolved set', () => {
  const resolved = { tools: ['diag.run', 'handoff'], room: 'feather-lab' };
  assert.deepEqual(canAgentUse(resolved, 'diag.run'), { ok: true });
  const denied = canAgentUse(resolved, 'repair.apply');
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /repair\.apply/);
});

test('attenuation can only remove tools, never add them', () => {
  const resolved = { tools: ['a', 'b', 'c'], deferred: ['a', 'c'], room: 'lab' };
  const worker = attenuate(resolved, ['a', 'c', 'repair.apply']);
  assert.deepEqual(worker.tools, ['a', 'c']);
  assert.deepEqual(worker.deferred, ['a', 'c']);
  assert.equal(canAgentUse(worker, 'repair.apply').ok, false);
});

test('makeCapCtx gates compute and tools independently', () => {
  const ctx = makeCapCtx({
    agentId: 'scanner',
    room: 'feather-lab',
    tools: ['diag.run'],
    hasCompute: false,
    deferred: [],
    approvalRules: {}
  });
  assert.equal(ctx.canRun(), false);
  assert.equal(ctx.canUse({ name: 'diag.run' }).ok, true);
  assert.equal(ctx.canUse({ name: 'repair.apply' }).ok, false);
});
