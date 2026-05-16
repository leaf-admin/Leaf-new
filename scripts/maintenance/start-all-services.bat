@echo off
echo 🚀 LEAF - INICIANDO TODOS OS SERVIÇOS 🚀
echo =======================================

echo.
echo 🐳 Iniciando Redis...
docker-compose up -d redis

echo.
echo 🔌 Iniciando WebSocket Backend...
start "LEAF WebSocket Backend" cmd /k "npm run dev:backend"

echo.
echo 📊 Iniciando Dashboard...
start "LEAF Dashboard" cmd /k "npm run dev:dashboard"

echo.
echo 📱 Iniciando Mobile App (desenvolvimento)...
start "LEAF Mobile App" cmd /k "npm run dev:mobile -- --dev-client"

echo.
echo ⏳ Aguardando serviços iniciarem...
timeout /t 15 /nobreak >nul

echo.
echo 🎉 TODOS OS SERVIÇOS INICIADOS! 🎉
echo =================================
echo.
echo 🔗 URLs dos serviços:
echo.
echo 🔌 WebSocket: http://localhost:3001
echo 📊 Dashboard: http://localhost:3000
echo 🔴 Redis Commander: http://localhost:8081
echo 📱 Mobile App: Expo DevTools
echo.
echo 💰 Agora pode testar tudo! 💰
echo.

pause
