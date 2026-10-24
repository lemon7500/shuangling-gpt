import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CompanionPlugin } from './companion.mjs';

const root = process.env.SHUANGLING_PROJECT_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const companion = new CompanionPlugin({ projectRoot: root, dataDir: process.env.SHUANGLING_DATA_DIR });
const tools = [
  { name: 'companion_status', description: '查看霜铃 GPT 的运行、整个本机 Codex 会话的任务联动、大小和位置。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'companion_usage', description: '查看用量区所选聊天的上下文和累计 token，以及独立的账户共用额度采样；未知值不估造。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'companion_open_settings', description: '打开霜铃 GPT 本机设置页。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'companion_control', description: '按用户要求启动、完整退出、暂停或恢复霜铃 GPT；退出后本次Codex启动期间不会自动重开。', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'stop', 'pause', 'resume'] } }, required: ['action'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'companion_auto_launch', description: '设置随 Codex 主窗口自动启动和退出霜铃 GPT。使用当前用户登录观察器，登录本身不显示桌宠。', inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
];
const reply = (id, result, error) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })+'\n');
const content = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
let startup = Promise.resolve();
let startupRequested = false;
function requestStartup() {
  if (startupRequested || process.env.SHUANGLING_PLUGIN_NO_AUTO === '1') return;
  startupRequested = true;
  startup = companion.automaticStart().catch(() => ({ error: 'automatic-start-unavailable' }));
}
async function handle(message) {
  if (message.method === 'initialize') {
    requestStartup();
    reply(message.id, { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'shuangling-gpt', version: '1.8.4' } });
    return;
  }
  if (message.method === 'notifications/initialized') {
    requestStartup();
    return;
  }
  if (message.id === undefined) return;
  if (message.method === 'ping') return reply(message.id, {});
  if (message.method === 'tools/list') { await startup; return reply(message.id, { tools }); }
  if (message.method === 'resources/list') return reply(message.id, { resources: [] });
  if (message.method === 'prompts/list') return reply(message.id, { prompts: [] });
  if (message.method !== 'tools/call') return reply(message.id, undefined, { code: -32601, message: 'Method not found' });
  try {
    await startup;
    const args = message.params?.arguments || {};
    let value;
    switch (message.params?.name) {
      case 'companion_status': value = await companion.status(); break;
      case 'companion_usage': value = await companion.usage(); break;
      case 'companion_open_settings': value = await companion.openSettings(); break;
      case 'companion_auto_launch': value = await companion.setAutoLaunch(args.enabled); break;
      case 'companion_control':
        if (args.action === 'start') value = await companion.start();
        else if (args.action === 'stop') value = await companion.stop();
        else if (args.action === 'pause') value = await companion.pause(true);
        else if (args.action === 'resume') value = await companion.pause(false);
        else throw new Error('invalid-action');
        break;
      default: return reply(message.id, undefined, { code: -32602, message: 'Unknown tool' });
    }
    reply(message.id, content(value));
  } catch (error) {
    const reason = /^[a-z][a-z0-9-]{0,60}$/.test(error.message) ? error.message : 'companion-operation-unavailable';
    reply(message.id, { ...content({ error: reason }), isError: true });
  }
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (Buffer.byteLength(line) > 1024*1024) return;
  let message;
  try { message = JSON.parse(line); } catch { return reply(null, undefined, { code: -32700, message: 'Parse error' }); }
  void handle(message).catch(() => { if (message.id !== undefined) reply(message.id, undefined, { code: -32603, message: 'Internal error' }); });
});
