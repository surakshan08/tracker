@echo off
title Tracker - Automatic GitHub Auto-Push Watcher
cls
echo ======================================================
echo    Tracker - Real-Time GitHub Auto-Push Watcher
echo ======================================================
echo.
echo Starting auto-push watcher... Press Ctrl+C anytime to stop.
echo.
node "%~dp0auto_git_sync.js"
pause
