@echo off
echo ========================================
echo TESTE DO SERVIDOR APOS CORRECOES
echo ========================================
echo.

echo 1. Verificando se o servidor esta rodando...
curl -s http://localhost:3001/health
if %errorlevel% neq 0 (
    echo ERRO: Servidor nao esta respondendo!
    echo Inicie o servidor com: node server.js
    pause
    exit /b 1
)

echo.
echo 2. Testando endpoint de metricas...
curl -s http://localhost:3001/metrics | findstr "container"
if %errorlevel% neq 0 (
    echo ERRO: Endpoint de metricas nao esta funcionando!
) else (
    echo ✅ Endpoint de metricas funcionando
)

echo.
echo 3. Testando endpoint de metricas em tempo real...
curl -s http://localhost:3001/metrics/realtime | findstr "container"
if %errorlevel% neq 0 (
    echo ERRO: Endpoint de metricas em tempo real nao esta funcionando!
) else (
    echo ✅ Endpoint de metricas em tempo real funcionando
)

echo.
echo 4. Verificando logs do servidor...
echo Procure por mensagens de erro nos logs do servidor

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
echo.
echo Se tudo estiver funcionando, o dashboard deve mostrar:
echo - CPU: ~0.5%% (baixo uso do container)
echo - Memoria: ~5%% (pouco uso do container)
echo - Redis: Conectado
echo - Alertas: Apenas quando ha conexoes ativas
echo.
pause 
echo ========================================
echo TESTE DO SERVIDOR APOS CORRECOES
echo ========================================
echo.

echo 1. Verificando se o servidor esta rodando...
curl -s http://localhost:3001/health
if %errorlevel% neq 0 (
    echo ERRO: Servidor nao esta respondendo!
    echo Inicie o servidor com: node server.js
    pause
    exit /b 1
)

echo.
echo 2. Testando endpoint de metricas...
curl -s http://localhost:3001/metrics | findstr "container"
if %errorlevel% neq 0 (
    echo ERRO: Endpoint de metricas nao esta funcionando!
) else (
    echo ✅ Endpoint de metricas funcionando
)

echo.
echo 3. Testando endpoint de metricas em tempo real...
curl -s http://localhost:3001/metrics/realtime | findstr "container"
if %errorlevel% neq 0 (
    echo ERRO: Endpoint de metricas em tempo real nao esta funcionando!
) else (
    echo ✅ Endpoint de metricas em tempo real funcionando
)

echo.
echo 4. Verificando logs do servidor...
echo Procure por mensagens de erro nos logs do servidor

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
echo.
echo Se tudo estiver funcionando, o dashboard deve mostrar:
echo - CPU: ~0.5%% (baixo uso do container)
echo - Memoria: ~5%% (pouco uso do container)
echo - Redis: Conectado
echo - Alertas: Apenas quando ha conexoes ativas
echo.
pause 
echo ========================================
echo TESTE DO SERVIDOR APOS CORRECOES
echo ========================================
echo.

echo 1. Verificando se o servidor esta rodando...
curl -s http://localhost:3001/health
if %errorlevel% neq 0 (
    echo ERRO: Servidor nao esta respondendo!
    echo Inicie o servidor com: node server.js
    pause
    exit /b 1
)

echo.
echo 2. Testando endpoint de metricas...
curl -s http://localhost:3001/metrics | findstr "container"
if %errorlevel% neq 0 (
    echo ERRO: Endpoint de metricas nao esta funcionando!
) else (
    echo ✅ Endpoint de metricas funcionando
)

echo.
echo 3. Testando endpoint de metricas em tempo real...
curl -s http://localhost:3001/metrics/realtime | findstr "container"
if %errorlevel% neq 0 (
    echo ERRO: Endpoint de metricas em tempo real nao esta funcionando!
) else (
    echo ✅ Endpoint de metricas em tempo real funcionando
)

echo.
echo 4. Verificando logs do servidor...
echo Procure por mensagens de erro nos logs do servidor

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
echo.
echo Se tudo estiver funcionando, o dashboard deve mostrar:
echo - CPU: ~0.5%% (baixo uso do container)
echo - Memoria: ~5%% (pouco uso do container)
echo - Redis: Conectado
echo - Alertas: Apenas quando ha conexoes ativas
echo.
pause 