@echo off
echo ========================================
echo Teste de Carga Redis - Leaf Backend
echo ========================================
echo.

if "%1"=="" (
    echo Uso: test-redis-quick.bat [numero_de_drivers]
    echo Exemplo: test-redis-quick.bat 100
    echo.
    echo Valores sugeridos:
    echo   100  - Teste leve
    echo   500  - Teste médio  
    echo   1000 - Teste pesado
    echo   2500 - Teste muito pesado
    echo.
    pause
    exit /b 1
)

echo Iniciando teste com %1 drivers...
echo.
echo Certifique-se de que o servidor Redis está rodando em localhost:3001
echo.
pause

node test-redis-load.cjs %1

echo.
echo Teste concluído!
pause 