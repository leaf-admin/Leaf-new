@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    LEAF TESTE AUTENTICAÇÃO COM EMAIL
echo    (Teste Firebase + WebSocket)
echo ========================================
echo.
echo Este script testa:
echo 1. Autenticação Firebase (email/senha)
echo 2. Escrita/leitura no Firebase
echo 3. Conexão WebSocket com backend
echo 4. Envio de mensagem WebSocket
echo.
echo ========================================
echo.

echo Verificando se o backend está rodando na porta 3001...
netstat -an | findstr ":3001" >nul
if %errorlevel% equ 0 (
    echo ✅ Backend está rodando na porta 3001!
    echo.
    echo ✅ Backend detectado! Iniciando teste com email...
    echo.
) else (
    echo ❌ Backend não está rodando na porta 3001!
    echo.
    echo ⚠️  Inicie o backend primeiro com: cd leaf-websocket-backend && npm start
    echo.
    pause
    exit /b 1
)

echo Executando teste de autenticação com email...
node tests/test-auth-email.cjs

echo.
echo ========================================
echo    TESTE COM EMAIL CONCLUÍDO
echo ========================================
echo.
pause 