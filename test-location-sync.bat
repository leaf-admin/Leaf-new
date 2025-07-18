@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    LEAF TESTE SINCRONIZAÇÃO LOCALIZAÇÃO
echo    (Verificação Real do Sistema)
echo ========================================
echo.
echo Este script testa especificamente:
echo 1. ✅ Se o backend processa updateLocation
echo 2. ✅ Se as localizações são salvas no Firebase
echo 3. ✅ Se o cálculo de distância funciona
echo 4. ✅ Se a priorização por distância funciona
echo.
echo IMPACTO REAL: Motoristas aparecem no mapa?
echo.
echo ========================================
echo.

echo Verificando se o backend está rodando na porta 3001...
netstat -an | findstr ":3001" >nul
if %errorlevel% equ 0 (
    echo ✅ Backend está rodando na porta 3001!
    echo.
    echo ✅ Backend detectado! Iniciando teste de sincronização...
    echo.
) else (
    echo ❌ Backend não está rodando na porta 3001!
    echo.
    echo ⚠️  Inicie o backend primeiro com: cd leaf-websocket-backend && npm start
    echo.
    pause
    exit /b 1
)

echo Executando teste de sincronização de localização...
node tests/test-location-sync-real.cjs

echo.
echo ========================================
echo    TESTE DE SINCRONIZAÇÃO CONCLUÍDO
echo ========================================
echo.
pause 