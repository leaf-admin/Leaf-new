@echo off
echo.
echo ========================================
echo    LEAF REALISTIC INTEGRATION TEST
echo    (Teste Realista de Integração)
echo ========================================
echo.
echo Este script executa testes realistas para verificar:
echo 1. Conexao WebSocket entre mobile e backend
echo 2. Motorista ficando online (latencia)
echo 3. Recebimento de solicitacao de corrida
echo 4. Aceitacao de corrida (latencia)
echo 5. Inicio da viagem (escrita no Firebase)
echo 6. Fim da viagem (escrita no Firebase)
echo.
echo OBSERVABILIDADE: Latencias, escritas, logs
echo FLUXO: Mobile → WebSocket → Backend → Firebase
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
echo ✅ Backend detectado! Iniciando teste realista...
echo.

node tests/test-realistic-integration.cjs

echo.
echo ========================================
echo    TESTE REALISTA CONCLUIDO
echo ========================================
echo.
pause 