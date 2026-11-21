@echo off
rem Stops a running discord-presence cleanly (clears the Discord status, tells the website right away).
cd /d "%~dp0"
node src\stop.js
rem Keep the window open briefly after a double-click so the result can be read.
ping -n 4 127.0.0.1 >nul
