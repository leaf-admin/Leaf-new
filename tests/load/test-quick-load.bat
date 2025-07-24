@echo off
echo ========================================
echo LEAF TESTE DE CARGA RÁPIDO
echo ========================================
echo Este script testa rapidamente se o sistema
echo está pronto para o teste de carga completo
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
echo.
echo 🚀 INICIANDO TESTE DE CARGA RÁPIDO...
echo 📊 Simulando 20 motoristas simultâneos
echo 📍 Testando conexões e operações básicas
echo.
echo ⚠️  Este teste é rápido (cerca de 30 segundos)...
echo.

node tests/test-quick-load.cjs

echo.
echo ========================================
echo TESTE RÁPIDO CONCLUÍDO
echo ========================================
pause 