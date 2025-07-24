@echo off
echo ========================================
echo Teste de Carga Completo - Leaf Backend
echo ========================================
echo.

echo Escolha o tipo de teste:
echo.
echo 1. Teste Leve (100 drivers)
echo 2. Teste Médio (500 drivers)  
echo 3. Teste Pesado (1000 drivers)
echo 4. Teste Muito Pesado (2500 drivers)
echo 5. Teste Personalizado
echo 6. Sair
echo.

set /p choice="Digite sua escolha (1-6): "

if "%choice%"=="1" (
    echo.
    echo Iniciando teste leve com 100 drivers...
    node test-redis-load.cjs 100
) else if "%choice%"=="2" (
    echo.
    echo Iniciando teste médio com 500 drivers...
    node test-redis-load.cjs 500
) else if "%choice%"=="3" (
    echo.
    echo Iniciando teste pesado com 1000 drivers...
    node test-redis-load.cjs 1000
) else if "%choice%"=="4" (
    echo.
    echo Iniciando teste muito pesado com 2500 drivers...
    echo ATENÇÃO: Este teste pode demorar e consumir muitos recursos!
    pause
    node test-redis-load.cjs 2500
) else if "%choice%"=="5" (
    echo.
    set /p custom_count="Digite o número de drivers: "
    echo.
    echo Iniciando teste personalizado com %custom_count% drivers...
    node test-redis-load.cjs %custom_count%
) else if "%choice%"=="6" (
    echo Saindo...
    exit /b 0
) else (
    echo Opção inválida!
    pause
    exit /b 1
)

echo.
echo Teste concluído!
pause 