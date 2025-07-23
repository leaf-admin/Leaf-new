Write-Host "🚀 LEAF - DEPLOY PARA PRODUÇÃO 🚀" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

Write-Host ""
Write-Host "📋 Verificando pré-requisitos..." -ForegroundColor Yellow

# Verificar Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js não encontrado!" -ForegroundColor Red
    exit 1
}

# Verificar Firebase CLI
try {
    $firebaseVersion = firebase --version
    Write-Host "✅ Firebase CLI: $firebaseVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Firebase CLI não encontrado!" -ForegroundColor Red
    exit 1
}

# Verificar Docker
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker não encontrado!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🔧 Instalando dependências..." -ForegroundColor Yellow

# Instalar dependências principais
Write-Host "📦 Instalando dependências principais..." -ForegroundColor Cyan
npm install --ignore-scripts

# Instalar dependências do mobile app
Write-Host "📱 Instalando dependências do mobile app..." -ForegroundColor Cyan
Set-Location mobile-app
npm install --ignore-scripts
Set-Location ..

# Instalar dependências do web app
Write-Host "🌐 Instalando dependências do web app..." -ForegroundColor Cyan
Set-Location web-app
npm install --ignore-scripts
Set-Location ..

# Instalar dependências das functions
Write-Host "🔥 Instalando dependências das functions..." -ForegroundColor Cyan
Set-Location functions
npm install --ignore-scripts
Set-Location ..

# Instalar dependências do backend WebSocket
Write-Host "🔌 Instalando dependências do WebSocket backend..." -ForegroundColor Cyan
Set-Location leaf-websocket-backend
npm install --ignore-scripts
Set-Location ..

Write-Host ""
Write-Host "✅ Dependências instaladas!" -ForegroundColor Green

Write-Host ""
Write-Host "🐳 Iniciando Redis..." -ForegroundColor Yellow
docker-compose up -d redis

Write-Host ""
Write-Host "⏳ Aguardando Redis iniciar..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host ""
Write-Host "🔥 Deploy das Firebase Functions..." -ForegroundColor Yellow
Set-Location functions
npm run deploy
Set-Location ..

Write-Host ""
Write-Host "🌐 Build e deploy do Web App..." -ForegroundColor Yellow
Set-Location web-app
npm run build
Set-Location ..

firebase deploy --only hosting

Write-Host ""
Write-Host "📱 Build do Mobile App..." -ForegroundColor Yellow
Set-Location mobile-app

Write-Host "🖥️ Build Android APK..." -ForegroundColor Cyan
npx eas build --platform android --profile preview --non-interactive

Set-Location ..

Write-Host ""
Write-Host "🔌 Iniciando Backend WebSocket..." -ForegroundColor Yellow
Set-Location leaf-websocket-backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm start"
Set-Location ..

Write-Host ""
Write-Host "📊 Iniciando Dashboard..." -ForegroundColor Yellow
Set-Location leaf-dashboard
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm start"
Set-Location ..

Write-Host ""
Write-Host "🎉 DEPLOY CONCLUÍDO COM SUCESSO! 🎉" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host ""
Write-Host "📱 Mobile App: Builds disponíveis no EAS" -ForegroundColor Cyan
Write-Host "🌐 Web App: https://leaf-reactnative.web.app" -ForegroundColor Cyan
Write-Host "🔌 Backend: http://localhost:3001" -ForegroundColor Cyan
Write-Host "📊 Dashboard: http://localhost:3000" -ForegroundColor Cyan
Write-Host "🔴 Redis: http://localhost:8081 (Redis Commander)" -ForegroundColor Cyan
Write-Host ""
Write-Host "💰 Agora pode gastar tudo com travestis! 💰" -ForegroundColor Magenta
Write-Host ""

Read-Host "Pressione Enter para continuar..." 