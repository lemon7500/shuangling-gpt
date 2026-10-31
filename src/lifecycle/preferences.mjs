export const LANGUAGES = Object.freeze(['zh-CN', 'zh-TW', 'en']);
export const normalizeLanguage = value => LANGUAGES.includes(value) ? value : 'zh-CN';
export const AMBIENT_FREQUENCIES = Object.freeze(['quiet', 'normal', 'lively']);
export const normalizeAmbientFrequency = value => AMBIENT_FREQUENCIES.includes(value) ? value : 'normal';

/** Preferences are a fixed capability; language-only edits have no lifecycle effects. */
export function validPreferences(input) {
  return !!input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length > 0 && Object.keys(input).every(key => ['autoLaunch', 'language', 'ambientEnabled', 'ambientFrequency'].includes(key)) &&
    (!Object.hasOwn(input, 'autoLaunch') || typeof input.autoLaunch === 'boolean') &&
    (!Object.hasOwn(input, 'language') || LANGUAGES.includes(input.language)) &&
    (!Object.hasOwn(input, 'ambientEnabled') || typeof input.ambientEnabled === 'boolean') &&
    (!Object.hasOwn(input, 'ambientFrequency') || AMBIENT_FREQUENCIES.includes(input.ambientFrequency));
}
