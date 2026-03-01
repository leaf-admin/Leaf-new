@echo off
echo 🚀 LEAF - INICIANDO TODOS OS SERVIÇOS 🚀
echo =======================================

echo.
echo 🐳 Iniciando Redis...
docker-compose up -d redis

echo.
echo 🔌 Iniciando WebSocket Backend...
cd leaf-websocket-backend
start "LEAF WebSocket Backend" cmd /k "npm start"
cd ..

echo.
echo 📊 Iniciando Dashboard...
cd leaf-dashboard
start "LEAF Dashboard" cmd /k "npm start"
cd ..

echo.
echo 🌐 Iniciando Web App (desenvolvimento)...
cd web-app
start "LEAF Web App" cmd /k "npm start"
cd ..

echo.
echo 📱 Iniciando Mobile App (desenvolvimento)...
cd mobile-app
start "LEAF Mobile App" cmd /k "npm start"
cd ..

echo.
echo ⏳ Aguardando serviços iniciarem...
timeout /t 15 /nobreak >nul

echo.
echo 🎉 TODOS OS SERVIÇOS INICIADOS! 🎉
echo =================================
echo.
echo 🔗 URLs dos serviços:
echo.
echo 🌐 Web App: http://localhost:3000
echo 🔌 WebSocket: http://localhost:3001
echo 📊 Dashboard: http://localhost:3000
echo 🔴 Redis Commander: http://localhost:8081
echo 📱 Mobile App: Expo DevTools
echo.
echo 💰 Agora pode testar tudo! 💰
echo.

pause 