@echo off
echo Starting VA Rider Calculator...
echo.

REM Start backend
start "Backend (FastAPI :8000)" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

REM Start frontend
start "Frontend (Vite :5173)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Both servers are starting in separate windows.
