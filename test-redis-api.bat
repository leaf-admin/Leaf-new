@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    LEAF TESTE API REDIS
echo    (Estrutura Híbrida sem Duplicação)
echo ========================================
echo.
echo Este script testa a estrutura correta:
echo 1. ✅ Localizações salvas apenas no Redis
echo 2. ✅ API REST para buscar motoristas
echo 3. ✅ App mobile acessa via API
echo 4. ✅ Sem duplicação de dados
echo.
echo ESTRUTURA: Redis (dados) + API (acesso)
echo.
echo ========================================
echo.

echo Verificando se o backend está rodando na porta 3001...
netstat -an | findstr ":3001" >nul
if %errorlevel% equ 0 (
    echo ✅ Backend está rodando na porta 3001!
    echo.
    echo ✅ Backend detectado! Iniciando teste da API Redis...
    echo.
) else (
    echo ❌ Backend não está rodando na porta 3001!
    echo.
    echo ⚠️  Inicie o backend primeiro com: cd leaf-websocket-backend && npm start
    echo.
    pause
    exit /b 1
)

echo Executando teste da API Redis...
node tests/test-redis-api.cjs

echo.
echo ========================================
echo    TESTE API REDIS CONCLUÍDO
echo ========================================
echo.
pause 