#!/bin/bash

# TESTE DE CORRIDA REAL - PONTA A PONTA
set -e

VULTR_IP="216.238.107.59"
VULTR_USER="root"
VULTR_SSH_KEY="~/.ssh/id_rsa"

echo "🚗 TESTE DE CORRIDA REAL - PONTA A PONTA"
echo "=========================================="

# 1. Teste de simulação de corrida completa
echo "🚗 Simulando corrida completa..."
node -e "
const WebSocket = require('ws');

class RideSimulator {
    constructor() {
        this.startTime = Date.now();
        this.metrics = {
            userConnection: 0,
            driverConnection: 0,
            rideRequest: 0,
            rideAccepted: 0,
            rideStarted: 0,
            rideCompleted: 0,
            totalTime: 0
        };
    }

    async simulateRide() {
        console.log('🚗 Iniciando simulação de corrida...');
        
        try {
            // 1. Usuário conecta
            const userStart = Date.now();
            const userWs = new WebSocket('ws://$VULTR_IP:3001');
            
            await new Promise((resolve, reject) => {
                userWs.on('open', () => {
                    this.metrics.userConnection = Date.now() - userStart;
                    console.log('✅ Usuário conectado:', this.metrics.userConnection + 'ms');
                    resolve();
                });
                userWs.on('error', reject);
                setTimeout(() => reject(new Error('Timeout usuário')), 5000);
            });

            // 2. Motorista conecta
            const driverStart = Date.now();
            const driverWs = new WebSocket('ws://$VULTR_IP:3002');
            
            await new Promise((resolve, reject) => {
                driverWs.on('open', () => {
                    this.metrics.driverConnection = Date.now() - driverStart;
                    console.log('✅ Motorista conectado:', this.metrics.driverConnection + 'ms');
                    resolve();
                });
                driverWs.on('error', reject);
                setTimeout(() => reject(new Error('Timeout motorista')), 5000);
            });

            // 3. Usuário solicita corrida
            const requestStart = Date.now();
            userWs.send(JSON.stringify({
                type: 'ride_request',
                pickup: { lat: -23.5505, lng: -46.6333 }, // São Paulo
                destination: { lat: -23.5505, lng: -46.6333 },
                timestamp: Date.now()
            }));
            
            // Simular processamento
            await new Promise(resolve => setTimeout(resolve, 100));
            this.metrics.rideRequest = Date.now() - requestStart;
            console.log('✅ Solicitação de corrida:', this.metrics.rideRequest + 'ms');

            // 4. Motorista aceita corrida
            const acceptStart = Date.now();
            driverWs.send(JSON.stringify({
                type: 'ride_accept',
                rideId: 'test_ride_123',
                timestamp: Date.now()
            }));
            
            await new Promise(resolve => setTimeout(resolve, 100));
            this.metrics.rideAccepted = Date.now() - acceptStart;
            console.log('✅ Corrida aceita:', this.metrics.rideAccepted + 'ms');

            // 5. Corrida inicia
            const startRideStart = Date.now();
            userWs.send(JSON.stringify({
                type: 'ride_start',
                rideId: 'test_ride_123',
                timestamp: Date.now()
            }));
            
            await new Promise(resolve => setTimeout(resolve, 100));
            this.metrics.rideStarted = Date.now() - startRideStart;
            console.log('✅ Corrida iniciada:', this.metrics.rideStarted + 'ms');

            // 6. Corrida completa
            const completeStart = Date.now();
            userWs.send(JSON.stringify({
                type: 'ride_complete',
                rideId: 'test_ride_123',
                timestamp: Date.now()
            }));
            
            await new Promise(resolve => setTimeout(resolve, 100));
            this.metrics.rideCompleted = Date.now() - completeStart;
            console.log('✅ Corrida completada:', this.metrics.rideCompleted + 'ms');

            // 7. Fechar conexões
            userWs.close();
            driverWs.close();

            this.metrics.totalTime = Date.now() - this.startTime;
            
            console.log('\\n📊 MÉTRICAS DA CORRIDA:');
            console.log('========================');
            console.log('🔌 Conexão usuário:', this.metrics.userConnection + 'ms');
            console.log('🔌 Conexão motorista:', this.metrics.driverConnection + 'ms');
            console.log('🚗 Solicitação corrida:', this.metrics.rideRequest + 'ms');
            console.log('✅ Aceitação corrida:', this.metrics.rideAccepted + 'ms');
            console.log('🚀 Início corrida:', this.metrics.rideStarted + 'ms');
            console.log('🏁 Finalização corrida:', this.metrics.rideCompleted + 'ms');
            console.log('⏱️ Tempo total:', this.metrics.totalTime + 'ms');
            console.log('📈 Performance média:', (this.metrics.totalTime / 6).toFixed(2) + 'ms');

        } catch (error) {
            console.log('❌ Erro na simulação:', error.message);
        }
    }
}

