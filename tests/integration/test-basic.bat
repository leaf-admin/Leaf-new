@echo off
echo ========================================
echo Teste Básico - Conectividade Redis
echo ========================================
echo.

echo Verificando se o servidor Redis está funcionando...
echo.

node test-basic.js

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ Teste básico PASSOU!
    echo O servidor Redis está funcionando corretamente.
    echo.
    echo Para executar testes de carga:
    echo   test-redis-quick.bat [numero_de_drivers]
    echo   Exemplo: test-redis-quick.bat 100
) else (
    echo.
    echo ❌ Teste básico FALHOU!
    echo Verifique se o servidor Redis está rodando em localhost:3001
    echo.
    echo Para iniciar o servidor:
    echo   cd leaf-websocket-backend
    echo   npm start
)

echo.
pause 