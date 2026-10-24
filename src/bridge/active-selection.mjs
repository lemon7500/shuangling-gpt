// Codex desktop does not currently publish its selected navigation route to
// third-party local integrations. A last request, saved project preference or
// retained stream view is not evidence of the page the user is looking at.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectUsageReader } from './project-usage.mjs';

const THREAD_ID = /^[A-Za-z0-9_-]{1,120}$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const shortText = value => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : null;
const threadName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null;
const safeRoots = value => Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string' && v.length <= 32768 && (path.win32.isAbsolute(v) || path.posix.isAbsolute(v))).map(v => /^[A-Za-z]:[\\/]$/.test(v) ? v : v.replace(/[\\/]+$/, '') || v))] : [];

export class ActiveSelectionReader {
  constructor({ codexHome, projectRoot, now = Date.now, readState, readNameIndex, metadataReader } = {}) {
    this.codexHome = codexHome;
    this.projectRoot = projectRoot;
    this.now = now;
    this.readState = readState ?? (() => readFile(path.join(codexHome, '.codex-global-state.json'), 'utf8'));
    this.readNameIndex = readNameIndex ?? (codexHome ? () => readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8') : async () => '');
    this.metadataReader = metadataReader ?? (codexHome ? new ProjectUsageReader({ codexHome, now }) : null);
  }

  async snapshot() {
    // Deliberately do not fall back to the pet's bound conversation, selected-
    // project (the new-chat default), latest log or the last retained stream.
    return {
      status: 'unknown', threadId: null, projectName: null, projectRoot: null,
      source: 'codex-desktop-navigation', observedAt: new Date(this.now()).toISOString(),
      reason: 'active-page-not-exposed',
    };
  }

  async resolveThread(threadId) {
    if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return this.unknown('invalid-thread-id');
    // Project preferences cannot attest that an ID is a real local root chat.
    // Verify the session's allowlisted metadata before resolving membership.
    if (!this.metadataReader) return this.unknown('thread-metadata-unavailable', threadId);
    try { await this.metadataReader.refreshIndex(); }
    catch { return this.unknown('thread-metadata-unavailable', threadId); }
    if (this.metadataReader.index?.get(threadId)?.metadata?.source !== 'root') return this.unknown('thread-not-root', threadId);
    const names = await this.readThreadNames([threadId]);
    let state;
    try {
      const raw = await this.readState();
      state = record(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch { return { ...this.threadMembership(threadId), threadName: names.get(threadId) ?? null, reason: 'project-metadata-unavailable' }; }
    return { ...this.resolveMembership(threadId, state), threadName: names.get(threadId) ?? null };
  }

  async readThreadNames(threadIds) {
    const allowed = new Set(threadIds.filter(id => THREAD_ID.test(id)));
    if (!allowed.size) return new Map();
    let raw;
    try { raw = await this.readNameIndex(); } catch { return new Map(); }
    // Read metadata only; never derive a title from the first user message.
    if (typeof raw !== 'string' || raw.length > 16 * 1024 * 1024) return new Map();
    const names = new Map();
    const lines = raw.split('\n');
    lines.pop(); // An unfinished appended record must not rename an entry.
    for (const line of lines) {
      if (line.length > 32768) continue;
      try {
        const row = JSON.parse(line);
        if (!allowed.has(row?.id) || typeof row.thread_name !== 'string') continue;
        const at = typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at)) ? Date.parse(row.updated_at) : -Infinity;
        if (names.has(row.id) && names.get(row.id).at > at) continue;
        names.set(row.id, { name: threadName(row.thread_name), at });
      } catch { /* A damaged metadata row does not hide other chat names. */ }
    }
    return new Map([...names].filter(([, value]) => value.name).map(([id, value]) => [id, value.name]));
  }

  resolveMembership(threadId, state) {
    // Read only membership metadata. Never retain drafts, messages or other
    // values from the desktop's global state in this reader or its snapshots.
    const assignments = record(state['thread-project-assignments']);
    const hosts = record(state['thread-project-membership-host-ids']);
    const assignment = record(assignments[threadId]);
    const hostId = hosts[threadId];
    const thread = this.threadMembership(threadId);
    if (hostId && hostId !== 'local') return { ...thread, reason: 'non-local-project' };
    if (assignment.projectKind !== 'local' || typeof assignment.projectId !== 'string') return { ...thread, reason: 'project-not-assigned' };
    const projects = record(state['local-projects']);
    const project = record(projects[assignment.projectId]);
    if (project.id !== assignment.projectId) return { ...thread, reason: 'project-metadata-missing' };
    const roots = safeRoots(project.rootPaths);
    const name = shortText(project.name);
    const members = Object.entries(assignments).filter(([id, item]) => THREAD_ID.test(id) && record(item).projectKind === 'local' && item.projectId === assignment.projectId && (!hosts[id] || hosts[id] === 'local')).map(([id]) => id).sort();
    return {
      ...thread, scope: 'project', projectId: assignment.projectId,
      projectName: name, projectRoot: roots[0] ?? null, projectRoots: roots,
      projectThreadIds: members,
    };
  }

  async listThreads({ limit = 100 } = {}) {
    if (!this.metadataReader) return [];
    // The index allowlists first-record metadata and rejects subagents and
    // guardian/review sessions. A list is for explicit choice, never recency-
    // based automatic page selection.
    try { await this.metadataReader.refreshIndex(); } catch { return []; }
    let state = {};
    try { const raw = await this.readState(); state = record(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { /* Names can remain unknown. */ }
    const verifiedIds = [...this.metadataReader.index].filter(([id, entry]) => THREAD_ID.test(id) && entry?.metadata?.source === 'root').map(([id]) => id);
    const names = await this.readThreadNames(verifiedIds);
    const rows = [];
    for (const [id, entry] of this.metadataReader.index) {
      if (!THREAD_ID.test(id) || entry?.metadata?.source !== 'root') continue;
      const membership = this.resolveMembership(id, state);
      rows.push({ threadId: id, threadName: names.get(id) ?? null, projectName: membership.projectName, projectId: membership.projectId,
        createdAt: typeof entry.metadata.timestamp === 'string' && Number.isFinite(Date.parse(entry.metadata.timestamp)) ? entry.metadata.timestamp : null });
    }
    return rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || a.threadId.localeCompare(b.threadId)).slice(0, Number.isInteger(limit) ? Math.max(0, Math.min(200, limit)) : 100);
  }

  unknown(reason, threadId = null) {
    return { status: 'unknown', threadId, projectName: null, projectRoot: null, source: 'codex-thread-project-membership', observedAt: new Date(this.now()).toISOString(), reason };
  }

  threadMembership(threadId) {
    return { status: 'available', threadId, scope: 'thread', projectId: null, projectName: null, projectRoot: null, projectRoots: [], projectThreadIds: [threadId], source: 'codex-thread-project-membership', observedAt: new Date(this.now()).toISOString() };
  }
}
