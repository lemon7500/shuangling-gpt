export const LANGUAGES = Object.freeze(['zh-CN', 'zh-TW', 'en']);
export const normalizeLanguage = value => LANGUAGES.includes(value) ? value : 'zh-CN';

/** Preferences are a fixed capability; language-only edits have no lifecycle effects. */
export function validPreferences(input) {
  return !!input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length > 0 && Object.keys(input).every(key => key === 'autoLaunch' || key === 'language') &&
    (!Object.hasOwn(input, 'autoLaunch') || typeof input.autoLaunch === 'boolean') &&
    (!Object.hasOwn(input, 'language') || LANGUAGES.includes(input.language));
}
