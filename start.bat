@echo off
echo Starting VA Rider Calculator...
echo.

REM Start backend first — give uvicorn a few seconds to boot before the
REM frontend loads and fires its auto-run (avoids the "not responding" banner)
start "Backend (FastAPI :8000)" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo Waiting for backend to start...
timeout /t 4 /nobreak > nul

REM Start frontend
start "Frontend (Vite :5173)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Both servers are running in separate windows.
