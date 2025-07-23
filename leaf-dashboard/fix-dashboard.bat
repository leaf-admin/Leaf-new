@echo off
echo ========================================
echo CORRECAO DO LEAF DASHBOARD
echo ========================================
echo.

echo 1. Limpando cache do npm...
call npm cache clean --force

echo.
echo 2. Removendo node_modules...
if exist node_modules (
    rmdir /s /q node_modules
    echo node_modules removido.
) else (
    echo node_modules nao encontrado.
)

echo.
echo 3. Removendo package-lock.json...
if exist package-lock.json (
    del package-lock.json
    echo package-lock.json removido.
) else (
    echo package-lock.json nao encontrado.
)

echo.
echo 4. Reinstalando dependencias...
call npm install

echo.
echo 5. Verificando TypeScript...
call npx tsc --noEmit

echo.
echo 6. Verificando se o servidor inicia...
echo Para iniciar o servidor, execute: npm start

echo.
echo ========================================
echo CORRECAO CONCLUIDA
echo ========================================
echo.
pause 
echo ========================================
echo CORRECAO DO LEAF DASHBOARD
echo ========================================
echo.

echo 1. Limpando cache do npm...
call npm cache clean --force

echo.
echo 2. Removendo node_modules...
if exist node_modules (
    rmdir /s /q node_modules
    echo node_modules removido.
) else (
    echo node_modules nao encontrado.
)

echo.
echo 3. Removendo package-lock.json...
if exist package-lock.json (
    del package-lock.json
    echo package-lock.json removido.
) else (
    echo package-lock.json nao encontrado.
)

echo.
echo 4. Reinstalando dependencias...
call npm install

echo.
echo 5. Verificando TypeScript...
call npx tsc --noEmit

echo.
echo 6. Verificando se o servidor inicia...
echo Para iniciar o servidor, execute: npm start

echo.
echo ========================================
echo CORRECAO CONCLUIDA
echo ========================================
echo.
pause 
echo ========================================
echo CORRECAO DO LEAF DASHBOARD
echo ========================================
echo.

echo 1. Limpando cache do npm...
call npm cache clean --force

echo.
echo 2. Removendo node_modules...
if exist node_modules (
    rmdir /s /q node_modules
    echo node_modules removido.
) else (
    echo node_modules nao encontrado.
)

echo.
echo 3. Removendo package-lock.json...
if exist package-lock.json (
    del package-lock.json
    echo package-lock.json removido.
) else (
    echo package-lock.json nao encontrado.
)

echo.
echo 4. Reinstalando dependencias...
call npm install

echo.
echo 5. Verificando TypeScript...
call npx tsc --noEmit

echo.
echo 6. Verificando se o servidor inicia...
echo Para iniciar o servidor, execute: npm start

echo.
echo ========================================
echo CORRECAO CONCLUIDA
echo ========================================
echo.
pause 