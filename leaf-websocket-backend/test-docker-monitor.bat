@echo off
echo ========================================
echo TESTE DO DOCKER MONITOR CORRIGIDO
echo ========================================
echo.

echo Primeiro, vamos verificar os containers disponiveis:
echo.
call check-containers.bat

echo.
echo ========================================
echo TESTANDO DOCKER MONITOR
echo ========================================
echo.

node test-docker-monitor.js

echo.
echo ========================================
echo TESTE CONCLUIDO
echo ========================================
pause 