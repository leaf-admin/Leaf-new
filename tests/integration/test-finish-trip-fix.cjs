const { io } = require('socket.io-client');

class FinishTripFixTest {
    constructor() {
        this.testId = `finish_trip_fix_${Date.now()}`;
        this.ws = null;
        this.connected = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async connectWebSocket() {
        this.log('=== CONECTANDO AO BACKEND ===', 'WEBSOCKET');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = io('http://localhost:3001', {
                    transports: ['websocket'],
                    timeout: 10000
                });
                
                this.ws.on('connect', () => {
                    this.connected = true;
                    this.log('✅ Conectado ao backend', 'SUCCESS');
                    resolve(true);
                });
                
                this.ws.on('connect_error', (error) => {
                    this.log(`❌ Erro na conexão: ${error.message}`, 'ERROR');
                    reject(error);
                });
                
                setTimeout(() => {
                    if (!this.connected) {
                        reject(new Error('Timeout na conexão WebSocket'));
                    }
                }, 10000);
                
            } catch (error) {
                reject(error);
            }
        });
    }

    async sendMessage(event, data) {
        if (!this.connected) {
            throw new Error('WebSocket não conectado');
        }
        
        this.ws.emit(event, data);
        this.log(`📤 Enviando: ${event}`, 'WEBSOCKET');
    }

    async testFinishTripWithMinimalData() {
        this.log('=== TESTE 1: FINISH TRIP COM DADOS MÍNIMOS ===', 'TEST');
        
        try {
            // 1. Autenticar motorista
            const driverId = `${this.testId}_driver_minimal`;
            this.log('1. Autenticando motorista...');
            await this.sendMessage('authenticate', { uid: driverId });
            await this.wait(1000);
            
            // 2. Enviar finishTrip com dados mínimos
            this.log('2. Enviando finishTrip com dados mínimos...');
            const minimalData = {
                tripId: `${this.testId}_trip_minimal`,
                distance: 1500,
                fare: 25.5
            };
            
            await this.sendMessage('finishTrip', minimalData);
            
            // 3. Aguardar resposta
            await new Promise((resolve, reject) => {
                this.ws.once('tripFinished', (data) => {
                    if (data.success) {
                        this.log('✅ FinishTrip com dados mínimos: SUCESSO', 'SUCCESS');
                        this.log(`   Trip ID: ${data.tripId}`, 'INFO');
                        resolve();
                    } else {
                        this.log(`❌ FinishTrip com dados mínimos: FALHOU - ${data.error}`, 'ERROR');
                        reject(new Error(data.error));
                    }
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout aguardando resposta do finishTrip'));
                }, 10000);
            });
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erro no teste 1: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testFinishTripWithCompleteData() {
        this.log('=== TESTE 2: FINISH TRIP COM DADOS COMPLETOS ===', 'TEST');
        
        try {
            // 1. Autenticar motorista
            const driverId = `${this.testId}_driver_complete`;
            this.log('1. Autenticando motorista...');
            await this.sendMessage('authenticate', { uid: driverId });
            await this.wait(1000);
            
            // 2. Enviar finishTrip com dados completos
            this.log('2. Enviando finishTrip com dados completos...');
            const completeData = {
                tripId: `${this.testId}_trip_complete`,
                driverId: driverId,
                status: 'completed',
                distance: 2500,
                fare: 35.0,
                startTime: Date.now() - 1800000, // 30 minutos atrás
                endTime: Date.now(),
                startLocation: { lat: -23.5505, lng: -46.6333 },
                endLocation: { lat: -23.5605, lng: -46.6433 }
            };
            
            await this.sendMessage('finishTrip', completeData);
            
            // 3. Aguardar resposta
            await new Promise((resolve, reject) => {
                this.ws.once('tripFinished', (data) => {
                    if (data.success) {
                        this.log('✅ FinishTrip com dados completos: SUCESSO', 'SUCCESS');
                        this.log(`   Trip ID: ${data.tripId}`, 'INFO');
                        resolve();
                    } else {
                        this.log(`❌ FinishTrip com dados completos: FALHOU - ${data.error}`, 'ERROR');
                        reject(new Error(data.error));
                    }
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout aguardando resposta do finishTrip'));
                }, 10000);
            });
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erro no teste 2: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testCancelTrip() {
        this.log('=== TESTE 3: CANCEL TRIP ===', 'TEST');
        
        try {
            // 1. Autenticar motorista
            const driverId = `${this.testId}_driver_cancel`;
            this.log('1. Autenticando motorista...');
            await this.sendMessage('authenticate', { uid: driverId });
            await this.wait(1000);
            
            // 2. Enviar cancelTrip
            this.log('2. Enviando cancelTrip...');
            const cancelData = {
                tripId: `${this.testId}_trip_cancel`,
                reason: 'driver_unavailable'
            };
            
            await this.sendMessage('cancelTrip', cancelData);
            
            // 3. Aguardar resposta
            await new Promise((resolve, reject) => {
                this.ws.once('tripCancelled', (data) => {
                    if (data.success) {
                        this.log('✅ CancelTrip: SUCESSO', 'SUCCESS');
                        this.log(`   Trip ID: ${data.tripId}`, 'INFO');
                        resolve();
                    } else {
                        this.log(`❌ CancelTrip: FALHOU - ${data.error}`, 'ERROR');
                        reject(new Error(data.error));
                    }
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout aguardando resposta do cancelTrip'));
                }, 10000);
            });
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erro no teste 3: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            if (this.ws && this.connected) {
                this.ws.disconnect();
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runFinishTripFixTest() {
        this.log('🚀 INICIANDO TESTE DE CORREÇÃO DO FINISH TRIP', 'START');
        
        const results = {
            websocket: false,
            finishTripMinimal: false,
            finishTripComplete: false,
            cancelTrip: false
        };
        
        try {
            // 1. WebSocket
            results.websocket = await this.connectWebSocket();
            if (!results.websocket) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // 2. Teste finishTrip com dados mínimos
            results.finishTripMinimal = await this.testFinishTripWithMinimalData();
            
            // 3. Teste finishTrip com dados completos
            results.finishTripComplete = await this.testFinishTripWithCompleteData();
            
            // 4. Teste cancelTrip
            results.cancelTrip = await this.testCancelTrip();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. WebSocket: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. FinishTrip (Mínimo): ${results.finishTripMinimal ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. FinishTrip (Completo): ${results.finishTripComplete ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. CancelTrip: ${results.cancelTrip ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (passedTests === totalTests) {
                this.log('🎉 CORREÇÃO DO FINISH TRIP FUNCIONANDO!', 'SUCCESS');
                this.log('✅ Erro "Cannot read properties of undefined" foi corrigido', 'SUCCESS');
            } else {
                this.log('🚨 AINDA HÁ PROBLEMAS NO FINISH TRIP', 'ERROR');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante os testes: ${error.message}`, 'ERROR');
        } finally {
            await this.cleanup();
        }
        
        return results;
    }
}

// Executar teste
async function runFinishTripFixTest() {
    const tester = new FinishTripFixTest();
    return await tester.runFinishTripFixTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runFinishTripFixTest()
        .then(results => {
            console.log('\n🏁 Teste de correção do finishTrip concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { FinishTripFixTest, runFinishTripFixTest }; 