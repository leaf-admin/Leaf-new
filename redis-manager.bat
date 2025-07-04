@echo off
setlocal enabledelayedexpansion

echo ========================================
echo    Gerenciador Redis - LEAF Project
echo ========================================

:menu
echo.
echo Escolha uma opcao:
echo 1. Iniciar Redis (Docker)
echo 2. Parar Redis
echo 3. Reiniciar Redis
echo 4. Status do Redis
echo 5. Testar Conexao
echo 6. Abrir Redis Commander (Interface Web)
echo 7. Limpar Dados Redis
echo 8. Ver Logs
echo 9. Backup Redis
echo 0. Sair
echo.
set /p choice="Digite sua escolha (0-9): "

if "%choice%"=="1" goto start_redis
if "%choice%"=="2" goto stop_redis
if "%choice%"=="3" goto restart_redis
if "%choice%"=="4" goto status_redis
if "%choice%"=="5" goto test_redis
if "%choice%"=="6" goto open_commander
if "%choice%"=="7" goto clear_redis
if "%choice%"=="8" goto logs_redis
if "%choice%"=="9" goto backup_redis
if "%choice%"=="0" goto exit
goto menu

:start_redis
echo.
echo ========================================
echo    Iniciando Redis...
echo ========================================
docker-compose up -d redis
if %errorlevel% equ 0 (
    echo ✅ Redis iniciado com sucesso!
    echo 📍 Porta: 6379
    echo 🌐 Interface: http://localhost:8081 (se habilitada)
) else (
    echo ❌ Erro ao iniciar Redis
)
pause
goto menu

:stop_redis
echo.
echo ========================================
echo    Parando Redis...
echo ========================================
docker-compose down
echo ✅ Redis parado
pause
goto menu

:restart_redis
echo.
echo ========================================
echo    Reiniciando Redis...
echo ========================================
docker-compose restart redis
if %errorlevel% equ 0 (
    echo ✅ Redis reiniciado com sucesso!
) else (
    echo ❌ Erro ao reiniciar Redis
)
pause
goto menu

:status_redis
echo.
echo ========================================
echo    Status do Redis
echo ========================================
docker-compose ps
echo.
docker stats --no-stream redis
pause
goto menu

:test_redis
echo.
echo ========================================
echo    Testando Conexao Redis
echo ========================================
docker exec leaf-redis redis-cli ping
if %errorlevel% equ 0 (
    echo ✅ Redis esta respondendo!
    
    echo.
    echo Testando comandos basicos...
    docker exec leaf-redis redis-cli set test "Hello Redis"
    docker exec leaf-redis redis-cli get test
    docker exec leaf-redis redis-cli del test
    
    echo.
    echo Testando GEO commands...
    docker exec leaf-redis redis-cli GEOADD test_geo 13.361389 38.115556 "Palermo" 15.087269 37.502669 "Catania"
    if %errorlevel% equ 0 (
        echo ✅ GEO commands funcionando!
    ) else (
        echo ⚠️ GEO commands nao disponiveis
    )
) else (
    echo ❌ Redis nao esta respondendo
)
pause
goto menu

:open_commander
echo.
echo ========================================
echo    Iniciando Redis Commander...
echo ========================================
docker-compose --profile tools up -d redis-commander
if %errorlevel% equ 0 (
    echo ✅ Redis Commander iniciado!
    echo 🌐 Acesse: http://localhost:8081
    echo.
    echo Pressione qualquer tecla para abrir no navegador...
    pause >nul
    start http://localhost:8081
) else (
    echo ❌ Erro ao iniciar Redis Commander
)
pause
goto menu

:clear_redis
echo.
echo ========================================
echo    Limpando Dados Redis
echo ========================================
echo ATENCAO: Isso apagara todos os dados!
set /p confirm="Tem certeza? (s/N): "
if /i "%confirm%"=="s" (
    docker exec leaf-redis redis-cli FLUSHALL
    echo ✅ Dados Redis limpos
) else (
    echo Operacao cancelada
)
pause
goto menu

:logs_redis
echo.
echo ========================================
echo    Logs do Redis
echo ========================================
docker-compose logs -f redis
pause
goto menu

:backup_redis
echo.
echo ========================================
echo    Backup do Redis
echo ========================================
set backup_file=redis_backup_%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%.rdb
set backup_file=%backup_file: =0%
echo Criando backup: %backup_file%
docker exec leaf-redis redis-cli BGSAVE
timeout /t 3 /nobreak >nul
docker cp leaf-redis:/data/dump.rdb ./%backup_file%
if %errorlevel% equ 0 (
    echo ✅ Backup criado: %backup_file%
) else (
    echo ❌ Erro ao criar backup
)
pause
goto menu

:exit
echo.
echo ========================================
echo    Saindo...
echo ========================================
exit /b 0 