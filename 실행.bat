@echo off
cd /d "%~dp0"
for %%f in ("%~dp0*.vbs") do (
    start "" wscript.exe "%%~ff"
    goto :done
)
:done
