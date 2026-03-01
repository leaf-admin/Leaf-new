/**
 * 🧪 DEBUGGER DE FLUXO DE CORRIDA - TESTE EM TEMPO REAL
 * 
 * Este arquivo permite testar todo o fluxo de corrida sem rebuild de APK
 * Use com Expo Go ou React Native Debugger para hot reload
 */

import WebSocketManager from './src/services/WebSocketManager';

class RideFlowDebugger {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.testData = {
            customer: {
                id: 'test_customer_123',
                name: 'João Cliente',
                location: { lat: -23.5505, lng: -46.6333 } // São Paulo
            },
            driver: {
                id: 'test_driver_456', 
                name: 'Maria Motorista',
                location: { lat: -23.5515, lng: -46.6343 } // Próximo ao cliente
            },
            ride: {
                id: null,
                pickup: { lat: -23.5505, lng: -46.6333, address: 'Av. Paulista, 1000' },
                destination: { lat: -23.5615, lng: -46.6553, address: 'Shopping Iguatemi' },
                fare: 25.50
            }
        };
        
        this.eventLog = [];
        this.isTestRunning = false;
    }

    /**
     * 🎬 INICIAR TESTE COMPLETO DO FLUXO
     */
    async startCompleteFlowTest() {
        console.log('🎬 INICIANDO TESTE COMPLETO DO FLUXO DE CORRIDA');
        this.isTestRunning = true;
        this.eventLog = [];

        try {
            // 1. Conectar WebSocket
            await this.connectWebSocket();
            
            // 2. Simular cliente solicitando corrida
            await this.simulateCustomerRequest();
            
            // 3. Simular pagamento PIX
            await this.simulatePixPayment();
            
            // 4. Simular motorista recebendo notificação
            await this.simulateDriverNotification();
            
            // 5. Simular motorista aceitando corrida
            await this.simulateDriverAcceptance();
            
            // 6. Simular início da viagem
            await this.simulateTripStart();
            
            // 7. Simular conclusão da viagem
            await this.simulateTripCompletion();
            
            // 8. Simular avaliação
            await this.simulateRating();
            
            console.log('✅ TESTE COMPLETO FINALIZADO COM SUCESSO!');
            this.printEventLog();
            
        } catch (error) {
            console.error('❌ ERRO NO TESTE:', error);
            this.printEventLog();
        } finally {
            this.isTestRunning = false;
        }
    }

    /**
     * 🔌 Conectar ao WebSocket
     */
    async connectWebSocket() {
        this.logEvent('🔌 Conectando ao WebSocket...');
        
        await this.wsManager.connect();
        
        // Configurar listeners para todos os eventos
        this.setupEventListeners();
        
        this.logEvent('✅ WebSocket conectado');
    }

    /**
     * 👤 Simular cliente solicitando corrida
     */
    async simulateCustomerRequest() {
        this.logEvent('👤 Cliente solicitando corrida...');
        
        const rideData = {
            customerId: this.testData.customer.id,
            pickupLocation: this.testData.ride.pickup,
            destinationLocation: this.testData.ride.destination,
            estimatedFare: this.testData.ride.fare,
            paymentMethod: 'PIX'
        };

        try {
            const result = await this.wsManager.createBooking(rideData);
            this.testData.ride.id = result.bookingId;
            this.logEvent(`✅ Corrida solicitada - ID: ${result.bookingId}`);
        } catch (error) {
            this.logEvent(`❌ Erro ao solicitar corrida: ${error.message}`);
            throw error;
        }
    }

    /**
     * 💳 Simular pagamento PIX
     */
    async simulatePixPayment() {
        this.logEvent('💳 Processando pagamento PIX...');
        
        const paymentData = {
            bookingId: this.testData.ride.id,
            paymentMethod: 'PIX',
            paymentId: `pix_${Date.now()}`,
            amount: this.testData.ride.fare
        };

        try {
            const result = await this.wsManager.confirmPayment(
                paymentData.bookingId,
                paymentData.paymentMethod,
                paymentData.paymentId,
                paymentData.amount
            );
            this.logEvent('✅ Pagamento PIX confirmado');
        } catch (error) {
            this.logEvent(`❌ Erro no pagamento: ${error.message}`);
            throw error;
        }
    }

    /**
     * 🚗 Simular motorista recebendo notificação
     */
    async simulateDriverNotification() {
        this.logEvent('🚗 Motorista recebendo notificação de corrida...');
        
        // Simular delay de notificação
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        this.logEvent('📱 Modal de corrida apareceu para o motorista');
    }

    /**
     * ✅ Simular motorista aceitando corrida
     */
    async simulateDriverAcceptance() {
        this.logEvent('✅ Motorista aceitando corrida...');
        
        try {
            const result = await this.wsManager.driverResponse(
                this.testData.ride.id, 
                true, // accepted
                null  // no reason
            );
            this.logEvent('✅ Corrida aceita pelo motorista');
        } catch (error) {
            this.logEvent(`❌ Erro ao aceitar corrida: ${error.message}`);
            throw error;
        }
    }

    /**
     * 🚀 Simular início da viagem
     */
    async simulateTripStart() {
        this.logEvent('🚀 Iniciando viagem...');
        
        try {
            const result = await this.wsManager.startTrip(
                this.testData.ride.id,
                this.testData.ride.pickup
            );
            this.logEvent('✅ Viagem iniciada');
        } catch (error) {
            this.logEvent(`❌ Erro ao iniciar viagem: ${error.message}`);
            throw error;
        }
    }

    /**
     * 🏁 Simular conclusão da viagem
     */
    async simulateTripCompletion() {
        this.logEvent('🏁 Concluindo viagem...');
        
        try {
            const result = await this.wsManager.completeTrip(
                this.testData.ride.id,
                this.testData.ride.destination,
                5.2, // km
                this.testData.ride.fare
            );
            this.logEvent('✅ Viagem concluída');
        } catch (error) {
            this.logEvent(`❌ Erro ao concluir viagem: ${error.message}`);
            throw error;
        }
    }

    /**
     * ⭐ Simular avaliação
     */
    async simulateRating() {
        this.logEvent('⭐ Enviando avaliação...');
        
        const ratingData = {
            tripId: this.testData.ride.id,
            customerId: this.testData.customer.id,
            driverId: this.testData.driver.id,
            customerRating: 5,
            driverRating: 4,
            customerComment: 'Excelente motorista!',
            driverComment: 'Cliente muito educado'
        };

        try {
            const result = await this.wsManager.submitRating(ratingData);
            this.logEvent('✅ Avaliação enviada');
        } catch (error) {
            this.logEvent(`❌ Erro ao enviar avaliação: ${error.message}`);
            throw error;
        }
    }

    /**
     * 📡 Configurar listeners de eventos
     */
    setupEventListeners() {
        // Eventos de corrida
        this.wsManager.on('bookingCreated', (data) => {
            this.logEvent(`📡 Evento recebido: bookingCreated - ${JSON.stringify(data)}`);
        });

        this.wsManager.on('paymentConfirmed', (data) => {
            this.logEvent(`📡 Evento recebido: paymentConfirmed - ${JSON.stringify(data)}`);
        });

        this.wsManager.on('rideAccepted', (data) => {
            this.logEvent(`📡 Evento recebido: rideAccepted - ${JSON.stringify(data)}`);
        });

        this.wsManager.on('tripStarted', (data) => {
            this.logEvent(`📡 Evento recebido: tripStarted - ${JSON.stringify(data)}`);
        });

        this.wsManager.on('tripCompleted', (data) => {
            this.logEvent(`📡 Evento recebido: tripCompleted - ${JSON.stringify(data)}`);
        });

        this.wsManager.on('ratingSubmitted', (data) => {
            this.logEvent(`📡 Evento recebido: ratingSubmitted - ${JSON.stringify(data)}`);
        });

        // Eventos de erro
        this.wsManager.on('error', (data) => {
            this.logEvent(`❌ Erro WebSocket: ${JSON.stringify(data)}`);
        });
    }

    /**
     * 📝 Log de eventos
     */
    logEvent(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;
        console.log(logEntry);
        this.eventLog.push(logEntry);
    }

    /**
     * 📊 Imprimir log completo
     */
    printEventLog() {
        console.log('\n📊 LOG COMPLETO DO TESTE:');
        console.log('='.repeat(50));
        this.eventLog.forEach(log => console.log(log));
        console.log('='.repeat(50));
    }

    /**
     * 🔄 Teste de eventos específicos
     */
    async testSpecificEvent(eventName, data) {
        this.logEvent(`🧪 Testando evento específico: ${eventName}`);
        
        switch (eventName) {
            case 'payment':
                await this.simulatePixPayment();
                break;
            case 'driver_accept':
                await this.simulateDriverAcceptance();
                break;
            case 'trip_start':
                await this.simulateTripStart();
                break;
            case 'trip_complete':
                await this.simulateTripCompletion();
                break;
            default:
                this.logEvent(`❌ Evento não reconhecido: ${eventName}`);
        }
    }
}

// Exportar para uso em outros arquivos
export default RideFlowDebugger;

// Função para uso direto no console
export const startRideFlowTest = () => {
    const debugger = new RideFlowDebugger();
    return debugger.startCompleteFlowTest();
};

// Função para teste específico
export const testSpecificEvent = (eventName, data) => {
    const debugger = new RideFlowDebugger();
    return debugger.testSpecificEvent(eventName, data);
};






