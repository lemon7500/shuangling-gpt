/** Optional character feedback must never change the outcome of a saved edit. */
export async function acknowledgeDeskCommand(input, { controller, getLanguage }) {
  const reply = input.type === 'memory.reply' && typeof input.text === 'string' && input.text.trim();
  const bookmark = ['note.create', 'note.update', 'note.intent'].includes(input.type) && ['remember', 'continue'].includes(input.intent);
  if (!reply && !bookmark) return false;
  try {
    const language = await getLanguage();
    const messages = reply
      ? { 'zh-CN': '我把你补的这一句，也夹进这一页。', 'zh-TW': '我把你補的這一句，也夾進這一頁。', en: 'I have kept your words on this page, too.' }
      : { 'zh-CN': '好，我给这一页留个位置。', 'zh-TW': '好，我給這一頁留個位置。', en: 'All right. I will keep a place for this page.' };
    return await controller.companionNotice(messages[language] ?? messages['zh-CN']);
  } catch { return false; }
}
