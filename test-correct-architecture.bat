@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    LEAF TESTE ARQUITETURA CORRETA
echo    (Estrutura de Três Camadas)
echo ========================================
echo.
echo Este script testa a estrutura planejada:
echo 1. 🔴 Redis (Tempo Real)
echo    - Localização em tempo real
echo    - Status online/offline
echo    - Busca de motoristas próximos
echo.
echo 2. 🟡 Realtime Database (Backup)
echo    - Sincronização para compatibilidade
echo    - Fallback quando Redis não está disponível
echo.
echo 3. 🟢 Firestore (Persistência)
echo    - Viagens finalizadas
echo    - Cancelamentos
echo    - Dados históricos
echo.
echo ========================================
echo.

echo Verificando se o backend está rodando na porta 3001...
netstat -an | findstr ":3001" >nul
if %errorlevel% equ 0 (
    echo ✅ Backend está rodando na porta 3001!
    echo.
    echo ✅ Backend detectado! Iniciando teste da arquitetura correta...
    echo.
) else (
    echo ❌ Backend não está rodando na porta 3001!
    echo.
    echo ⚠️  Inicie o backend primeiro com: cd leaf-websocket-backend && npm start
    echo.
    pause
    exit /b 1
)

echo Executando teste da arquitetura correta...
node tests/test-correct-architecture.cjs

echo.
echo ========================================
echo    TESTE ARQUITETURA CONCLUÍDO
echo ========================================
echo.
pause 