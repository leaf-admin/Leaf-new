/**
 * 🐛 DEBUG ESPECÍFICO DO DRIVER SIDE
 * 
 * Teste focado em debugar por que o driver não recebe rideRequest
 */

const io = require('socket.io-client');

class DriverSideDebugger {
    constructor() {
        this.baseUrl = 'http://localhost:3001';
        this.driverEvents = [];
        this.customerEvents = [];
    }

    async debugDriverSide() {
        console.log('🐛 DEBUG ESPECÍFICO DO DRIVER SIDE');
        console.log('='.repeat(50));
        
        // Criar driver primeiro
        const driverSocket = io(this.baseUrl, { 
            transports: ['websocket', 'polling'],
            reconnection: false 
        });

        return new Promise((resolve) => {
            driverSocket.on('connect', () => {
                console.log('🚗 DRIVER conectado:', driverSocket.id);
                
                // Configurar listeners do driver
                this.setupDriverListeners(driverSocket);
                
                // Aguardar 2 segundos e criar customer
                setTimeout(() => {
                    this.createCustomerAndTest(driverSocket, resolve);
                }, 2000);
            });

            driverSocket.on('connect_error', (error) => {
                console.error('❌ Erro conectando driver:', error);
                resolve();
            });
        });
    }

    setupDriverListeners(socket) {
        // Listener específico para rideRequest
        socket.on('rideRequest', (data) => {
            this.driverEvents.push({ type: 'rideRequest', data, timestamp: Date.now() });
            console.log('🎯 DRIVER RECEBEU rideRequest:', data);
        });

        // Listener para TODOS os eventos (debug)
        socket.onAny((eventName, ...args) => {
            if (eventName !== 'rideRequest') {
                this.driverEvents.push({ type: eventName, data: args, timestamp: Date.now() });
                console.log(`🔍 DRIVER recebeu evento: ${eventName}`, args.length > 0 ? args[0] : 'sem dados');
            }
        });

        // Listener para conexão/desconexão
        socket.on('disconnect', () => {
            console.log('🔌 DRIVER desconectado');
        });
    }

    async createCustomerAndTest(driverSocket, resolve) {
        const customerSocket = io(this.baseUrl, { 
            transports: ['websocket', 'polling'],
            reconnection: false 
        });

        customerSocket.on('connect', () => {
            console.log('👤 CUSTOMER conectado:', customerSocket.id);
            
            // Configurar listeners do customer
            this.setupCustomerListeners(customerSocket);
            
            // Aguardar 1 segundo e executar teste
            setTimeout(() => {
                this.executeTest(customerSocket, driverSocket, resolve);
            }, 1000);
        });
    }

    setupCustomerListeners(socket) {
        socket.on('bookingCreated', (data) => {
            this.customerEvents.push({ type: 'bookingCreated', data, timestamp: Date.now() });
            console.log('✅ CUSTOMER: bookingCreated');
        });

        socket.on('paymentConfirmed', (data) => {
            this.customerEvents.push({ type: 'paymentConfirmed', data, timestamp: Date.now() });
            console.log('💳 CUSTOMER: paymentConfirmed');
        });

        socket.on('rideAccepted', (data) => {
            this.customerEvents.push({ type: 'rideAccepted', data, timestamp: Date.now() });
            console.log('✅ CUSTOMER: rideAccepted');
        });
    }

    async executeTest(customerSocket, driverSocket, resolve) {
        try {
            console.log('\n🚀 EXECUTANDO TESTE DE DEBUG...\n');

            // 1. Customer solicita corrida
            console.log('1️⃣ CUSTOMER: Solicitando corrida...');
            customerSocket.emit('createBooking', {
                customerId: 'debug_customer_driver',
                pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                estimatedFare: 25.50,
                paymentMethod: 'PIX'
            });

            // Aguardar criação da corrida
            await this.waitForEvent('CUSTOMER', 'bookingCreated');
            
            // 2. Customer processa pagamento
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
            
            // 3. Aguardar driver receber rideRequest
            console.log('\n3️⃣ DRIVER: Aguardando rideRequest...');
            try {
                await this.waitForEvent('DRIVER', 'rideRequest', 10000);
                console.log('✅ DRIVER: Recebeu rideRequest com sucesso!');
            } catch (error) {
                console.log('❌ DRIVER: NÃO recebeu rideRequest:', error.message);
            }
            
            // 4. Aguardar aceitação automática
            console.log('\n4️⃣ CUSTOMER: Aguardando aceitação automática...');
            try {
                await this.waitForEvent('CUSTOMER', 'rideAccepted', 10000);
                console.log('✅ CUSTOMER: Recebeu rideAccepted');
            } catch (error) {
                console.log('❌ CUSTOMER: NÃO recebeu rideAccepted:', error.message);
            }
            
            // Mostrar relatório final
            console.log('\n📊 RELATÓRIO DE DEBUG:');
            console.log('='.repeat(50));
            
            console.log('\n👤 EVENTOS DO CUSTOMER:');
            this.customerEvents.forEach((event, index) => {
                console.log(`${index + 1}. ${event.type} - ${new Date(event.timestamp).toLocaleTimeString()}`);
            });
            
            console.log('\n🚗 EVENTOS DO DRIVER:');
            this.driverEvents.forEach((event, index) => {
                console.log(`${index + 1}. ${event.type} - ${new Date(event.timestamp).toLocaleTimeString()}`);
            });
            
            console.log('\n🎯 ANÁLISE:');
            const driverReceivedRideRequest = this.driverEvents.some(e => e.type === 'rideRequest');
            if (driverReceivedRideRequest) {
                console.log('✅ DRIVER está recebendo rideRequest corretamente');
            } else {
                console.log('❌ DRIVER NÃO está recebendo rideRequest');
                console.log('🔍 Possíveis causas:');
                console.log('   - Servidor não está enviando para o driver');
                console.log('   - Driver não está escutando o evento correto');
                console.log('   - Problema de timing na conexão');
                console.log('   - Problema de transporte (WebSocket vs Polling)');
            }
            
            resolve();
            
        } catch (error) {
            console.error('❌ Erro no teste:', error);
            resolve();
        } finally {
            customerSocket.disconnect();
            driverSocket.disconnect();
        }
    }

    waitForEvent(side, eventType, timeout = 5000) {
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
}

// Executar debug
if (require.main === module) {
    const driverDebugger = new DriverSideDebugger();
    driverDebugger.debugDriverSide().catch(console.error);
}

module.exports = DriverSideDebugger;
