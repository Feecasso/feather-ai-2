/* Feather AI 2.0 workflow event contract.
 *
 * Adapted from StarNet `shared/events.js` (MIT, Copyright (c) 2026 Andrew Sims):
 * the frozen-contract idea and boundary validation are kept, then reduced to
 * the small event set the three-agent Feather workflow actually emits. See
 * THIRD_PARTY_NOTICES.md for the upstream commit and license text.
 */
'use strict';

const SCHEMA_VERSION = 1;

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const enumOf = (...values) => ({ enum: values });
const obj = (required, properties) => ({ type: 'object', required, properties });

const AGENTS = ['lead', 'scanner', 'repair'];
const CHECK_STATUS = ['pass', 'info', 'warn', 'fail', 'error', 'skip'];

const EVENTS = {
  'agent.status': obj(['agentId', 'status'], {
    agentId: enumOf(...AGENTS),
    status: enumOf('idle', 'working', 'waiting', 'done', 'error'),
    task: str
  }),
  'agent.activity': obj(['agentId', 'text'], {
    agentId: enumOf(...AGENTS),
    text: str,
    tone: enumOf('info', 'good', 'warn', 'bad')
  }),
  'handoff': obj(['id', 'from', 'to', 'reason'], {
    id: str,
    from: enumOf(...AGENTS),
    to: enumOf(...AGENTS),
    reason: str,
    summary: str
  }),
  'job.start': obj(['jobId', 'startedAt', 'checkCount'], {
    jobId: str,
    startedAt: str,
    checkCount: num
  }),
  'scan.check.start': obj(['checkId', 'name', 'index', 'total'], {
    checkId: str,
    name: str,
    index: num,
    total: num
  }),
  'scan.check.result': obj(['checkId', 'name', 'status', 'finding', 'evidence', 'durationMs'], {
    checkId: str,
    name: str,
    status: enumOf(...CHECK_STATUS),
    finding: str,
    evidence: str,
    explanation: str,
    nextStep: str,
    durationMs: num,
    unavailable: bool
  }),
  'scan.done': obj(['summary'], {
    summary: { type: 'object' },
    durationMs: num
  }),
  'repair.proposed': obj(['proposalId', 'repairId', 'name', 'risk', 'rationale'], {
    proposalId: str,
    repairId: str,
    name: str,
    description: str,
    risk: enumOf('Low', 'Moderate', 'High'),
    rationale: str,
    impact: str,
    evidence: str,
    available: bool,
    linkedCheckIds: { type: 'array' },
    preventive: bool
  }),
  'repair.decision': obj(['proposalId', 'decision'], {
    proposalId: str,
    decision: enumOf('approved', 'declined')
  }),
  'repair.start': obj(['repairId', 'name'], {
    repairId: str,
    name: str
  }),
  'repair.done': obj(['repairId', 'outcome', 'summary'], {
    repairId: str,
    outcome: enumOf('success', 'failed', 'cancelled', 'declined', 'unavailable'),
    summary: str,
    details: str,
    rollback: str
  }),
  'report.saved': obj(['reports'], {
    reports: { type: 'array' },
    directory: str,
    fallback: bool,
    warning: str
  }),
  'job.done': obj(['jobId', 'outcome', 'summary'], {
    jobId: str,
    outcome: enumOf('completed', 'declined', 'failed', 'cancelled'),
    summary: str,
    reports: { type: 'array' }
  }),
  'job.error': obj(['message'], {
    message: str,
    where: str
  }),
  'usb.status': obj(['root', 'writable', 'reportsDir'], {
    root: str,
    writable: bool,
    reportsDir: str
  }),
  'workflow.state': obj(['phase'], {
    phase: enumOf('idle', 'scanning', 'awaiting_approval', 'repairing', 'writing_report', 'done', 'error'),
    message: str
  })
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

deepFreeze(EVENTS);

function isKnown(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

function checkValue(path, spec, value, errors) {
  if (!spec || typeof spec !== 'object') return;
  if (spec.enum) {
    if (!spec.enum.includes(value)) errors.push(`${path} must be one of ${spec.enum.join(', ')}`);
    return;
  }
  if (spec.type === 'string') {
    if (typeof value !== 'string') errors.push(`${path} must be a string`);
    return;
  }
  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} must be a finite number`);
    return;
  }
  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
    return;
  }
  if (spec.type === 'array') {
    if (!Array.isArray(value)) errors.push(`${path} must be an array`);
    return;
  }
  if (spec.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push(`${path} must be an object`);
  }
}

/**
 * Validate at the bus boundary in both directions. Returns { ok, errors }.
 * An unknown event name is a hard failure: the front end only accepts the
 * frozen set, so a typo cannot silently disappear from the dashboard.
 */
function validate(name, payload = {}) {
  if (!isKnown(name)) return { ok: false, errors: [`unknown event: ${name}`] };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['payload must be an object'] };
  }
  const schema = EVENTS[name];
  const errors = [];
  for (const key of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) errors.push(`missing required field: ${key}`);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!schema.properties[key]) continue;
    checkValue(key, schema.properties[key], value, errors);
  }
  return { ok: errors.length === 0, errors };
}

function names() {
  return Object.keys(EVENTS);
}

/** A tiny synchronous bus. Every publish validates before it reaches listeners. */
function createBus({ clock = () => new Date().toISOString(), sink = () => {} } = {}) {
  const history = [];
  const listeners = new Set();
  let seq = 0;

  function publish(name, payload = {}) {
    const result = validate(name, payload);
    if (!result.ok) {
      const error = new Error(`Invalid ${name} event: ${result.errors.join('; ')}`);
      error.code = 'EVENT_INVALID';
      throw error;
    }
    const event = Object.freeze({
      seq: ++seq,
      at: clock(),
      type: name,
      payload: Object.freeze({ ...payload })
    });
    history.push(event);
    if (history.length > 500) history.shift();
    try {
      sink(event);
    } catch {
      /* a broken renderer must not stop the job */
    }
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* listener isolation */
      }
    }
    return event;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { publish, subscribe, history, names };
}

module.exports = { SCHEMA_VERSION, AGENTS, CHECK_STATUS, EVENTS, validate, names, createBus, deepFreeze };
