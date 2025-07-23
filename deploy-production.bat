@echo off
echo 🚀 LEAF - DEPLOY PARA PRODUÇÃO 🚀
echo =================================

echo.
echo 📋 Verificando pré-requisitos...
echo.

REM Verificar se Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js não encontrado! Instale Node.js 18+
    pause
    exit /b 1
)

REM Verificar se Firebase CLI está instalado
firebase --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Firebase CLI não encontrado! Instalando...
    npm install -g firebase-tools
)

REM Verificar se Docker está instalado
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker não encontrado! Instale Docker Desktop
    pause
    exit /b 1
)

echo ✅ Pré-requisitos verificados!
echo.

echo 🔧 Instalando dependências...
echo.

REM Instalar dependências do projeto principal
call npm install

REM Instalar dependências do mobile app
cd mobile-app
call npm install
cd ..

REM Instalar dependências do web app
cd web-app
call npm install
cd ..

REM Instalar dependências das functions
cd functions
call npm install
cd ..

REM Instalar dependências do backend WebSocket
cd leaf-websocket-backend
call npm install
cd ..

echo ✅ Dependências instaladas!
echo.

echo 🔐 Configurando Firebase...
echo.

REM Login no Firebase
firebase login

REM Deploy das regras do banco de dados
firebase deploy --only database

REM Deploy das regras do Firestore
firebase deploy --only firestore

REM Deploy das regras do Storage
firebase deploy --only storage

echo ✅ Firebase configurado!
echo.

echo 🐳 Iniciando Redis com Docker...
echo.

REM Parar containers existentes
docker-compose down

REM Iniciar Redis
docker-compose up -d redis

REM Aguardar Redis estar pronto
timeout /t 10 /nobreak >nul

echo ✅ Redis iniciado!
echo.

echo 🔥 Deploy das Firebase Functions...
echo.

cd functions
call npm run deploy
cd ..

echo ✅ Functions deployadas!
echo.

echo 🌐 Build e deploy do Web App...
echo.

cd web-app
call npm run build
cd ..

REM Deploy do hosting
firebase deploy --only hosting

echo ✅ Web App deployado!
echo.

echo 📱 Build do Mobile App...
echo.

cd mobile-app

REM Build para Android
echo 🖥️ Build Android APK...
call npx eas build --platform android --profile preview --non-interactive

REM Build para iOS (se estiver no Mac)
echo 🍎 Build iOS (se disponível)...
call npx eas build --platform ios --profile preview --non-interactive

cd ..

echo ✅ Mobile App buildado!
echo.

echo 🔌 Iniciando Backend WebSocket...
echo.

cd leaf-websocket-backend
start "LEAF WebSocket Backend" cmd /k "npm start"
cd ..

echo ✅ Backend iniciado!
echo.

echo 📊 Iniciando Dashboard...
echo.

cd leaf-dashboard
start "LEAF Dashboard" cmd /k "npm start"
cd ..

echo ✅ Dashboard iniciado!
echo.

echo 🎉 DEPLOY CONCLUÍDO COM SUCESSO! 🎉
echo =================================
echo.
echo 📱 Mobile App: Builds disponíveis no EAS
echo 🌐 Web App: https://leaf-reactnative.web.app
echo 🔌 Backend: http://localhost:3001
echo 📊 Dashboard: http://localhost:3000
echo 🔴 Redis: http://localhost:8081 (Redis Commander)
echo.
echo 💰 Agora pode gastar tudo com travestis! 💰
echo.

pause 