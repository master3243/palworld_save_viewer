@echo off
rem Double-click to start live mode (see README.md). Extra arguments are passed through.
title Palworld Save Analyzer - live mode
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Live mode needs Node.js 18 or newer. Install it from https://nodejs.org and double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node live-server.mjs --open %*
pause
