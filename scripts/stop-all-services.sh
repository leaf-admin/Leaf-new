#!/bin/bash

echo "🛑 Parando todos os serviços do Leaf App..."

# Função para parar processos por porta
stop_by_port() {
    local port=$1
    local pids=$(ss -tlnp | grep ":$port " | awk '{print $7}' | cut -d',' -f2 | cut -d'=' -f2 | sort -u)
    
    if [ ! -z "$pids" ]; then
        echo "🔄 Parando processos na porta $port (PIDs: $pids)"
        echo $pids | xargs kill -TERM 2>/dev/null
        sleep 2
        echo $pids | xargs kill -KILL 2>/dev/null
        echo "✅ Processos na porta $port parados"
    else
        echo "✅ Nenhum processo na porta $port"
    fi
}

# Parar processos específicos
echo "🔄 Parando processos Node.js..."
pkill -f "node server.js" 2>/dev/null
pkill -f "expo start" 2>/dev/null
pkill -f "yarn start" 2>/dev/null
pkill -f "npm start" 2>/dev/null
pkill -f "firebase emulators" 2>/dev/null

# Parar por portas específicas
stop_by_port 3000
stop_by_port 3001
stop_by_port 5001
stop_by_port 8081
stop_by_port 4000

# Parar Redis (opcional)
echo ""
read -p "🔄 Deseja parar o Redis também? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔄 Parando Redis..."
    docker stop redis-leaf 2>/dev/null
    echo "✅ Redis parado"
else
    echo "✅ Redis mantido rodando"
fi

echo ""
echo "🎉 Todos os serviços foram parados!"
echo ""
echo "📊 Para verificar se ainda há processos rodando:"
echo "   ps aux | grep -E '(node|expo|yarn|npm)' | grep -v grep"
echo "" 