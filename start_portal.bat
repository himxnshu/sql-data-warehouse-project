@echo off
title Enterprise Sales Data Warehouse - Web Portal
echo ===================================================
echo  Enterprise Sales Data Warehouse & Analytics Portal
echo ===================================================
echo.
echo Launching server on http://localhost:8000...
echo.

start "" "http://localhost:8000"

if exist ".\.venv\Scripts\python.exe" (
    ".\.venv\Scripts\python.exe" -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
) else (
    python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
)

pause
