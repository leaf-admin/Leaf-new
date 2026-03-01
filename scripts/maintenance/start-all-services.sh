#!/bin/bash

echo "🚀 Iniciando todos os serviços do Leaf App..."

# Configurar variáveis de ambiente
export NODE_OPTIONS="--openssl-legacy-provider"

# Função para verificar se uma porta está em uso
check_port() {
    local port=$1
    if ss -tlnp | grep -q ":$port "; then
        echo "✅ Porta $port já está em uso"
        return 0
    else
        echo "❌ Porta $port não está em uso"
        return 1
    fi
}

# Função para iniciar serviço em background
start_service() {
    local name=$1
    local command=$2
    local port=$3
    
    echo "🔄 Iniciando $name..."
    if check_port $port; then
        echo "✅ $name já está rodando na porta $port"
    else
        eval "$command" &
        echo "✅ $name iniciado em background"
        sleep 5
    fi
}

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo "❌ Execute este script no diretório raiz do projeto"
    exit 1
fi

echo "📁 Diretório: $(pwd)"

# Iniciar Redis (se não estiver rodando)
echo "🔄 Verificando Redis..."
if ! docker ps | grep -q redis-leaf; then
    echo "🔄 Iniciando Redis..."
    docker run -d --name redis-leaf -p 6379:6379 redis:7-alpine
    echo "✅ Redis iniciado"
else
    echo "✅ Redis já está rodando"
fi

# Iniciar WebSocket Backend
start_service "WebSocket Backend" "cd leaf-websocket-backend && node server.js" 3001

# Iniciar Firebase Functions
start_service "Firebase Functions" "cd functions && firebase emulators:start --only functions" 5001

# Iniciar Web App
start_service "Web App" "cd web-app && yarn start" 3000

# Iniciar Dashboard
start_service "Dashboard" "cd leaf-dashboard && npm start" 3000

# Iniciar Mobile App (Metro Bundler)
start_service "Mobile App" "cd mobile-app && npx expo start --dev-client" 8081

echo ""
echo "🎉 Todos os serviços foram iniciados!"
echo ""
echo "📊 Status dos Serviços:"
echo "├── 🔴 WebSocket Backend: http://localhost:3001"
echo "├── 🔴 Firebase Functions: http://216.238.107.59:5001"
echo "├── 🔴 Firebase Emulator UI: http://216.238.107.59:4000"
echo "├── 🔴 Web App: http://localhost:3000"
echo "├── 🔴 Dashboard: http://localhost:3000"
echo "└── 🔴 Mobile App: http://localhost:8081"
echo ""
echo "📱 QR Code do Mobile App disponível no terminal"
echo "🔧 Para parar todos os serviços: pkill -f 'node\|expo\|yarn\|npm'"
echo "" 