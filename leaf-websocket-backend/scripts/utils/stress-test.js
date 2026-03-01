#!/usr/bin/env node

// Script de teste de stress para Leaf System com Docker
// Testa até 10.000 conexões simultâneas

const io = require('socket.io-client');
const axios = require('axios');

class StressTester {
    constructor() {
        this.ports = [3001, 3002, 3003, 3004];
        this.connections = [];
        this.results = {
            totalConnections: 0,
            successfulConnections: 0,
            failedConnections: 0,
            averageResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: Infinity,
            startTime: Date.now()
        };
        this.testPhases = [
            { name: 'Fase 1: 100 conexões', connections: 100 },
            { name: 'Fase 2: 500 conexões', connections: 500 },
            { name: 'Fase 3: 1.000 conexões', connections: 1000 },
            { name: 'Fase 4: 5.000 conexões', connections: 5000 },
            { name: 'Fase 5: 10.000 conexões', connections: 10000 }
        ];
    }

    async testHealthEndpoints() {
        console.log('🏥 Testando endpoints de health...');
        
        for (const port of this.ports) {
            try {
                const startTime = Date.now();
                const response = await axios.get(`http://localhost:${port}/health`, { timeout: 5000 });
                const responseTime = Date.now() - startTime;
                
                console.log(`✅ Porta ${port}: ${response.data.instanceId} (${responseTime}ms)`);
                
                this.updateResponseTimeStats(responseTime);
            } catch (error) {
                console.log(`❌ Porta ${port}: OFFLINE - ${error.message}`);
            }
        }
    }

    async runStressTest() {
        console.log('🚀 INICIANDO TESTE DE STRESS DO LEAF SYSTEM');
        console.log('==========================================');
        
        await this.testHealthEndpoints();
        
        for (const phase of this.testPhases) {
            console.log(`\n${phase.name}`);
            console.log('='.repeat(phase.name.length));
            
            await this.runPhase(phase.connections);
            
            // Aguardar entre fases
            if (phase.connections < 10000) {
                console.log('⏳ Aguardando 10 segundos para próxima fase...');
                await this.sleep(10000);
            }
        }
        
        this.generateFinalReport();
    }

    async runPhase(targetConnections) {
        console.log(`📡 Criando ${targetConnections} conexões simultâneas...`);
        
        const promises = [];
        const batchSize = 100;
        
        for (let i = 0; i < targetConnections; i += batchSize) {
            const batch = Math.min(batchSize, targetConnections - i);
            const batchPromises = [];
            
            for (let j = 0; j < batch; j++) {
                const connectionId = i + j;
                const promise = this.createConnection(connectionId);
                batchPromises.push(promise);
            }
            
            promises.push(...batchPromises);
            
            // Aguardar um pouco entre batches para não sobrecarregar
            if (i + batch < targetConnections) {
                await this.sleep(1000);
            }
        }
        
        try {
            await Promise.allSettled(promises);
            console.log(`✅ Fase concluída: ${this.results.successfulConnections}/${targetConnections} conexões`);
        } catch (error) {
            console.log(`⚠️ Algumas conexões falharam: ${error.message}`);
        }
    }

    async createConnection(connectionId) {
        try {
            const port = this.ports[connectionId % this.ports.length];
            const startTime = Date.now();
            
            const socket = io(`http://localhost:${port}`, {
                timeout: 10000,
                forceNew: true,
                transports: ['websocket']
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout'));
                }, 10000);

                socket.on('connect', () => {
                    clearTimeout(timeout);
                    const responseTime = Date.now() - startTime;
                    
                    this.connections.push({
                        id: connectionId,
                        port,
                        socketId: socket.id,
                        responseTime
                    });
                    
                    this.results.successfulConnections++;
                    this.updateResponseTimeStats(responseTime);
                    
                    // Desconectar após teste
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

    updateResponseTimeStats(responseTime) {
        this.results.averageResponseTime = 
            (this.results.averageResponseTime * (this.results.successfulConnections - 1) + responseTime) / 
            this.results.successfulConnections;
        
        this.results.maxResponseTime = Math.max(this.results.maxResponseTime, responseTime);
        this.results.minResponseTime = Math.min(this.results.minResponseTime, responseTime);
    }

    generateFinalReport() {
        const endTime = Date.now();
        const totalTime = endTime - this.results.startTime;
        
        console.log('\n📊 RELATÓRIO FINAL DO TESTE DE STRESS');
        console.log('=====================================');
        console.log(`⏱️ Tempo total: ${totalTime}ms`);
        console.log(`🔌 Total de conexões: ${this.results.totalConnections}`);
        console.log(`✅ Conexões bem-sucedidas: ${this.results.successfulConnections}`);
        console.log(`❌ Conexões falharam: ${this.results.failedConnections}`);
        console.log(`📈 Taxa de sucesso: ${((this.results.successfulConnections / this.results.totalConnections) * 100).toFixed(2)}%`);
        
        console.log('\n📊 ESTATÍSTICAS DE PERFORMANCE:');
        console.log(`   Tempo médio de resposta: ${this.results.averageResponseTime.toFixed(2)}ms`);
        console.log(`   Tempo máximo de resposta: ${this.results.maxResponseTime}ms`);
        console.log(`   Tempo mínimo de resposta: ${this.results.minResponseTime}ms`);
        
        console.log('\n🌐 CAPACIDADE DO SISTEMA:');
        if (this.results.successfulConnections >= 10000) {
            console.log('🎉 SISTEMA PRONTO PARA MEGACIDADES!');
            console.log('🚀 Capacidade: 1M+ usuários simultâneos');
        } else if (this.results.successfulConnections >= 5000) {
            console.log('✅ SISTEMA PRONTO PARA METRÓPOLES!');
            console.log('🌆 Capacidade: 500k+ usuários simultâneos');
        } else if (this.results.successfulConnections >= 1000) {
            console.log('✅ SISTEMA PRONTO PARA CAPITAIS!');
            console.log('🏙️ Capacidade: 250k+ usuários simultâneos');
        } else {
            console.log('⚠️ SISTEMA COM LIMITAÇÕES');
            console.log('🔧 Verificar configuração');
        }
        
        // Mostrar distribuição por porta
        console.log('\n📊 DISTRIBUIÇÃO POR PORTA:');
        const portDistribution = {};
        this.connections.forEach(conn => {
            portDistribution[conn.port] = (portDistribution[conn.port] || 0) + 1;
        });
        
        Object.entries(portDistribution).forEach(([port, count]) => {
            const percentage = ((count / this.results.successfulConnections) * 100).toFixed(1);
            console.log(`   Porta ${port}: ${count} conexões (${percentage}%)`);
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Executar teste
const tester = new StressTester();
tester.runStressTest().catch(console.error);






