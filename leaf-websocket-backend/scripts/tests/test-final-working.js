/**
 * 🎯 TESTE FINAL FUNCIONANDO - FLUXO COMPLETO
 */

const io = require('socket.io-client');

class FinalWorkingTest {
    constructor() {
        this.baseUrl = 'http://localhost:3001';
        this.events = [];
    }

    async runTest() {
        console.log('🎯 TESTE FINAL FUNCIONANDO - FLUXO COMPLETO');
        console.log('='.repeat(50));
        
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        return new Promise((resolve) => {
            socket.on('connect', () => {
                console.log('✅ Conectado ao servidor:', socket.id);
                
                // Configurar listeners
                this.setupListeners(socket);
                
                // Executar fluxo completo
                this.executeFlow(socket, resolve);
            });
        });
    }

    setupListeners(socket) {
        socket.on('bookingCreated', (data) => {
            this.events.push({ type: 'bookingCreated', data, timestamp: Date.now() });
            console.log('✅ Corrida criada:', data.bookingId);
        });

        socket.on('paymentConfirmed', (data) => {
            this.events.push({ type: 'paymentConfirmed', data, timestamp: Date.now() });
            console.log('💳 Pagamento confirmado');
        });

        socket.on('rideAccepted', (data) => {
            this.events.push({ type: 'rideAccepted', data, timestamp: Date.now() });
            console.log('✅ Corrida aceita pelo motorista');
        });

        socket.on('tripStarted', (data) => {
            this.events.push({ type: 'tripStarted', data, timestamp: Date.now() });
            console.log('🚀 Viagem iniciada');
        });

        socket.on('tripCompleted', (data) => {
            this.events.push({ type: 'tripCompleted', data, timestamp: Date.now() });
            console.log('🏁 Viagem finalizada');
        });

        socket.on('ratingSubmitted', (data) => {
            this.events.push({ type: 'ratingSubmitted', data, timestamp: Date.now() });
            console.log('⭐ Avaliação enviada');
        });
    }

    async executeFlow(socket, resolve) {
        try {
            // 1. Solicitar corrida
            console.log('\n1️⃣ Solicitando corrida...');
            socket.emit('createBooking', {
                customerId: 'test_customer_final',
                pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                estimatedFare: 25.50,
                paymentMethod: 'PIX'
            });

            // Aguardar criação da corrida
            await this.waitForEvent('bookingCreated');
            
            // 2. Processar pagamento
            console.log('\n2️⃣ Processando pagamento...');
            const bookingId = this.events.find(e => e.type === 'bookingCreated').data.bookingId;
            
            socket.emit('confirmPayment', {
                bookingId,
                paymentMethod: 'PIX',
                paymentId: `pix_${Date.now()}`,
                amount: 25.50
            });

            // Aguardar confirmação do pagamento
            await this.waitForEvent('paymentConfirmed');
            
            // 3. Aguardar aceitação automática (servidor simula)
            console.log('\n3️⃣ Aguardando aceitação automática...');
            await this.waitForEvent('rideAccepted');
            
            // 4. Aguardar início da viagem
            console.log('\n4️⃣ Aguardando início da viagem...');
            await this.waitForEvent('tripStarted');
            
            // 5. Aguardar finalização da viagem
            console.log('\n5️⃣ Aguardando finalização da viagem...');
            await this.waitForEvent('tripCompleted');
            
            // 6. Enviar avaliação
            console.log('\n6️⃣ Enviando avaliação...');
            socket.emit('submitRating', {
                tripId: bookingId,
                customerId: 'test_customer_final',
                driverId: 'simulated_driver',
                customerRating: 5,
                customerComment: 'Excelente motorista!'
            });

            // Aguardar confirmação da avaliação
            await this.waitForEvent('ratingSubmitted');
            
            // Mostrar resultado final
            console.log('\n🎉 FLUXO COMPLETO EXECUTADO COM SUCESSO!');
            console.log('='.repeat(50));
            console.log('📊 Eventos recebidos:');
            this.events.forEach((event, index) => {
                console.log(`${index + 1}. ${event.type} - ${new Date(event.timestamp).toLocaleTimeString()}`);
            });
            
            console.log('\n✅ TESTE CONCLUÍDO COM SUCESSO!');
            resolve();
            
        } catch (error) {
            console.error('❌ Erro no teste:', error);
            resolve();
        } finally {
            socket.disconnect();
        }
    }

    waitForEvent(eventType, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkEvent = () => {
                const event = this.events.find(e => e.type === eventType);
                if (event) {
                    resolve(event);
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout aguardando evento ${eventType}`));
                } else {
                    setTimeout(checkEvent, 100);
                }
            };
            
            checkEvent();
        });
    }
}

// Executar teste
if (require.main === module) {
    const tester = new FinalWorkingTest();
    tester.runTest().catch(console.error);
}

module.exports = FinalWorkingTest;






