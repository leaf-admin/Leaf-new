#!/bin/bash

echo "🔄 Reiniciando todos os serviços LEAF..."

# Parar todos os processos
echo "⏹️ Parando processos existentes..."
pkill -f "firebase emulators"
pkill -f "expo start"
pkill -f "node.*server.js"
pkill -f "npm start"
pkill -f "yarn start"

# Aguardar um pouco
sleep 2

# Verificar se o Redis está rodando
echo "🔴 Verificando Redis..."
if ! docker ps | grep -q redis-leaf; then
    echo "🚀 Iniciando Redis..."
    docker run -d --name redis-leaf -p 6379:6379 redis:7-alpine
else
    echo "✅ Redis já está rodando"
fi

# Aguardar Redis inicializar
sleep 3

# Iniciar Firebase Functions
echo "🔥 Iniciando Firebase Functions..."
cd functions
firebase emulators:start --only functions &
FIREBASE_PID=$!
cd ..

# Aguardar Firebase Functions inicializar
sleep 5

# Iniciar WebSocket Backend
echo "🌐 Iniciando WebSocket Backend..."
cd leaf-websocket-backend
node server.js &
WEBSOCKET_PID=$!
cd ..

# Aguardar WebSocket inicializar
sleep 3

# Iniciar Dashboard
echo "📊 Iniciando Dashboard..."
cd leaf-dashboard
npm start &
DASHBOARD_PID=$!
cd ..

# Aguardar Dashboard inicializar
sleep 5

# Iniciar Mobile App
echo "📱 Iniciando Mobile App..."
cd mobile-app
npx expo start --dev-client &
MOBILE_PID=$!
cd ..

echo "✅ Todos os serviços iniciados!"
echo ""
echo "📋 Status dos serviços:"
echo "🔴 Redis: http://localhost:6379"
echo "🔥 Firebase Functions: http://127.0.0.1:5001"
echo "🌐 WebSocket Backend: http://localhost:3001"
echo "📊 Dashboard: http://localhost:3000"
echo "📱 Mobile App: http://localhost:8081"
echo ""
echo "🔄 Para parar todos os serviços: pkill -f 'firebase|expo|node.*server|npm start'"
echo ""

# Função para limpeza ao sair
cleanup() {
    echo ""
    echo "🛑 Parando todos os serviços..."
    kill $FIREBASE_PID $WEBSOCKET_PID $DASHBOARD_PID $MOBILE_PID 2>/dev/null
    pkill -f "firebase emulators"
    pkill -f "expo start"
    pkill -f "node.*server.js"
    pkill -f "npm start"
    echo "✅ Serviços parados"
    exit 0
}

# Capturar Ctrl+C
trap cleanup SIGINT

# Manter script rodando
echo "⏳ Pressione Ctrl+C para parar todos os serviços"
while true; do
    sleep 1
done 