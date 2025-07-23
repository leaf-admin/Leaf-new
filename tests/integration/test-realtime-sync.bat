@echo off
echo ========================================
echo LEAF TESTE SINCRONIZAÇÃO REALTIME DATABASE
echo ========================================
echo Este script testa se o backend está sincronizando
echo corretamente com o Firebase Realtime Database
echo ========================================

echo Verificando se o backend está rodando na porta 3001...
netstat -an | findstr ":3001" >nul
if %errorlevel% neq 0 (
    echo ❌ Backend não está rodando na porta 3001!
    echo Inicie o backend primeiro com: cd leaf-websocket-backend && node server.js
    pause
    exit /b 1
)

echo ✅ Backend está rodando na porta 3001!
echo ✅ Backend detectado!
echo Iniciando teste de sincronização...
echo.

node tests/test-realtime-sync.cjs

echo.
echo ========================================
echo TESTE SINCRONIZAÇÃO CONCLUÍDO
echo ========================================
pause 