import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { StatusReducer } from './status.mjs';
import { UsageReducer } from './usage.mjs';

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_LINE = 8 * 1024 * 1024;

async function filesUnder(root, fsApi = fs, depth = 0) {
  if (depth > 5) return [];
  const entries = await fsApi.readdir(root, { withFileTypes: true });
  const results = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesUnder(path, fsApi, depth + 1);
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
  }));
  return results.flat();
}

export async function readSessionMetadata(path, fsApi = fs) {
  const file = await fsApi.open(path, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const newline = text.indexOf('\n');
    if (newline < 0) return null;
    const event = JSON.parse(text.slice(0, newline));
    if (event.type !== 'session_meta' || !ID.test(event.payload?.id ?? '')) return null;
    const p = event.payload;
    // Return a deliberately small allowlist; never spread the rollout payload.
    return { id: p.id, timestamp: p.timestamp ?? event.timestamp ?? null, source: p.thread_source ?? null };
  } finally { await file.close(); }
}

export async function listThreads(codexHome, { fsApi = fs, limit = 100 } = {}) {
  const paths = await filesUnder(join(codexHome, 'sessions'), fsApi);
  const out = [];
  // Recent paths first makes the bounded metadata pass useful on large histories.
  for (const path of paths.sort().reverse()) {
    try {
      const metadata = await readSessionMetadata(path, fsApi);
      if (metadata && metadata.source !== 'subagent') out.push(metadata);
      if (out.length >= limit) break;
    } catch { /* a concurrently rotated or unreadable session is omitted */ }
  }
  return out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

export class RolloutWatcher {
  constructor({ codexHome, threadId, onChange = () => {}, intervalMs = 300, fsApi = fs }) {
    if (!ID.test(threadId ?? '')) throw new Error('invalid-thread-id');
    this.codexHome = codexHome;
    this.threadId = threadId;
    this.fs = fsApi;
    this.onChange = onChange;
    this.intervalMs = intervalMs;
    this.reducer = new StatusReducer(threadId);
    this.usage = new UsageReducer(threadId);
    this.path = null;
    this.identity = null;
    this.offset = 0;
    this.carry = '';
    this.carryBytes = 0;
    this.decoder = new StringDecoder('utf8');
    this.dropping = false;
    this.lastSnapshot = null;
    this.busy = false;
    this.closed = false;
    this.recovering = false;
    this.checkpointHash = null;
  }

  snapshot() { return this.reducer.snapshot(); }
  usageSnapshot(now) { return this.usage.snapshot(now); }

  async find() {
    const suffix = `-${this.threadId}.jsonl`;
    const paths = (await filesUnder(join(this.codexHome, 'sessions'), this.fs)).filter(p => p.endsWith(suffix));
    for (const path of paths.sort().reverse()) {
      const metadata = await readSessionMetadata(path, this.fs);
      if (metadata?.id === this.threadId && metadata.source !== 'subagent') return path;
    }
    return null;
  }

  publish() {
    const snapshot = this.snapshot();
    const key = JSON.stringify(snapshot);
    if (key !== this.lastSnapshot) {
      this.lastSnapshot = key;
      this.onChange(snapshot);
    }
  }

  resetRead(reason) {
    this.offset = 0;
    this.carry = '';
    this.carryBytes = 0;
    this.decoder = new StringDecoder('utf8');
    this.dropping = false;
    this.checkpointHash = null;
    this.reducer.reset(reason);
    this.usage.reset(reason);
  }

  async checkpoint(file) {
    if (!this.offset) return null;
    const length = Math.min(128, this.offset);
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await file.read(bytes, 0, length, this.offset - length);
    return createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex');
  }

  consume(text) {
    for (const segment of text.split(/(?<=\n)/)) {
      const complete = segment.endsWith('\n');
      if (!this.dropping) {
        this.carry += segment;
        this.carryBytes += Buffer.byteLength(segment, 'utf8');
        if (this.carryBytes > MAX_LINE) { this.carry = ''; this.dropping = true; this.reducer.unavailable('log-format-incompatible'); this.usage.unavailable('log-format-incompatible'); }
      }
      if (!complete) continue;
      if (!this.dropping) {
        try { const event = JSON.parse(this.carry); this.reducer.accept(event); this.usage.accept(event); }
        catch { this.reducer.unavailable('log-format-incompatible'); this.usage.unavailable('log-format-incompatible'); }
      }
      this.carry = '';
      this.carryBytes = 0;
      this.dropping = false;
    }
  }

  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      if (!this.path) this.path = await this.find();
      if (!this.path) { this.reducer.unavailable('log-not-found'); this.usage.unavailable('log-not-found'); this.publish(); return; }
      const file = await this.fs.open(this.path, 'r');
      try {
        const stat = await file.stat();
        const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        const replacedPrefix = this.checkpointHash && stat.size >= this.offset && await this.checkpoint(file) !== this.checkpointHash;
        if (this.recovering || this.identity !== identity || stat.size < this.offset || replacedPrefix) this.resetRead(this.identity ? 'log-reloaded' : 'initializing');
        this.recovering = false;
        this.identity = identity;
        const buffer = Buffer.alloc(256 * 1024);
        while (this.offset < stat.size && !this.closed) {
          const count = Math.min(buffer.length, stat.size - this.offset);
          const { bytesRead } = await file.read(buffer, 0, count, this.offset);
          if (!bytesRead) break;
          this.offset += bytesRead;
          this.consume(this.decoder.write(buffer.subarray(0, bytesRead)));
        }
        this.checkpointHash = await this.checkpoint(file);
      } finally { await file.close(); }
      this.publish();
    } catch (error) {
      this.recovering = true;
      const reason = ['EACCES', 'EPERM'].includes(error?.code) ? 'log-permission-denied' : 'log-unavailable';
      if (error?.code === 'ENOENT') { this.path = null; this.identity = null; }
      this.reducer.unavailable(reason);
      this.usage.unavailable(reason);
      this.publish();
    } finally { this.busy = false; }
  }

  async start() {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 10));
  }
}
