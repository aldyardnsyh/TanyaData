@echo off
REM Wrapper QA: jalankan standalone dengan data proyek (bukan data standalone yang di-purge).
set "PORT=3216"
set "DATA_DIR=%~dp0..\data"
set "WORKSPACE_DIR=%~dp0..\data\workspace"
set "SEED_PROFILE=demo"
set "NEXT_PUBLIC_API_BASE_URL="
call npm run start
