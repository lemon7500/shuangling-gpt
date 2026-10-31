const visible = value => ['desktop', 'both'].includes(value?.display);
const activeGesture = value => ['pointer', 'dragging', 'throwing', 'blocked'].includes(value?.phase);
const messages = {
  daily: {
    'zh-CN': '新的一页，我写好了。想看时，到霜铃手记里一起翻翻。',
    'zh-TW': '新的一頁，我寫好了。想看時，到霜鈴手記裡一起翻翻。',
    en: 'A new page is ready. We can read it together in my journal whenever you like.',
  },
  continue: {
    'zh-CN': '上次夹住的那一页，今天想接着写吗？书签还在手记里。',
    'zh-TW': '上次夾住的那一頁，今天想接著寫嗎？書籤還在手記裡。',
    en: 'Would you like to return to the page we bookmarked? It is waiting in the journal.',
  },
};

/** A quiet, local hint. Never opens a window, acquires a lease or changes sync. */
export function createMemoryReminders({ desk, controller, getLanguage = async () => 'zh-CN', intervalMs = 1000, autoTick = true } = {}) {
  let closed = false, pending = null, timer;
  const eligible = () => !closed && controller.status?.state === 'idle' && !controller.closed && !controller.paused && !controller.preempted &&
    !controller.surfaceReloading && !!controller.lockId && !activeGesture(controller.interaction);
  function tick() {
    if (closed) return Promise.resolve(false);
    if (pending) return pending;
    pending = (async () => {
      if (!eligible()) return false;
      const snapshot = await desk.snapshot();
      const prompt = snapshot.memories?.prompt;
      if (!snapshot.memories?.enabled || !snapshot.memories?.reminders || !messages[prompt?.kind]) return false;
      // Read-only visibility evidence must precede the durable once/day claim.
      if (!visible(await controller.client.appearance()) || !eligible()) return false;
      await controller.observeRestInteraction();
      if (!eligible()) return false;
      const language = await getLanguage();
      if (!eligible() || !await desk.claimMemoryPrompt(prompt.id)) return false;
      if (!eligible()) return false;
      // A claimed hint is not replayed after failure, hiding or a new gesture.
      // The persistent journal card still offers Read / Later when opened.
      return await controller.companionNotice(messages[prompt.kind][language] ?? messages[prompt.kind]['zh-CN'], null, { idleOnly: true });
    })().catch(() => false).finally(() => { pending = null; });
    return pending;
  }
  if (autoTick) {
    timer = setInterval(() => { void tick(); }, Math.max(250, intervalMs));
    timer.unref?.();
  }
  return { tick, async close() { closed = true; if (timer) clearInterval(timer); await pending; } };
}
