#!/bin/bash

# TESTE COMPLETO DE PERFORMANCE - VULTR
set -e

VULTR_IP="216.238.107.59"
VULTR_USER="root"
VULTR_SSH_KEY="~/.ssh/id_rsa"

echo "🧪 TESTE COMPLETO DE PERFORMANCE - VULTR"
echo "========================================="

# 1. Teste de conectividade básica
echo "🌐 Testando conectividade básica..."
ping -c 3 $VULTR_IP

# 2. Teste de latência de rede
echo "⏱️ Testando latência de rede..."
echo "Latência para Vultr: $(ping -c 5 $VULTR_IP | tail -1 | awk '{print $4}' | cut -d'/' -f2)ms"

# 3. Teste de endpoints HTTP
echo "🔌 Testando endpoints HTTP..."
echo "Load Balancer: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP/health)"
echo "WebSocket 1: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP:3001/health)"
echo "WebSocket 2: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP:3002/health)"
echo "WebSocket 3: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP:3003/health)"
echo "WebSocket 4: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP:3004/health)"

# 4. Teste de WebSocket em tempo real
echo "🔌 Testando WebSocket em tempo real..."
node -e "
const WebSocket = require('ws');

async function testWebSocket(port) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://$VULTR_IP:' + port);
        
        ws.on('open', () => {
            const latency = Date.now() - start;
            ws.close();
            resolve(latency);
        });
        
        ws.on('error', reject);
        
        setTimeout(() => reject(new Error('Timeout')), 5000);
    });
}

async function runTests() {
    try {
        const ports = [3001, 3002, 3003, 3004];
        for (const port of ports) {
            try {
                const latency = await testWebSocket(port);
                console.log('WebSocket ' + port + ': ' + latency + 'ms');
            } catch (err) {
                console.log('WebSocket ' + port + ': ERRO - ' + err.message);
            }
        }
    } catch (err) {
        console.log('Erro nos testes:', err.message);
    }
}

runTests();
"

# 5. Teste de carga HTTP
echo "📊 Teste de carga HTTP..."
ab -n 100 -c 10 http://$VULTR_IP/health 2>/dev/null | grep -E "(Requests per second|Time per request|Transfer rate)" || echo "Apache Bench não disponível"

# 6. Teste de monitoramento
echo "📈 Testando monitoramento..."
echo "Prometheus: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP:9090/-/healthy)"
echo "Grafana: $(curl -s -w "%{time_total}s" -o /dev/null http://$VULTR_IP:3000/api/health)"

# 7. Status dos containers
echo "🐳 Status dos containers..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "cd ~/leaf-system && docker-compose -f docker-compose-vultr-8gb.yml ps"

# 8. Métricas do sistema
echo "💻 Métricas do sistema Vultr..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "
echo 'CPU Usage:'
top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1

echo 'Memory Usage:'
free -m | awk 'NR==2{printf \"%.1f%%\", \$3*100/\$2}'

echo 'Disk Usage:'
df -h / | awk 'NR==2{print \$5}'

echo 'Load Average:'
uptime | awk -F'load average:' '{print \$2}'
"

# 9. Teste de Redis
echo "🗄️ Testando Redis..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "
cd ~/leaf-system
docker exec leaf-redis-master redis-cli ping
docker exec leaf-redis-master redis-cli info memory | grep used_memory_human
"

# 10. Teste de WebSocket com múltiplas conexões
echo "🔌 Teste de WebSocket com múltiplas conexões..."
node -e "
const WebSocket = require('ws');

async function testMultipleConnections() {
    const connections = 10;
    const port = 3001;
    const start = Date.now();
    
    const promises = [];
    for (let i = 0; i < connections; i++) {
        promises.push(new Promise((resolve, reject) => {
            const ws = new WebSocket('ws://$VULTR_IP:' + port);
            ws.on('open', () => resolve(Date.now() - start));
            ws.on('error', reject);
            setTimeout(() => reject(new Error('Timeout')), 5000);
        }));
    }
    
    try {
        const latencies = await Promise.all(promises);
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const min = Math.min(...latencies);
        const max = Math.max(...latencies);
        
        console.log('Múltiplas conexões WebSocket:');
        console.log('  Média: ' + avg.toFixed(2) + 'ms');
        console.log('  Mínima: ' + min + 'ms');
        console.log('  Máxima: ' + max + 'ms');
        console.log('  Total de conexões: ' + connections);
    } catch (err) {
        console.log('Erro no teste múltiplo:', err.message);
    }
}

testMultipleConnections();
"

echo "✅ Testes de performance concluídos!"
echo "📊 Resultados salvos acima"
echo "🌐 Sistema rodando em: http://$VULTR_IP"



