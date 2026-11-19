<#
.SYNOPSIS
    Regression check for the install location resolver in install-local.ps1.

.DESCRIPTION
    The resolver reads the uninstall entries Windows writes when the app is
    installed and works out which executable to trust. Two things go wrong if it
    is careless:

      * Get-ItemProperty returns an object carrying only the values an entry
        defines, so under Set-StrictMode reading DisplayName, DisplayIcon or
        UninstallString from an entry that does not have it throws
        PropertyNotFoundException. Windows keeps keys with no DisplayName at all,
        so this breaks the script on a normal machine.
      * An entry with a display name but neither path value has to fall through
        to the default folder, and no entry at all has to produce one clear
        error rather than a stack trace.

    This file calls the real functions out of install-local.ps1. It does not
    build, install, write WORKSPACE_SERVER_URL, read or write the registry, or
    open the app. The only things it creates are empty ZuriCopilot.exe files in a
    throwaway folder under the user's temp directory, removed at the end.

    No Pester, no modules, nothing to install.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local.test.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Strict mode is the whole point of this check: without it a missing property
# reads as $null and the guards would look unnecessary. install-local.ps1 turns
# it on, and dot-sourcing keeps it on here.
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'install-local.ps1') -ExportFunctionsOnly

if ((Get-Command Get-StrictMode -ErrorAction SilentlyContinue)) {
    if ((Get-StrictMode) -ne 'Latest') {
        throw "Expected strict mode Latest, got '$(Get-StrictMode)'. The missing-property cases below would not prove anything."
    }
} else {
    # Windows PowerShell 5.1 has no Get-StrictMode, so prove the setting the way
    # it matters: reading a property that is not there must throw. Without strict
    # mode this reads as $null and none of the guards below would be necessary.
    $strictModeOn = $false
    try {
        $null = ([pscustomobject]@{ OnlyValue = 1 }).MissingValue
    } catch [System.Management.Automation.PropertyNotFoundException] {
        $strictModeOn = $true
    }
    if (-not $strictModeOn) {
        throw 'Strict mode is not active, so the missing-property cases below would prove nothing.'
    }
}

$productName = 'ZuriCopilot'
$results = New-Object System.Collections.Generic.List[string]
$failures = New-Object System.Collections.Generic.List[string]

function Add-Pass([string]$Case) {
    $results.Add("PASS  $Case")
}

function Add-Fail([string]$Case, [string]$Detail) {
    $failures.Add("FAIL  $Case`n        $Detail")
}

function Assert-Equal([string]$Case, $Expected, $Actual) {
    if ($null -ne $Actual -and ([string]$Actual -eq [string]$Expected)) {
        Add-Pass $Case
        return
    }
    Add-Fail $Case "expected '$Expected', got '$Actual'"
}

