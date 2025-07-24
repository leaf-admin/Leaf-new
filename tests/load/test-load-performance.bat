@echo off
echo ========================================
echo LEAF TESTE DE CARGA E PERFORMANCE
echo ========================================
echo Este script testa a performance do sistema
echo simulando múltiplos motoristas e passageiros
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
echo 🚀 INICIANDO TESTE DE CARGA...
echo 📊 Simulando 50 motoristas simultâneos por 30 segundos
echo 📍 Testando atualizações de localização e busca de motoristas
echo 🔄 Testando sincronização com Firebase
echo.
echo ⚠️  Este teste pode demorar alguns minutos...
echo.

node tests/test-load-performance.cjs

echo.
echo ========================================
echo TESTE DE CARGA CONCLUÍDO
echo ========================================
pause 