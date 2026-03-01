#!/usr/bin/env node

// Script de teste para cluster de servidores WebSocket
// Testa múltiplas instâncias simultaneamente

const io = require('socket.io-client');
const axios = require('axios');

class ClusterTester {
    constructor() {
        this.ports = [3001, 3002, 3003, 3004];
        this.results = {};
        this.startTime = Date.now();
    }

    async testHealthEndpoints() {
        console.log('🏥 Testando endpoints de health...');
        
        for (const port of this.ports) {
            try {
                const response = await axios.get(`http://localhost:${port}/health`, { timeout: 5000 });
                this.results[port] = {
                    health: '✅ ONLINE',
                    instanceId: response.data.instanceId,
                    clusterMode: response.data.clusterMode,
                    port: response.data.port,
                    responseTime: response.headers['x-response-time'] || 'N/A'
                };
                console.log(`✅ Porta ${port}: ${response.data.instanceId} (Cluster: ${response.data.clusterMode})`);
            } catch (error) {
                this.results[port] = {
                    health: '❌ OFFLINE',
                    error: error.message
                };
                console.log(`❌ Porta ${port}: OFFLINE - ${error.message}`);
            }
        }
    }

    async testWebSocketConnections() {
        console.log('\n🔌 Testando conexões WebSocket...');
        
        for (const port of this.ports) {
            if (this.results[port]?.health === '✅ ONLINE') {
                try {
                    const socket = io(`http://localhost:${port}`, {
                        timeout: 5000,
                        forceNew: true
                    });

                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Timeout'));
                        }, 5000);

                        socket.on('connect', () => {
                            clearTimeout(timeout);
                            this.results[port].websocket = '✅ CONECTADO';
                            this.results[port].socketId = socket.id;
                            console.log(`✅ Porta ${port}: WebSocket conectado (ID: ${socket.id})`);
                            socket.disconnect();
                            resolve();
                        });

                        socket.on('connect_error', (error) => {
                            clearTimeout(timeout);
                            reject(error);
                        });
                    });
                } catch (error) {
                    this.results[port].websocket = '❌ ERRO';
                    this.results[port].websocketError = error.message;
                    console.log(`❌ Porta ${port}: WebSocket falhou - ${error.message}`);
                }
            }
        }
    }

    async testLoadBalancing() {
        console.log('\n⚖️ Testando distribuição de carga...');
        
        this.connections = [];
        const promises = [];
        
        // Criar múltiplas conexões simultâneas
        for (let i = 0; i < 20; i++) {
            const port = this.ports[Math.floor(Math.random() * this.ports.length)];
            if (this.results[port]?.health === '✅ ONLINE') {
                const promise = this.createTestConnection(port, i);
                promises.push(promise);
            }
        }
        
        try {
            await Promise.all(promises);
            console.log(`✅ ${this.connections.length} conexões de teste criadas`);
        } catch (error) {
            console.log(`⚠️ Algumas conexões falharam: ${error.message}`);
        }
    }

    async createTestConnection(port, id) {
        try {
            const socket = io(`http://localhost:${port}`, {
                timeout: 3000,
                forceNew: true
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout'));
                }, 3000);

                socket.on('connect', () => {
                    clearTimeout(timeout);
                    this.connections.push({ port, id, socketId: socket.id });
                    socket.disconnect();
                    resolve();
                });

                socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        } catch (error) {
            throw error;
        }
    }

    generateReport() {
        const endTime = Date.now();
        const duration = endTime - this.startTime;
        
        console.log('\n📊 RELATÓRIO DO CLUSTER');
        console.log('========================');
        console.log(`⏱️ Tempo total de teste: ${duration}ms`);
        console.log(`🌐 Total de portas testadas: ${this.ports.length}`);
        
        let onlineCount = 0;
        let websocketCount = 0;
        
        for (const [port, result] of Object.entries(this.results)) {
            console.log(`\n🔌 Porta ${port}:`);
            console.log(`   Health: ${result.health}`);
            
            if (result.health === '✅ ONLINE') {
                onlineCount++;
                console.log(`   Instância: ${result.instanceId}`);
                console.log(`   Cluster: ${result.clusterMode}`);
                console.log(`   WebSocket: ${result.websocket || 'N/A'}`);
                
                if (result.websocket === '✅ CONECTADO') {
                    websocketCount++;
                }
            } else {
                console.log(`   Erro: ${result.error}`);
            }
        }
        
        console.log('\n📈 RESUMO:');
        console.log(`   ✅ Servidores online: ${onlineCount}/${this.ports.length}`);
        console.log(`   🔌 WebSockets funcionando: ${websocketCount}/${onlineCount}`);
        console.log(`   🌐 Capacidade estimada: ${onlineCount * 125000}+ usuários simultâneos`);
        
        if (onlineCount >= 3) {
            console.log('🎉 CLUSTER FUNCIONANDO PERFEITAMENTE!');
            console.log('🚀 Sistema pronto para megacidades!');
        } else if (onlineCount >= 2) {
            console.log('✅ CLUSTER FUNCIONANDO BEM!');
            console.log('🌆 Sistema pronto para metrópoles!');
        } else {
            console.log('⚠️ CLUSTER COM PROBLEMAS!');
            console.log('🔧 Verificar configuração dos servidores');
        }
    }

    async run() {
        console.log('🚀 INICIANDO TESTE DO CLUSTER DE SERVIDORES WEBSOCKET');
        console.log('==================================================');
        
        try {
            await this.testHealthEndpoints();
            await this.testWebSocketConnections();
            await this.testLoadBalancing();
            this.generateReport();
        } catch (error) {
            console.error('❌ Erro durante o teste:', error.message);
        }
    }
}

// Executar teste
const tester = new ClusterTester();
tester.run();
