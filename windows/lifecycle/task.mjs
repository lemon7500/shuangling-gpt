import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from '../../src/lifecycle/index.mjs';

const run = promisify(execFile);
const ps = value => `'${String(value).replaceAll("'", "''")}'`;
export function taskName(projectRoot, dataDir) { return `ShuanglingGPT-Codex-${createHash('sha256').update(`${resolve(projectRoot)}|${resolve(dataDir)}`.toLowerCase()).digest('hex').slice(0, 16)}`; }
export async function buildWatcher({ projectRoot }) {
  const directory = join(projectRoot, 'windows', 'lifecycle');
  const source = join(directory, 'Watcher.cs'), exe = join(directory, 'ShuanglingCodexWatcher.exe');
  const compiler = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (process.platform !== 'win32' || !existsSync(compiler)) throw new Error('watcher-compiler-unavailable');
  await run(compiler, ['/nologo', '/target:winexe', '/optimize+', '/reference:System.Web.Extensions.dll', `/out:${exe}`, source], { windowsHide: true, timeout: 30000 });
  return { executable: exe, bytes: (await stat(exe)).size };
}
export async function runTaskCommand({ projectRoot, dataDir = join(projectRoot, 'windows', 'data'), action }) {
  if (!['build', 'install', 'disable', 'status'].includes(action)) throw new Error('invalid-task-action');
  projectRoot = resolve(projectRoot); dataDir = resolve(dataDir);
  if (action === 'build') return buildWatcher({ projectRoot });
  if (process.platform !== 'win32') throw new Error('login-task-unavailable');
  const name = taskName(projectRoot, dataDir);
  const exe = join(projectRoot, 'windows', 'lifecycle', 'ShuanglingCodexWatcher.exe');
  if (action === 'install' && !existsSync(exe)) await buildWatcher({ projectRoot });
  if (/["\r\n]/.test(projectRoot+dataDir)) throw new Error('invalid-task-path');
  const argument = `--root "${projectRoot}" --data "${dataDir}"`;
  let script = `$ErrorActionPreference='Stop';$taskName=${ps(name)};`;
  if (action === 'install') {
    script += `$current=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;`+
      `if($current -and $current.Actions.Execute -eq ${ps(exe)} -and $current.Actions.Arguments -eq ${ps(argument)}){Enable-ScheduledTask -TaskName $taskName | Out-Null}`+
      `else{$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;`+
      `$taskAction=New-ScheduledTaskAction -Execute ${ps(exe)} -Argument ${ps(argument)} -WorkingDirectory ${ps(projectRoot)};`+
      `$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity;`+
      `$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited;`+
      `$settings=New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1);`+
      `Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description '霜铃 GPT：仅在 Codex 主窗口打开时启动桌宠。' -Force | Out-Null};`;
  } else if (action === 'disable') script += `$current=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;if($current){Disable-ScheduledTask -TaskName $taskName | Out-Null};`;
  script += `$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;if($task){@{installed=$true;enabled=($task.State -ne 'Disabled');name=$taskName}|ConvertTo-Json -Compress}else{@{installed=$false;enabled=$false;name=$taskName}|ConvertTo-Json -Compress}`;
  const { stdout } = await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  await mkdir(dataDir, { recursive: true });
  await atomicJson(join(dataDir, 'lifecycle-task.json'), { ...result, checkedAt: new Date().toISOString(), executable: exe });
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hereRoot = fileURLToPath(new URL('../../', import.meta.url));
  const flag = process.argv.find(arg => ['--build', '--install', '--disable', '--status'].includes(arg));
  const argument = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };
  if (!flag) { process.stderr.write('Expected --build, --install, --disable or --status\n'); process.exitCode = 2; }
  else runTaskCommand({ projectRoot: argument('--root') || hereRoot, dataDir: argument('--data'), action: flag.slice(2) }).then(result => process.stdout.write(JSON.stringify(result)+'\n')).catch(() => { process.stderr.write('login-task-unavailable\n'); process.exitCode = 1; });
}
