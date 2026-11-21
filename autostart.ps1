# Adds (or with -Remove removes) discord-presence to the Windows autostart for the current user.
param([switch]$Remove)
$link = Join-Path ([Environment]::GetFolderPath("Startup")) "discord-presence.lnk"
if ($Remove) {
  Remove-Item $link -ErrorAction SilentlyContinue
  Write-Host "Removed from autostart."
  exit
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot "start-hidden.vbs") + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Save()
Write-Host "Added to autostart: $link"
