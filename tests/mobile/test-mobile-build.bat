@echo off
chcp 65001 >nul
echo.
echo ========================================
echo 🚀 TESTE DE BUILD MOBILE
echo ========================================
echo.
echo Verificando se o app vai carregar corretamente...
echo.

node test-mobile-build.cjs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ TESTE PASSOU! App deve carregar corretamente no dispositivo móvel.
    echo.
    echo Próximos passos:
    echo 1. Execute: cd mobile-app
    echo 2. Execute: npx expo start
    echo 3. Teste no dispositivo/emulador
    echo.
) else (
    echo.
    echo ❌ TESTE FALHOU! Corrija os problemas antes de fazer build.
    echo.
    echo Dicas:
    echo - Verifique se há imports de módulos Node.js incompatíveis
    echo - Confirme se o metro.config.js está correto
    echo - Verifique se não há dependências Redis no package.json
    echo.
)

pause 