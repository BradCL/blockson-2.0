<#
  editor-launcher.ps1 — starts the Blockson owner editor and opens it as an app
  window, with no console window and no leftover process.

  It is not run directly by the owner — the matching "Edit My Site.vbs" launches
  it fully hidden. See README.md in this folder.

  Flow:
    1. Make sure Node is present (friendly dialog if not).
    2. Start `engine/serve.js <client>` in a hidden window, logging to .editor-*.log.
    3. Wait for the port to come up (or report the startup error from the log).
    4. Open the editor in Edge/Chrome *app mode* (a clean window, no tabs/address
       bar) using a dedicated browser profile so it is an isolated instance.
    5. When that window closes, stop the server — nothing is left running.

  This script must sit at the repo root (next to the `engine/` folder).
#>
[CmdletBinding()]
param(
  [string]$Client = "",
  [int]$Port = 0,
  [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell

function Show-Dialog([string]$text, [string]$title = "Site editor", [int]$icon = 64) {
  # icon: 16 = error, 48 = warning, 64 = info
  [void]$shell.Popup($text, 0, $title, $icon)
}

function Test-PortOpen([string]$h, [int]$p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($h, $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500)
    if ($ok -and $client.Connected) { $client.EndConnect($iar); return $true }
    return $false
  } catch { return $false }
  finally { $client.Close() }
}

function Resolve-Browser {
  foreach ($name in 'msedge.exe', 'chrome.exe') {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  $paths = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $paths) { if (Test-Path $p) { return $p } }
  return $null
}

# --- resolve config ----------------------------------------------------------
$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Client)) {
  Show-Dialog "This launcher wasn't told which site to open. Ask your web developer to set it up." "Site editor" 16
  return
}
if ($Port -eq 0) {
  $cfgPath = Join-Path $root "clients\$Client\owner-config.json"
  if (Test-Path $cfgPath) {
    try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json; if ($cfg.port) { $Port = [int]$cfg.port } } catch {}
  }
  if ($Port -eq 0) { $Port = 4173 }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Show-Dialog "Node.js isn't installed on this computer, so the site editor can't start.`n`nAsk your web developer to install it." "Site editor" 16
  return
}

# --- start the server (unless it is already running) -------------------------
$node = $null
$startedNode = $false
if (-not (Test-PortOpen $BindHost $Port)) {
  $outLog = Join-Path $root ".editor-out.log"
  $errLog = Join-Path $root ".editor-err.log"
  $node = Start-Process -FilePath "node" `
    -ArgumentList "engine\serve.js", $Client, "--port", $Port, "--host", $BindHost `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  $startedNode = $true

  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    if ($node.HasExited) { break }
    if (Test-PortOpen $BindHost $Port) { break }
    Start-Sleep -Milliseconds 400
  }

  if (-not (Test-PortOpen $BindHost $Port)) {
    $detail = ""
    if (Test-Path $errLog) { $detail = (Get-Content $errLog -Raw) }
    Show-Dialog "The site editor couldn't start.`n`n$detail`nShow this to your web developer." "Site editor" 16
    if ($node -and -not $node.HasExited) { Stop-Process -Id $node.Id -Force }
    return
  }
}

# --- open the editor window --------------------------------------------------
$url = "http://$BindHost`:$Port/"
$browser = Resolve-Browser
try {
  if ($browser) {
    $profileDir = Join-Path $root ".editor-browser"
    $edgeArgs = "--app=$url --user-data-dir=`"$profileDir`""
    Start-Process -FilePath $browser -ArgumentList $edgeArgs -Wait
  } else {
    # No Chromium browser found: fall back to the default browser, and use a
    # blocking dialog as the "I'm done" control so the server still shuts down.
    Start-Process $url
    Show-Dialog "Your site editor is open in your web browser.`n`nWhen you're finished editing, click OK here to close the editor." "Site editor" 64
  }
}
finally {
  if ($startedNode -and $node -and -not $node.HasExited) {
    Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
  }
}
