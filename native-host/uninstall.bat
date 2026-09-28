@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "HOSTNAME=com.wan.tele.dlhost"

echo Menghapus registrasi native host...
for %%B in (
  "Software\Google\Chrome\NativeMessagingHosts"
  "Software\Chromium\NativeMessagingHosts"
  "Software\Microsoft\Edge\NativeMessagingHosts"
  "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"
) do (
  reg delete "HKCU\%%~B\%HOSTNAME%" /f >nul 2>&1
)

if exist "%HOSTNAME%.json"  del /q "%HOSTNAME%.json"
if exist "runtime.txt"      del /q "runtime.txt"
if exist "python_path.txt"  del /q "python_path.txt"

echo Selesai. Extension otomatis kembali ke mode fallback (chrome.downloads).
echo.
pause
