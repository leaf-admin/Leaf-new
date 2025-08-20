const io = require('socket.io-client');
const Redis = require('ioredis');

// Configurações
const SERVER_URL = 'http://localhost:3001';
const REDIS_URL = 'redis://localhost:6379';

// Cliente Redis
const redis = new Redis(REDIS_URL);

// Dados de teste
const testData = {
    passenger: {
        uid: 'test_passenger_123',
        userType: 'passenger'
    },
    driver: {
        uid: 'test_driver_456',
        userType: 'driver'
    },
    trip: {
        id: 'test_trip_789',
        pickup: { add: 'Rua Teste, 123', lat: -23.5505, lng: -46.6333 },
        drop: { add: 'Av. Paulista, 1000', lat: -23.5631, lng: -46.6544 },
        estimate: 25.50
    }
};

// Função para limpar dados de teste
async function cleanupTestData() {
    try {
        // Limpar avaliações de teste
        const ratingKeys = await redis.keys('rating_*');
        if (ratingKeys.length > 0) {
            await redis.del(...ratingKeys);
            console.log('🧹 Avaliações de teste removidas');
        }

        // Limpar listas de avaliações
        const tripRatingKeys = await redis.keys('trip_ratings:*');
        if (tripRatingKeys.length > 0) {
            await redis.del(...tripRatingKeys);
            console.log('🧹 Listas de avaliações de viagem removidas');
        }

        const userRatingKeys = await redis.keys('user_ratings:*');
        if (userRatingKeys.length > 0) {
            await redis.del(...userRatingKeys);
            console.log('🧹 Listas de avaliações de usuário removidas');
        }

        // Limpar reservas de teste
        const bookingKeys = await redis.keys('bookings:active');
        if (bookingKeys.length > 0) {
            await redis.hdel('bookings:active', testData.trip.id);
            console.log('🧹 Reserva de teste removida');
        }

        console.log('✅ Limpeza de dados de teste concluída');
    } catch (error) {
        console.error('❌ Erro na limpeza:', error);
    }
}

