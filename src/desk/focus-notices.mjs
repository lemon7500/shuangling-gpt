const visible = value => ['desktop', 'both'].includes(value?.display);
const busyPhases = new Set(['pointer', 'dragging', 'throwing', 'blocked']);
const messages = {
  focus: {
    'zh-CN': '这段专注结束了。要歇一会儿吗？',
    'zh-TW': '這段專注結束了。要歇一會兒嗎？',
    en: 'This focus session has ended. Would you like a break?',
  },
  break: {
    'zh-CN': '这段休息结束了。下一步由你决定。',
    'zh-TW': '這段休息結束了。下一步由你決定。',
    en: 'This break has ended. You can decide what comes next.',
  },
};

/** A completion is offered once now, never retained for a later idle window. */
export async function deliverFocusNotice(notice, { desk, controller, getLanguage = async () => 'zh-CN' } = {}) {
  const generation = controller?.generation, lease = controller?.lockId;
  const eligible = () => !!controller && controller.status?.state === 'idle' && !controller.closed && !controller.paused &&
    !controller.preempted && !controller.surfaceReloading && !!lease && controller.lockId === lease &&
    controller.generation === generation && !busyPhases.has(controller.interaction?.phase);
  try {
    if (!eligible()) return false;
    // Capture visibility before independent preference I/O; an already hidden
    // completion must not become a delayed bubble when the user shows the pet.
    if (!visible(await controller.client.appearance()) || !eligible()) return false;
    const language = await getLanguage();
    if (!eligible()) return false;
    const translated = messages[notice.phase === 'break' ? 'break' : 'focus'];
    return await controller.companionNotice(translated[language] ?? translated['zh-CN'], 'stretching-wings',
      { idleOnly: true, requireVisible: true, cuePolicy: 'focus' });
  } catch { return false; }
  finally { await desk?.consumeNotice(notice.id); }
}
