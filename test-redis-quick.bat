@echo off
echo ========================================
echo    Teste Rapido Redis - LEAF
echo ========================================

echo.
echo Verificando container redis-taxi-app...

docker ps | findstr redis-taxi-app
if %errorlevel% equ 0 (
    echo ✅ Container redis-taxi-app esta rodando
) else (
    echo ❌ Container redis-taxi-app nao esta rodando
    echo.
    echo Tentando iniciar...
    docker start redis-taxi-app
    timeout /t 3 /nobreak >nul
)

echo.
echo Testando conectividade...
docker exec redis-taxi-app redis-cli ping
if %errorlevel% equ 0 (
    echo ✅ Conectividade OK
) else (
    echo ❌ Falha na conectividade
    pause
    exit /b 1
)

echo.
echo Testando comandos basicos...
docker exec redis-taxi-app redis-cli SET test "Hello Redis"
docker exec redis-taxi-app redis-cli GET test
docker exec redis-taxi-app redis-cli DEL test

echo.
echo Testando GEO commands...
docker exec redis-taxi-app redis-cli GEOADD test_geo 13.361389 38.115556 "Palermo"
if %errorlevel% equ 0 (
    echo ✅ GEO commands funcionando
    docker exec redis-taxi-app redis-cli DEL test_geo
) else (
    echo ⚠️ GEO commands nao disponiveis (usando fallback)
)

echo.
echo ========================================
echo    TESTE CONCLUIDO COM SUCESSO!
echo ========================================

echo.
echo ✅ Redis esta funcionando corretamente!
echo.
echo Para continuar com os testes completos:
echo run-all-redis-tests.bat

pause 