@echo off
chcp 65001 >nul
title 一刀窮一刀富 - 賭石
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js，請先安裝 https://nodejs.org
  pause
  exit /b 1
)

rem 已經有伺服器在跑就直接開瀏覽器
netstat -ano | findstr /r /c:":5183 .*LISTENING" >nul
if not errorlevel 1 (
  echo 遊戲伺服器已在執行，開啟瀏覽器...
  start "" "http://127.0.0.1:5183/"
  exit /b 0
)

if not exist "node_modules\vite" (
  echo 第一次執行，安裝套件中...
  call npm install
  if errorlevel 1 (
    echo [錯誤] 套件安裝失敗
    pause
    exit /b 1
  )
)

echo.
echo  賭石攤開張中，瀏覽器會自動開啟 http://127.0.0.1:5183/
echo  關閉這個視窗就會收攤
echo.
call npm run dev -- --open
if errorlevel 1 pause
