@echo off
chcp 65001 >nul
echo.
echo ========================================
echo 🔍 TESTE DE IMPORTS REDIS
echo ========================================
echo.
echo Verificando se há imports Redis restantes...
echo.

node test-redis-imports.cjs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ NENHUM IMPORT REDIS ENCONTRADO!
    echo 🎉 O app deve carregar sem problemas no dispositivo móvel.
    echo.
) else (
    echo.
    echo ❌ IMPORTS REDIS ENCONTRADOS!
    echo 🚨 Corrija os imports antes de fazer build.
    echo.
    echo Dicas para corrigir:
    echo - Remova imports diretos do @redis/client
    echo - Use a API Redis via HTTP endpoints
    echo - Verifique se há imports em arquivos de configuração
    echo.
)

pause 