// Função para criar dados de teste
async function createTestData() {
    try {
        // Criar reserva de teste
        const testBooking = {
            id: testData.trip.id,
            customerId: testData.passenger.uid,
            driverId: testData.driver.uid,
            pickup: testData.trip.pickup,
            drop: testData.trip.drop,
            estimate: testData.trip.estimate,
            status: 'COMPLETED',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await redis.hset('bookings:active', testData.trip.id, JSON.stringify(testBooking));
        console.log('✅ Dados de teste criados');

        return testBooking;
    } catch (error) {
        console.error('❌ Erro ao criar dados de teste:', error);
        throw error;
    }
}

// Teste 1: Submeter avaliação de passageiro
async function testPassengerRating() {
    return new Promise((resolve, reject) => {
        console.log('\n🧪 Teste 1: Avaliação de Passageiro');
        
        const passengerSocket = io(SERVER_URL);
        
        passengerSocket.on('connect', async () => {
            console.log('🔌 Passageiro conectado');
            
            // Autenticar passageiro
            passengerSocket.emit('authenticate', testData.passenger);
            
            passengerSocket.once('authenticated', async (data) => {
                if (data.success) {
                    console.log('✅ Passageiro autenticado');
                    
                    // Submeter avaliação
                    const ratingData = {
                        tripId: testData.trip.id,
                        rating: 5,
                        selectedOptions: ['Veículo limpo', 'Ótimo trajeto'],
                        comment: 'Excelente serviço!',
                        userType: 'passenger',
                        timestamp: new Date().toISOString()
                    };
                    
                    passengerSocket.emit('submitRating', ratingData);
                    
                    passengerSocket.once('ratingSubmitted', (result) => {
                        if (result.success) {
                            console.log('✅ Avaliação de passageiro enviada:', result.ratingId);
                            resolve(result);
                        } else {
                            reject(new Error('Falha ao enviar avaliação de passageiro'));
                        }
                        passengerSocket.disconnect();
                    });
                    
                    passengerSocket.once('ratingSubmittedError', (error) => {
                        reject(new Error(`Erro na avaliação de passageiro: ${error.error}`));
                        passengerSocket.disconnect();
                    });
                    
                } else {
                    reject(new Error('Falha na autenticação do passageiro'));
                    passengerSocket.disconnect();
                }
            });
        });
        
        passengerSocket.on('connect_error', (error) => {
            reject(new Error(`Erro de conexão do passageiro: ${error.message}`));
        });
        
        // Timeout
        setTimeout(() => {
            reject(new Error('Timeout no teste de avaliação de passageiro'));
            passengerSocket.disconnect();
        }, 10000);
    });
}

// Teste 2: Submeter avaliação de motorista
async function testDriverRating() {
    return new Promise((resolve, reject) => {
        console.log('\n🧪 Teste 2: Avaliação de Motorista');
        
        const driverSocket = io(SERVER_URL);
        
        driverSocket.on('connect', async () => {
            console.log('🔌 Motorista conectado');
            
            // Autenticar motorista
            driverSocket.emit('authenticate', testData.driver);
            
            driverSocket.once('authenticated', async (data) => {
                if (data.success) {
                    console.log('✅ Motorista autenticado');
                    
                    // Submeter avaliação
                    const ratingData = {
                        tripId: testData.trip.id,
                        rating: 4,
                        selectedOptions: ['Passageiro educado', 'Embarque preciso'],
                        suggestion: 'Poderia ser mais pontual',
                        userType: 'driver',
                        timestamp: new Date().toISOString()
                    };
                    
                    driverSocket.emit('submitRating', ratingData);
                    
                    driverSocket.once('ratingSubmitted', (result) => {
                        if (result.success) {
                            console.log('✅ Avaliação de motorista enviada:', result.ratingId);
                            resolve(result);
                        } else {
                            reject(new Error('Falha ao enviar avaliação de motorista'));
                        }
                        driverSocket.disconnect();
                    });
                    
                    driverSocket.once('ratingSubmittedError', (error) => {
                        reject(new Error(`Erro na avaliação de motorista: ${error.error}`));
                        driverSocket.disconnect();
                    });
                    
                } else {
                    reject(new Error('Falha na autenticação do motorista'));
                    driverSocket.disconnect();
                }
            });
        });
        
        driverSocket.on('connect_error', (error) => {
            reject(new Error(`Erro de conexão do motorista: ${error.message}`));
        });
        
        // Timeout
        setTimeout(() => {
            reject(new Error('Timeout no teste de avaliação de motorista'));
            driverSocket.disconnect();
        }, 10000);
    });
}

// Teste 3: Buscar avaliações da viagem
async function testGetTripRatings() {
    return new Promise((resolve, reject) => {
        console.log('\n🧪 Teste 3: Buscar Avaliações da Viagem');
        
        const socket = io(SERVER_URL);
        
        socket.on('connect', async () => {
            console.log('🔌 Cliente conectado para buscar avaliações');
            
            // Autenticar
            socket.emit('authenticate', testData.passenger);
            
            socket.once('authenticated', async (data) => {
                if (data.success) {
                    console.log('✅ Cliente autenticado');
                    
                    // Buscar avaliações da viagem
                    socket.emit('getTripRatings', { tripId: testData.trip.id });
                    
                    socket.once('tripRatings', (result) => {
                        if (result.success) {
                            console.log(`✅ Avaliações da viagem encontradas: ${result.total}`);
                            console.log('📊 Avaliações:', result.ratings);
                            resolve(result);
                        } else {
                            reject(new Error('Falha ao buscar avaliações da viagem'));
                        }
                        socket.disconnect();
                    });
                    
                    socket.once('getTripRatingsError', (error) => {
                        reject(new Error(`Erro ao buscar avaliações: ${error.error}`));
                        socket.disconnect();
                    });
                    
                } else {
                    reject(new Error('Falha na autenticação'));
                    socket.disconnect();
                }
            });
        });
        
        socket.on('connect_error', (error) => {
            reject(new Error(`Erro de conexão: ${error.message}`));
        });
        
        // Timeout
        setTimeout(() => {
            reject(new Error('Timeout no teste de busca de avaliações'));
            socket.disconnect();
        }, 10000);
    });
}

// Teste 4: Verificar se usuário já avaliou
async function testHasUserRatedTrip() {
    return new Promise((resolve, reject) => {
        console.log('\n🧪 Teste 4: Verificar se Usuário Já Avaliou');
        
        const socket = io(SERVER_URL);
        
        socket.on('connect', async () => {
            console.log('🔌 Cliente conectado para verificar avaliação');
            
            // Autenticar
            socket.emit('authenticate', testData.passenger);
            
            socket.once('authenticated', async (data) => {
                if (data.success) {
                    console.log('✅ Cliente autenticado');
                    
                    // Verificar se passageiro já avaliou
                    socket.emit('hasUserRatedTrip', { 
                        tripId: testData.trip.id, 
                        userType: 'passenger' 
                    });
                    
                    socket.once('userRatedTrip', (result) => {
                        if (result.success) {
                            console.log(`✅ Verificação concluída: ${result.hasRated ? 'Já avaliou' : 'Não avaliou'}`);
                            if (result.rating) {
                                console.log('📊 Avaliação encontrada:', result.rating);
                            }
                            resolve(result);
                        } else {
                            reject(new Error('Falha ao verificar avaliação'));
                        }
                        socket.disconnect();
                    });
                    
                    socket.once('hasUserRatedTripError', (error) => {
                        reject(new Error(`Erro ao verificar avaliação: ${error.error}`));
                        socket.disconnect();
                    });
                    
                } else {
                    reject(new Error('Falha na autenticação'));
                    socket.disconnect();
                }
            });
        });
        
        socket.on('connect_error', (error) => {
            reject(new Error(`Erro de conexão: ${error.message}`));
        });
        
        // Timeout
        setTimeout(() => {
            reject(new Error('Timeout no teste de verificação'));
            socket.disconnect();
        }, 10000);
    });
}

// Função principal de teste
async function runTests() {
    console.log('🚀 Iniciando testes do sistema de avaliações...\n');
    
    try {
        // Limpar dados anteriores
        await cleanupTestData();
        
        // Criar dados de teste
        await createTestData();
        
        // Executar testes
        await testPassengerRating();
        await testDriverRating();
        await testGetTripRatings();
        await testHasUserRatedTrip();
        
        console.log('\n🎉 Todos os testes passaram com sucesso!');
        console.log('✅ Sistema de avaliações funcionando perfeitamente');
        
    } catch (error) {
        console.error('\n❌ Teste falhou:', error.message);
        process.exit(1);
    } finally {
        // Limpar dados de teste
        await cleanupTestData();
        
        // Fechar conexão Redis
        await redis.quit();
        
        console.log('\n🏁 Testes concluídos');
        process.exit(0);
    }
}

// Executar testes se arquivo for chamado diretamente
if (require.main === module) {
    runTests();
}

module.exports = {
    runTests,
    testPassengerRating,
    testDriverRating,
    testGetTripRatings,
    testHasUserRatedTrip
};
