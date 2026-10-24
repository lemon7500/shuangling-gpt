import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

type ObjectValue = Record<string, unknown>;
type GeometryInput = { petId: string; size: number; corner: string; marginX: number; marginY: number };

/** Validation uses the effective config; persistence keeps the original raw layer. */
export function patchShuanglingGeometry(existing: ObjectValue | undefined, effectivePets: ObjectValue[], input: GeometryInput) {
  const effective = effectivePets.find(pet => pet.id === input.petId);
  if (!effective) throw Object.assign(new Error('pet-not-in-main-config'), { reason: 'pet-not-in-main-config' });
  const oldPosition = effective.position as ObjectValue | undefined;
  const position = { corner: input.corner, marginX: input.marginX, marginY: input.marginY };
  const appearance = { size: input.size, position, display: effective.display };
  const changed = effective.size !== input.size || oldPosition?.corner !== input.corner || oldPosition?.marginX !== input.marginX || oldPosition?.marginY !== input.marginY;
  if (!changed) return { changed: false, config: existing, appearance };
  const rawPets = existing?.pets;
  // A missing/empty raw list inherits the effective default list. Materialize
  // that list only when necessary; do not materialize any top-level defaults.
  let pets: ObjectValue[];
  if (rawPets === undefined || Array.isArray(rawPets) && rawPets.length === 0) pets = effectivePets;
  else if (Array.isArray(rawPets)) pets = rawPets as ObjectValue[];
  else throw Object.assign(new Error('config-conflict'), { reason: 'config-conflict' });
  const index = pets.findIndex(pet => pet && typeof pet === 'object' && String(pet.id ?? '').trim() === input.petId);
  if (index < 0) throw Object.assign(new Error('config-conflict'), { reason: 'config-conflict' });
  const target = pets[index];
  const rawPosition = target.position && typeof target.position === 'object' && !Array.isArray(target.position) ? target.position as ObjectValue : {};
  const config = { ...existing, pets: pets.map((pet, i) => i === index ? { ...pet, size: input.size, position: { ...rawPosition, ...position } } : pet) };
  return { changed: true, config, appearance };
}

/** One profile-local lane covers each whole read/modify/write route. */
export function createShuanglingConfigQueue(enabled: boolean) {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(rawUrl: string, method: string, operation: () => Promise<T>): Promise<T> => {
    if (!enabled) return operation();
    const pathname = new URL(rawUrl, 'http://localhost').pathname;
    const rest = decodeURIComponent(pathname.slice('/dsh-pet-7340/'.length));
    const mutates = rest === 'shuangling-appearance' && method === 'PUT' || rest === 'config' && ['PUT', 'POST'].includes(method) || rest === 'pet-display' && method === 'POST';
    if (!mutates) return operation();
    const next = pending.then(operation, operation);
    pending = next.catch(() => {});
    return next;
  };
}

/** Replace only a complete file. Failed writes/renames retain the old config. */
export async function writeShuanglingConfigAtomic(file: string, content: string) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.shuangling-${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    try { await unlink(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }
}
