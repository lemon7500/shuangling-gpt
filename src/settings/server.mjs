import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validPreferences } from '../lifecycle/preferences.mjs';

const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const authEquals = (a, b) => {
  if (typeof a !== 'string') return false;
  const supplied = Buffer.from(a); const expected = Buffer.from(b);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

async function jsonBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4096) throw Object.assign(new Error(), { reason: 'request-too-large' });
  }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error(), { reason: 'invalid-json' }); }
}

/** A loopback-only capability UI. It does not proxy arbitrary upstream routes. */
export async function startSettings({ getState, getUsage, getThreads, update, getAppearance, setAppearance,
  getAccountUsage = () => ({ fiveHour: { status: 'unknown', reason: 'account-source-unavailable' }, weekly: { status: 'unknown', reason: 'account-source-unavailable' } }),
  setUsageTarget = () => { throw Object.assign(new Error('usage-selection-unavailable'), { reason: 'usage-selection-unavailable' }); },
  getPreferences = () => ({ autoLaunch: false, language: 'zh-CN', lifecycle: { available: false, reason: 'unavailable' } }),
  setPreferences = () => { throw Object.assign(new Error('preferences-unavailable'), { reason: 'preferences-unavailable' }); },
  shutdown, port = 0 }) {
  const token = randomBytes(32).toString('base64url');
  const html = await readFile(htmlPath);
  let boundPort;
  const server = createServer(async (req, res) => {
    const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    const expectedHost = `127.0.0.1:${boundPort}`;
    if (req.headers.host !== expectedHost) return send(403, { error: 'invalid-host' });
    if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: 'invalid-origin' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'cross-site' });
    let path;
    try { path = new URL(req.url, `http://${expectedHost}`).pathname; }
    catch { return send(400, { error: 'invalid-path' }); }
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      return res.end(html);
    }
    if (!authEquals(req.headers['x-shuangling-token'], token)) return send(403, { error: 'unauthorized' });
    try {
      if (req.method === 'GET' && path === '/api/state') return send(200, await getState());
      if (req.method === 'GET' && path === '/api/usage') return send(200, await getUsage());
      if (req.method === 'GET' && path === '/api/account-usage') return send(200, await getAccountUsage());
      if (req.method === 'POST' && path === '/api/usage-target') {
        const input = await jsonBody(req);
        if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length !== 1 ||
          typeof input.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(input.threadId)) {
          return send(400, { error: 'invalid-usage-thread' });
        }
        return send(200, await setUsageTarget(input));
      }
      if (req.method === 'GET' && path === '/api/threads') return send(200, { threads: await getThreads() });
      if (req.method === 'GET' && path === '/api/appearance') return send(200, await getAppearance());
      if (req.method === 'GET' && path === '/api/preferences') return send(200, await getPreferences());
      if (req.method === 'POST' && path === '/api/settings') return send(200, await update(await jsonBody(req)));
      if (req.method === 'POST' && path === '/api/appearance') return send(200, await setAppearance(await jsonBody(req)));
      if (req.method === 'POST' && path === '/api/preferences') {
        const input = await jsonBody(req);
        if (!validPreferences(input)) {
          return send(400, { error: 'invalid-preferences' });
        }
        return send(200, await setPreferences(input));
      }
      if (req.method === 'POST' && path === '/api/shutdown') {
        send(200, { ok: true });
        setImmediate(() => void shutdown());
        return;
      }
      send(404, { error: 'not-found' });
    } catch (error) {
      const reason = /^[a-z][a-z0-9-]{0,60}$/.test(error?.reason ?? '') ? error.reason : 'operation-unavailable';
      send(error?.status === 409 ? 409 : 400, { error: reason });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  boundPort = server.address().port;
  return { port: boundPort, token, settingsUrl: `http://127.0.0.1:${boundPort}/#${token}`, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }) };
}
