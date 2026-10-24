# Windows x64 source checkout preparation. Does not install or start the plugin.
# Runtime versions match the validated local distribution.
[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [switch]$Plan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Avoid expensive per-chunk progress rendering for large runtime downloads.
$ProgressPreference = 'SilentlyContinue'
$NodeVersion = '24.19.0'
$ElectronVersion = '43.2.0'

if (-not $ProjectRoot) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json')) {
        $ProjectRoot = $PSScriptRoot
    } else {
        $ProjectRoot = Join-Path $PSScriptRoot '..\..'
    }
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$Vendor = Join-Path $ProjectRoot 'vendor\dsh-pet'
$NodeDirectory = Join-Path $ProjectRoot 'windows\runtime\node'
$ElectronDirectory = Join-Path $ProjectRoot 'windows\runtime\electron'
$CacheDirectory = Join-Path $ProjectRoot '.setup-cache'

foreach ($required in @('package.json', 'vendor\dsh-pet\package-lock.json', 'vendor\dsh-pet\tsdown.config.mjs', 'windows\lifecycle\task.mjs', 'windows\lifecycle\Watcher.cs', 'windows\assets\shuangling\idle.webm', 'reports\windows-assets.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required) -PathType Leaf)) {
        throw "Incomplete source checkout: $required"
    }
}

$actions = @(
    "Download Node.js $NodeVersion (nodejs.org) and verify its official SHA256 list.",
    "Download Electron $ElectronVersion (github.com/electron/electron) and verify its official SHA256 list.",
    'Keep existing matching runtimes; never replace a different runtime automatically.',
    'Install lockfile dependencies only into a fresh vendor/dsh-pet/node_modules.',
    'Build the standalone host and desktop shared core.',
    'Compile the window observer with the Windows .NET Framework compiler.',
    'Leave Codex plugin installation and automatic startup unchanged.'
)
if ($Plan) {
    [PSCustomObject]@{
        projectRoot = $ProjectRoot
        platform = 'win32-x64'
        nodeVersion = $NodeVersion
        electronVersion = $ElectronVersion
        actions = $actions
        downloads = $false
        changes = $false
    } | ConvertTo-Json -Depth 3
    exit 0
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'This source setup supports Windows x64 only.'
}
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
    throw 'Windows ARM64 has not been validated. Use a Windows x64 machine.'
}
$Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Compiler -PathType Leaf)) {
    throw 'The Windows .NET Framework C# compiler is unavailable.'
}
if (Test-Path -LiteralPath (Join-Path $Vendor 'node_modules')) {
    throw 'Existing node_modules found. Use a fresh checkout for this first-install setup; existing files will not be removed.'
}
$disk = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($ProjectRoot))
if ($disk.AvailableFreeSpace -lt 2GB) {
    throw 'At least 2 GB of free space is required for downloads, runtimes and source dependencies.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Path $CacheDirectory -Force | Out-Null

function Get-VerifiedArchive {
    param([string]$BaseUrl, [string]$FileName, [string]$ChecksumFile)
    $archive = Join-Path $CacheDirectory $FileName
    $checksumPath = Join-Path $CacheDirectory ($FileName + '.sha256-list.txt')
    Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + '/' + $ChecksumFile) -OutFile $checksumPath
    $pattern = '^([a-fA-F0-9]{64})\s+\*?' + [Regex]::Escape($FileName) + '$'
    $matchesFound = @()
    foreach ($line in [IO.File]::ReadAllLines($checksumPath)) {
        if ($line.Trim() -match $pattern) { $matchesFound += $Matches[1].ToLowerInvariant() }
    }
    if ($matchesFound.Count -ne 1) { throw "Official SHA256 entry missing or ambiguous: $FileName" }
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
        Write-Host "Downloading $FileName"
        Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + '/' + $FileName) -OutFile $archive
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $matchesFound[0]) { throw "SHA256 verification failed: $FileName. Cached files were retained for inspection." }
    return $archive
}

