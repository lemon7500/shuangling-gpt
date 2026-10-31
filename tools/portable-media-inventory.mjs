// Pure inventory check shared by release smoke validation and its unit tests.
// v1.8 packages export only verifyOutlineAssetContract; they remain valid with
// exactly the original nine clips. New packages publish their optional set.
const LEGACY_CORE = Object.freeze(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']);
const KNOWN_AMBIENT = Object.freeze(['reading', 'looking-around', 'stretching-wings']);
const KNOWN_MANUAL = Object.freeze(['running-classic', 'review-classic', 'waiting-classic']);
const KNOWN_DRAG = Object.freeze(['drag-lift', 'drag-hover', 'drag-lower']);
const requireValue = (condition, message) => { if (!condition) throw Error(message); };

export function validatePackagedAnimationInventory(assets, contract) {
  requireValue(typeof contract?.verifyOutlineAssetContract === 'function', 'Package outline contract is missing.');
  const legacy = contract.CORE_ANIMATIONS === undefined && contract.AMBIENT_ANIMATIONS === undefined;
  const core = legacy ? LEGACY_CORE : contract.CORE_ANIMATIONS;
  const ambient = legacy ? [] : contract.AMBIENT_ANIMATIONS;
  const manual = contract.MANUAL_VARIANTS === undefined ? [] : contract.MANUAL_VARIANTS;
  const drag = contract.DRAG_ANIMATIONS === undefined ? [] : contract.DRAG_ANIMATIONS;
  requireValue(Array.isArray(core) && core.length === LEGACY_CORE.length && new Set(core).size === core.length && LEGACY_CORE.every(name => core.includes(name)), 'Invalid packaged core animation contract.');
  requireValue(Array.isArray(ambient) && new Set(ambient).size === ambient.length && ambient.every(name => KNOWN_AMBIENT.includes(name)), 'Invalid packaged ambient animation contract.');
  requireValue(Array.isArray(manual) && new Set(manual).size === manual.length && manual.every(name => KNOWN_MANUAL.includes(name)), 'Invalid packaged manual animation contract.');
  requireValue(Array.isArray(drag) && (drag.length === 0 || drag.length === KNOWN_DRAG.length) && new Set(drag).size === drag.length && drag.every(name => KNOWN_DRAG.includes(name)), 'Invalid packaged drag animation contract.');
  const names = assets?.animations?.map(row => row?.name);
  const dragCount = Array.isArray(names) ? KNOWN_DRAG.filter(name => names.includes(name)).length : 0;
  requireValue(Array.isArray(names) && names.length >= core.length && names.length <= core.length + ambient.length + manual.length + drag.length &&
    new Set(names).size === names.length && core.every(name => names.includes(name)) &&
    names.every(name => [...core, ...ambient, ...manual, ...drag].includes(name)) &&
    (dragCount === 0 || dragCount === KNOWN_DRAG.length), 'Accepted animation inventory does not match the package contract.');
  return { names: [...names], legacyContract: legacy };
}
