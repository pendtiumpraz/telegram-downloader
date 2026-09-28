@echo off
setlocal
cd /d "%~dp0"

REM Runtime dipilih saat install dan disimpan di runtime.txt:
REM   baris 1 = "node" atau "python"
REM   baris 2 = perintah lengkap untuk menjalankannya
set "KIND="
set "CMD="
if exist "runtime.txt" (
  set /p KIND=<runtime.txt
  for /f "skip=1 delims=" %%L in (runtime.txt) do if not defined CMD set "CMD=%%L"
)

if /i "%KIND%"=="node"   goto :run
if /i "%KIND%"=="python" goto :run

REM ---- fallback kalau runtime.txt tidak ada: deteksi sendiri
where node >nul 2>&1 && (set "KIND=node" & set "CMD=node" & goto :run)
where py   >nul 2>&1 && (set "KIND=python" & set "CMD=py -3" & goto :run)
exit /b 1

:run
if /i "%KIND%"=="node" (
  %CMD% "%~dp0wan_dl_host.js"
) else (
  %CMD% "%~dp0wan_dl_host.py"
)
