@echo off
cd /d "%~dp0"
start "Vocab Server - do not close" py -m http.server 5500
timeout /t 2 /nobreak >nul
start http://localhost:5500
