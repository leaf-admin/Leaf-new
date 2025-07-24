@echo off
echo ========================================
echo TESTE DAS METRICAS DO DOCKER
echo ========================================
echo.

echo 1. Verificando se o Docker esta rodando...
docker --version
if %errorlevel% neq 0 (
    echo ERRO: Docker nao encontrado!
    pause
    exit /b 1
)

echo.
echo 2. Verificando containers ativos...
docker ps

echo.
echo 3. Verificando estatisticas do container leaf-backend...
docker stats leaf-backend --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

echo.
echo 4. Verificando Redis no Docker...
docker exec leaf-redis redis-cli ping

echo.
echo 5. Testando API de metricas...
curl -s http://localhost:3001/metrics | findstr "container"

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
pause 
echo ========================================
echo TESTE DAS METRICAS DO DOCKER
echo ========================================
echo.

echo 1. Verificando se o Docker esta rodando...
docker --version
if %errorlevel% neq 0 (
    echo ERRO: Docker nao encontrado!
    pause
    exit /b 1
)

echo.
echo 2. Verificando containers ativos...
docker ps

echo.
echo 3. Verificando estatisticas do container leaf-backend...
docker stats leaf-backend --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

echo.
echo 4. Verificando Redis no Docker...
docker exec leaf-redis redis-cli ping

echo.
echo 5. Testando API de metricas...
curl -s http://localhost:3001/metrics | findstr "container"

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
pause 
echo ========================================
echo TESTE DAS METRICAS DO DOCKER
echo ========================================
echo.

echo 1. Verificando se o Docker esta rodando...
docker --version
if %errorlevel% neq 0 (
    echo ERRO: Docker nao encontrado!
    pause
    exit /b 1
)

echo.
echo 2. Verificando containers ativos...
docker ps

echo.
echo 3. Verificando estatisticas do container leaf-backend...
docker stats leaf-backend --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

echo.
echo 4. Verificando Redis no Docker...
docker exec leaf-redis redis-cli ping

echo.
echo 5. Testando API de metricas...
curl -s http://localhost:3001/metrics | findstr "container"

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
pause 