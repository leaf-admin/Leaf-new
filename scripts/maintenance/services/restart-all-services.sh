#!/bin/bash

echo "🔄 Reiniciando todos os serviços LEAF..."

# Parar todos os processos
echo "⏹️ Parando processos existentes..."
pkill -f "firebase emulators"
pkill -f "expo start"
pkill -f "node.*server.js"
pkill -f "npm run dev:"
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

# Iniciar WebSocket Backend
echo "🌐 Iniciando WebSocket Backend..."
npm run dev:backend &
WEBSOCKET_PID=$!

# Aguardar WebSocket inicializar
sleep 3

# Iniciar Dashboard
echo "📊 Iniciando Dashboard..."
npm run dev:dashboard &
DASHBOARD_PID=$!

# Aguardar Dashboard inicializar
sleep 5

# Iniciar Mobile App
echo "📱 Iniciando Mobile App..."
npm run dev:mobile -- --dev-client &
MOBILE_PID=$!

echo "✅ Todos os serviços iniciados!"
echo ""
echo "📋 Status dos serviços:"
echo "🔴 Redis: http://localhost:6379"
echo "🌐 WebSocket Backend: http://localhost:3001"
echo "📊 Dashboard: http://localhost:3000"
echo "📱 Mobile App: http://localhost:8081"
echo ""
echo "🔄 Para parar todos os serviços: pkill -f 'expo|node.*server|npm run dev:'"
echo ""

# Função para limpeza ao sair
cleanup() {
    echo ""
    echo "🛑 Parando todos os serviços..."
    kill $WEBSOCKET_PID $DASHBOARD_PID $MOBILE_PID 2>/dev/null
    pkill -f "expo start"
    pkill -f "node.*server.js"
    pkill -f "npm run dev:"
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
