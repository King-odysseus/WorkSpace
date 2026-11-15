<#
.SYNOPSIS
    Build, install and launch the ZuriCopilot desktop app for local testing.

.DESCRIPTION
    One command from a checkout: build the Windows installer, install it for the
    current user (no administrator prompt), record the WorkSpace server address so
    the installed shortcut can find it, then prove the installed app starts.

    The address is stored as the per-user WORKSPACE_SERVER_URL environment
    variable, which is what electron/windows.js reads. A packaged build refuses a
    localhost address on purpose (a session cookie must never cross a plain-http
    hop), so this script validates the address with that same code before it
    installs anything: a bad address fails here, in one line, instead of producing
    an app that opens and then cannot load.

.PARAMETER ServerUrl
    The https address of the WorkSpace server, for example
    https://workspace.example.com. Required unless -SkipInstall is used.

.PARAMETER SkipBuild
    Install the newest installer already in desktop/dist instead of rebuilding.
    Useful after a build that already succeeded.

.PARAMETER SkipInstall
    Only set and verify the server address (no build, no install).

.PARAMETER SkipLaunch
    Do not open the app at the end. The smoke test still runs.

.EXAMPLE
    npm run install:local -- -ServerUrl https://workspace.example.com

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local.ps1 `
        -ServerUrl https://workspace.example.com -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$ServerUrl,
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopDir = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $desktopDir 'dist'
$envName = 'WORKSPACE_SERVER_URL'
$productName = 'ZuriCopilot'
$installDir = Join-Path $env:LOCALAPPDATA "Programs\$productName"
$installedExe = Join-Path $installDir "$productName.exe"
$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$productName.lnk"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"

function Write-Step([string]$Message) {
    Write-Host "==> $Message"
}

# The app decides what address it will load; ask its own code rather than keeping
# a second copy of the rules here, so this script and the app can never disagree.
function Resolve-Origin([string]$Candidate) {
    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        throw "A server address is required: -ServerUrl https://your-workspace-host"
    }
    $script = @'
const { resolveServerConfig } = require('./electron/windows.js')
try {
  const config = resolveServerConfig({ env: { WORKSPACE_SERVER_URL: process.argv[1] }, isPackaged: true })
  process.stdout.write(config.origin)
} catch (error) {
  process.stderr.write(error.message + '\n')
  process.exit(1)
}
'@
    Push-Location $desktopDir
    try {
        $output = & node -e $script $Candidate 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "The app will not accept '$Candidate': $($output -join ' ')"
        }
        return ($output -join '').Trim()
    } finally {
        Pop-Location
    }
}

# Explorer keeps its own copy of the environment and only refreshes it on this
# broadcast. Without it, a shortcut launched from the Start Menu would start
# without the address until the next sign-in.
function Update-ProcessEnvironment {
    if (-not ('EnvironmentBroadcast' -as [type])) {
        Add-Type -Namespace '' -Name 'EnvironmentBroadcast' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(
    System.IntPtr hWnd, uint Msg, System.IntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out System.IntPtr lpdwResult);
'@
    }
    $result = [System.IntPtr]::Zero
    [void][EnvironmentBroadcast]::SendMessageTimeout(
        [System.IntPtr]0xffff, 0x1A, [System.IntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
}

# Validated before the build: a two-minute build followed by a rejected address
# is the least useful order this script can run in.
$origin = Resolve-Origin $ServerUrl

if (-not $SkipInstall -and -not $SkipBuild) {
    Write-Step "Building the Windows installer (electron-builder, NSIS)"
    Push-Location $desktopDir
    try {
        & npm.cmd run dist
        if ($LASTEXITCODE -ne 0) { throw "The build failed (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

$installer = $null
if (-not $SkipInstall) {
    $installer = Get-ChildItem -Path $distDir -Filter '*setup.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) { throw "No installer found in $distDir. Run without -SkipBuild." }

    Write-Step "Installing $($installer.Name) for the current user"
    # /currentuser keeps it per-user even if the installer ever gains an all-users
    # option; /S makes it unattended so this script can be run end to end.
    $process = Start-Process -FilePath $installer.FullName -ArgumentList '/S', '/currentuser' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "The installer failed (exit $($process.ExitCode))." }
    if (-not (Test-Path $installedExe)) { throw "Expected the app at $installedExe, but it was not installed there." }
}

Write-Step "Recording $envName=$origin for this Windows user"
[Environment]::SetEnvironmentVariable($envName, $origin, 'User')
# The check below and the app this script starts both inherit this process, so it
# needs the value too.
Set-Item -Path "env:$envName" -Value $origin
Update-ProcessEnvironment
if ([Environment]::GetEnvironmentVariable($envName, 'User') -ne $origin) {
    throw "Could not store $envName for this user."
}

if ($SkipInstall) {
    Write-Step "Server address recorded. Nothing was built or installed (-SkipInstall)."
    return
}

Write-Step "Checking the installed app"
foreach ($path in @($startMenuShortcut, $desktopShortcut)) {
    if (-not (Test-Path $path)) { throw "Expected a shortcut at $path, but it is missing." }
}

# The same check the repository's smoke script runs, only against the installed
# copy: the window loads the configured server and the process exits 0.
& $installedExe '--smoke-test'
if ($LASTEXITCODE -ne 0) {
    throw "The installed app could not load $origin (exit $LASTEXITCODE). Check that the server is running and reachable."
}

Write-Host ''
Write-Host "Installed to $installDir"
Write-Host "Start menu shortcut: $startMenuShortcut"
Write-Host "Server: $origin"
Write-Host ''

if (-not $SkipLaunch) {
    Write-Step "Opening $productName"
    Start-Process -FilePath $installedExe
}
