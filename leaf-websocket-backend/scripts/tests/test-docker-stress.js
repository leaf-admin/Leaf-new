#!/usr/bin/env node

// Teste de Stress para Leaf System com Docker
const io = require('socket.io-client');

class DockerStressTester {
    constructor() {
        this.connections = [];
        this.results = {
            successfulConnections: 0,
            failedConnections: 0,
            averageResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: Infinity
        };
    }

    async runStressTest() {
        console.log('🚀 TESTE DE STRESS DO LEAF SYSTEM DOCKER');
        console.log('========================================');
        
        const targetConnections = 1000;
        console.log(`📡 Criando ${targetConnections} conexões simultâneas...`);
        
        const promises = [];
        for (let i = 0; i < targetConnections; i++) {
            promises.push(this.createConnection(i));
        }
        
        try {
            await Promise.allSettled(promises);
            console.log(`✅ Teste concluído: ${this.results.successfulConnections}/${targetConnections} conexões`);
            this.generateReport();
        } catch (error) {
            console.log(`⚠️ Erro: ${error.message}`);
        }
    }

    async createConnection(connectionId) {
        try {
            const startTime = Date.now();
            
            const socket = io('http://localhost:3001', {
                timeout: 10000,
                forceNew: true,
                transports: ['websocket']
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

                socket.on('connect', () => {
                    clearTimeout(timeout);
                    const responseTime = Date.now() - startTime;
                    
                    this.connections.push({ id: connectionId, responseTime });
                    this.results.successfulConnections++;
                    this.updateStats(responseTime);
                    
                    socket.disconnect();
                    resolve();
                });

                socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    this.results.failedConnections++;
                    reject(error);
                });
            });
        } catch (error) {
            this.results.failedConnections++;
            throw error;
        }
    }

    updateStats(responseTime) {
        this.results.averageResponseTime = 
            (this.results.averageResponseTime * (this.results.successfulConnections - 1) + responseTime) / 
            this.results.successfulConnections;
        
        this.results.maxResponseTime = Math.max(this.results.maxResponseTime, responseTime);
        this.results.minResponseTime = Math.min(this.results.minResponseTime, responseTime);
    }

    generateReport() {
        console.log('\n📊 RELATÓRIO FINAL:');
        console.log(`✅ Conexões bem-sucedidas: ${this.results.successfulConnections}`);
        console.log(`❌ Conexões falharam: ${this.results.failedConnections}`);
        console.log(`📈 Tempo médio: ${this.results.averageResponseTime.toFixed(2)}ms`);
        console.log(`🚀 Tempo máximo: ${this.results.maxResponseTime}ms`);
        console.log(`⚡ Tempo mínimo: ${this.results.minResponseTime}ms`);
        
        if (this.results.successfulConnections >= 1000) {
            console.log('\n🎉 SISTEMA DOCKER PRONTO PARA PRODUÇÃO!');
        }
    }
}

const tester = new DockerStressTester();
tester.runStressTest().catch(console.error);
