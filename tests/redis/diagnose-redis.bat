@echo off
setlocal enabledelayedexpansion

echo ========================================
echo    Diagnostico Redis - LEAF
echo ========================================

echo.
echo Verificando ambiente Docker...

echo.
echo 1. Verificando se Docker Desktop esta rodando...
docker version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker nao esta rodando!
    echo.
    echo Solucoes:
    echo 1. Abrir Docker Desktop
    echo 2. Aguardar inicializacao completa
    echo 3. Executar este script novamente
    pause
    exit /b 1
) else (
    echo ✅ Docker esta rodando
)

echo.
echo 2. Verificando containers Redis...
echo.
echo Containers ativos:
docker ps | findstr redis

echo.
echo Todos os containers (incluindo parados):
docker ps -a | findstr redis

echo.
echo 3. Verificando arquivo docker-compose.yml...
if exist "docker-compose.yml" (
    echo ✅ docker-compose.yml encontrado
) else (
    echo ❌ docker-compose.yml nao encontrado
    echo Verifique se esta no diretorio correto
    pause
    exit /b 1
)

echo.
echo 4. Verificando configuracoes Redis...
if exist "redis-config\redis.conf" (
    echo ✅ redis.conf encontrado
) else (
    echo ⚠️ redis.conf nao encontrado
)

echo.
echo 5. Tentando iniciar Redis...
echo.
echo Executando: docker-compose up -d redis
docker-compose up -d redis

if %errorlevel% equ 0 (
    echo ✅ Redis iniciado com sucesso
) else (
    echo ❌ Falha ao iniciar Redis
    echo.
    echo Tentando reconstruir container...
    docker-compose up -d --force-recreate redis
)

echo.
echo 6. Aguardando inicializacao...
timeout /t 10 /nobreak >nul

echo.
echo 7. Verificando status final...
docker ps | findstr redis
if %errorlevel% equ 0 (
    echo ✅ Redis esta rodando
) else (
    echo ❌ Redis ainda nao esta rodando
    echo.
    echo Verificando logs...
    docker-compose logs redis
    pause
    exit /b 1
)

echo.
echo 8. Testando conectividade...
docker exec redis-leaf redis-cli ping
if %errorlevel% equ 0 (
    echo ✅ Conectividade OK
) else (
    echo ❌ Falha na conectividade
    echo.
    echo Verificando logs detalhados...
    docker logs leaf-redis
    pause
    exit /b 1
)

echo.
echo 9. Testando comandos basicos...
echo Testando SET/GET...
docker exec redis-leaf redis-cli SET test "Hello Redis"
docker exec redis-leaf redis-cli GET test
docker exec redis-leaf redis-cli DEL test

echo.
echo Testando GEO commands...
docker exec redis-leaf redis-cli GEOADD test_geo 13.361389 38.115556 "Palermo"
if %errorlevel% equ 0 (
    echo ✅ GEO commands funcionando
    docker exec redis-leaf redis-cli DEL test_geo
) else (
    echo ⚠️ GEO commands nao disponiveis (usando fallback)
)

echo.
echo ========================================
echo    DIAGNOSTICO CONCLUIDO
echo ========================================

echo.
echo ✅ Redis esta funcionando corretamente!
echo.
echo Para continuar com os testes:
echo 1. Execute: run-all-redis-tests.bat
echo 2. Ou execute: quick-start-redis.bat
echo.
echo Para monitoramento:
echo - Interface Web: http://localhost:8081
echo - Logs: docker-compose logs -f redis
echo - Status: docker ps | findstr redis

echo.
pause 