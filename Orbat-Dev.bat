@echo off
setlocal
set "base=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%base%Orbat Mapper Dev.lnk');" ^
 "$s.TargetPath='%base%Orbat-Dev.bat'; $s.WorkingDirectory='%base%';" ^
 "$s.IconLocation='%base%images\Icons\Orbat Mapper Dev.ico'; $s.Save()"
endlocal

cd /d "%~dp0"
npm run dev
pause