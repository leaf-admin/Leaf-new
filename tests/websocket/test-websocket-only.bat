@echo off
echo.
echo ========================================
echo    LEAF WEBSOCKET TEST SUITE
echo    (Versao Simplificada)
echo ========================================
echo.
echo Este script executa testes simplificados para verificar:
echo 1. Se a conexao WebSocket/Socket.io esta funcionando
echo 2. Se a autenticacao esta funcionando
echo 3. Se a atualizacao de localizacao esta funcionando
echo 4. Se o status do motorista esta funcionando
echo 5. Se o ping/pong esta funcionando
echo.
echo FOCUS: WebSocket/Socket.io Communication Only
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
echo ✅ Backend detectado! Iniciando testes WebSocket...
echo.

node tests/test-websocket-only.cjs

echo.
echo ========================================
echo    TESTES CONCLUIDOS
echo ========================================
echo.
pause 