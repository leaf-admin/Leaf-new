/**
 * 🎯 TESTE COMPLETO - DRIVER E CUSTOMER SIMULTÂNEO
 * 
 * Teste que simula ambos os lados da aplicação para validar
 * se os eventos estão sendo processados corretamente
 */

const io = require('socket.io-client');

class CompleteFlowTest {
    constructor() {
        this.baseUrl = 'http://localhost:3001';
        this.customerEvents = [];
        this.driverEvents = [];
        this.flowLog = [];
    }

    async runCompleteTest() {
        console.log('🎯 TESTE COMPLETO - DRIVER E CUSTOMER SIMULTÂNEO');
        console.log('='.repeat(60));
        
        // Criar conexões para ambos os lados
        const customerSocket = io(this.baseUrl, { transports: ['websocket', 'polling'] });
        const driverSocket = io(this.baseUrl, { transports: ['websocket', 'polling'] });

        return new Promise((resolve) => {
            let connectionsReady = 0;
            
            // Configurar Customer
            customerSocket.on('connect', () => {
                console.log('👤 CUSTOMER conectado:', customerSocket.id);
                this.setupCustomerListeners(customerSocket);
                connectionsReady++;
                if (connectionsReady === 2) this.executeFlow(customerSocket, driverSocket, resolve);
            });

            // Configurar Driver
            driverSocket.on('connect', () => {
                console.log('🚗 DRIVER conectado:', driverSocket.id);
                this.setupDriverListeners(driverSocket);
                connectionsReady++;
                if (connectionsReady === 2) this.executeFlow(customerSocket, driverSocket, resolve);
            });
        });
    }

    setupCustomerListeners(socket) {
        socket.on('bookingCreated', (data) => {
            this.customerEvents.push({ type: 'bookingCreated', data, timestamp: Date.now() });
            this.logEvent('CUSTOMER', 'bookingCreated', data);
        });

        socket.on('paymentConfirmed', (data) => {
            this.customerEvents.push({ type: 'paymentConfirmed', data, timestamp: Date.now() });
            this.logEvent('CUSTOMER', 'paymentConfirmed', data);
        });

        socket.on('rideAccepted', (data) => {
            this.customerEvents.push({ type: 'rideAccepted', data, timestamp: Date.now() });
            this.logEvent('CUSTOMER', 'rideAccepted', data);
        });

        socket.on('tripStarted', (data) => {
            this.customerEvents.push({ type: 'tripStarted', data, timestamp: Date.now() });
            this.logEvent('CUSTOMER', 'tripStarted', data);
        });

        socket.on('tripCompleted', (data) => {
            this.customerEvents.push({ type: 'tripCompleted', data, timestamp: Date.now() });
            this.logEvent('CUSTOMER', 'tripCompleted', data);
        });

        socket.on('ratingSubmitted', (data) => {
            this.customerEvents.push({ type: 'ratingSubmitted', data, timestamp: Date.now() });
            this.logEvent('CUSTOMER', 'ratingSubmitted', data);
        });
    }

    setupDriverListeners(socket) {
        socket.on('rideRequest', (data) => {
            this.driverEvents.push({ type: 'rideRequest', data, timestamp: Date.now() });
            this.logEvent('DRIVER', 'rideRequest', data);
        });

        socket.on('rideAccepted', (data) => {
            this.driverEvents.push({ type: 'rideAccepted', data, timestamp: Date.now() });
            this.logEvent('DRIVER', 'rideAccepted', data);
        });

        socket.on('tripStarted', (data) => {
            this.driverEvents.push({ type: 'tripStarted', data, timestamp: Date.now() });
            this.logEvent('DRIVER', 'tripStarted', data);
        });

        socket.on('tripCompleted', (data) => {
            this.driverEvents.push({ type: 'tripCompleted', data, timestamp: Date.now() });
            this.logEvent('DRIVER', 'tripCompleted', data);
        });
    }

