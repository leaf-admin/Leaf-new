@echo off
echo ========================================
echo DEBUG COMPLETO DO SISTEMA
echo ========================================
echo.

echo 1. Verificando estado real do Docker e Redis...
node check-docker-redis.js

echo.
echo 2. Testando DockerMonitor diretamente...
node test-docker-monitor.js

echo.
echo 3. Testando endpoint /metrics...
node test-metrics-endpoint.js

echo.
echo 4. Debugando dados reais...
node debug-real-data.js

echo.
echo ========================================
echo DEBUG CONCLUIDO
echo ========================================
pause 
echo ========================================
echo DEBUG COMPLETO DO SISTEMA
echo ========================================
echo.

echo 1. Verificando estado real do Docker e Redis...
node check-docker-redis.js

echo.
echo 2. Testando DockerMonitor diretamente...
node test-docker-monitor.js

echo.
echo 3. Testando endpoint /metrics...
node test-metrics-endpoint.js

echo.
echo 4. Debugando dados reais...
node debug-real-data.js

echo.
echo ========================================
echo DEBUG CONCLUIDO
echo ========================================
pause 
echo ========================================
echo DEBUG COMPLETO DO SISTEMA
echo ========================================
echo.

echo 1. Verificando estado real do Docker e Redis...
node check-docker-redis.js

echo.
echo 2. Testando DockerMonitor diretamente...
node test-docker-monitor.js

echo.
echo 3. Testando endpoint /metrics...
node test-metrics-endpoint.js

echo.
echo 4. Debugando dados reais...
node debug-real-data.js

echo.
echo ========================================
echo DEBUG CONCLUIDO
echo ========================================
pause 