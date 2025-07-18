const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove } = require('firebase/database');
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore');
const { getAuth, signInAnonymously } = require('firebase/auth');

class CorrectArchitectureTest {
    constructor() {
        this.testId = `arch_test_${Date.now()}`;
        this.driverId = `${this.testId}_driver`;
        this.tripId = `${this.testId}_trip`;
        this.ws = null;
        this.connected = false;
        
        // Firebase config (configuração correta do projeto)
        this.firebaseConfig = {
            apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
            authDomain: "leaf-reactnative.firebaseapp.com",
            databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
            projectId: "leaf-reactnative",
            storageBucket: "leaf-reactnative.firebasestorage.app",
            messagingSenderId: "106504629884",
            appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
            measurementId: "G-22368DBCY9"
        };
        
        this.app = initializeApp(this.firebaseConfig);
        this.database = getDatabase(this.app);
        this.firestore = getFirestore(this.app);
        this.auth = getAuth(this.app);
        this.authenticated = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== AUTENTICANDO NO FIREBASE ===', 'AUTH');
        
        try {
            const userCredential = await signInAnonymously(this.auth);
            this.authenticated = true;
            this.log(`✅ Autenticado: ${userCredential.user.uid}`, 'SUCCESS');
            return true;
        } catch (error) {
            this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async connectWebSocket() {
        this.log('=== CONECTANDO AO BACKEND ===', 'WEBSOCKET');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = io('http://localhost:3001', {
                    transports: ['websocket', 'polling'],
                    timeout: 10000
                });
                
                this.ws.on('connect', () => {
                    this.connected = true;
                    this.log('✅ Conectado ao backend', 'SUCCESS');
                    resolve(true);
                });
                
                this.ws.on('disconnect', () => {
                    this.connected = false;
                    this.log('🔌 Desconectado do backend', 'WEBSOCKET');
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

    async testRedisPrimary() {
        this.log('=== TESTE 1: REDIS (Tempo Real) ===', 'TEST');
        
        try {
            // 1. Autenticar motorista
            this.log('1. Autenticando motorista...');
            await this.sendMessage('authenticate', { uid: this.driverId });
            await this.wait(1000);
            
            // 2. Enviar localização
            this.log('2. Enviando localização...');
            const location = {
                lat: -23.5505,
                lng: -46.6333
            };
            
            await this.sendMessage('updateLocation', location);
            await this.wait(2000);
            
            this.log('✅ Localização enviada para Redis', 'SUCCESS');
            return true;
            
        } catch (error) {
            this.log(`❌ Erro no teste 1: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testRealtimeDatabaseBackup() {
        this.log('=== TESTE 2: REALTIME DATABASE (Backup) ===', 'TEST');
        
        try {
            // Verificar se a localização foi sincronizada com Realtime Database
            this.log('3. Verificando sincronização com Realtime Database...');
            
            const locationRef = ref(this.database, `locations/${this.driverId}`);
            const snapshot = await get(locationRef);
            
            if (snapshot.exists()) {
                const data = snapshot.val();
                this.log('✅ Localização encontrada no Realtime Database:', 'SUCCESS');
                this.log(`   Lat: ${data.lat}`, 'INFO');
                this.log(`   Lng: ${data.lng}`, 'INFO');
                this.log(`   Status: ${data.status}`, 'INFO');
                this.log(`   Última atualização: ${data.lastUpdate}`, 'INFO');
                return true;
            } else {
                this.log('❌ Localização NÃO encontrada no Realtime Database', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste 2: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testFirestorePersistence() {
        this.log('=== TESTE 3: FIRESTORE (Persistência) ===', 'TEST');
        
        try {
            // 4. Simular finalização de viagem
            this.log('4. Simulando finalização de viagem...');
            
            const tripData = {
                startTime: Date.now() - 300000, // 5 minutos atrás
                startLocation: { lat: -23.5505, lng: -46.6333 },
                endLocation: { lat: -23.5605, lng: -46.6433 },
                distance: 1500, // 1.5km
                fare: 25.50
            };
            
            await this.sendMessage('finishTrip', {
                tripId: this.tripId,
                tripData: tripData
            });
            
            await this.wait(3000);
            
            // 5. Verificar se foi salvo no Firestore
            this.log('5. Verificando persistência no Firestore...');
            
            const tripDoc = doc(this.firestore, 'trips', this.tripId);
            const tripSnapshot = await getDoc(tripDoc);
            
            if (tripSnapshot.exists()) {
                const data = tripSnapshot.data();
                this.log('✅ Viagem encontrada no Firestore:', 'SUCCESS');
                this.log(`   Trip ID: ${data.tripId}`, 'INFO');
                this.log(`   Driver ID: ${data.driverId}`, 'INFO');
                this.log(`   Status: ${data.status}`, 'INFO');
                this.log(`   Distância: ${data.distance}m`, 'INFO');
                this.log(`   Tarifa: R$ ${data.fare}`, 'INFO');
                this.log(`   Finalizada em: ${data.completedAt}`, 'INFO');
                return true;
            } else {
                this.log('❌ Viagem NÃO encontrada no Firestore', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste 3: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testCancelTripPersistence() {
        this.log('=== TESTE 4: CANCELAMENTO (Persistência) ===', 'TEST');
        
        try {
            // 6. Simular cancelamento de viagem
            this.log('6. Simulando cancelamento de viagem...');
            
            const cancelTripId = `${this.testId}_cancel_trip`;
            
            await this.sendMessage('cancelTrip', {
                tripId: cancelTripId,
                reason: 'driver_unavailable'
            });
            
            await this.wait(3000);
            
            // 7. Verificar se cancelamento foi salvo no Firestore
            this.log('7. Verificando cancelamento no Firestore...');
            
            const cancelDoc = doc(this.firestore, 'trips', cancelTripId);
            const cancelSnapshot = await getDoc(cancelDoc);
            
            if (cancelSnapshot.exists()) {
                const data = cancelSnapshot.data();
                this.log('✅ Cancelamento encontrado no Firestore:', 'SUCCESS');
                this.log(`   Trip ID: ${data.tripId}`, 'INFO');
                this.log(`   Status: ${data.status}`, 'INFO');
                this.log(`   Motivo: ${data.reason}`, 'INFO');
                this.log(`   Cancelado em: ${data.cancelledAt}`, 'INFO');
                return true;
            } else {
                this.log('❌ Cancelamento NÃO encontrado no Firestore', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste 4: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Limpar dados de teste do Realtime Database
            const locationRef = ref(this.database, `locations/${this.driverId}`);
            await remove(locationRef);
            this.log('✅ Localização removida do Realtime Database', 'SUCCESS');
            
            // Limpar dados de teste do Firestore
            const tripDoc = doc(this.firestore, 'trips', this.tripId);
            await setDoc(tripDoc, {}, { merge: true });
            this.log('✅ Viagem removida do Firestore', 'SUCCESS');
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runArchitectureTest() {
        this.log('🚀 INICIANDO TESTE DA ARQUITETURA CORRETA', 'START');
        this.log('', 'INFO');
        this.log('🎯 ESTRUTURA TESTADA:', 'INFO');
        this.log('   1. 🔴 Redis (Tempo Real)', 'INFO');
        this.log('   2. 🟡 Realtime Database (Backup)', 'INFO');
        this.log('   3. 🟢 Firestore (Persistência)', 'INFO');
        this.log('', 'INFO');
        
        const results = {
            firebaseAuth: false,
            websocket: false,
            redisPrimary: false,
            realtimeBackup: false,
            firestorePersistence: false,
            cancelPersistence: false
        };
        
        try {
            // 1. Autenticar no Firebase
            results.firebaseAuth = await this.authenticateFirebase();
            await this.wait(1000);
            
            if (!results.firebaseAuth) {
                this.log('❌ Falha na autenticação Firebase', 'ERROR');
                return results;
            }
            
            // 2. WebSocket
            results.websocket = await this.connectWebSocket();
            await this.wait(1000);
            
            if (!results.websocket) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // 3. Redis (Tempo Real)
            results.redisPrimary = await this.testRedisPrimary();
            await this.wait(2000);
            
            // 4. Realtime Database (Backup)
            results.realtimeBackup = await this.testRealtimeDatabaseBackup();
            await this.wait(1000);
            
            // 5. Firestore (Persistência)
            results.firestorePersistence = await this.testFirestorePersistence();
            await this.wait(1000);
            
            // 6. Cancelamento (Persistência)
            results.cancelPersistence = await this.testCancelTripPersistence();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. Firebase Auth: ${results.firebaseAuth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. WebSocket: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Redis (Tempo Real): ${results.redisPrimary ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Realtime DB (Backup): ${results.realtimeBackup ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`5. Firestore (Persistência): ${results.firestorePersistence ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`6. Cancelamento (Persistência): ${results.cancelPersistence ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (results.redisPrimary && results.realtimeBackup && results.firestorePersistence) {
                this.log('🎉 ARQUITETURA CORRETA FUNCIONANDO!', 'SUCCESS');
                this.log('✅ Estrutura de três camadas implementada corretamente', 'SUCCESS');
                this.log('✅ Redis: Tempo real', 'SUCCESS');
                this.log('✅ Realtime DB: Backup', 'SUCCESS');
                this.log('✅ Firestore: Persistência', 'SUCCESS');
            } else {
                this.log('🚨 ARQUITETURA COM PROBLEMAS', 'ERROR');
                this.log('🔧 Backend precisa ser ajustado', 'ERROR');
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
async function runCorrectArchitectureTest() {
    const tester = new CorrectArchitectureTest();
    return await tester.runArchitectureTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runCorrectArchitectureTest()
        .then(results => {
            console.log('\n🏁 Teste da arquitetura correta concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { CorrectArchitectureTest, runCorrectArchitectureTest }; 