    logEvent(side, eventType, data) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
            timestamp,
            side,
            event: eventType,
            data: data.bookingId || data.rideId || 'N/A'
        };
        this.flowLog.push(logEntry);
        console.log(`📡 [${timestamp}] ${side}: ${eventType} - ${logEntry.data}`);
    }

    async executeFlow(customerSocket, driverSocket, resolve) {
        try {
            console.log('\n🚀 INICIANDO FLUXO COMPLETO...\n');

            // 1. CUSTOMER solicita corrida
            console.log('1️⃣ CUSTOMER: Solicitando corrida...');
            customerSocket.emit('createBooking', {
                customerId: 'test_customer_complete',
                pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                estimatedFare: 25.50,
                paymentMethod: 'PIX'
            });

            // Aguardar criação da corrida
            await this.waitForEvent('CUSTOMER', 'bookingCreated');
            
            // 2. CUSTOMER processa pagamento
            console.log('\n2️⃣ CUSTOMER: Processando pagamento...');
            const bookingId = this.customerEvents.find(e => e.type === 'bookingCreated').data.bookingId;
            
            customerSocket.emit('confirmPayment', {
                bookingId,
                paymentMethod: 'PIX',
                paymentId: `pix_${Date.now()}`,
                amount: 25.50
            });

            // Aguardar confirmação do pagamento
            await this.waitForEvent('CUSTOMER', 'paymentConfirmed');
            
            // 3. DRIVER recebe notificação (se o servidor enviar)
            console.log('\n3️⃣ DRIVER: Aguardando notificação de corrida...');
            try {
                await this.waitForEvent('DRIVER', 'rideRequest', 5000);
                console.log('✅ DRIVER: Recebeu notificação de corrida');
            } catch (error) {
                console.log('⚠️ DRIVER: Não recebeu notificação (servidor pode não estar enviando)');
            }
            
            // 4. Aguardar aceitação automática (servidor simula)
            console.log('\n4️⃣ CUSTOMER: Aguardando aceitação automática...');
            await this.waitForEvent('CUSTOMER', 'rideAccepted');
            
            // 5. Aguardar início da viagem
            console.log('\n5️⃣ CUSTOMER: Aguardando início da viagem...');
            await this.waitForEvent('CUSTOMER', 'tripStarted');
            
            // 6. Aguardar finalização da viagem
            console.log('\n6️⃣ CUSTOMER: Aguardando finalização da viagem...');
            await this.waitForEvent('CUSTOMER', 'tripCompleted');
            
            // 7. CUSTOMER envia avaliação
            console.log('\n7️⃣ CUSTOMER: Enviando avaliação...');
            customerSocket.emit('submitRating', {
                tripId: bookingId,
                customerId: 'test_customer_complete',
                driverId: 'simulated_driver',
                customerRating: 5,
                customerComment: 'Excelente motorista!'
            });

            // Aguardar confirmação da avaliação
            await this.waitForEvent('CUSTOMER', 'ratingSubmitted');
            
            // Mostrar resultado final
            console.log('\n🎉 FLUXO COMPLETO EXECUTADO!');
            console.log('='.repeat(60));
            
            this.generateFlowReport();
            resolve();
            
        } catch (error) {
            console.error('❌ Erro no teste:', error);
            this.generateFlowReport();
            resolve();
        } finally {
            customerSocket.disconnect();
            driverSocket.disconnect();
        }
    }

    waitForEvent(side, eventType, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const events = side === 'CUSTOMER' ? this.customerEvents : this.driverEvents;
            
            const checkEvent = () => {
                const event = events.find(e => e.type === eventType);
                if (event) {
                    resolve(event);
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout aguardando evento ${eventType} para ${side}`));
                } else {
                    setTimeout(checkEvent, 100);
                }
            };
            
            checkEvent();
        });
    }

    generateFlowReport() {
        console.log('\n📊 RELATÓRIO DE FLUXO DE EVENTOS');
        console.log('='.repeat(60));
        
        console.log('\n👤 EVENTOS DO CUSTOMER:');
        this.customerEvents.forEach((event, index) => {
            console.log(`${index + 1}. ${event.type} - ${new Date(event.timestamp).toLocaleTimeString()}`);
        });
        
        console.log('\n🚗 EVENTOS DO DRIVER:');
        this.driverEvents.forEach((event, index) => {
            console.log(`${index + 1}. ${event.type} - ${new Date(event.timestamp).toLocaleTimeString()}`);
        });
        
        console.log('\n📡 LOG COMPLETO DE EVENTOS:');
        this.flowLog.forEach((log, index) => {
            console.log(`${index + 1}. [${log.timestamp}] ${log.side}: ${log.event} - ${log.data}`);
        });
        
        console.log('\n✅ TESTE CONCLUÍDO!');
    }
}

// Executar teste
if (require.main === module) {
    const tester = new CompleteFlowTest();
    tester.runCompleteTest().catch(console.error);
}

module.exports = CompleteFlowTest;






