// Only numeric usage telemetry is retained. Messages, parameters, outputs,
// credits and account identifiers never enter this reducer.
const WINDOW_MINUTES = { fiveHour: 300, weekly: 10080 };
const safeTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const absent = (reason = 'not-reported', observedAt = null) => ({ status: 'unknown', reason, observedAt });

export class UsageReducer {
  constructor(threadId, { contextMaxAgeMs = 15 * 60_000, accountMaxAgeMs = 5 * 60_000, now = Date.now } = {}) {
    this.threadId = threadId;
    this.contextMaxAgeMs = contextMaxAgeMs;
    this.accountMaxAgeMs = accountMaxAgeMs;
    this.now = now;
    this.reset();
  }

  reset(reason = 'not-reported') {
    this.verified = false;
    this.problem = null;
    this.latestAt = 0;
    this.context = absent(reason);
    this.windows = { fiveHour: absent(reason), weekly: absent(reason) };
    this.accountObservedAt = null;
    this.planType = null;
  }

  unavailable(reason = 'log-unavailable') { this.problem = reason; }

  accept(event) {
    const p = event?.payload;
    if (!p || typeof p !== 'object') return;
    if (event.type === 'session_meta') {
      this.verified = p.id === this.threadId && p.thread_source !== 'subagent';
      if (!this.verified) this.reset('wrong-thread');
      return;
    }
    const attributed = p.thread_id ?? p.threadId ?? p.turn_attribution?.thread_id ?? event.thread_id;
    if (!this.verified || attributed && attributed !== this.threadId || event.type !== 'event_msg' || p.type !== 'token_count') return;
    const observedAt = safeTime(event.timestamp);
    if (!observedAt || Date.parse(observedAt) > this.now() + 60_000 || Date.parse(observedAt) < this.latestAt) return;
    this.latestAt = Date.parse(observedAt);
    this.problem = null;
    if (p.info && typeof p.info === 'object') {
      // total_token_usage is cumulative across requests. It cannot represent
      // current context. cached_input_tokens is already included in input_tokens.
      const usedTokens = integer(p.info.last_token_usage?.total_tokens);
      const windowTokens = integer(p.info.model_context_window);
      this.context = usedTokens !== null && windowTokens > 0 && usedTokens <= windowTokens
        ? { status: 'available', observedAt, usedTokens, windowTokens, remainingTokens: windowTokens - usedTokens, usedPercent: usedTokens * 100 / windowTokens, remainingPercent: (windowTokens - usedTokens) * 100 / windowTokens, sample: 'last-model-request' }
        : absent('context-not-reported', observedAt);
    }
    const limits = p.rate_limits ?? p.rateLimits;
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return;
    const limitId = limits.limit_id ?? limits.limitId;
    // Other model buckets must not silently replace the account's Codex quota.
    if (limitId && limitId !== 'codex') return;
    this.accountObservedAt = observedAt;
    const plan = limits.plan_type ?? limits.planType;
    this.planType = ['free', 'go', 'plus', 'pro', 'max', 'team', 'business', 'enterprise', 'edu'].includes(plan) ? plan : null;
    const next = { fiveHour: absent('window-not-reported', observedAt), weekly: absent('window-not-reported', observedAt) };
    for (const raw of [limits.primary, limits.secondary]) {
      if (!raw || typeof raw !== 'object') continue;
      const minutes = integer(raw.window_minutes ?? raw.windowDurationMins);
      const key = Object.keys(WINDOW_MINUTES).find(k => WINDOW_MINUTES[k] === minutes);
      if (!key) continue;
      const usedPercent = number(raw.used_percent ?? raw.usedPercent);
      const resetsAt = integer(raw.resets_at ?? raw.resetsAt);
      if (usedPercent === null || usedPercent < 0 || usedPercent > 100 || !resetsAt || resetsAt > 253402300799) continue;
      next[key] = { status: 'available', observedAt, windowMinutes: minutes, usedPercent, remainingPercent: 100 - usedPercent, resetsAt };
    }
    // A complete, weekly-only report explicitly omits this window. Missing
    // fields or malformed windows are uncertainty, never proof of no limit.
    const completeWeeklyOnly = Object.hasOwn(limits, 'primary') && Object.hasOwn(limits, 'secondary')
      && next.weekly.status === 'available'
      && ((limits.primary === null && next.weekly.windowMinutes === integer(limits.secondary?.window_minutes ?? limits.secondary?.windowDurationMins))
        || (limits.secondary === null && next.weekly.windowMinutes === integer(limits.primary?.window_minutes ?? limits.primary?.windowDurationMins)));
    if (completeWeeklyOnly && this.planType !== 'plus') {
      next.fiveHour = { status: 'not-applicable', reason: 'window-not-applicable', observedAt };
    }
    this.windows = next;
  }

