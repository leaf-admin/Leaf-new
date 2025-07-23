@echo off
echo ========================================
echo MATANDO PROCESSO NA PORTA 3000
echo ========================================
echo.

echo Verificando processos na porta 3000...
netstat -ano | findstr :3000

echo.
echo Matando processos encontrados...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo Matando processo PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Verificando se ainda ha processos na porta 3000...
netstat -ano | findstr :3000

if %errorlevel% neq 0 (
    echo ✅ Nenhum processo encontrado na porta 3000
) else (
    echo ⚠️ Ainda ha processos na porta 3000
)

echo.
pause 