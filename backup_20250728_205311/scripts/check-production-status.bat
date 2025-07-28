@echo off
echo 🔍 LEAF - VERIFICANDO STATUS DA PRODUÇÃO 🔍
echo ===========================================

echo.
echo 📊 Verificando serviços...
echo.

REM Verificar se Redis está rodando
echo 🔴 Verificando Redis...
docker ps | findstr redis >nul
if %errorlevel% equ 0 (
    echo ✅ Redis está rodando
) else (
    echo ❌ Redis não está rodando
)

REM Verificar se WebSocket backend está rodando
echo 🔌 Verificando WebSocket Backend...
netstat -an | findstr :3001 >nul
if %errorlevel% equ 0 (
    echo ✅ WebSocket Backend está rodando na porta 3001
) else (
    echo ❌ WebSocket Backend não está rodando
)

REM Verificar se Dashboard está rodando
echo 📊 Verificando Dashboard...
netstat -an | findstr :3000 >nul
if %errorlevel% equ 0 (
    echo ✅ Dashboard está rodando na porta 3000
) else (
    echo ❌ Dashboard não está rodando
)

REM Verificar se Redis Commander está rodando
echo 🖥️ Verificando Redis Commander...
netstat -an | findstr :8081 >nul
if %errorlevel% equ 0 (
    echo ✅ Redis Commander está rodando na porta 8081
) else (
    echo ❌ Redis Commander não está rodando
)

echo.
echo 🌐 Verificando Firebase...
echo.

REM Verificar status do Firebase
firebase projects:list >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Firebase está conectado
) else (
    echo ❌ Firebase não está conectado
)

echo.
echo 📱 Verificando builds do Mobile App...
echo.

REM Verificar se há builds recentes
cd mobile-app
if exist "eas.json" (
    echo ✅ EAS configurado
    echo 📋 Para ver builds: npx eas build:list
) else (
    echo ❌ EAS não configurado
)
cd ..

echo.
echo 🔗 URLs dos serviços:
echo.
echo 🌐 Web App: https://leaf-reactnative.web.app
echo 🔌 WebSocket: http://localhost:3001
echo 📊 Dashboard: http://localhost:3000
echo 🔴 Redis Commander: http://localhost:8081
echo.

echo 💰 Status da produção verificado! 💰
echo.

pause 