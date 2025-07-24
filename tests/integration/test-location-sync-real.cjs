const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, onValue, off } = require('firebase/database');
const { getAuth, signInAnonymously } = require('firebase/auth');

// Configuração real do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
    authDomain: "leaf-reactnative.firebaseapp.com",
    databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
    projectId: "leaf-reactnative",
    storageBucket: "leaf-reactnative.firebasestorage.app",
    messagingSenderId: "106504629884",
    appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
    measurementId: "G-22368DBCY9"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

class LocationSyncTest {
    constructor() {
        this.testId = `location_test_${Date.now()}`;
        this.driverId = `${this.testId}_driver`;
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
        this.locationReceived = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== AUTENTICANDO NO FIREBASE ===', 'AUTH');
        
        try {
            const result = await signInAnonymously(auth);
            this.authenticated = true;
            this.log(`✅ Autenticado: ${result.user.uid}`, 'SUCCESS');
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

    async testLocationSync() {
        this.log('=== TESTE DE SINCRONIZAÇÃO DE LOCALIZAÇÃO ===', 'TEST');
        
        try {
            // 1. Autenticar motorista no backend
            this.log('1. Autenticando motorista no backend...');
            await this.sendMessage('authenticate', { uid: this.driverId });
            await this.wait(1000);
            
            // 2. Configurar listener para mudanças no Firebase
            this.log('2. Configurando listener do Firebase...');
            const locationRef = ref(database, `locations/${this.driverId}`);
            
            const unsubscribe = onValue(locationRef, (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this.locationReceived = true;
                    this.log(`✅ Localização recebida no Firebase: ${JSON.stringify(data)}`, 'SUCCESS');
                }
            });
            
            // 3. Enviar localização via WebSocket
            this.log('3. Enviando localização via WebSocket...');
            const location = {
                uid: this.driverId,
                lat: -23.5505,
                lng: -46.6333,
                timestamp: Date.now()
            };
            
            await this.sendMessage('updateLocation', location);
            
            // 4. Aguardar sincronização
            this.log('4. Aguardando sincronização...');
            await this.wait(5000);
            
            // 5. Verificar se foi salva no Firebase
            this.log('5. Verificando se foi salva no Firebase...');
            const snapshot = await get(locationRef);
            const savedLocation = snapshot.val();
            
            unsubscribe(); // Parar de escutar
            
            if (savedLocation) {
                this.log('✅ Localização salva no Firebase!', 'SUCCESS');
                this.log(`   Lat: ${savedLocation.lat}`, 'INFO');
                this.log(`   Lng: ${savedLocation.lng}`, 'INFO');
                this.log(`   Timestamp: ${savedLocation.timestamp}`, 'INFO');
                return true;
            } else {
                this.log('❌ Localização NÃO foi salva no Firebase', 'ERROR');
                this.log('🔍 POSSÍVEIS CAUSAS:', 'ERROR');
                this.log('   - Backend não está processando updateLocation', 'ERROR');
                this.log('   - Backend não está salvando no Firebase', 'ERROR');
                this.log('   - Regras do Firebase bloqueando escrita', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testDistanceCalculation() {
        this.log('=== TESTE DE CÁLCULO DE DISTÂNCIA ===', 'TEST');
        
        try {
            // Criar localização de origem (passageiro)
            const origin = { lat: -23.5505, lng: -46.6333 }; // Av. Paulista
            
            // Criar localizações de motoristas em distâncias diferentes
            const drivers = [
                { id: 'driver_near', lat: -23.5506, lng: -46.6334, expectedDistance: 0.1 }, // Muito próximo
                { id: 'driver_medium', lat: -23.5605, lng: -46.6433, expectedDistance: 1.5 }, // Médio
                { id: 'driver_far', lat: -23.5705, lng: -46.6533, expectedDistance: 3.0 } // Distante
            ];
            
            this.log('📊 Testando cálculo de distâncias:', 'INFO');
            
            for (const driver of drivers) {
                const distance = this.calculateDistance(origin.lat, origin.lng, driver.lat, driver.lng);
                this.log(`   ${driver.id}: ${distance.toFixed(2)}km (esperado: ~${driver.expectedDistance}km)`, 'INFO');
                
                // Verificar se a distância está razoável
                if (Math.abs(distance - driver.expectedDistance) < 0.5) {
                    this.log(`   ✅ Distância calculada corretamente`, 'SUCCESS');
                } else {
                    this.log(`   ⚠️ Distância pode estar incorreta`, 'WARNING');
                }
            }
            
            // Simular priorização
            const sortedDrivers = drivers.sort((a, b) => {
                const distA = this.calculateDistance(origin.lat, origin.lng, a.lat, a.lng);
                const distB = this.calculateDistance(origin.lat, origin.lng, b.lat, b.lng);
                return distA - distB;
            });
            
            this.log('🎯 Ordem de priorização:', 'INFO');
            sortedDrivers.forEach((driver, index) => {
                const distance = this.calculateDistance(origin.lat, origin.lng, driver.lat, driver.lng);
                this.log(`   ${index + 1}. ${driver.id}: ${distance.toFixed(2)}km`, 'INFO');
            });
            
            if (sortedDrivers[0].id === 'driver_near') {
                this.log('✅ Priorização por distância funcionando!', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Priorização não está funcionando corretamente', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de distância: ${error.message}`, 'ERROR');
            return false;
        }
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Raio da Terra em km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Remover localização de teste
            if (this.authenticated) {
                await set(ref(database, `locations/${this.driverId}`), null);
                this.log('✅ Localização de teste removida', 'SUCCESS');
            }
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runLocationTest() {
        this.log('🚀 INICIANDO TESTE DE SINCRONIZAÇÃO DE LOCALIZAÇÃO', 'START');
        
        const results = {
            auth: false,
            websocket: false,
            locationSync: false,
            distanceCalculation: false
        };
        
        try {
            // 1. Autenticação
            results.auth = await this.authenticateFirebase();
            await this.wait(1000);
            
            if (!results.auth) {
                this.log('❌ Falha na autenticação', 'ERROR');
                return results;
            }
            
            // 2. WebSocket
            results.websocket = await this.connectWebSocket();
            await this.wait(1000);
            
            if (!results.websocket) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // 3. Teste de sincronização
            results.locationSync = await this.testLocationSync();
            await this.wait(1000);
            
            // 4. Teste de cálculo de distância
            results.distanceCalculation = await this.testDistanceCalculation();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. Autenticação: ${results.auth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. WebSocket: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Sincronização Localização: ${results.locationSync ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Cálculo Distância: ${results.distanceCalculation ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (results.locationSync) {
                this.log('🎉 SINCRONIZAÇÃO FUNCIONANDO!', 'SUCCESS');
                this.log('✅ Sistema de localização operacional', 'SUCCESS');
            } else {
                this.log('🚨 SINCRONIZAÇÃO COM PROBLEMAS', 'ERROR');
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
async function runLocationSyncTest() {
    const tester = new LocationSyncTest();
    return await tester.runLocationTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runLocationSyncTest()
        .then(results => {
            console.log('\n🏁 Teste de sincronização concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { LocationSyncTest, runLocationSyncTest }; 