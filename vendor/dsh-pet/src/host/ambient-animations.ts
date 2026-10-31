/** Only the Shuangling launcher can supply these installed, accepted assets.
 * This projection never rewrites the user's animation, physics or pet settings.
 */
export const SHUANGLING_AMBIENT_ACTIONS = ['reading', 'looking-around', 'stretching-wings'] as const;

export function withAmbientAnimations(main: Record<string, unknown>, available: readonly string[]): Record<string, unknown> {
  const extra = SHUANGLING_AMBIENT_ACTIONS.filter(name => available.includes(name));
  if (!extra.length) return main;
  const animations = main.animations as Record<string, unknown>;
  if (!animations || !Array.isArray(animations.categories)) return main;
  return { ...main, animations: { ...animations, categories: [
    ...animations.categories.filter(category => category?.id !== 'shuangling-companion'),
    { id: 'shuangling-companion', weight: 0, noMirror: true, actions: extra },
  ] } };
}
