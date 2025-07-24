@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    LEAF TESTE DE PRODUÇÃO
echo    (Simulação Completa do Sistema)
echo ========================================
echo.
echo Este script testa o fluxo completo:
echo 1. ✅ Motorista online conectado ao backend
echo 2. ✅ Localizações via Redis → Firebase
echo 3. ✅ Recebimento de solicitações de viagem
echo 4. ✅ Tempo de resposta à solicitação
echo 5. ✅ Priorização por distância
echo.
echo OBSERVABILIDADE: Latencias, métricas, logs
echo FLUXO: Mobile → WebSocket → Backend → Redis/Firebase
echo.
echo ========================================
echo.

echo Verificando se o backend está rodando na porta 3001...
netstat -an | findstr ":3001" >nul
if %errorlevel% equ 0 (
    echo ✅ Backend está rodando na porta 3001!
    echo.
    echo ✅ Backend detectado! Iniciando teste de produção...
    echo.
) else (
    echo ❌ Backend não está rodando na porta 3001!
    echo.
    echo ⚠️  Inicie o backend primeiro com: cd leaf-websocket-backend && npm start
    echo.
    pause
    exit /b 1
)

echo Executando teste de produção Leaf...
node tests/test-leaf-production.cjs

echo.
echo ========================================
echo    TESTE DE PRODUÇÃO CONCLUÍDO
echo ========================================
echo.
pause 