import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { UsageReducer } from './usage.mjs';

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_LINE = 8 * 1024 * 1024;
// Canonical body records can contain images, tool output and copied histories
// far larger than usage telemetry. Only a positively recognized top-level
// header (including the local ordinal field) may bypass the line cap; unknown
// headers and usage records fail closed.
const bodyRecord = line => /^\s*\{\s*(?:(?:"timestamp"\s*:\s*"(?:[^"\\]|\\.)*"|"ordinal"\s*:\s*(?:0|[1-9]\d*))\s*,\s*){0,2}"type"\s*:\s*"(?:response_item|compacted|turn_context)"(?:\s*[,}])/u.test(line);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validTotal = value => Number.isSafeInteger(value) && value >= 0;
const unknown = (reason, observedAt = null) => ({ status: 'unknown', reason, observedAt });
const pathKey = value => typeof value === 'string' && value.trim()
  ? value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() : null;
const within = (path, root) => path === root || path.startsWith(`${root}/`);

// This allowlist deliberately excludes session instructions, messages, account
// identifiers and titles. Parent sessions include guardian/review agents too.
function metadataFrom(event) {
  const p = event?.payload;
  if (event?.type !== 'session_meta' || !ID.test(p?.id ?? '')) return null;
  const parentThreadId = ID.test(p.parent_thread_id ?? '') ? p.parent_thread_id : null;
  const child = Boolean(parentThreadId || p.source?.subagent || ['subagent', 'guardian_review'].includes(p.thread_source));
  return {
    id: p.id,
    cwd: typeof p.cwd === 'string' ? p.cwd : null,
    workspaceRoots: Array.isArray(p.runtime_workspace_roots) ? p.runtime_workspace_roots.filter(v => typeof v === 'string') : [],
    forkedFromId: ID.test(p.forked_from_id ?? '') ? p.forked_from_id : null,
    parentThreadId,
    source: child ? 'subagent' : 'root',
    timestamp: validTime(p.timestamp ?? event.timestamp) ? p.timestamp ?? event.timestamp : null,
  };
}

async function filesUnder(root, fsApi, depth = 0) {
  if (depth > 5) return [];
  const entries = await fsApi.readdir(root, { withFileTypes: true });
  const out = await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesUnder(join(root, entry.name), fsApi, depth + 1)
    : entry.isFile() && entry.name.endsWith('.jsonl') ? [join(root, entry.name)] : []));
  return out.flat();
}

async function firstMetadata(path, fsApi) {
  const file = await fsApi.open(path, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const end = text.indexOf('\n');
    return end < 0 ? null : metadataFrom(JSON.parse(text.slice(0, end)));
  } finally { await file.close(); }
}

/** Read-only, incremental usage telemetry. No conversation text is retained. */
export class ProjectUsageReader {
  constructor({ codexHome, now = Date.now, fsApi = fs, indexMaxAgeMs = 5000 } = {}) {
    if (typeof codexHome !== 'string' || !codexHome) throw new Error('codex-home-required');
    this.codexHome = codexHome;
    this.now = now;
    this.fs = fsApi;
    this.indexMaxAgeMs = indexMaxAgeMs;
    this.index = new Map();
    this.indexAt = -Infinity;
    this.indexProblem = null;
    this.metadataCache = new Map();
    this.readers = new Map();
    this.pending = Promise.resolve();
  }

