@echo off
chcp 65001 >nul
echo.
echo ========================================
echo 🚀 TESTE COMPLETO DE BUILD MOBILE
echo ========================================
echo.
echo Executando todos os testes...
echo.

echo.
echo 🔍 1. Teste de Imports Redis...
node test-redis-imports.cjs
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ TESTE DE IMPORTS REDIS FALHOU!
    echo Corrija os imports Redis antes de continuar.
    pause
    exit /b 1
)

echo.
echo ✅ Teste de Imports Redis PASSOU!
echo.

echo.
echo 🚀 2. Teste Completo de Build Mobile...
node test-mobile-build.cjs
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ TESTE DE BUILD MOBILE FALHOU!
    echo Corrija os problemas antes de fazer build.
    pause
    exit /b 1
)

echo.
echo ✅ Teste Completo de Build Mobile PASSOU!
echo.

echo.
echo ========================================
echo 🎉 TODOS OS TESTES PASSARAM!
echo ========================================
echo.
echo ✅ Nenhum import Redis encontrado
echo ✅ Configuração do Metro está correta
echo ✅ Dependências estão compatíveis
echo ✅ App deve carregar corretamente no dispositivo móvel
echo.
echo Próximos passos:
echo 1. Execute: cd mobile-app
echo 2. Execute: npx expo start
echo 3. Teste no dispositivo/emulador
echo.

pause 