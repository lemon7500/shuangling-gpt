import { formatUsageSummary } from './usage.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const unknown = reason => ({ status: 'unknown', reason, observedAt: null });
const identity = selection => JSON.stringify([
  selection?.status, selection?.threadId, selection?.projectId,
  selection?.projectRoot, selection?.projectRoots, selection?.projectThreadIds,
]);

/** Chat usage and the shared account quota have independent sources. */
export class ActiveUsageService {
  constructor({ selectionReader, projectReader, scope = 'thread', accountSnapshot = () => null }) {
    this.selectionReader = selectionReader;
    this.projectReader = projectReader;
    this.scope = scope;
    this.accountSnapshot = accountSnapshot;
    this.pending = null;
  }

  readAccount() {
    try {
      const account = this.accountSnapshot();
      return {
        ...(typeof account?.observedAt === 'string' ? { observedAt: account.observedAt } : {}),
        ...(['free', 'go', 'plus', 'pro', 'max', 'team', 'business', 'enterprise', 'edu'].includes(account?.planType) ? { planType: account.planType } : {}),
        fiveHour: account?.fiveHour ?? unknown('not-reported'), weekly: account?.weekly ?? unknown('not-reported'),
      };
    } catch {
      return { fiveHour: unknown('account-source-unavailable'), weekly: unknown('account-source-unavailable') };
    }
  }

  unavailable(selection, reason = 'active-page-unavailable') {
    const value = {
      source: 'local-codex-rollout', threadId: null,
      selection: { status: 'unknown', threadId: null, reason, source: selection?.source ?? null, observedAt: selection?.observedAt ?? null,
        choices: Array.isArray(selection?.choices) ? selection.choices.filter(choice => validId(choice?.threadId)).map(choice => ({
          threadId: choice.threadId, threadName: typeof choice.threadName === 'string' ? choice.threadName : null,
          projectName: typeof choice.projectName === 'string' ? choice.projectName : null,
        })) : [],
      },
      context: unknown(reason),
      account: this.readAccount(),
      project: { ...unknown(reason), scope: this.scope, label: this.scope === 'thread' ? '本聊天已用' : '本项目已用' },
    };
    return { ...value, summaryText: formatUsageSummary(value) };
  }

  snapshot() {
    if (this.pending) return this.pending;
    this.pending = this.read().finally(() => { this.pending = null; });
    return this.pending;
  }

  async read() {
    let selection;
    try {
      selection = await this.selectionReader.snapshot();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (selection?.status !== 'available' || !validId(selection.threadId)) {
          return this.unavailable(selection, selection?.reason || 'active-page-unavailable');
        }
        const scope = selection.scope === 'thread' ? 'thread' : this.scope;
        const sample = await this.projectReader.snapshot({
          threadId: selection.threadId, scope,
          ...(scope === 'project' ? {
            ...(selection.projectThreadIds ? { projectThreadIds: selection.projectThreadIds } : {}),
            ...(selection.projectRoots ? { projectRoots: selection.projectRoots } : {}),
            ...(selection.projectRoot ? { projectRoot: selection.projectRoot } : {}),
            ...(selection.projectName ? { projectName: selection.projectName } : {}),
          } : {}),
        });
        // A long first read can overlap a page switch. Never publish the old
        // page's values under a new page label or revert to the bound chat.
        const current = await this.selectionReader.snapshot();
        if (identity(current) !== identity(selection)) { selection = current; continue; }
        // A different chat's historic limits must never replace the shared
        // account sample. Freshness and failures remain owned by its reducer.
        const value = { ...sample, account: this.readAccount(), selection: { ...selection }, threadId: selection.threadId };
        return { ...value, summaryText: formatUsageSummary(value) };
      }
      return this.unavailable(selection, 'active-page-changing');
    } catch {
      return this.unavailable(selection, 'usage-source-unavailable');
    }
  }
}

/** Explicit view selection is separate from the saved task binding. */
export class UsageTargetSelection {
  constructor({ navigationReader, boundThreadId, selectedThreadId = null, persistSelection = async () => {} }) {
    this.navigationReader = navigationReader;
    this.boundThreadId = boundThreadId;
    this.selectedThreadId = validId(selectedThreadId) ? selectedThreadId : null;
    this.persistSelection = persistSelection;
    this.changing = Promise.resolve();
  }

  choose(threadId) {
    // Validate, durably save, then publish in request order. A failed write or
    // slow earlier choice must not leave disk and the visible selection apart.
    const operation = () => this.chooseAndSave(threadId);
    const pending = this.changing.then(operation, operation);
    this.changing = pending.catch(() => {});
    return pending;
  }

  async chooseAndSave(threadId) {
    if (!validId(threadId)) throw Object.assign(new Error('invalid-usage-thread'), { reason: 'invalid-usage-thread' });
    const choices = await this.navigationReader.listThreads({ limit: 200 });
    if (!choices.some(choice => choice.threadId === threadId) && threadId !== (this.selectedThreadId || this.boundThreadId())) {
      throw Object.assign(new Error('usage-thread-unavailable'), { reason: 'usage-thread-unavailable' });
    }
    const selected = await this.navigationReader.resolveThread(threadId);
    if (selected?.status !== 'available' || selected.threadId !== threadId) {
      throw Object.assign(new Error('usage-thread-unavailable'), { reason: 'usage-thread-unavailable' });
    }
    await this.persistSelection(threadId);
    this.selectedThreadId = threadId;
    return { ok: true, threadId };
  }

  async snapshot() {
    const active = await this.navigationReader.snapshot();
    if (active?.status === 'available' && validId(active.threadId) && !this.selectedThreadId) return active;
    const threadId = this.selectedThreadId || this.boundThreadId();
    const selected = await this.navigationReader.resolveThread(threadId);
    const choices = await this.navigationReader.listThreads();
    // An older restored chat may fall outside the recent list. Keep its
    // verified option visible so both settings surfaces can select its name.
    if (selected?.status === 'available' && selected.threadId === threadId && !choices.some(choice => choice.threadId === threadId)) {
      choices.unshift({ threadId, threadName: selected.threadName ?? null, projectName: selected.projectName ?? null });
    }
    return {
      ...selected,
      source: this.selectedThreadId ? 'selected-chat' : 'bound-chat',
      choices: choices.slice(0, 200).map(choice => ({ threadId: choice.threadId, threadName: choice.threadName ?? null, projectName: choice.projectName })),
    };
  }
}
