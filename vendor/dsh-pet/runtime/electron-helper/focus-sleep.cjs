'use strict';
const { readFileSync, statSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } = require('node:fs');
const { dirname, isAbsolute, join } = require('node:path');
const { randomUUID } = require('node:crypto');

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const epoch = value => Number.isSafeInteger(value) && value >= 0;
function validSleepEvent(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 4 && ['id', 'sessionId', 'runId'].every(key => uuid(value[key])) && epoch(value.at);
}
const intentPath = directory => join(directory, 'focus-sleep-intent.json');
const activationPath = directory => join(directory, 'focus-sleep-activation.json');
function atomicJsonSync(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`, handle = openSync(temp, 'wx', 0o600);
  try { writeFileSync(handle, JSON.stringify(value) + '\n'); fsyncSync(handle); }
  finally { closeSync(handle); }
  renameSync(temp, file);
}
function readActivationSync(directory) {
  const file = activationPath(directory);
  try {
    if (statSync(file).size > 1024) throw new Error('focus-sleep-activation-invalid');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || Object.keys(value).length !== 4 || !uuid(value.sessionId) || !uuid(value.runId) ||
        !epoch(value.startedAt) || !epoch(value.baseRevision)) throw new Error('focus-sleep-activation-invalid');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Publish before the first asynchronous write of a new running activation.
 * Its old revision fence expires automatically when desk.json commits. */
function prepareFocusActivationSync(directory, previous, draft) {
  if (draft.focus.status !== 'running' || (previous.focus.status === 'running' && previous.focus.runId === draft.focus.runId)) return;
  atomicJsonSync(activationPath(directory), { sessionId: draft.sleepSessionId, runId: draft.focus.runId,
    startedAt: draft.sleepRunStartedAt, baseRevision: previous.revision });
}

/** Fixed private sibling paths only. No settings token or renderer-supplied path. */
function recordFocusSleepSync(managerStatePath, at = Date.now()) {
  if (typeof managerStatePath !== 'string' || !isAbsolute(managerStatePath) || !epoch(at)) throw new Error('focus-sleep-unavailable');
  const directory = dirname(managerStatePath), deskFile = join(directory, 'desk.json');
  if (statSync(deskFile).size > 8_388_608) throw new Error('focus-sleep-unavailable');
  const desk = JSON.parse(readFileSync(deskFile, 'utf8'));
  const activation = readActivationSync(directory);
  const pending = activation?.sessionId === desk.sleepSessionId && activation.baseRevision === desk.revision ? activation : null;
  if (!pending && desk.focus?.status !== 'running') return null;
  const startedAt = pending ? pending.startedAt : desk.sleepRunStartedAt;
  const event = { id: randomUUID(), sessionId: desk.sleepSessionId, runId: pending ? pending.runId : desk.focus.runId, at };
  if (!validSleepEvent(event) || !epoch(startedAt) || at < startedAt) throw new Error('focus-sleep-unavailable');
  const previous = readFocusSleepSync(directory);
  if (previous && previous.sessionId === event.sessionId && previous.runId === event.runId && previous.at <= at &&
      previous.at >= startedAt) return { type: 'focus.suspend', reason: 'sleep', event: previous };
  atomicJsonSync(intentPath(directory), event);
  return { type: 'focus.suspend', reason: 'sleep', event };
}

/** A failed read blocks the transaction; a failed checkpoint must retry this intent. */
function readFocusSleepSync(directory) {
  const file = intentPath(directory);
  try {
    if (statSync(file).size > 1024) throw new Error('focus-sleep-invalid');
    const event = JSON.parse(readFileSync(file, 'utf8'));
    if (!validSleepEvent(event)) throw new Error('focus-sleep-invalid');
    return event;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
module.exports = { validSleepEvent, recordFocusSleepSync, readFocusSleepSync, prepareFocusActivationSync };