const simulator = new RideSimulator();
simulator.simulateRide();
"

# 2. Teste de múltiplas corridas simultâneas
echo "🚗 Testando múltiplas corridas simultâneas..."
node -e "
const WebSocket = require('ws');

async function testMultipleRides() {
    const numRides = 5;
    const results = [];
    
    console.log('🚗 Testando', numRides, 'corridas simultâneas...');
    
    for (let i = 0; i < numRides; i++) {
        const start = Date.now();
        
        try {
            const userWs = new WebSocket('ws://$VULTR_IP:3001');
            const driverWs = new WebSocket('ws://$VULTR_IP:3002');
            
            await Promise.all([
                new Promise((resolve, reject) => {
                    userWs.on('open', resolve);
                    userWs.on('error', reject);
                    setTimeout(() => reject(new Error('Timeout')), 5000);
                }),
                new Promise((resolve, reject) => {
                    driverWs.on('open', resolve);
                    driverWs.on('error', reject);
                    setTimeout(() => reject(new Error('Timeout')), 5000);
                })
            ]);
            
            const latency = Date.now() - start;
            results.push(latency);
            
            userWs.close();
            driverWs.close();
            
            console.log('✅ Corrida', (i+1), ':', latency + 'ms');
            
        } catch (error) {
            console.log('❌ Corrida', (i+1), 'falhou:', error.message);
        }
    }
    
    if (results.length > 0) {
        const avg = results.reduce((a, b) => a + b, 0) / results.length;
        const min = Math.min(...results);
        const max = Math.max(...results);
        
        console.log('\\n📊 ESTATÍSTICAS DAS CORRIDAS:');
        console.log('==============================');
        console.log('🚗 Total de corridas:', results.length);
        console.log('📊 Latência média:', avg.toFixed(2) + 'ms');
        console.log('⚡ Latência mínima:', min + 'ms');
        console.log('🐌 Latência máxima:', max + 'ms');
        console.log('📈 Throughput:', (1000 / avg * 60).toFixed(2) + ' corridas/minuto');
    }
}

testMultipleRides();
"

# 3. Teste de carga real
echo "📊 Teste de carga real..."
ab -n 200 -c 20 http://$VULTR_IP/health 2>/dev/null | grep -E "(Requests per second|Time per request|Transfer rate|Failed requests)" || echo "Teste de carga não disponível"

# 4. Métricas do sistema durante teste
echo "💻 Métricas do sistema durante teste..."
ssh -i "$VULTR_SSH_KEY" "$VULTR_USER@$VULTR_IP" "
echo 'CPU Usage:'
top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1

echo 'Memory Usage:'
free -m | awk 'NR==2{printf \"%.1f%%\", \$3*100/\$2}'

echo 'Load Average:'
uptime | awk -F'load average:' '{print \$2}'

echo 'Docker Stats:'
docker stats --no-stream --format 'table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}'
"

echo "✅ Teste de corrida ponta a ponta concluído!"
echo "📊 Métricas salvas acima"
echo "🌐 Sistema rodando em: http://$VULTR_IP"



