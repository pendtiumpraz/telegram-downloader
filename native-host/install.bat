@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ==========================================================
echo   WAN Telegram  -  Native Host Installer  (Windows)
echo ==========================================================
echo.
echo Native host membuat file bisa dipindah ke path absolut
echo (mis. D:\telegram\) tanpa mengubah folder Download Chrome.
echo Runtime: Node.js (utama) atau Python 3 (alternatif).
echo.

REM ================================================== 1. cari runtime
set "KIND="
set "CMD="

REM --- Node.js lebih diutamakan: hampir selalu sudah ada dan tidak punya
REM     masalah alias Microsoft Store seperti "python".
REM Dua jebakan batch di baris `set CMD` di bawah, jangan diubah tanpa menguji:
REM  1. Backslash BUKAN escape di batch. set "CMD=\"%%N\"" menulis \"...\"
REM     secara harfiah, dan perintahnya tidak dikenali. Pakai set CMD="..."
REM     tanpa kutip pembungkus supaya tanda kutipnya asli.
REM  2. Kurung tutup harus langsung menempel setelah nilainya. Kalau ada spasi
REM     sebelumnya, spasi itu ikut jadi bagian path.
REM Komentar ini sengaja ditaruh DI LUAR blok: tanda kurung di dalam REM tetap
REM dihitung untuk nesting, jadi REM ber-kurung di dalam blok menutupnya lebih awal.
for /f "delims=" %%N in ('where node 2^>nul') do (
  if not defined KIND (
    "%%N" -e "process.exit(0)" >nul 2>&1
    if !errorlevel! equ 0 ( set "KIND=node" & set CMD="%%N")
  )
)

if not defined KIND call :trycmd python  py -3
if not defined KIND call :trycmd python  python
if not defined KIND call :trycmd python  python3

if not defined KIND (
  echo [X] Tidak ada Node.js maupun Python 3 yang bisa dijalankan.
  echo.
  echo     Install salah satu:
  echo       Node.js  ^: https://nodejs.org/       ^(paling gampang^)
  echo       Python 3 ^: https://www.python.org/downloads/
  echo                  ^(centang "Add python.exe to PATH"^)
  echo.
  echo     Tanpa native host extension TETAP jalan memakai mode fallback:
  echo     berkas tetap tersimpan di folder Download Chrome.
  echo.
  pause
  exit /b 1
)

echo [OK] Runtime: !KIND!  -^>  !CMD!
> runtime.txt echo !KIND!
>>runtime.txt echo !CMD!

REM ================================================== 2. Extension ID
echo.
echo Buka  chrome://extensions  -^> aktifkan "Developer mode"
echo Salin ID dari kartu "WAN Telegram Downloader" (32 huruf kecil).
echo.
set "EXTID="
set /p EXTID=Extension ID:
if "!EXTID!"=="" (
  echo [X] Dibatalkan - ID kosong.
  pause
  exit /b 1
)

set "HOSTNAME=com.wan.tele.dlhost"
set "MANIFEST=%~dp0!HOSTNAME!.json"
set "HOSTPATH=%~dp0wan_dl_host.bat"
set "HOSTPATH_JSON=!HOSTPATH:\=\\!"

REM ================================================== 3. tulis manifest
> "!MANIFEST!" (
  echo {
  echo   "name": "!HOSTNAME!",
  echo   "description": "WAN Telegram Downloader download mover",
  echo   "path": "!HOSTPATH_JSON!",
  echo   "type": "stdio",
  echo   "allowed_origins": [ "chrome-extension://!EXTID!/" ]
  echo }
)
echo [OK] Manifest: !MANIFEST!

REM ================================================== 4. daftar ke registry
set "OKREG=0"
for %%B in (
  "Software\Google\Chrome\NativeMessagingHosts"
  "Software\Chromium\NativeMessagingHosts"
  "Software\Microsoft\Edge\NativeMessagingHosts"
  "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"
) do (
  reg add "HKCU\%%~B\!HOSTNAME!" /ve /t REG_SZ /d "!MANIFEST!" /f >nul 2>&1
  if !errorlevel! equ 0 (
    echo [OK] Terdaftar: HKCU\%%~B\!HOSTNAME!
    set "OKREG=1"
  )
)

if "!OKREG!"=="0" (
  echo [X] Gagal menulis registry HKCU.
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo   SELESAI.
echo   1. chrome://extensions  -^>  Reload extension
echo   2. Sidebar -^> tab Setelan -^> "Cek ulang native host"
echo      harus jadi hijau: "Aktif".
echo ==========================================================
echo.
pause
exit /b 0

REM ---------------------------------------------------------- subroutine
REM  %1 = jenis runtime, sisanya = perintah yang diuji
:trycmd
  set "K=%~1"
  shift
  set "TRY=%1"
  :shiftloop
  shift
  if not "%~1"=="" ( set "TRY=!TRY! %~1" & goto :shiftloop )
  for /f "delims=" %%V in ('!TRY! -c "import sys;print(sys.version_info[0])" 2^>nul') do (
    if "%%V"=="3" ( set "KIND=!K!" & set "CMD=!TRY!" )
  )
  exit /b 0
