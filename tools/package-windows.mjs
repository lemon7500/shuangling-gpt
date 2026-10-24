// Build the portable Windows distribution from already-built project files.
// No application, plugin, task, user settings or generation service is started.
//
// node tools/package-windows.mjs --runtime-source <directory> --stage-only
// node tools/package-windows.mjs --finalize
// Runtimes can also be supplied with SHUANGLING_RUNTIME_SOURCE. That directory
// must contain node/node.exe, node/LICENSE and a complete electron/ directory.
import { createReadStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const releaseRoot = join(root, 'release');
const slash = value => value.split(sep).join('/');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const packageInfo = await json(join(root, 'package.json'));
const args = process.argv.slice(2);
const allowedFlags = new Set(['--runtime-source', '--stage-only', '--finalize', '--plan']);
for (let i = 0; i < args.length; i++) {
  if (!allowedFlags.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  if (args[i] === '--runtime-source' && (!args[++i] || args[i].startsWith('--'))) throw new Error('Missing --runtime-source directory');
}
if (args.includes('--finalize') && (args.includes('--stage-only') || args.includes('--plan'))) throw new Error('Choose one packaging mode');
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const runtimeSource = resolve(option('--runtime-source') || process.env.SHUANGLING_RUNTIME_SOURCE || join(root, 'windows', 'runtime'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(packageInfo.version)) throw new Error('Invalid release version');
const releaseName = `shuangling-gpt-${packageInfo.version}-windows-x64`;
const stage = join(releaseRoot, releaseName);
const archive = `${stage}.zip`;
const manifestName = 'PACKAGE-MANIFEST.json';
const sourceVendor = join(root, 'vendor', 'dsh-pet');
const licenseDirectory = join(root, 'tools', 'licenses');
const sourceBindings = [];
const documentation = ['README.md', 'ASSETS.md', 'NOTICE.md', 'UPSTREAM.md', 'LICENSE', 'BRIDGE.md'];
const fixedFiles = [
  'package.json',
  '安装Codex插件.vbs', '启动霜铃.vbs', '霜铃设置.vbs', '退出霜铃.vbs',
  'windows/start.mjs', 'windows/install-plugin.mjs', 'windows/outline-contract.mjs',
  'windows/runtime-config.json', 'windows/default-config.json',
  'windows/animation-timing.json', 'windows/hd-geometry.json',
  'windows/启动霜铃.vbs', 'windows/霜铃设置.vbs', 'windows/退出霜铃.vbs',
  'windows/lifecycle/Watcher.cs', 'windows/lifecycle/task.mjs', 'windows/lifecycle/ShuanglingCodexWatcher.exe',
  'reports/windows-assets.json', 'reports/windows-action-frames-v179.json',
  'vendor/dsh-pet/LICENSE', 'vendor/dsh-pet/lib/standalone.js',
  'vendor/dsh-pet/assets/config.jsonc', 'vendor/dsh-pet/assets/logo.png',
  'plugin-marketplace/README.md', 'plugin-marketplace/.agents/plugins/marketplace.json',
  'plugin-marketplace/plugins/shuangling-gpt/.mcp.template.json',
  'plugin-marketplace/plugins/shuangling-gpt/.codex-plugin/plugin.json',
];
const fixedTrees = ['src/bridge', 'src/settings', 'src/plugin', 'src/lifecycle', 'vendor/dsh-pet/runtime/electron-helper'];
const animationNames = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];
for (const name of animationNames) fixedFiles.push(`windows/assets/shuangling/${name}.webm`);

function under(base, target) {
  const rel = relative(resolve(base), resolve(target));
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}
if (!under(releaseRoot, stage) || !under(releaseRoot, archive)) throw new Error('Unsafe release output');
async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in release: ${rel}`);
    if (entry.isDirectory()) files.push(...await filesIn(full, rel));
    else if (entry.isFile()) files.push(rel);
    else throw new Error(`Unsupported release entry: ${rel}`);
  }
  return files;
}
async function copyOne(source, destination, bind = false) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const info = await stat(source);
  await utimes(destination, info.atime, info.mtime);
  if (bind) sourceBindings.push({ path: slash(relative(root, source)), sha256: await hash(source) });
}
async function copyTree(source, destination, { bind = false, exclude = () => false } = {}, prefix = '') {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (exclude(rel, entry)) continue;
    const from = join(source, entry.name), to = join(destination, entry.name);
    const info = await stat(from); // Dereference source junctions; output never contains links.
    if (info.isDirectory()) await copyTree(from, to, { bind, exclude }, rel);
    else if (info.isFile()) await copyOne(from, to, bind);
    else throw new Error(`Unsupported source entry: ${rel}`);
  }
}
async function copyDocumentation() {
  for (const file of documentation) await copyOne(join(root, file), join(stage, file));
  await copyTree(join(root, 'docs'), join(stage, 'docs'), { exclude: rel => /(?:^|\/)(?:\.cache|\.git|node_modules)(?:\/|$)/.test(rel) });
}

async function dependencyAt(owner, name) {
  if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`Unsafe dependency name: ${name}`);
  let directory = owner;
  while (under(sourceVendor, directory) || directory === sourceVendor) {
    const candidate = join(directory, 'node_modules', name);
    if (await exists(join(candidate, 'package.json'))) return candidate;
    directory = dirname(directory);
  }
  return null;
}
async function productionDependencies() {
  const found = new Map();
  const visit = async (directory, metadata) => {
    const required = metadata.dependencies || {};
    const optional = metadata.optionalDependencies || {};
    for (const name of [...new Set([...Object.keys(required), ...Object.keys(optional)])].sort()) {
      const dependency = await dependencyAt(directory, name);
      if (!dependency) {
        if (Object.hasOwn(optional, name)) continue;
        throw new Error(`Missing production dependency: ${metadata.name} -> ${name}`);
      }
      const rel = slash(relative(sourceVendor, dependency));
      if (!rel.startsWith('node_modules/')) throw new Error(`Dependency outside vendor tree: ${name}`);
      if (found.has(rel)) continue;
      const child = await json(join(dependency, 'package.json'));
      const supported = (list, value) => !Array.isArray(list) || (!list.includes(`!${value}`) && (list.every(item => item.startsWith('!')) || list.includes(value)));
      if (!supported(child.os, 'win32') || !supported(child.cpu, 'x64')) {
        if (Object.hasOwn(optional, name)) continue;
        throw new Error(`Production dependency does not support Windows x64: ${name}`);
      }
      found.set(rel, { source: dependency, path: `vendor/dsh-pet/${rel}`, name: child.name || name, version: child.version,
        license: typeof child.license === 'string' ? child.license : child.license?.type || child.licenses?.map(value => value.type).join(' OR ') || 'SEE PACKAGE FILES' });
      await visit(dependency, child);
    }
  };
  const metadata = await json(join(sourceVendor, 'package.json'));
  await visit(sourceVendor, metadata);
  return { metadata, rows: [...found.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')) };
}

async function licenseSupplements() {
  const metadata = await json(join(licenseDirectory, 'sources.json'));
  if (metadata.schema !== 'shuangling-license-supplements-v1') throw new Error('Invalid license supplement metadata');
  for (const row of metadata.sources) {
    if (!/^[a-zA-Z0-9._-]+$/.test(row.file) || await hash(join(licenseDirectory, row.file)) !== row.sha256) throw new Error(`License supplement identity mismatch: ${row.package}`);
  }
  return metadata.sources;
}

function vbsEntry(action, title, success) {
  const script = action === 'install' ? '\\windows\\install-plugin.mjs' : '\\windows\\start.mjs';
  const argument = action === 'install' ? '' : ` ${action}`;
  return `Option Explicit\r\nDim shell, fso, root, command, result\r\nSet shell = CreateObject("WScript.Shell")\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\nroot = fso.GetParentFolderName(WScript.ScriptFullName)\r\ncommand = Chr(34) & root & "\\windows\\runtime\\node\\node.exe" & Chr(34) & " " & Chr(34) & root & "${script}" & Chr(34) & "${argument}"\r\nresult = shell.Run(command, 0, ${action === 'install' ? 'True' : 'False'})\r\n${action === 'install' ? `If result = 0 Then\r\n  MsgBox "${success}", 64, "${title}"\r\nElse\r\n  MsgBox "Installation did not finish. See reports\\codex-plugin-install.json. Keep this folder in its final location before installing.", 48, "${title}"\r\nEnd If\r\n` : ''}`;
}
async function writeEntrypoints() {
  const aliases = {
    'Install plugin.vbs': vbsEntry('install', 'Shuangling GPT', 'Plugin installed and enabled. Restart Codex to load it. Keep this folder in its current location.'),
    'Start Pet.vbs': vbsEntry('start', 'Shuangling GPT'),
    'Settings.vbs': vbsEntry('settings', 'Shuangling GPT'),
    'Exit Pet.vbs': vbsEntry('stop', 'Shuangling GPT'),
  };
  for (const [name, content] of Object.entries(aliases)) await writeFile(join(stage, name), content, 'ascii');
  const text = `霜铃 GPT ${packageInfo.version} · Windows x64 免安装版\r\n\r\n简体中文\r\n1. 完整解压 ZIP 到准备长期保留的文件夹，不要在压缩包预览中运行。\r\n2. 确保已经安装并登录 Codex 桌面版，双击“安装Codex插件.vbs”。\r\n3. 重新打开 Codex。需要立即手动启动时，双击“启动霜铃.vbs”。\r\n4. 右键霜铃打开面板；双击“霜铃设置.vbs”打开高级设置。\r\n无需安装 Node.js、Electron 或自行编译。请勿移动已安装插件所在文件夹；移动后重新运行安装入口。\r\n\r\n繁體中文\r\n1. 將 ZIP 完整解壓縮到會長期保留的資料夾，勿在壓縮檔預覽中執行。\r\n2. 確認已安裝並登入 Codex 桌面版，按兩下「安装Codex插件.vbs」。\r\n3. 重新開啟 Codex。需要立即手動啟動時，按兩下「启动霜铃.vbs」。\r\n4. 在霜鈴上按右鍵開啟面板；「霜铃设置.vbs」可開啟進階設定。\r\n不需另裝 Node.js、Electron 或自行編譯。移動資料夾後請重新執行安裝入口。\r\n\r\nEnglish\r\n1. Extract the entire ZIP to a permanent folder. Do not run it inside the ZIP preview.\r\n2. Install and sign in to the Codex desktop app, then double-click “Install plugin.vbs”.\r\n3. Restart Codex. For an immediate manual launch, double-click “Start Pet.vbs”.\r\n4. Right-click Shuangling for the control panel; “Settings.vbs” opens advanced settings.\r\nNode.js and Electron are included. No compilation is required. Reinstall the plugin after moving this folder.\r\n\r\nRead README.md, docs/PORTABLE.md, and docs/i18n/README.en.md / README.zh-TW.md for details.\r\nCode: MIT; character artwork has separate terms in ASSETS.md and NOTICE.md.\r\nDesktop host: PC2005-cloud/dsh-pet, pinned d7a308e.\r\nOriginal reference artwork: Bilibili @ZipZipPipe (https://space.bilibili.com/4168597).\r\n`;
  await writeFile(join(stage, 'START-HERE.txt'), '\uFEFF' + text, 'utf8');
}

async function verifyMediaAt(directory) {
  if ((await json(join(directory, 'windows', 'runtime-config.json'))).defaultThreadId !== null) throw new Error('Portable config must not bind a private chat');
  const assets = await json(join(directory, 'reports', 'windows-assets.json'));
  const motion = join(directory, assets.motionManifest);
  if (!under(directory, motion) || await hash(motion) !== assets.motionManifestSha256) throw new Error('Media manifest binding mismatch');
  if (assets.animations.length !== animationNames.length) throw new Error('Expected exactly nine animation assets');
  for (const name of animationNames) {
    const rows = assets.animations.filter(row => row.name === name);
    if (rows.length !== 1 || await hash(join(directory, 'windows', 'assets', 'shuangling', `${name}.webm`)) !== rows[0].webmSha256) throw new Error(`Media identity mismatch: ${name}`);
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const profile = require(join(directory, 'vendor', 'dsh-pet', 'runtime', 'electron-helper', 'shuangling-motion.js'));
  const { verifyOutlineAssetContract } = await import(new URL('../windows/outline-contract.mjs', import.meta.url));
  verifyOutlineAssetContract({ profile, manifestPath: motion, assetDirectory: join(directory, 'windows', 'assets', 'shuangling'), animations: assets.animations });
}
async function checkPackage() {
  const list = await filesIn(stage);
  for (const path of list) {
    if (/^(?:windows\/data|\.git|\.cache)(?:\/|$)/i.test(path) || /(?:^|\/)(?:auth\.json|credentials\.json|\.mcp\.json|\.env(?:\..*)?)$/i.test(path)) throw new Error(`Private or generated data in release: ${path}`);
    const info = await lstat(join(stage, path));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release contains a link: ${path}`);
  }
  await verifyMediaAt(stage);
  for (const path of ['windows/runtime/node/node.exe', 'windows/runtime/node/LICENSE', 'windows/runtime/electron/electron.exe', 'windows/runtime/electron/LICENSE', 'windows/runtime/electron/LICENSES.chromium.html', 'windows/lifecycle/ShuanglingCodexWatcher.exe']) {
    if ((await stat(join(stage, path))).size === 0) throw new Error(`Empty runtime artifact: ${path}`);
  }
  return list;
}
async function writeManifest(metadata) {
  const all = await checkPackage();
  const files = [];
  for (const path of all.filter(path => path !== manifestName)) files.push({ path, bytes: (await stat(join(stage, path))).size, sha256: await hash(join(stage, path)) });
  const manifest = { ...metadata, generatedAt: new Date().toISOString(), fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0), files };
  await writeFile(join(stage, manifestName), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
async function stagePackage() {
  if (await exists(stage) || await exists(archive)) throw new Error(`Release output already exists; nothing overwritten: ${releaseName}`);
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this distribution on Windows x64');
  for (const path of fixedFiles) await access(join(root, path));
  for (const path of ['node/node.exe', 'node/LICENSE', 'electron/electron.exe', 'electron/LICENSE', 'electron/LICENSES.chromium.html', 'electron/version']) await access(join(runtimeSource, path));
  await verifyMediaAt(root);
  const deps = await productionDependencies();
  const supplements = await licenseSupplements();
  for (const row of supplements) if (!deps.rows.some(dependency => dependency.name === row.package && dependency.version === row.version)) throw new Error(`License supplement version mismatch: ${row.package}`);
  const runtime = { node: (await run(join(runtimeSource, 'node', 'node.exe'), ['--version'], { windowsHide: true })).stdout.trim(),
    electron: (await readFile(join(runtimeSource, 'electron', 'version'), 'utf8')).trim() };
  let sourceCommit = null;
  try { sourceCommit = (await run('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim(); } catch { /* source snapshots may lack git */ }
  await mkdir(stage, { recursive: true });
  for (const path of fixedFiles) await copyOne(join(root, path), join(stage, path), true);
  for (const path of fixedTrees) await copyTree(join(root, path), join(stage, path), { bind: true });
  await copyDocumentation();
  const runtimeVendor = { name: deps.metadata.name, version: deps.metadata.version, type: deps.metadata.type, license: deps.metadata.license,
    repository: deps.metadata.repository, dependencies: deps.metadata.dependencies, optionalDependencies: deps.metadata.optionalDependencies };
  await writeFile(join(stage, 'vendor', 'dsh-pet', 'package.json'), JSON.stringify(runtimeVendor, null, 2) + '\n');
  for (const row of deps.rows) await copyTree(row.source, join(stage, row.path), {
    exclude: rel => /(?:^|\/)(?:node_modules|\.git|\.github|\.cache)(?:\/|$)/.test(rel),
  });
  await copyTree(licenseDirectory, join(stage, 'third-party-licenses'), { bind: true });
  const webhookDependency = deps.rows.find(row => row.name === 'standardwebhooks');
  await copyOne(join(licenseDirectory, 'standardwebhooks-MIT-LICENSE.txt'), join(stage, webhookDependency.path, 'LICENSE'));
  await copyOne(join(runtimeSource, 'node', 'node.exe'), join(stage, 'windows', 'runtime', 'node', 'node.exe'));
  await copyOne(join(runtimeSource, 'node', 'LICENSE'), join(stage, 'windows', 'runtime', 'node', 'LICENSE'));
  await copyTree(join(runtimeSource, 'electron'), join(stage, 'windows', 'runtime', 'electron'));
  await writeEntrypoints();
  const dependencyRows = [];
  for (const { source, ...row } of deps.rows) {
    const files = await filesIn(join(stage, row.path));
    const supplement = supplements.find(value => value.package === row.name);
    const licenseFiles = files.filter(path => /(?:^|\/)(?:licen[cs]e|copying|notice)(?:[^/]*)$/i.test(path)).map(path => `${row.path}/${path}`);
    if (supplement) licenseFiles.push(`third-party-licenses/${supplement.file}`);
    dependencyRows.push({ ...row, licenseFiles, ...(supplement ? { licenseSupplement: supplement } : {}) });
  }
  const table = dependencyRows.map(row => `| ${row.name} | ${row.version} | ${row.license.replaceAll('|', '\\|')} | ${row.licenseFiles.map(path => `[${path.split('/').at(-1)}](${path})`).join(', ') || 'See package metadata'} |`).join('\n');
  await writeFile(join(stage, 'THIRD-PARTY-LICENSES.md'), `# Bundled third-party notices\n\nThis is a runtime distribution, with production dependencies only. Original license and notice files remain inside each package. [License supplements and their provenance](third-party-licenses/README.md) document two published packages which omit separate license files. The BSD-2-Clause supplement is clearly labeled as the unchanged SPDX template; it does not invent an upstream copyright notice.\n\n- Node.js ${runtime.node}: [LICENSE](windows/runtime/node/LICENSE).\n- Electron ${runtime.electron}: [LICENSE](windows/runtime/electron/LICENSE), [Chromium and other notices](windows/runtime/electron/LICENSES.chromium.html).\n- dsh-pet ${deps.metadata.version}, pinned d7a308ecd4504cf4468c03707ce228ed1e1c0402: [MIT](vendor/dsh-pet/LICENSE).\n- Shuangling code: [MIT](LICENSE). Artwork: [separate terms and credits](ASSETS.md).\n\n| Package | Version | Declared license | Bundled license / notice |\n| --- | --- | --- | --- |\n${table}\n`);
  return writeManifest({ schema: 'shuangling-portable-windows-v1', version: packageInfo.version, platform: 'win32', arch: 'x64',
    sourceCommit, runtime, upstream: { repository: 'https://github.com/PC2005-cloud/dsh-pet', commit: 'd7a308ecd4504cf4468c03707ce228ed1e1c0402' },
    manifestExcludesItself: true, containsUserData: false, sourceBindings, dependencies: dependencyRows, licenseSupplements: supplements });
}
async function finalizePackage(manifest) {
  if (await exists(archive)) throw new Error(`Archive already exists; nothing overwritten: ${releaseName}.zip`);
  if (manifest.version !== packageInfo.version || manifest.schema !== 'shuangling-portable-windows-v1') throw new Error('Staged version mismatch');
  for (const binding of manifest.sourceBindings) {
    if (await hash(join(root, binding.path)) !== binding.sha256) throw new Error(`Source changed after staging; use a new verified release staging directory: ${binding.path}`);
  }
  // Documentation may be completed while runtime validation is in progress.
  await copyDocumentation();
  const { files, fileCount, totalBytes, generatedAt, ...metadata } = manifest;
  try { metadata.sourceCommit = (await run('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim(); } catch { /* source archive */ }
  manifest = await writeManifest(metadata);
  const ps = value => `'${value.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[System.IO.Compression.ZipFile]::CreateFromDirectory(${ps(stage)},${ps(archive)},[System.IO.Compression.CompressionLevel]::Optimal,$true)`;
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 600000 });
  const sha256 = await hash(archive);
  await writeFile(`${archive}.sha256`, `${sha256}  ${releaseName}.zip\n`);
  const report = { schema: 'shuangling-portable-build-v1', version: packageInfo.version, archive: `${releaseName}.zip`,
    archiveBytes: (await stat(archive)).size, sha256, manifest: `${releaseName}/${manifestName}`, manifestSha256: await hash(join(stage, manifestName)),
    payloadFiles: manifest.fileCount, payloadBytes: manifest.totalBytes, productionPackages: manifest.dependencies.length,
    runtime: manifest.runtime, containsUserData: false, generatedAt: new Date().toISOString() };
  await writeFile(join(releaseRoot, `${releaseName}.build.json`), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
if (args.includes('--plan')) {
  const { rows } = await productionDependencies();
  process.stdout.write(JSON.stringify({ version: packageInfo.version, releaseName, stagingExists: await exists(stage), archiveExists: await exists(archive),
    dependencies: rows.map(({ source, ...row }) => row), licenseSupplements: await licenseSupplements(), sourceFiles: fixedFiles, sourceTrees: fixedTrees }, null, 2) + '\n');
} else if (args.includes('--finalize')) {
  await finalizePackage(await json(join(stage, manifestName)));
} else {
  const manifest = await stagePackage();
  if (args.includes('--stage-only')) process.stdout.write(JSON.stringify({ staged: releaseName, manifest: manifestName, files: manifest.fileCount, bytes: manifest.totalBytes,
    productionPackages: manifest.dependencies.length, runtime: manifest.runtime, finalized: false }, null, 2) + '\n');
  else await finalizePackage(manifest);
}
