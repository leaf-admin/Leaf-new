@echo off
echo.
echo ========================================
echo    LEAF DRIVER SYSTEM TEST SUITE
echo    (Versao Realista - WebSocket)
echo ========================================
echo.
echo Este script executa testes realistas para verificar:
echo 1. Se o motorista online esta conectado ao backend via WebSocket
echo 2. Se recebe localizacoes via WebSocket e salva no Firebase
echo 3. Se recebe solicitacoes de viagem corretamente
echo 4. Se o tempo de resposta esta aceitavel
echo 5. Se a priorizacao por distancia esta funcionando
echo.
echo FLUXO: Mobile → WebSocket → Backend → Redis/Firebase
echo.
echo ========================================
echo.

echo Verificando se o backend esta rodando na porta 3001...
netstat -an | findstr :3001 >nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Backend esta rodando na porta 3001!
) else (
    echo ❌ Backend nao esta rodando na porta 3001!
    echo.
    echo AVISO: Backend nao esta rodando!
    echo Por favor, inicie o backend antes de executar os testes.
    echo.
    echo Para iniciar o backend:
    echo cd leaf-websocket-backend
    echo npm start
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Backend detectado! Iniciando testes...
echo.

node tests/test-driver-integration-realistic.cjs

echo.
echo ========================================
echo    TESTES CONCLUIDOS
echo ========================================
echo.
pause 