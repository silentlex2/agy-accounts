@echo off
chcp 65001 >nul 2>&1
node "%~dp0cli.js" %*
if "%~1"=="" pause
