@echo off
echo ========================================
echo INICIANDO LEAF WEBSOCKET BACKEND
echo ========================================
echo.

echo 1. Verificando dependencias...
if not exist node_modules (
    echo Instalando dependencias...
    npm install
)

echo.
echo 2. Verificando arquivos de configuracao...
if not exist firebase-config.js (
    echo ERRO: firebase-config.js nao encontrado!
    pause
    exit /b 1
)

echo.
echo 3. Verificando modulos de monitoramento...
if not exist monitoring\docker-monitor.js (
    echo ERRO: docker-monitor.js nao encontrado!
    pause
    exit /b 1
)

if not exist monitoring\smart-sync-alert-system.js (
    echo ERRO: smart-sync-alert-system.js nao encontrado!
    pause
    exit /b 1
)

if not exist metrics\latency-monitor.js (
    echo ERRO: latency-monitor.js nao encontrado!
    pause
    exit /b 1
)

echo.
echo 4. Iniciando servidor...
echo O servidor estara disponivel em: http://localhost:3001
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

node server.js


echo.
echo 3. Verificando modulos de monitoramento...
if not exist monitoring\docker-monitor.js (
    echo ERRO: docker-monitor.js nao encontrado!
    pause
    exit /b 1
)

if not exist monitoring\smart-sync-alert-system.js (
    echo ERRO: smart-sync-alert-system.js nao encontrado!
    pause
    exit /b 1
)

if not exist metrics\latency-monitor.js (
    echo ERRO: latency-monitor.js nao encontrado!
    pause
    exit /b 1
)

echo.
echo 4. Iniciando servidor...
echo O servidor estara disponivel em: http://localhost:3001
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

node server.js


echo.
echo 3. Verificando modulos de monitoramento...
if not exist monitoring\docker-monitor.js (
    echo ERRO: docker-monitor.js nao encontrado!
    pause
    exit /b 1
)

if not exist monitoring\smart-sync-alert-system.js (
    echo ERRO: smart-sync-alert-system.js nao encontrado!
    pause
    exit /b 1
)

if not exist metrics\latency-monitor.js (
    echo ERRO: latency-monitor.js nao encontrado!
    pause
    exit /b 1
)

echo.
echo 4. Iniciando servidor...
echo O servidor estara disponivel em: http://localhost:3001
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

node server.js