# Any exception is a failure unless the case says which one it wants, so an
# unexpected PropertyNotFoundException is reported against the case that caused
# it instead of killing the run with a stack trace. -ExpectError means the case
# asserts on $script:lastError itself.
function Invoke-Case([string]$Case, [scriptblock]$Action, [switch]$ExpectError) {
    $script:lastValue = $null
    $script:lastError = $null
    try {
        $script:lastValue = & $Action
    } catch {
        $script:lastError = $_
    }
    if ($null -ne $script:lastError -and -not $ExpectError) {
        Add-Fail $Case ("threw $($script:lastError.Exception.GetType().FullName): $($script:lastError.Exception.Message)")
    }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('zuricopilot-install-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null

try {
    function New-FakeInstall([string]$Folder) {
        $dir = Join-Path $script:root $Folder
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $exe = Join-Path $dir "$productName.exe"
        Set-Content -LiteralPath $exe -Value '' -NoNewline
        return $exe
    }

    $installedExe = New-FakeInstall 'installed'
    $iconOnlyExe = New-FakeInstall 'icon-only'
    $uninstallOnlyExe = New-FakeInstall 'uninstall-only'
    $fallbackExe = New-FakeInstall 'fallback'
    $emptyDir = Join-Path $root 'empty'
    New-Item -ItemType Directory -Path $emptyDir | Out-Null

    # --- 1. An unrelated entry with no DisplayName -------------------------
    # Sits beside a real entry. Under strict mode, reading its DisplayName in the
    # filtering predicate used to throw before the real entry was ever looked at.
    $noDisplayName = [pscustomobject]@{ UninstallString = '"C:\Windows\NotOurs\uninstall.exe"' }
    $realEntry = [pscustomobject]@{ DisplayName = "$productName 0.0.0"; DisplayIcon = "$installedExe,0" }

    Invoke-Case 'unrelated entry missing DisplayName is skipped, the real entry wins' {
        Resolve-InstalledExeFromEntries -Entries @($noDisplayName, $realEntry) -Name $productName -FallbackDir $emptyDir
    }
    Assert-Equal 'unrelated entry missing DisplayName is skipped, the real entry wins' $installedExe $script:lastValue

    # The same entry on its own, with nothing to fall back to: the intended
    # error, not a PropertyNotFoundException.
    Invoke-Case -Case 'only an unrelated entry with no DisplayName gives the intended error' -ExpectError -Action {
        Resolve-InstalledExeFromEntries -Entries @($noDisplayName) -Name $productName -FallbackDir $emptyDir
    }
    if ($null -eq $script:lastError) {
        Add-Fail 'only an unrelated entry with no DisplayName gives the intended error' "expected an exception, got '$($script:lastValue)'"
    } elseif ($script:lastError.Exception -is [System.Management.Automation.PropertyNotFoundException]) {
        Add-Fail 'only an unrelated entry with no DisplayName gives the intended error' 'threw PropertyNotFoundException instead of the intended error'
    } elseif ([string]$script:lastError.Exception.Message -like '*Could not find the installed*') {
        Add-Pass 'only an unrelated entry with no DisplayName gives the intended error'
    } else {
        Add-Fail 'only an unrelated entry with no DisplayName gives the intended error' "unexpected message: $($script:lastError.Exception.Message)"
    }

    # --- 2. Matching entries missing one optional path value ---------------
    # DisplayIcon only, no UninstallString.
    Invoke-Case 'matching entry with DisplayIcon and no UninstallString resolves' {
        Resolve-InstalledExeFromEntries -Entries @(
            [pscustomobject]@{ DisplayName = $productName; DisplayIcon = "$iconOnlyExe,0" }
        ) -Name $productName -FallbackDir $emptyDir
    }
    Assert-Equal 'matching entry with DisplayIcon and no UninstallString resolves' $iconOnlyExe $script:lastValue

    # UninstallString only, no DisplayIcon.
    Invoke-Case 'matching entry with UninstallString and no DisplayIcon resolves' {
        Resolve-InstalledExeFromEntries -Entries @(
            [pscustomobject]@{
                DisplayName = "$productName 0.0.0"
                UninstallString = '"' + (Join-Path (Split-Path -Parent $uninstallOnlyExe) 'Uninstall ZuriCopilot.exe') + '"'
            }
        ) -Name $productName -FallbackDir $emptyDir
    }
    Assert-Equal 'matching entry with UninstallString and no DisplayIcon resolves' $uninstallOnlyExe $script:lastValue

    # --- 3. Both path values missing, with a usable fallback ---------------
    Invoke-Case 'matching entry with neither path value falls back to the default folder' {
        Resolve-InstalledExeFromEntries -Entries @(
            [pscustomobject]@{ DisplayName = "$productName 0.0.0" }
        ) -Name $productName -FallbackDir (Split-Path -Parent $fallbackExe)
    }
    Assert-Equal 'matching entry with neither path value falls back to the default folder' $fallbackExe $script:lastValue

    # --- 4. No entries at all, with a usable fallback ----------------------
    Invoke-Case 'no entries at all falls back to the default folder' {
        Resolve-InstalledExeFromEntries -Entries @() -Name $productName -FallbackDir (Split-Path -Parent $fallbackExe)
    }
    Assert-Equal 'no entries at all falls back to the default folder' $fallbackExe $script:lastValue

    # The registry wrapper, pointed at a folder instead of HKCU so no registry key
    # is read. Get-ItemProperty there returns file objects with no DisplayName,
    # which is what the real entry list looks like for keys Windows writes with
    # no display name. This exercises the wrapper's own filtering.
    $fakeUninstallRoot = Join-Path $root 'fake-uninstall'
    New-Item -ItemType Directory -Path $fakeUninstallRoot | Out-Null
    Set-Content -LiteralPath (Join-Path $fakeUninstallRoot 'someone-elses-key') -Value 'not a registry entry'
    Invoke-Case 'the registry wrapper skips entries with no DisplayName' {
        Resolve-InstalledExe -Name $productName -FallbackDir (Split-Path -Parent $fallbackExe) -UninstallRoot $fakeUninstallRoot
    }
    Assert-Equal 'the registry wrapper skips entries with no DisplayName' $fallbackExe $script:lastValue

    # --- 5. No valid executable anywhere ----------------------------------
    Invoke-Case -Case 'nothing installed anywhere gives the intended error' -ExpectError -Action {
        Resolve-InstalledExeFromEntries -Entries @(
            [pscustomobject]@{ DisplayName = $productName; DisplayIcon = (Join-Path $emptyDir 'Gone.exe') }
        ) -Name $productName -FallbackDir $emptyDir
    }
    if ($null -eq $script:lastError) {
        Add-Fail 'nothing installed anywhere gives the intended error' "expected an exception, got '$($script:lastValue)'"
    } elseif ($script:lastError.Exception -is [System.Management.Automation.PropertyNotFoundException]) {
        Add-Fail 'nothing installed anywhere gives the intended error' 'threw PropertyNotFoundException instead of the intended error'
    } elseif ([string]$script:lastError.Exception.Message -notlike "*Could not find the installed $productName*") {
        Add-Fail 'nothing installed anywhere gives the intended error' "unexpected message: $($script:lastError.Exception.Message)"
    } else {
        Add-Pass 'nothing installed anywhere gives the intended error'
    }

    # The fallback path is named in that error, so the person can see where it
    # looked without rerunning anything.
    $reportedFallback = Join-Path $emptyDir "$productName.exe"
    if ($null -ne $script:lastError -and ([string]$script:lastError.Exception.Message).Contains($reportedFallback)) {
        Add-Pass 'the error names the fallback path it checked'
    } else {
        Add-Fail 'the error names the fallback path it checked' "message did not contain '$reportedFallback'"
    }
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}

foreach ($line in $results) { Write-Host $line }

if ($failures.Count -gt 0) {
    Write-Host ''
    foreach ($line in $failures) { Write-Host $line }
    Write-Host ''
    Write-Host "$($failures.Count) check(s) failed."
    exit 1
}

Write-Host ''
Write-Host "All $($results.Count) checks passed under $($PSVersionTable.PSVersion)."
exit 0
