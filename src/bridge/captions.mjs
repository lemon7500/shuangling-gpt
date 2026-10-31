import { normalizeLanguage } from '../lifecycle/preferences.mjs';

// These are acknowledgements of a confirmed turn ending, never claims about
// project completion, review results or the contents of the user's work.
export const completionCaptions = Object.freeze({
  'zh-CN': Object.freeze([
    '这一步完成了。',
    '慢慢看看这一轮的结果。',
    '接下来，由你决定。',
    '这一轮先到这里。',
    '先歇一小会儿也好。',
    '这一段结束了，不急着往下赶。',
  ]),
  'zh-TW': Object.freeze([
    '這一步完成了。',
    '慢慢看看這一輪的結果。',
    '接下來，由你決定。',
    '這一輪先到這裡。',
    '先歇一小會兒也好。',
    '這一段結束了，不急著往下趕。',
  ]),
  en: Object.freeze([
    'This step is complete.',
    'Take a look when ready.',
    'You choose what is next.',
    'This turn ends here.',
    'Take a moment to rest.',
    'No need to rush onward.',
  ]),
});

const stateCaptions = Object.freeze({
  waiting: Object.freeze({ 'zh-CN': '等你回来，我在这里。', 'zh-TW': '等你回來，我在這裡。', en: 'I am here whenever you are ready.' }),
  interrupted: Object.freeze({ 'zh-CN': '已停下，陪你等一会儿。', 'zh-TW': '已停下，陪你等一會兒。', en: 'Stopped for now. I will stay with you.' }),
  unknown: Object.freeze({ 'zh-CN': '状态未知 · 仍在陪伴', 'zh-TW': '狀態未知 · 仍在陪伴', en: 'Status unknown · Still here with you' }),
});

export function statusCaption(state, language = 'zh-CN', completionIndex = 0) {
  const locale = normalizeLanguage(language);
  if (state !== 'complete') return stateCaptions[state]?.[locale] ?? null;
  const index = Number.isSafeInteger(completionIndex) && completionIndex >= 0 ? completionIndex : 0;
  const messages = completionCaptions[locale];
  return messages[index % messages.length];
}
