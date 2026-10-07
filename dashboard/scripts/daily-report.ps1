# daily-report.ps1 - one scheduled run: refresh the board's data, write a report,
# append one log line, toast a summary.
#
# Windows PowerShell 5.1 ONLY (pure ASCII, no `if` as an expression). The silent
# launcher calls powershell.exe rather than pwsh because WinRT toasts do not load
# on PowerShell 7.
#
# THE FAILURE THIS GUARDS AGAINST
# The Google credential expires about every 7 days by design - the OAuth app is
# deliberately unpublished. A daily report that just printed whatever the API
# returned would therefore show zeros for six days out of seven and look calm
# while blind. So credential state is checked explicitly, said first in the
# report, and raised in the toast. A silent watcher must be loud about its own
# blindness.

[CmdletBinding()]
param(
    [switch]$NoToast
)

$ErrorActionPreference = 'Stop'
$here    = Split-Path -Parent $PSScriptRoot      # ...\dashboard
$repo    = Split-Path -Parent $here
$reports = Join-Path $here 'reports'
if (-not (Test-Path $reports)) { New-Item -ItemType Directory -Force $reports | Out-Null }

$log     = Join-Path $reports 'daily.log'
$latest  = Join-Path $reports 'latest.txt'
$stamp   = (Get-Date).ToString('yyyy-MM-dd HH:mm')
$lines   = New-Object System.Collections.ArrayList
function Add-Line($t) { [void]$lines.Add($t) }

function Write-Log($text) {
    # One run = one line. Newlines in a logged field make every downstream count lie.
    $flat = ($text -replace '\s+', ' ').Trim()
    Add-Content -Path $log -Value ("{0}`t{1}" -f $stamp, $flat) -Encoding utf8
}

# ---- refresh the board's data (this also appends a history point) -----------
$status = 'ok'
$summary = ''
try {
    & (Join-Path $PSScriptRoot 'build-data.ps1') | Out-Null
} catch {
    $msg = $_.Exception.Message
    Write-Log ("ERROR build-data failed: " + $msg)
    Set-Content -Path $latest -Value ("{0}`r`nFAILED: {1}" -f $stamp, $msg) -Encoding utf8
    if (-not $NoToast) { . (Join-Path $PSScriptRoot 'toast.ps1'); Show-Toast "HarborMaster daily" "FAILED: $msg" }
    exit 1
}

# ---- read what the snapshot actually says -----------------------------------
$dataJs = Join-Path $here 'data.js'
# -Encoding UTF8 is required: Windows PowerShell 5.1 reads in the system code
# page by default, which turns every non-ASCII character in the snapshot into
# mojibake ("Â·" for a middle dot) in the report and the log.
$raw = Get-Content $dataJs -Raw -Encoding UTF8
$json = $raw.Substring($raw.IndexOf('{'))
$json = $json.Substring(0, $json.LastIndexOf('}') + 1)
$d = $json | ConvertFrom-Json
$snap = $d.snapshot

Add-Line ("HarborMaster daily report  -  " + $stamp)
Add-Line ("berth " + $snap.berth + "   snapshot " + $snap.generated)
Add-Line ''

# ---- credential state, FIRST, because everything below depends on it --------
$analyticsStates = @()
foreach ($r in $snap.rows) {
    if ($r.analytics -is [string]) { $analyticsStates += $r.analytics }
}
$authDead = ($analyticsStates -contains 'AuthExpired')
$adsenseDead = ($snap.adsense -is [string]) -and ($snap.adsense -eq 'AuthExpired')

if ($authDead -or $adsenseDead) {
    $status = 'auth-expired'
    Add-Line '!! GOOGLE CREDENTIAL EXPIRED - every figure below is blank, not zero.'
    Add-Line '   Fix: cd I:\web_server; uv run --with google-auth-oauthlib --with google-auth python infra/scripts/mint_adc.py'
    Add-Line '   Sign in as tecnocraticaservices@gmail.com. Do NOT Ctrl+C the waiting terminal.'
    Add-Line ''
}

# ---- fleet ------------------------------------------------------------------
Add-Line ("FLEET   {0}/{1} healthy   {2} gap(s)" -f $snap.totals.healthy, $snap.totals.projects, $snap.gaps.Count)
foreach ($g in $snap.gaps) {
    Add-Line ("  [{0}] {1}: {2}" -f $g.severity, $g.label, $g.text)
}
if ($snap.host) {
    Add-Line ("  host: disk {0}% ({1})  mem {2}%  load {3}  reboot {4}" -f `
        $snap.host.disk_pct, $snap.host.disk, $snap.host.mem_pct, $snap.host.load, $snap.host.reboot)
}
Add-Line ''

# ---- traffic ----------------------------------------------------------------
Add-Line 'TRAFFIC  users/sessions, last 7d and last 365d'
$traffic = @()
foreach ($r in $snap.rows) {
    $a = $null
    if ($r.analytics -isnot [string]) { $a = $r.analytics.Ok }
    if ($a) {
        Add-Line ("  {0,-17} {1,3}u/{2,3}s  7d     {3,4}u/{4,4}s  365d   {5}" -f `
            $r.project.slug, $a.users_recent, $a.sessions_recent, $a.users_year, $a.sessions_year, $r.measurement)
        $traffic += ("{0} {1}u" -f $r.project.slug, $a.users_recent)
    } else {
        $state = $r.analytics
        if ($state -isnot [string]) { $state = 'unavailable' }
        Add-Line ("  {0,-17} {1}" -f $r.project.slug, $state)
    }
}
Add-Line ''

# ---- adsense ----------------------------------------------------------------
$ads = $snap.adsense
if ($ads -isnot [string]) {
    $ok = $ads.Ok
    if ($ok) {
        Add-Line ("ADSENSE  {0}   account {1}   ad client {2}   unpaid {3}" -f `
            $ok.publisher_id, $ok.account_state, $ok.client_state, $ok.unpaid)
        if ($ok.client_state -ne 'READY') {
            Add-Line '  NOT SERVING - earnings are structurally zero, not a quiet day.'
        }
        foreach ($s in $ok.sites) { Add-Line ("  site {0}: {1}" -f $s.domain, $s.state) }
        foreach ($al in $ok.alerts) { Add-Line ("  alert {0}" -f $al) }
    }
} else {
    Add-Line ("ADSENSE  " + $ads)
}

# ---- write outputs ----------------------------------------------------------
$body = ($lines -join "`r`n")
Set-Content -Path $latest -Value $body -Encoding utf8

$gapTxt = "{0}/{1} healthy, {2} gap(s)" -f $snap.totals.healthy, $snap.totals.projects, $snap.gaps.Count
if ($status -eq 'auth-expired') {
    Write-Log ("auth-expired; " + $gapTxt)
    $toastTitle = "HarborMaster: credential expired"
    $toastBody  = "Figures are blank, not zero. Re-run mint_adc.py. " + $gapTxt
} else {
    Write-Log ("ok; " + $gapTxt + "; " + ($traffic -join ' '))
    $toastTitle = "HarborMaster daily"
    $toastBody  = $gapTxt + " - " + ($traffic -join '  ')
}

if (-not $NoToast) {
    . (Join-Path $PSScriptRoot 'toast.ps1')
    Show-Toast $toastTitle $toastBody
}

Write-Host $body