  fresh(sample, maxAgeMs, now, historicalContext = false) {
    if (this.problem) return absent(this.problem, sample.observedAt);
    if (sample.status !== 'available') return { ...sample };
    const ageMs = now - Date.parse(sample.observedAt);
    if (historicalContext && sample.sample === 'last-model-request' && ageMs > maxAgeMs) {
      // A past request's context remains a valid historical measurement. It
      // must be labelled as history rather than presented as a current balance.
      return { ...sample, status: 'historical', reason: 'sample-expired', ageSeconds: Math.max(0, Math.floor(ageMs / 1000)) };
    }
    if (ageMs > maxAgeMs || sample.resetsAt && now >= sample.resetsAt * 1000) {
      // A passed reset is not evidence that an allowance became 100% again.
      return { status: 'stale', reason: sample.resetsAt && now >= sample.resetsAt * 1000 ? 'reset-passed' : 'sample-expired', observedAt: sample.observedAt };
    }
    return { ...sample, ageSeconds: Math.max(0, Math.floor(ageMs / 1000)) };
  }

  snapshot(now = this.now()) {
    return {
      threadId: this.threadId,
      source: 'local-codex-rollout',
      context: this.fresh(this.context, this.contextMaxAgeMs, now, true),
      account: { observedAt: this.accountObservedAt, planType: this.planType, fiveHour: this.fresh(this.windows.fiveHour, this.accountMaxAgeMs, now), weekly: this.fresh(this.windows.weekly, this.accountMaxAgeMs, now) },
      freshness: { contextMaxAgeSeconds: this.contextMaxAgeMs / 1000, accountMaxAgeSeconds: this.accountMaxAgeMs / 1000 },
    };
  }
}

export function formatUsageSummary(usage) {
  const percent = n => `${Math.round(n * 10) / 10}%`;
  const unknown = sample => sample?.status === 'stale' ? '未知（采样已过期）' : '未知（暂未提供）';
  const c = usage.context;
  const historical = c?.status === 'historical' && c.sample === 'last-model-request';
  const context = c?.status === 'available' || historical ? `${historical ? '上次请求上下文剩余' : '最近上下文剩余'} ${c.remainingTokens.toLocaleString('zh-CN')} / ${c.windowTokens.toLocaleString('zh-CN')} tokens（${percent(c.remainingPercent)}）${historical ? ` · 历史采样 ${new Date(c.observedAt).toLocaleString('zh-CN')}` : ''}` : `上下文剩余：${unknown(c)}`;
  const quota = (label, sample) => sample?.status === 'not-applicable' ? null : `${label}剩余：${sample?.status === 'available' ? `${percent(sample.remainingPercent)} · ${new Date(sample.resetsAt * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 重置` : unknown(sample)}`;
  const project = usage.project;
  const cumulative = project ? `${project.scope === 'thread' ? '本聊天' : '本项目'}已用：${['available', 'partial'].includes(project.status) && Number.isSafeInteger(project.usedTokens) && project.usedTokens >= 0 ? `${project.status === 'partial' ? '≥ ' : ''}${project.usedTokens.toLocaleString('zh-CN')} tokens` : '未知'}` : null;
  return [context, cumulative, quota('5 小时额度', usage.account?.fiveHour), quota('每周额度', usage.account?.weekly)].filter(Boolean).join('\n');
}
