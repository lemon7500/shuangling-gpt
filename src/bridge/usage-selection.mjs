import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);

/** View preference only: no task binding, chat text, usage samples or account data. */
export class UsageSelectionStore {
  constructor({ dataDir, readFileImpl = readFile, writeFileImpl = writeFile, renameImpl = rename }) {
    this.path = join(dataDir, 'usage-selection.json');
    this.readFile = readFileImpl;
    this.writeFile = writeFileImpl;
    this.rename = renameImpl;
  }

  async read() {
    try {
      const raw = await this.readFile(this.path, 'utf8');
      if (raw.length > 4096) return null;
      const saved = JSON.parse(raw);
      return saved?.version === 1 && validId(saved.threadId) ? saved.threadId : null;
    } catch { return null; }
  }

  async save(threadId) {
    if (!validId(threadId)) throw new Error('invalid-usage-thread');
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await this.writeFile(temp, JSON.stringify({ version: 1, threadId }, null, 2) + '\n', { mode: 0o600 });
      await this.rename(temp, this.path);
    } catch {
      // Keep the previous durable choice and never report a successful switch.
      throw Object.assign(new Error('usage-selection-save-failed'), { reason: 'usage-selection-save-failed' });
    }
  }
}
