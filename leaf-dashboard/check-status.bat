@echo off
echo ========================================
echo VERIFICACAO DE STATUS - LEAF DASHBOARD
echo ========================================
echo.

echo 1. Verificando versao do Node.js...
node --version
if %errorlevel% neq 0 (
    echo ERRO: Node.js nao encontrado!
    echo Instale o Node.js em: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo 2. Verificando versao do npm...
npm --version

echo.
echo 3. Verificando dependencias instaladas...
if exist node_modules (
    echo ✅ node_modules encontrado
    call npm list --depth=0
) else (
    echo ❌ node_modules nao encontrado
    echo Execute: npm install
)

echo.
echo 4. Verificando TypeScript...
call npx tsc --noEmit
if %errorlevel% equ 0 (
    echo ✅ TypeScript OK
) else (
    echo ❌ Erros no TypeScript
)

echo.
echo 5. Verificando porta 3000...
netstat -ano | findstr :3000
if %errorlevel% equ 0 (
    echo ⚠️  Porta 3000 em uso
) else (
    echo ✅ Porta 3000 livre
)

echo.
echo ========================================
echo VERIFICACAO CONCLUIDA
echo ========================================
echo.
echo Para iniciar o dashboard: start-dashboard.bat
echo Para corrigir problemas: fix-dashboard.bat
echo.
pause 
echo ========================================
echo VERIFICACAO DE STATUS - LEAF DASHBOARD
echo ========================================
echo.

echo 1. Verificando versao do Node.js...
node --version
if %errorlevel% neq 0 (
    echo ERRO: Node.js nao encontrado!
    echo Instale o Node.js em: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo 2. Verificando versao do npm...
npm --version

echo.
echo 3. Verificando dependencias instaladas...
if exist node_modules (
    echo ✅ node_modules encontrado
    call npm list --depth=0
) else (
    echo ❌ node_modules nao encontrado
    echo Execute: npm install
)

echo.
echo 4. Verificando TypeScript...
call npx tsc --noEmit
if %errorlevel% equ 0 (
    echo ✅ TypeScript OK
) else (
    echo ❌ Erros no TypeScript
)

echo.
echo 5. Verificando porta 3000...
netstat -ano | findstr :3000
if %errorlevel% equ 0 (
    echo ⚠️  Porta 3000 em uso
) else (
    echo ✅ Porta 3000 livre
)

echo.
echo ========================================
echo VERIFICACAO CONCLUIDA
echo ========================================
echo.
echo Para iniciar o dashboard: start-dashboard.bat
echo Para corrigir problemas: fix-dashboard.bat
echo.
pause 
echo ========================================
echo VERIFICACAO DE STATUS - LEAF DASHBOARD
echo ========================================
echo.

echo 1. Verificando versao do Node.js...
node --version
if %errorlevel% neq 0 (
    echo ERRO: Node.js nao encontrado!
    echo Instale o Node.js em: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo 2. Verificando versao do npm...
npm --version

echo.
echo 3. Verificando dependencias instaladas...
if exist node_modules (
    echo ✅ node_modules encontrado
    call npm list --depth=0
) else (
    echo ❌ node_modules nao encontrado
    echo Execute: npm install
)

echo.
echo 4. Verificando TypeScript...
call npx tsc --noEmit
if %errorlevel% equ 0 (
    echo ✅ TypeScript OK
) else (
    echo ❌ Erros no TypeScript
)

echo.
echo 5. Verificando porta 3000...
netstat -ano | findstr :3000
if %errorlevel% equ 0 (
    echo ⚠️  Porta 3000 em uso
) else (
    echo ✅ Porta 3000 livre
)

echo.
echo ========================================
echo VERIFICACAO CONCLUIDA
echo ========================================
echo.
echo Para iniciar o dashboard: start-dashboard.bat
echo Para corrigir problemas: fix-dashboard.bat
echo.
pause 