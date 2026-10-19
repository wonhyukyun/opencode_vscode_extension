# Runs diagnose-db.mjs with the opencode.exe bundled in the installed extension and saves the report
# to the desktop. Usage: powershell -ExecutionPolicy Bypass -File diagnose-db.ps1 [-SessionId ses_...]
param(
  [string]$SessionId = "",
  [string]$Database = ""
)
$ErrorActionPreference = "Stop"

$extension = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter "local.opencode-integrated-*" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $extension) { throw "OpenCode Integrated extension is not installed under $env:USERPROFILE\.vscode\extensions" }
$engine = Join-Path $extension.FullName "bin\win32-x64\opencode.exe"
if (-not (Test-Path $engine)) { throw "Bundled engine not found: $engine" }

$script = Join-Path $PSScriptRoot "diagnose-db.mjs"
$report = Join-Path ([Environment]::GetFolderPath("Desktop")) "opencode-db-report.txt"
$arguments = @($script)
if ($Database) { $arguments += $Database }
if ($SessionId) { $arguments += $SessionId }

# The engine prints UTF-8; without this, Windows PowerShell decodes it with the ANSI code page and
# Korean chat titles come out garbled. Out-File writes UTF-8 rather than Tee-Object's UTF-16.
$previousEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:BUN_BE_BUN = "1"
try {
  $lines = & $engine @arguments
  $lines | Out-File -FilePath $report -Encoding utf8
  $lines
} finally {
  Remove-Item Env:BUN_BE_BUN -ErrorAction SilentlyContinue
  [Console]::OutputEncoding = $previousEncoding
}
Write-Host "`nReport saved to $report"
