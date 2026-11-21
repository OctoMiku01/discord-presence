@echo off
rem Stops a hidden discord-presence (started via start-hidden.vbs or autostart).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*discord-presence\src\index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId; Write-Host ('Stopped ' + $_.ProcessId) }"