function Expand-VerifiedArchive {
    param([string]$Archive, [string]$Destination)
    # Archives are verified before expansion; reject traversal paths as well.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationPrefix = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
            if (-not $target.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Archive contains a path outside its extraction directory.'
            }
        }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}

$nodeExe = Join-Path $NodeDirectory 'node.exe'
if (Test-Path -LiteralPath $nodeExe -PathType Leaf) {
    $actualNodeVersion = (& $nodeExe --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne ('v' + $NodeVersion)) {
        throw 'Existing Node runtime version differs; no runtime was replaced.'
    }
} elseif (Test-Path -LiteralPath $NodeDirectory) {
    throw 'An incomplete Node runtime directory exists; no files were replaced.'
} else {
    $nodeName = 'node-v' + $NodeVersion + '-win-x64'
    $nodeZip = Get-VerifiedArchive -BaseUrl ('https://nodejs.org/dist/v' + $NodeVersion) -FileName ($nodeName + '.zip') -ChecksumFile 'SHASUMS256.txt'
    $nodeExtract = Join-Path $CacheDirectory ('unpack-' + $nodeName)
    Expand-VerifiedArchive -Archive $nodeZip -Destination $nodeExtract
    New-Item -ItemType Directory -Path (Split-Path -Parent $NodeDirectory) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $nodeExtract $nodeName) -Destination $NodeDirectory -Recurse
}
$npmCli = Join-Path $NodeDirectory 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw 'The existing Node runtime lacks npm. A fresh source checkout is required for source preparation.'
}

$electronExe = Join-Path $ElectronDirectory 'electron.exe'
if (Test-Path -LiteralPath $electronExe -PathType Leaf) {
    $versionFile = Join-Path $ElectronDirectory 'version'
    if (-not (Test-Path -LiteralPath $versionFile) -or [IO.File]::ReadAllText($versionFile).Trim() -ne $ElectronVersion) {
        throw 'Existing Electron runtime version differs; no runtime was replaced.'
    }
} elseif (Test-Path -LiteralPath $ElectronDirectory) {
    throw 'An incomplete Electron runtime directory exists; no files were replaced.'
} else {
    $electronName = 'electron-v' + $ElectronVersion + '-win32-x64.zip'
    $electronZip = Get-VerifiedArchive -BaseUrl ('https://github.com/electron/electron/releases/download/v' + $ElectronVersion) -FileName $electronName -ChecksumFile 'SHASUMS256.txt'
    Expand-VerifiedArchive -Archive $electronZip -Destination $ElectronDirectory
}

$oldPath = $env:PATH
$oldPlaywright = $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
try {
    $env:PATH = $NodeDirectory + ';' + $oldPath
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
    # Lockfile integrity is checked by npm. Install scripts are disabled; the
    # desktop does not need Playwright browser downloads or Electron's installer.
    # The locked standalone source intentionally omits DSH-host-only peers.
    # Preserve the peer-resolution mode used to create that lockfile.
    & $nodeExe $npmCli --prefix $Vendor ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund --cache (Join-Path $CacheDirectory 'npm')
    if ($LASTEXITCODE -ne 0) { throw 'Source dependency installation failed.' }
    & $nodeExe $npmCli --prefix $Vendor run bundle
    if ($LASTEXITCODE -ne 0) { throw 'Standalone host build failed.' }
    & $nodeExe $npmCli --prefix $Vendor run build:desktop-core
    if ($LASTEXITCODE -ne 0) { throw 'Desktop shared-core build failed.' }
    & $nodeExe (Join-Path $ProjectRoot 'windows\lifecycle\task.mjs') --build --root $ProjectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Window observer build failed.' }
} finally {
    $env:PATH = $oldPath
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = $oldPlaywright
}
foreach ($file in @($nodeExe, $electronExe, (Join-Path $Vendor 'lib\standalone.js'), (Join-Path $ProjectRoot 'windows\lifecycle\ShuanglingCodexWatcher.exe'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Prepared component missing: $file" }
}
Write-Host 'Source preparation complete. Double-click the root Install Codex Plugin entry next.'
Write-Host 'No Codex plugin, login task, account or desktop setting was changed by this script.'
