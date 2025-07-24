@echo off
echo ========================================
echo INICIANDO LEAF DASHBOARD
echo ========================================
echo.

echo Verificando se as dependencias estao instaladas...
if not exist node_modules (
    echo Dependencias nao encontradas. Instalando...
    call npm install
    echo.
)

echo Verificando TypeScript...
call npx tsc --noEmit

echo.
echo Iniciando servidor de desenvolvimento...
echo O dashboard estara disponivel em: http://localhost:3000
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

call npm start

pause 
echo ========================================
echo INICIANDO LEAF DASHBOARD
echo ========================================
echo.

echo Verificando se as dependencias estao instaladas...
if not exist node_modules (
    echo Dependencias nao encontradas. Instalando...
    call npm install
    echo.
)

echo Verificando TypeScript...
call npx tsc --noEmit

echo.
echo Iniciando servidor de desenvolvimento...
echo O dashboard estara disponivel em: http://localhost:3000
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

call npm start

pause 
echo ========================================
echo INICIANDO LEAF DASHBOARD
echo ========================================
echo.

echo Verificando se as dependencias estao instaladas...
if not exist node_modules (
    echo Dependencias nao encontradas. Instalando...
    call npm install
    echo.
)

echo Verificando TypeScript...
call npx tsc --noEmit

echo.
echo Iniciando servidor de desenvolvimento...
echo O dashboard estara disponivel em: http://localhost:3000
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.

call npm start

pause 