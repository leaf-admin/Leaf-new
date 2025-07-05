@echo off
echo 🚀 Iniciando servidor LEAF WebSocket Backend...

echo 🔍 Verificando processos na porta 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
    echo 🛑 Parando processo PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo ⏳ Aguardando 2 segundos...
timeout /t 2 /nobreak >nul

echo 📦 Instalando dependências se necessário...
npm install

echo 🔧 Iniciando servidor...
node server.js

pause 