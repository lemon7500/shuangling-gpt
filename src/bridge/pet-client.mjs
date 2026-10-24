import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export class PetApiError extends Error {
  constructor(reason, status = 0) { super(reason); this.name = 'PetApiError'; this.reason = reason; this.status = status; }
}
const safeReason = value => /^[a-z][a-z0-9-]{0,60}$/.test(value ?? '') ? value : 'api-rejected';

/** Uses only the upstream local runtime manifest; never discovers or launches a host. */
export class PetClient {
  constructor({ dshHome, petId = 'shuangling', fetchImpl = globalThis.fetch, readFileImpl = readFile }) {
    this.manifestPath = join(dshHome, 'dsh-pet', 'standalone-runtime.json');
    this.petId = petId;
    this.fetch = fetchImpl;
    this.readFile = readFileImpl;
  }

  async request(route, { method = 'GET', body, lockId, timeoutMs = 5000, surface = true } = {}) {
    let runtime;
    try { runtime = JSON.parse(await this.readFile(this.manifestPath, 'utf8')); }
    catch { throw new PetApiError('runtime-unavailable'); }
    if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 || !/^[A-Za-z0-9_-]{32,200}$/.test(runtime.token ?? '')) throw new PetApiError('runtime-invalid');
    const url = new URL(`http://127.0.0.1:${runtime.port}/dsh-pet-7340/${route}`);
    if (surface) { url.searchParams.set('pet', this.petId); url.searchParams.set('surface', 'desktop'); }
    if (lockId) url.searchParams.set('lock', lockId);
    let result;
    try {
      const response = await this.fetch(url, {
        method, headers: { 'x-dsh-pet-token': runtime.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      result = await response.json();
      if (!response.ok) throw new PetApiError(response.status === 401 || response.status === 403 ? 'runtime-auth-failed' : response.status === 409 ? 'config-conflict' : 'api-http-error', response.status);
    } catch (error) {
      if (error instanceof PetApiError) throw error;
      throw new PetApiError('runtime-unreachable');
    }
    if (result?.ok === false) throw new PetApiError(safeReason(result.reason));
    return result;
  }

  lock(lockId, ttl = 30000) { return this.request('lock', { method: 'POST', body: { ...(lockId ? { lockId } : {}), ttl } }); }
  release(lockId) { return this.request('lock/release', { method: 'POST', body: { lockId } }); }
  play(name, lockId) { return this.request('anim', { method: 'POST', body: { name, facing: 'left' }, lockId }); }
  playback(id) { return this.request(`playback/${encodeURIComponent(id)}?wait=ended,failed,cancelled&timeout=1000`, { timeoutMs: 4000, surface: false }); }
  broadcast(text, lockId, duration = 2400) { return this.request('broadcast', { method: 'POST', body: { text, duration, anim: false }, lockId }); }
  config() { return this.request('config', { surface: false }); }
  interaction() { return this.request('interaction'); }
  position(x, y, lockId) { return this.request('position', { method: 'POST', body: { x, y, mode: 'instant' }, lockId }); }

  async appearance() {
    const all = await this.config();
    const pet = all?.main?.pets?.find(p => p.id === this.petId);
    if (!pet) throw new PetApiError('pet-not-in-main-config');
    return { size: pet.size, position: pet.position, display: pet.display };
  }

  async updateAppearance({ size, corner, marginX, marginY }, { apply = operation => operation() } = {}) {
    if (!Number.isFinite(size) || size < 160 || size > 1200 || !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(corner) || !Number.isFinite(marginX) || marginX < 0 || marginX > 3000 || !Number.isFinite(marginY) || marginY < 0 || marginY > 3000) throw new PetApiError('invalid-appearance');
    const all = await this.config();
    if (!Array.isArray(all?.main?.pets) || !all.main.pets.some(p => p.id === this.petId)) throw new PetApiError('pet-not-in-main-config');
    const current = all.main.pets.find(p => p.id === this.petId);
    if (current.size === size && current.position?.corner === corner && current.position?.marginX === marginX && current.position?.marginY === marginY) {
      return { size: current.size, position: { ...current.position }, display: current.display };
    }
    // The upstream route preserves advanced config. Its existing display value is retained,
    // including "none", so settings never resurrect a pet hidden by its owner.
    const main = { ...all.main, pets: all.main.pets.map(p => p.id === this.petId ? { ...p, size, position: { corner, marginX, marginY } } : p) };
    return apply(async () => {
      await this.request('config', { method: 'PUT', body: main, surface: false });
      return this.appearance();
    });
  }

  /** Panel-only geometry update: persist the same fields without replacing Electron. */
  async updateAppearanceLive({ size, corner, marginX, marginY }) {
    if (!Number.isFinite(size) || size < 160 || size > 1200 ||
      !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(corner) ||
      !Number.isFinite(marginX) || marginX < 0 || marginX > 3000 ||
      !Number.isFinite(marginY) || marginY < 0 || marginY > 3000) throw new PetApiError('invalid-appearance');
    const result = await this.request('shuangling-appearance', {
      method: 'PUT', surface: false, body: { petId: this.petId, size, corner, marginX, marginY },
    });
    if (result?.size !== size || result?.position?.corner !== corner ||
      result?.position?.marginX !== marginX || result?.position?.marginY !== marginY) {
      throw new PetApiError('appearance-not-applied');
    }
    return result;
  }
}
