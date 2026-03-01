#!/bin/bash

# Script para iniciar cluster de servidores WebSocket
# Suporte para megacidades (500k+ usuários simultâneos)

echo "🚀 INICIANDO CLUSTER DE SERVIDORES WEBSOCKET PARA MEGACIDADES"

# Parar servidores existentes
echo "🛑 Parando servidores existentes..."
pkill -f "node server.js"
sleep 3

# Configurações do cluster
REDIS_URL="redis://localhost:6379"
PORTS=(3001 3002 3003 3004)
WEIGHTS=(3 2 2 1)

# Função para iniciar servidor
start_server() {
    local port=$1
    local weight=$2
    local instance_id=$3
    
    echo "🚀 Iniciando servidor na porta $port (peso: $weight, instância: $instance_id)"
    
    # Configurar variáveis de ambiente específicas
    export PORT=$port
    export INSTANCE_ID=$instance_id
    export REDIS_URL=$REDIS_URL
    export CLUSTER_MODE=true
    
    # Iniciar servidor em background
    nohup node server.js > server_$port.log 2>&1 &
    local pid=$!
    
    # Aguardar inicialização
    sleep 5
    
    # Verificar se está funcionando
    if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
        echo "✅ Servidor na porta $port iniciado com sucesso (PID: $pid)"
        echo "$port:$pid" >> cluster.pids
    else
        echo "❌ Falha ao iniciar servidor na porta $port"
        return 1
    fi
}

# Limpar arquivo de PIDs
rm -f cluster.pids

# Iniciar servidores
echo "📡 Iniciando cluster de servidores..."
for i in "${!PORTS[@]}"; do
    port=${PORTS[$i]}
    weight=${WEIGHTS[$i]}
    instance_id="instance_$((i+1))"
    
    if start_server $port $weight $instance_id; then
        echo "✅ Instância $instance_id iniciada na porta $port"
    else
        echo "❌ Falha na instância $instance_id"
        exit 1
    fi
done

# Aguardar todos os servidores estarem prontos
echo "⏳ Aguardando todos os servidores estarem prontos..."
sleep 10

# Verificar status do cluster
echo "🔍 Verificando status do cluster..."
echo "=================================="

for port in "${PORTS[@]}"; do
    if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
        echo "✅ Porta $port: ONLINE"
    else
        echo "❌ Porta $port: OFFLINE"
    fi
done

echo "=================================="

# Mostrar estatísticas do cluster
echo "📊 ESTATÍSTICAS DO CLUSTER:"
echo "   - Total de servidores: ${#PORTS[@]}"
echo "   - Portas ativas: ${PORTS[*]}"
echo "   - Pesos: ${WEIGHTS[*]}"
echo "   - Capacidade estimada: 500k+ usuários simultâneos"

# Mostrar PIDs dos servidores
echo ""
echo "🆔 PIDs dos servidores:"
if [ -f cluster.pids ]; then
    cat cluster.pids
else
    echo "❌ Nenhum PID encontrado"
fi

echo ""
echo "🎉 CLUSTER INICIADO COM SUCESSO!"
echo "🌐 Acesse: http://localhost:3001/health"
echo "📊 Status: http://localhost:3001/stats"
echo "🔄 Para parar: ./stop-cluster.sh"






