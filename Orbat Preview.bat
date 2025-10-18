@echo off
setlocal
set "base=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%base%Orbat Mapper Preview.lnk');" ^
 "$s.TargetPath='%base%Orbat-Dev.bat'; $s.WorkingDirectory='%base%';" ^
 "$s.IconLocation='%base%images\Icons\Orbat Mapper Preview.ico'; $s.Save()"
endlocal

@echo off
cd /d "%~dp0"
npm run preview
pause