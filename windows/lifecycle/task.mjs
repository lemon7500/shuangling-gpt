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
// Installer-only ownership handover. Every process command is an exact local
// observer command; PID + creation time are checked again immediately before
// termination. The desktop host is never stopped here, even as a task child.
export function observerHandoverScript({ projectRoot, dataDir, retire = false }) {
  const exe = join(projectRoot, 'windows/lifecycle/ShuanglingCodexWatcher.exe');
  const node = join(projectRoot, 'windows/runtime/node/node.exe');
  const observer = join(projectRoot, 'src/lifecycle/observer.mjs');
  const argument = `--root "${projectRoot}" --data "${dataDir}"`;
  const watcherCommand = `"${exe}" ${argument}`;
  const nodeCommand = `"${node}" "${observer}" ${argument}`;
  return `
$ErrorActionPreference='Stop'
$taskName=${ps(taskName(projectRoot, dataDir))}
$expectedExe=${ps(exe)}
$expectedArgs=${ps(argument)}
$watcherCommand=${ps(watcherCommand)}
$nodeExe=${ps(node)}
$nodeCommand=${ps(nodeCommand)}
$heartbeatFile=${ps(join(dataDir, 'lifecycle-observer.json'))}
$retire=$${retire ? 'true' : 'false'}
function OwnedTask {
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if($task -and (@($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne $expectedExe -or $task.Actions[0].Arguments -ne $expectedArgs)){throw 'login-task-ownership-unverified'}
  return $task
}
function Observers {
  $all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  $watchers=@($all | Where-Object {$_.ExecutablePath -eq $expectedExe -and $_.CommandLine -eq $watcherCommand})
  $nodes=@($all | Where-Object {$_.ExecutablePath -eq $nodeExe -and $_.CommandLine -eq $nodeCommand})
  foreach($watcher in $watchers){
    $children=@($nodes | Where-Object {$_.ParentProcessId -eq $watcher.ProcessId})
    if($children.Count -gt 1){throw 'observer-identity-unverified'}
  }
  foreach($child in $nodes){if(-not @($watchers | Where-Object {$_.ProcessId -eq $child.ParentProcessId}).Count){throw 'observer-orphan-running'}}
  if($watchers.Count -gt 1){throw 'observer-identity-unverified'}
  return @{watchers=$watchers;nodes=$nodes;all=$all}
}
function FreshObserver($set){
  if($set.watchers.Count -ne 1 -or $set.nodes.Count -ne 1){return $false}
  try{$heartbeat=Get-Content -LiteralPath $heartbeatFile -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop}catch{return $false}
  $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  return ($heartbeat.pid -eq $set.nodes[0].ProcessId -and $heartbeat.detectorAvailable -eq $true -and $heartbeat.observedAt -le $now -and $now-$heartbeat.observedAt -lt 6000)
}
function ScheduledObserver($task,$set){
  if(-not $task -or $task.State -ne 'Running' -or -not (FreshObserver $set)){return $false}
  $parent=@($set.all|Where-Object {$_.ProcessId -eq $set.watchers[0].ParentProcessId})
  if($parent.Count -ne 1 -or -not @('svchost.exe','taskeng.exe','taskhostw.exe').Contains($parent[0].Name)){return $false}
  $info=Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  return ($info.LastRunTime.Year -ge 2000 -and $set.watchers[0].CreationDate -and $set.watchers[0].CreationDate.ToUniversalTime() -ge $info.LastRunTime.ToUniversalTime().AddSeconds(-1))
}
function StopVerified($expected){
  $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$expected.ProcessId) -ErrorAction Stop
  if(-not $current){return}
  if(-not $expected.CreationDate -or $current.ExecutablePath -ne $expected.ExecutablePath -or $current.CommandLine -ne $expected.CommandLine -or $current.ParentProcessId -ne $expected.ParentProcessId -or $current.CreationDate -ne $expected.CreationDate){throw 'observer-identity-changed'}
  Stop-Process -Id $current.ProcessId -ErrorAction Stop
}
$task=OwnedTask
$set=Observers
$healthyScheduled=ScheduledObserver $task $set
if(-not $retire -and $healthyScheduled){
  @{installed=$true;enabled=$true;name=$taskName;started=$true;running=$true;observerOwned=$true;observerPid=$set.nodes[0].ProcessId}|ConvertTo-Json -Compress
  exit 0
}
if($set.watchers.Count -or ($task -and $task.State -eq 'Running')){
  $petManagers=@($set.all | Where-Object {$_.ExecutablePath -eq $nodeExe -and $_.CommandLine -and ($_.CommandLine.IndexOf(${ps(join(projectRoot, 'windows/start.mjs'))},[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine.IndexOf(${ps(join(projectRoot, 'windows/start.mjs').replaceAll('\\', '/'))},[StringComparison]::OrdinalIgnoreCase) -ge 0)})
  if($petManagers.Count){throw 'observer-handover-pet-running'}
  if($task -and $task.State -eq 'Running' -and -not $set.watchers.Count){throw 'observer-identity-unverified'}
  foreach($watcher in $set.watchers){if(@($set.nodes|Where-Object {$_.ParentProcessId -eq $watcher.ProcessId}).Count -ne 1){throw 'observer-identity-unverified'}}
  foreach($watcher in $set.watchers){StopVerified $watcher}
  # Closing the native stdin pipe lets the exact Node observer finish its own
  # bounded task command. No process tree or desktop process is terminated.
  $deadline=[DateTime]::UtcNow.AddSeconds(23)
  do{
    $remaining=@($set.nodes | Where-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue})
    if(-not $remaining.Count){break}
    Start-Sleep -Milliseconds 100
  }while([DateTime]::UtcNow -lt $deadline)
  if($remaining.Count){throw 'observer-shutdown-timeout'}
}
if($retire){
  $task=OwnedTask
  if($task){Disable-ScheduledTask -TaskName $taskName -ErrorAction Stop|Out-Null}
  $task=OwnedTask
  if($task -and $task.State -eq 'Running'){throw 'observer-shutdown-timeout'}
  @{installed=($null -ne $task);enabled=$false;name=$taskName;retired=$true;observerOwned=$false}|ConvertTo-Json -Compress
  exit 0
}
$task=OwnedTask
if(-not $task){throw 'login-task-unavailable'}
$settle=[DateTime]::UtcNow.AddSeconds(5)
while($task.State -eq 'Running' -and [DateTime]::UtcNow -lt $settle){Start-Sleep -Milliseconds 100;$task=OwnedTask}
if($task.State -eq 'Running'){throw 'observer-shutdown-timeout'}
Enable-ScheduledTask -TaskName $taskName -ErrorAction Stop|Out-Null
Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
$deadline=[DateTime]::UtcNow.AddSeconds(8)
do{
  Start-Sleep -Milliseconds 200
  $task=OwnedTask
  $set=Observers
  if(ScheduledObserver $task $set){
    @{installed=$true;enabled=$true;name=$taskName;started=$true;running=$true;observerOwned=$true;observerPid=$set.nodes[0].ProcessId}|ConvertTo-Json -Compress
    exit 0
  }
}while([DateTime]::UtcNow -lt $deadline)
throw 'observer-task-not-ready'
`;
}
export function taskName(projectRoot, dataDir) { return `ShuanglingGPT-Codex-${createHash('sha256').update(`${resolve(projectRoot)}|${resolve(dataDir)}`.toLowerCase()).digest('hex').slice(0, 16)}`; }
export async function buildWatcher({ projectRoot }) {
  const directory = join(projectRoot, 'windows', 'lifecycle');
  const source = join(directory, 'Watcher.cs'), exe = join(directory, 'ShuanglingCodexWatcher.exe');
  const compiler = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (process.platform !== 'win32' || !existsSync(compiler)) throw new Error('watcher-compiler-unavailable');
  await run(compiler, ['/nologo', '/target:winexe', '/optimize+', '/reference:System.Web.Extensions.dll', `/out:${exe}`, source], { windowsHide: true, timeout: 30000 });
  return { executable: exe, bytes: (await stat(exe)).size };
}
export async function runTaskCommand({ projectRoot, dataDir = join(projectRoot, 'windows', 'data'), action, runImpl = run }) {
  if (!['build', 'install', 'start', 'handover', 'retire', 'disable', 'status'].includes(action)) throw new Error('invalid-task-action');
  projectRoot = resolve(projectRoot); dataDir = resolve(dataDir);
  if (action === 'build') return buildWatcher({ projectRoot });
  if (process.platform !== 'win32') throw new Error('login-task-unavailable');
  const name = taskName(projectRoot, dataDir);
  const exe = join(projectRoot, 'windows', 'lifecycle', 'ShuanglingCodexWatcher.exe');
  if (['install', 'start', 'handover'].includes(action) && !existsSync(exe)) await buildWatcher({ projectRoot });
  if (/["\r\n]/.test(projectRoot+dataDir)) throw new Error('invalid-task-path');
  const argument = `--root "${projectRoot}" --data "${dataDir}"`;
  let script = `$ErrorActionPreference='Stop';$taskName=${ps(name)};`;
  if (['install', 'start'].includes(action)) {
    script += `$current=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;`+
      `if($current -and (@($current.Actions).Count -ne 1 -or $current.Actions[0].Execute -ne ${ps(exe)} -or $current.Actions[0].Arguments -ne ${ps(argument)})){throw 'login-task-ownership-unverified'};`+
      `if($current -and $current.Actions.Execute -eq ${ps(exe)} -and $current.Actions.Arguments -eq ${ps(argument)}){Enable-ScheduledTask -TaskName $taskName | Out-Null}`+
      `else{$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;`+
      `$taskAction=New-ScheduledTaskAction -Execute ${ps(exe)} -Argument ${ps(argument)} -WorkingDirectory ${ps(projectRoot)};`+
      `$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity;`+
      `$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited;`+
      `$settings=New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1);`+
      `Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description '霜铃 GPT：仅在 Codex 主窗口打开时启动桌宠。' -Force | Out-Null};`;
  } else if (action === 'disable') script += `$current=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;if($current){if(@($current.Actions).Count -ne 1 -or $current.Actions[0].Execute -ne ${ps(exe)} -or $current.Actions[0].Arguments -ne ${ps(argument)}){throw 'login-task-ownership-unverified'};Disable-ScheduledTask -TaskName $taskName | Out-Null};`;
  if (action === 'start') script += `$task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop;if($task.State -ne 'Running'){Start-ScheduledTask -TaskName $taskName -ErrorAction Stop};`;
  script += `$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;if($task){@{installed=$true;enabled=($task.State -ne 'Disabled');name=$taskName;started=$${action === 'start' ? 'true' : 'false'}}|ConvertTo-Json -Compress}else{@{installed=$false;enabled=$false;name=$taskName;started=$false}|ConvertTo-Json -Compress}`;
  if (['handover', 'retire'].includes(action)) script = observerHandoverScript({ projectRoot, dataDir, retire: action === 'retire' });
  let stdout;
  try {
    ({ stdout } = await runImpl(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: ['handover', 'retire'].includes(action) ? 60000 : 20000, encoding: 'utf8' }));
  } catch (error) {
    const known = /\b(login-task-ownership-unverified|observer-identity-unverified|observer-identity-changed|observer-orphan-running|observer-handover-pet-running|observer-shutdown-timeout|observer-task-not-ready)\b/.exec(String(error?.stderr || ''));
    throw new Error(known?.[1] || 'login-task-unavailable');
  }
  const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  await mkdir(dataDir, { recursive: true });
  await atomicJson(join(dataDir, 'lifecycle-task.json'), { ...result, checkedAt: new Date().toISOString(), executable: exe });
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hereRoot = fileURLToPath(new URL('../../', import.meta.url));
  const flag = process.argv.find(arg => ['--build', '--install', '--start', '--disable', '--status'].includes(arg));
  const argument = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };
  if (!flag) { process.stderr.write('Expected --build, --install, --start, --disable or --status\n'); process.exitCode = 2; }
  else runTaskCommand({ projectRoot: argument('--root') || hereRoot, dataDir: argument('--data'), action: flag.slice(2) }).then(result => process.stdout.write(JSON.stringify(result)+'\n')).catch(() => { process.stderr.write('login-task-unavailable\n'); process.exitCode = 1; });
}