  async refreshIndex() {
    if (this.now() - this.indexAt < this.indexMaxAgeMs) return;
    const next = new Map();
    let problem = null;
    const allPaths = [];
    for (const directory of ['sessions', 'archived_sessions']) {
      try { allPaths.push(...await filesUnder(join(this.codexHome, directory), this.fs)); }
      catch (error) {
        if (!(directory === 'archived_sessions' && error?.code === 'ENOENT')) problem = ['EACCES', 'EPERM'].includes(error?.code) ? 'log-permission-denied' : 'log-unavailable';
      }
    }
    // Metadata work is bounded in batches, rather than opening every rollout
    // concurrently. Full contents are read only for selected root chats.
    for (let offset = 0; offset < allPaths.length; offset += 16) {
      const batch = await Promise.all(allPaths.slice(offset, offset + 16).map(async path => {
        try {
          const stat = await this.fs.stat(path);
          const signature = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.size}:${stat.mtimeMs}`;
          let cached = this.metadataCache.get(path);
          if (!cached || cached.signature !== signature) {
            cached = { signature, metadata: await firstMetadata(path, this.fs) };
            this.metadataCache.set(path, cached);
          }
          return cached.metadata ? { path, metadata: cached.metadata, mtimeMs: stat.mtimeMs, size: stat.size } : null;
        } catch (error) {
          if (error?.code !== 'ENOENT') problem ??= ['EACCES', 'EPERM'].includes(error?.code) ? 'log-permission-denied' : 'log-format-incompatible';
          return null;
        }
      }));
      for (const entry of batch) {
        if (!entry || entry.metadata.source !== 'root') continue;
        const old = next.get(entry.metadata.id);
        if (!old || entry.mtimeMs > old.mtimeMs || entry.mtimeMs === old.mtimeMs && entry.size > old.size) next.set(entry.metadata.id, entry);
      }
    }
    this.index = next;
    this.indexProblem = problem;
    this.indexAt = this.now();
  }

  newReader(threadId) {
    return { threadId, usage: new UsageReducer(threadId, { now: this.now }), metadata: null, offset: 0,
      identity: null, checkpoint: null, decoder: new StringDecoder('utf8'), carry: '', carryBytes: 0,
      dropping: false, malformed: false, regressed: false, problem: null, latestAt: 0,
      total: null, observedAt: null, samples: [] };
  }

  consumeLine(reader, line) {
    // Body records are discarded before parsing. The temporary input buffer is
    // released after this tick; cached records contain numeric usage only.
    if (reader.metadata && !/"type"\s*:\s*"token_count"/.test(line)) return;
    let event;
    try { event = JSON.parse(line); }
    catch { reader.malformed = true; reader.usage.unavailable('log-format-incompatible'); return; }
    if (!reader.metadata) {
      const metadata = metadataFrom(event);
      if (!metadata || metadata.id !== reader.threadId || metadata.source !== 'root') {
        reader.problem = 'wrong-thread'; return;
      }
      reader.metadata = metadata;
      reader.usage.accept(event);
      return;
    }
    reader.usage.accept(event);
    const p = event.payload;
    const attribution = p?.thread_id ?? p?.threadId ?? p?.turn_attribution?.thread_id ?? event.thread_id;
    if (event.type !== 'event_msg' || p?.type !== 'token_count' || attribution && attribution !== reader.threadId) return;
    if (!validTime(event.timestamp)) return;
    const at = Date.parse(event.timestamp);
    if (at > this.now() + 60_000 || at < reader.latestAt) return;
    const total = p.info?.total_token_usage?.total_tokens;
    // Quota-only events do not erase a valid lifetime count. last_token_usage
    // and cached_input_tokens are never added to cumulative totals.
    if (!Object.hasOwn(p.info ?? {}, 'total_token_usage')) return;
    if (!validTotal(total)) { reader.problem = 'cumulative-not-reported'; return; }
    if (reader.total !== null && total < reader.total) reader.regressed = true;
    reader.latestAt = at;
    reader.total = total;
    reader.observedAt = event.timestamp;
    reader.problem = null;
    const components = p.info.total_token_usage;
    const key = [event.timestamp, total, ...['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'].map(k => validTotal(components[k]) ? components[k] : null)].join('|');
    if (reader.samples.at(-1)?.key !== key) reader.samples.push({ key, total, at });
  }

  consume(reader, text) {
    for (const segment of text.split(/(?<=\n)/)) {
      if (!reader.dropping) {
        reader.carry += segment;
        reader.carryBytes += Buffer.byteLength(segment);
        if (reader.carryBytes > MAX_LINE) {
          if (!reader.metadata || !bodyRecord(reader.carry)) {
            reader.malformed = true; reader.usage.unavailable('log-format-incompatible');
          }
          reader.carry = ''; reader.dropping = true;
        }
      }
      if (!segment.endsWith('\n')) continue;
      if (!reader.dropping) this.consumeLine(reader, reader.carry);
      reader.carry = ''; reader.carryBytes = 0; reader.dropping = false;
    }
  }

  async checkpoint(file, offset) {
    if (!offset) return null;
    const bytes = Buffer.alloc(Math.min(128, offset));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, offset - bytes.length);
    return createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex');
  }

  async read(entry) {
    let reader = this.readers.get(entry.path);
    if (!reader || reader.threadId !== entry.metadata.id) reader = this.newReader(entry.metadata.id);
    try {
      const file = await this.fs.open(entry.path, 'r');
      try {
        const stat = await file.stat();
        const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        const replaced = reader.identity !== identity || stat.size < reader.offset || reader.checkpoint && await this.checkpoint(file, reader.offset) !== reader.checkpoint;
        if (replaced) reader = this.newReader(entry.metadata.id);
        reader.identity = identity;
        const buffer = Buffer.alloc(256 * 1024);
        while (reader.offset < stat.size) {
          const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, stat.size - reader.offset), reader.offset);
          if (!bytesRead) break;
          reader.offset += bytesRead;
          this.consume(reader, reader.decoder.write(buffer.subarray(0, bytesRead)));
        }
        reader.checkpoint = await this.checkpoint(file, reader.offset);
      } finally { await file.close(); }
    } catch (error) {
      reader.problem = ['EACCES', 'EPERM'].includes(error?.code) ? 'log-permission-denied' : 'log-unavailable';
      reader.usage.unavailable(reader.problem);
      // Reload after recovery, so a stale UsageReducer problem cannot survive
      // an otherwise unchanged, newly readable file.
      reader.identity = null;
    }
    this.readers.set(entry.path, reader);
    return reader;
  }

  snapshot(options = {}) {
    const operation = () => this.computeSnapshot(options);
    const pending = this.pending.then(operation, operation);
    this.pending = pending.catch(() => {});
    return pending;
  }

  async computeSnapshot({ threadId, scope = 'thread', projectThreadIds, projectRoot, projectRoots = [], projectName } = {}) {
    if (!ID.test(threadId ?? '')) throw new Error('invalid-thread-id');
    await this.refreshIndex();
    const roots = [...new Set([projectRoot, ...projectRoots].map(pathKey).filter(Boolean))];
    const explicitIds = Array.isArray(projectThreadIds) ? [...new Set(projectThreadIds.filter(id => ID.test(id ?? '')))] : null;
    const hasMembership = explicitIds !== null || roots.length > 0;
    const actualScope = scope === 'project' && hasMembership ? 'project' : 'thread';
    const selected = this.index.get(threadId);
    const selectedReader = selected ? await this.read(selected) : null;
    const members = actualScope === 'thread' ? selected ? [selected] : [] : explicitIds
      ? explicitIds.map(id => this.index.get(id)).filter(Boolean)
      : [...this.index.values()].filter(entry => [entry.metadata.cwd, ...entry.metadata.workspaceRoots].map(pathKey).filter(Boolean).some(path => roots.some(root => within(path, root))));
    const readings = new Map(selectedReader ? [[threadId, selectedReader]] : []);
    for (const entry of members) if (!readings.has(entry.metadata.id)) readings.set(entry.metadata.id, await this.read(entry));
    // Ancestors are loaded only to identify an exact inherited telemetry
    // prefix. They are not automatically added to the selected project.
    for (const reader of [...readings.values()]) {
      const ancestorId = reader.metadata?.forkedFromId;
      const ancestor = ancestorId && this.index.get(ancestorId);
      if (ancestor && !readings.has(ancestorId)) readings.set(ancestorId, await this.read(ancestor));
    }
    let usedTokens = 0, sampled = 0, observedAt = null;
    // Explicit membership is authoritative: unrelated unreadable rollouts do
    // not make this project's known member set incomplete. Root-path matching
    // still needs the whole index because an unreadable file may match it.
    let problem = actualScope === 'project' && explicitIds === null ? this.indexProblem : null;
    if (actualScope === 'project' && explicitIds && members.length !== explicitIds.length) problem ??= 'project-logs-unavailable';
    for (const entry of members) {
      const reader = readings.get(entry.metadata.id);
      if (reader.problem || reader.malformed || reader.total === null) {
        problem ??= reader.problem ?? (reader.malformed ? 'log-format-incompatible' : 'cumulative-not-reported');
        continue;
      }
      // A reset makes the full lifetime unverifiable, but the latest valid
      // reported counter is still a known lower bound. Never add reset epochs
      // together or reuse the earlier maximum as an exact lifetime total.
      if (reader.regressed) problem ??= 'cumulative-reset';
      let contribution = reader.total;
      const ancestorId = reader.metadata?.forkedFromId;
      if (ancestorId && actualScope === 'project') {
        const ancestor = readings.get(ancestorId);
        const keys = new Set(ancestor?.samples.map(sample => sample.key));
        const inherited = reader.samples.filter(sample => keys.has(sample.key));
        // A fork without verifiable shared samples cannot safely be summed.
        // Excluding its number and marking partial prevents counting copied
        // history twice. A single-chat figure remains its reported lifetime.
        if (!ancestor || ancestor.problem || ancestor.malformed || !inherited.length) { problem ??= 'fork-usage-unverified'; continue; }
        const baseline = inherited.reduce((max, sample) => Math.max(max, sample.total), 0);
        if (baseline > contribution) { problem ??= 'fork-usage-unverified'; continue; }
        contribution -= baseline;
      }
      if (!Number.isSafeInteger(usedTokens + contribution)) { problem ??= 'cumulative-overflow'; continue; }
      usedTokens += contribution;
      sampled++;
      if (!observedAt || Date.parse(reader.observedAt) > Date.parse(observedAt)) observedAt = reader.observedAt;
    }
    if (!members.length) problem ??= selected ? 'project-membership-unavailable' : this.indexProblem ?? 'log-not-found';
    const label = actualScope === 'project' ? projectName || '当前项目' : '当前聊天';
    const project = {
      status: sampled ? problem ? 'partial' : 'available' : 'unknown',
      ...(sampled ? { usedTokens } : {}), observedAt,
      threadCount: members.length, sampledThreadCount: sampled, scope: actualScope, label,
      ...(problem ? { reason: problem } : scope === 'project' && !hasMembership ? { reason: 'project-membership-unavailable' } : {}),
      source: 'local-codex-cumulative',
    };
    const usage = selectedReader?.usage.snapshot() ?? { ...new UsageReducer(threadId, { now: this.now }).snapshot(), context: unknown(this.indexProblem ?? 'log-not-found') };
    // A malformed cumulative field affects the lifetime figure only. Context
    // and account telemetry have their own independent validation above.
    if (selectedReader?.problem && selectedReader.problem !== 'cumulative-not-reported' || selectedReader?.malformed) {
      const reason = selectedReader.problem ?? 'log-format-incompatible';
      usage.context = unknown(reason, usage.context?.observedAt);
      usage.account = { ...usage.account, ...Object.fromEntries(['fiveHour', 'weekly']
        .map(key => [key, unknown(reason, usage.account[key]?.observedAt)])) };
    }
    return { ...usage, project, metadata: selectedReader?.metadata ?? selected?.metadata ?? null };
  }
}
