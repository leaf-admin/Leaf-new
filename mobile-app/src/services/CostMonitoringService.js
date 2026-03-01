import Logger from '../utils/Logger';
// CostMonitoringService.js - Monitoramento de custos em tempo real
// Mock para testes Node.js
const AsyncStorage = {
    setItem: async (key, value) => Promise.resolve(),
    getItem: async (key) => Promise.resolve(null),
    removeItem: async (key) => Promise.resolve()
};

class CostMonitoringService {
    constructor() {
        this.costs = {
            google: {
                maps: { requests: 0, cost: 0 },
                firebase: { 
                    functions: { executions: 0, cost: 0 },
                    database: { reads: 0, writes: 0, cost: 0 },
                    auth: { operations: 0, cost: 0 },
                    storage: { operations: 0, cost: 0 }
                }
            },
            apis: {
                payment: { transactions: 0, cost: 0 },
                sms: { messages: 0, cost: 0 },
                email: { messages: 0, cost: 0 }
            },
            infrastructure: {
                redis: { operations: 0, connections: 0, cost: 0 },
                websocket: { connections: 0, messages: 0, cost: 0 },
                bandwidth: { data: 0, cost: 0 }
            },
            mobile: {
                apiCalls: { count: 0, data: 0, cost: 0 },
                location: { updates: 0, cost: 0 },
                battery: { consumption: 0, cost: 0 }
            }
        };
        
        this.pricing = {
            google: {
                maps: {
                    geocoding: 0.025, // R$ 0.025 per request (USD 0.005 * 5.0)
                    directions: 0.025, // R$ 0.025 per request (USD 0.005 * 5.0)
                    places: 0.085 // R$ 0.085 per request (USD 0.017 * 5.0)
                },
                firebase: {
                    functions: 0.0000125, // R$ 0.0000125 per GB-second (USD 0.0000025 * 5.0)
                    database: {
                        reads: 0.0000003, // R$ 0.0000003 per read (USD 0.00000006 * 5.0)
                        writes: 0.0000009 // R$ 0.0000009 per write (USD 0.00000018 * 5.0)
                    },
                    auth: 0.00005, // R$ 0.00005 per operation (USD 0.00001 * 5.0)
                    storage: 0.000002 // R$ 0.000002 per GB (USD 0.0000004 * 5.0)
                }
            },
            apis: {
                payment: {
                    woovi: 0.008, // 0.8% per transaction
                    wooviMinFee: 0.50, // R$ 0.50 minimum fee
                    wooviFixedFee: 1.55, // R$ 1.55 fixed fee
                    // Gateway de cartão ainda não definido
                    stripe: 0.145, // Placeholder - R$ 0.145 per transaction (USD 0.029 * 5.0)
                    paypal: 0.145, // Placeholder - R$ 0.145 per transaction (USD 0.029 * 5.0)
                    baseFee: 1.50 // Placeholder - R$ 1.50 per transaction (USD 0.30 * 5.0)
                },
                sms: 0.375, // R$ 0.375 per SMS (USD 0.075 * 5.0)
                email: 0.0005 // R$ 0.0005 per email (USD 0.0001 * 5.0)
            },
            infrastructure: {
                redis: {
                    operations: 0.000005, // R$ 0.000005 per operation (USD 0.000001 * 5.0)
                    connections: 0.0005 // R$ 0.0005 per connection-hour (USD 0.0001 * 5.0)
                },
                websocket: {
                    connections: 0.0005, // R$ 0.0005 per connection-hour (USD 0.0001 * 5.0)
                    messages: 0.000005 // R$ 0.000005 per message (USD 0.000001 * 5.0)
                },
                bandwidth: 0.60 // R$ 0.60 per GB (USD 0.12 * 5.0)
            },
            mobile: {
                apiCalls: 0.000005, // R$ 0.000005 per API call (USD 0.000001 * 5.0)
                location: 0.000005, // R$ 0.000005 per location update (USD 0.000001 * 5.0)
                battery: 0.0005 // R$ 0.0005 per battery percentage (USD 0.0001 * 5.0)
            }
        };
        
        this.tripCosts = new Map(); // Custo por viagem
        this.userCosts = new Map(); // Custo por usuário
        this.dailyCosts = new Map(); // Custo por dia
        
        Logger.log('💰 CostMonitoringService inicializado');
    }

    // ===== MONITORAMENTO DE CUSTOS GOOGLE =====
    
    async trackGoogleMapsCost(operation, requests = 1) {
        const cost = this.pricing.google.maps[operation] * requests;
        this.costs.google.maps.requests += requests;
        this.costs.google.maps.cost += cost;
        
        Logger.log(`🗺️ Google Maps ${operation}: ${requests} requests, R$${cost.toFixed(6)}`);
        return { requests, cost };
    }

    async trackFirebaseFunctionCost(functionName, executionTime = 1, memoryUsed = 128) {
        // Custo baseado em execuções e memória
        const executions = executionTime;
        const memoryGB = memoryUsed / 1024; // Converter MB para GB
        const cost = executions * this.pricing.google.firebase.functions; // Usar apenas o preço base
        
        this.costs.google.firebase.functions.executions += executions;
        this.costs.google.firebase.functions.cost += cost;
        
        Logger.log(`⚡ Firebase Function ${functionName}: R$${cost.toFixed(6)}`);
        return { functionName, executions, memoryGB, cost };
    }

    async trackFirebaseDatabaseCost(operation, count = 1) {
        const cost = this.pricing.google.firebase.database[operation] * count;
        this.costs.google.firebase.database[operation + 's'] += count;
        this.costs.google.firebase.database.cost += cost;
        
        Logger.log(`🔥 Firebase DB ${operation}: ${count} operations, R$${cost.toFixed(6)}`);
        return { operations: count, cost };
    }

    // ===== MONITORAMENTO DE CUSTOS DE APIS =====
    
    async trackPaymentCost(provider, amount) {
        // Apenas monitorar, não somar aos nossos custos operacionais
        // A taxa Woovi é debitada do valor da corrida, não impacta nosso lucro
        Logger.log(`💳 ${provider} PIX: R$${this.pricing.apis.payment.wooviMinFee.toFixed(4)} (R$${amount}) - Taxa: R$${this.pricing.apis.payment.wooviMinFee.toFixed(4)}`);
        
        // Não somar aos custos operacionais - apenas monitorar
        return { 
            provider, 
            amount, 
            fee: this.pricing.apis.payment.wooviMinFee,
            note: 'Taxa debitada do valor da corrida - não impacta nosso lucro'
        };
    }

    async trackSMSCost(messages = 1) {
        const cost = this.pricing.apis.sms * messages;
        this.costs.apis.sms.messages += messages;
        this.costs.apis.sms.cost += cost;
        
        Logger.log(`📱 SMS: ${messages} messages, R$${cost.toFixed(4)}`);
        return { messages, cost };
    }

    // ===== MONITORAMENTO DE INFRAESTRUTURA =====
    
    async trackRedisCost(operations = 1, connections = 0) {
        const operationsCost = this.pricing.infrastructure.redis.operations * operations;
        const connectionsCost = this.pricing.infrastructure.redis.connections * connections;
        const totalCost = operationsCost + connectionsCost;
        
        this.costs.infrastructure.redis.operations += operations;
        this.costs.infrastructure.redis.connections += connections;
        this.costs.infrastructure.redis.cost += totalCost;
        
        Logger.log(`🔴 Redis: ${operations} ops, ${connections} conns, R$${totalCost.toFixed(6)}`);
        return { operations, connections, cost: totalCost };
    }

    async trackWebSocketCost(connections = 0, messages = 0) {
        const connectionsCost = this.pricing.infrastructure.websocket.connections * connections;
        const messagesCost = this.pricing.infrastructure.websocket.messages * messages;
        const totalCost = connectionsCost + messagesCost;
        
        this.costs.infrastructure.websocket.connections += connections;
        this.costs.infrastructure.websocket.messages += messages;
        this.costs.infrastructure.websocket.cost += totalCost;
        
        Logger.log(`🔌 WebSocket: ${connections} conns, ${messages} msgs, R$${totalCost.toFixed(6)}`);
        return { connections, messages, cost: totalCost };
    }

    // ===== MONITORAMENTO MOBILE =====
    
    async trackMobileAPICost(calls = 1, dataSize = 0) {
        const callsCost = this.pricing.mobile.apiCalls * calls;
        const dataCost = this.pricing.infrastructure.bandwidth * (dataSize / 1024 / 1024); // Convert to GB
        const totalCost = callsCost + dataCost;
        
        this.costs.mobile.apiCalls.count += calls;
        this.costs.mobile.apiCalls.data += dataSize;
        this.costs.mobile.apiCalls.cost += totalCost;
        
        Logger.log(`📱 Mobile API: ${calls} calls, ${dataSize} bytes, R$${totalCost.toFixed(6)}`);
        return { calls, dataSize, cost: totalCost };
    }

    async trackLocationCost(updates = 1) {
        const cost = this.pricing.mobile.location * updates;
        this.costs.mobile.location.updates += updates;
        this.costs.mobile.location.cost += cost;
        
        Logger.log(`📍 Location: ${updates} updates, R$${cost.toFixed(6)}`);
        return { updates, cost };
    }

    // ===== CÁLCULO DE RECEITA E LUCRO =====
    
    calculateOperationalRevenue(tripAmount) {
        // Nossa receita é a taxa operacional de R$ 1.55 por corrida
        const operationalFee = this.pricing.apis.payment.wooviFixedFee; // R$ 1.55
        return operationalFee;
    }
    
    calculateWooviFee(tripAmount) {
        // Taxa do Woovi: 0.8% do valor da transação
        const percentageFee = tripAmount * this.pricing.apis.payment.woovi;
        const minFeeBRL = this.pricing.apis.payment.wooviMinFee;
        return Math.max(percentageFee, minFeeBRL);
    }
    
    calculateDriverPayment(tripAmount) {
        // Motorista recebe: valor total da corrida (sem deduções)
        return tripAmount;
    }
    
    calculateProfit(tripAmount, totalCosts) {
        // Nosso lucro: taxa operacional - custos operacionais
        const operationalRevenue = this.calculateOperationalRevenue(tripAmount);
        return operationalRevenue - totalCosts;
    }

    // ===== CUSTO POR VIAGEM =====
    
    async startTripCost(tripId, userId) {
        const tripCost = {
            tripId,
            userId,
            startTime: Date.now(),
            costs: {
                google: { maps: 0, firebase: 0 },
                apis: { payment: 0, sms: 0 },
                infrastructure: { redis: 0, websocket: 0 },
                mobile: { api: 0, location: 0 }
            },
            total: 0
        };
        
        this.tripCosts.set(tripId, tripCost);
        Logger.log(`🚗 Iniciando monitoramento de custos para viagem ${tripId}`);
        return tripCost;
    }

    async addTripCost(tripId, category, subcategory, cost) {
        const tripCost = this.tripCosts.get(tripId);
        if (tripCost) {
            tripCost.costs[category][subcategory] += cost;
            tripCost.total += cost;
            Logger.log(`💰 Viagem ${tripId}: +$${cost.toFixed(6)} (${category}.${subcategory})`);
        }
    }

    async endTripCost(tripId) {
        const tripCost = this.tripCosts.get(tripId);
        if (tripCost) {
            tripCost.endTime = Date.now();
            tripCost.duration = tripCost.endTime - tripCost.startTime;
            
            Logger.log(`🏁 Viagem ${tripId} finalizada:`);
            Logger.log(`   ⏱️  Duração: ${tripCost.duration}ms`);
            Logger.log(`   💰 Custo total: $${tripCost.total.toFixed(6)}`);
            Logger.log(`   📊 Detalhes:`, tripCost.costs);
            
            // Salvar no histórico
            await this.saveTripCost(tripCost);
            
            return tripCost;
        }
    }

    // ===== CUSTO POR USUÁRIO =====
    
    async trackUserCost(userId, category, subcategory, cost) {
        if (!this.userCosts.has(userId)) {
            this.userCosts.set(userId, {
                userId,
                totalCost: 0,
                costs: {
                    google: { maps: 0, firebase: 0 },
                    apis: { payment: 0, sms: 0 },
                    infrastructure: { redis: 0, websocket: 0 },
                    mobile: { api: 0, location: 0 }
                },
                trips: 0,
                lastActivity: Date.now()
            });
        }
        
        const userCost = this.userCosts.get(userId);
        userCost.costs[category][subcategory] += cost;
        userCost.totalCost += cost;
        userCost.lastActivity = Date.now();
        
        Logger.log(`👤 Usuário ${userId}: +$${cost.toFixed(6)} (${category}.${subcategory})`);
        return userCost;
    }

    // ===== CUSTO DIÁRIO =====
    
    async trackDailyCost(category, subcategory, cost) {
        const today = new Date().toISOString().split('T')[0];
        
        if (!this.dailyCosts.has(today)) {
            this.dailyCosts.set(today, {
                date: today,
                totalCost: 0,
                costs: {
                    google: { maps: 0, firebase: 0 },
                    apis: { payment: 0, sms: 0 },
                    infrastructure: { redis: 0, websocket: 0 },
                    mobile: { api: 0, location: 0 }
                },
                trips: 0,
                users: 0
            });
        }
        
        const dailyCost = this.dailyCosts.get(today);
        dailyCost.costs[category][subcategory] += cost;
        dailyCost.totalCost += cost;
        
        Logger.log(`📅 ${today}: +$${cost.toFixed(6)} (${category}.${subcategory})`);
        return dailyCost;
    }

    // ===== RELATÓRIOS E ANÁLISES =====
    
    async getTripCostReport(tripId) {
        const tripCost = this.tripCosts.get(tripId);
        if (!tripCost) return null;
        
        return {
            tripId: tripCost.tripId,
            userId: tripCost.userId,
            duration: tripCost.duration,
            totalCost: tripCost.total,
            breakdown: tripCost.costs,
            costPerMinute: tripCost.total / (tripCost.duration / 60000),
            sustainability: this.calculateSustainability(tripCost.total)
        };
    }

    async getUserCostReport(userId) {
        const userCost = this.userCosts.get(userId);
        if (!userCost) return null;
        
        return {
            userId: userCost.userId,
            totalCost: userCost.totalCost,
            breakdown: userCost.costs,
            trips: userCost.trips,
            averageCostPerTrip: userCost.totalCost / userCost.trips,
            lastActivity: userCost.lastActivity,
            sustainability: this.calculateSustainability(userCost.totalCost)
        };
    }

    async getDailyCostReport(date = null) {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dailyCost = this.dailyCosts.get(targetDate);
        if (!dailyCost) return null;
        
        return {
            date: dailyCost.date,
            totalCost: dailyCost.totalCost,
            breakdown: dailyCost.costs,
            trips: dailyCost.trips,
            users: dailyCost.users,
            averageCostPerTrip: dailyCost.totalCost / dailyCost.trips,
            sustainability: this.calculateSustainability(dailyCost.totalCost)
        };
    }

    async getSustainabilityReport() {
        const totalCost = this.calculateTotalCost();
        const sustainability = this.calculateSustainability(totalCost);
        
        return {
            totalCost,
            sustainability,
            recommendations: this.generateRecommendations(),
            breakdown: this.costs,
            topCostDrivers: this.identifyTopCostDrivers()
        };
    }

    // ===== CÁLCULOS DE SUSTENTABILIDADE =====
    
    calculateTotalCost() {
        let total = 0;
        
        // Google costs
        total += this.costs.google.maps.cost;
        total += this.costs.google.firebase.functions.cost;
        total += this.costs.google.firebase.database.cost;
        total += this.costs.google.firebase.auth.cost;
        total += this.costs.google.firebase.storage.cost;
        
        // API costs
        total += this.costs.apis.payment.cost;
        total += this.costs.apis.sms.cost;
        total += this.costs.apis.email.cost;
        
        // Infrastructure costs
        total += this.costs.infrastructure.redis.cost;
        total += this.costs.infrastructure.websocket.cost;
        total += this.costs.infrastructure.bandwidth.cost;
        
        // Mobile costs
        total += this.costs.mobile.apiCalls.cost;
        total += this.costs.mobile.location.cost;
        total += this.costs.mobile.battery.cost;
        
        return total;
    }

    calculateSustainability(totalCost) {
        // Assumindo que uma viagem média custa $10 para o usuário
        const averageTripRevenue = 10;
        const costPercentage = (totalCost / averageTripRevenue) * 100;
        
        if (costPercentage < 10) return { level: 'EXCELLENT', percentage: costPercentage };
        if (costPercentage < 20) return { level: 'GOOD', percentage: costPercentage };
        if (costPercentage < 30) return { level: 'ACCEPTABLE', percentage: costPercentage };
        if (costPercentage < 50) return { level: 'CONCERNING', percentage: costPercentage };
        return { level: 'CRITICAL', percentage: costPercentage };
    }

    generateRecommendations() {
        const recommendations = [];
        const totalCost = this.calculateTotalCost();
        
        // Análise de custos por categoria
        if (this.costs.google.maps.cost > totalCost * 0.3) {
            recommendations.push('🔴 Google Maps representa mais de 30% dos custos. Considere cache local e otimização de queries.');
        }
        
        if (this.costs.google.firebase.functions.cost > totalCost * 0.2) {
            recommendations.push('⚡ Firebase Functions representa mais de 20% dos custos. Otimize execuções e memória.');
        }
        
        if (this.costs.apis.payment.cost > totalCost * 0.4) {
            recommendations.push('💳 Custos de pagamento são altos. Negocie taxas com gateways ou considere alternativas.');
        }
        
        if (this.costs.infrastructure.redis.cost > totalCost * 0.1) {
            recommendations.push('🔴 Redis representa mais de 10% dos custos. Otimize operações e conexões.');
        }
        
        return recommendations;
    }

    identifyTopCostDrivers() {
        const drivers = [
            { name: 'Google Maps', cost: this.costs.google.maps.cost },
            { name: 'Firebase Functions', cost: this.costs.google.firebase.functions.cost },
            { name: 'Firebase Database', cost: this.costs.google.firebase.database.cost },
            { name: 'Payment APIs', cost: this.costs.apis.payment.cost },
            { name: 'SMS', cost: this.costs.apis.sms.cost },
            { name: 'Redis', cost: this.costs.infrastructure.redis.cost },
            { name: 'WebSocket', cost: this.costs.infrastructure.websocket.cost },
            { name: 'Mobile API', cost: this.costs.mobile.apiCalls.cost }
        ];
        
        return drivers
            .filter(driver => driver.cost > 0)
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 5);
    }

    // ===== PERSISTÊNCIA =====
    
    async saveTripCost(tripCost) {
        try {
            const key = `trip_cost_${tripCost.tripId}`;
            await AsyncStorage.setItem(key, JSON.stringify(tripCost));
            Logger.log(`💾 Custo da viagem ${tripCost.tripId} salvo`);
        } catch (error) {
            Logger.error('❌ Erro ao salvar custo da viagem:', error);
        }
    }

    async loadTripCost(tripId) {
        try {
            const key = `trip_cost_${tripId}`;
            const data = await AsyncStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            Logger.error('❌ Erro ao carregar custo da viagem:', error);
            return null;
        }
    }

    // ===== RESET E LIMPEZA =====
    
    async resetCosts() {
        this.costs = {
            google: {
                maps: { requests: 0, cost: 0 },
                firebase: { 
                    functions: { executions: 0, cost: 0 },
                    database: { reads: 0, writes: 0, cost: 0 },
                    auth: { operations: 0, cost: 0 },
                    storage: { operations: 0, cost: 0 }
                }
            },
            apis: {
                payment: { transactions: 0, cost: 0 },
                sms: { messages: 0, cost: 0 },
                email: { messages: 0, cost: 0 }
            },
            infrastructure: {
                redis: { operations: 0, connections: 0, cost: 0 },
                websocket: { connections: 0, messages: 0, cost: 0 },
                bandwidth: { data: 0, cost: 0 }
            },
            mobile: {
                apiCalls: { count: 0, data: 0, cost: 0 },
                location: { updates: 0, cost: 0 },
                battery: { consumption: 0, cost: 0 }
            }
        };
        
        Logger.log('🔄 Custos resetados');
    }

    async getCurrentCosts() {
        return {
            ...this.costs,
            total: this.calculateTotalCost(),
            sustainability: this.calculateSustainability(this.calculateTotalCost())
        };
    }

    // ===== SIMULAÇÃO DE CORRIDA REAL COM TRACKING 2-3 SEGUNDOS =====
    async simulateRealTrip() {
        Logger.log('🚗 SIMULAÇÃO DE CORRIDA REAL COM TRACKING 2-3 SEGUNDOS');
        
        // Dados da corrida
        const tripDuration = 28; // minutos
        const trackingInterval = 2.5; // segundos (média entre 2-3 segundos)
        const trackingUpdatesPerMinute = 60 / trackingInterval; // 24 updates por minuto
        const totalTrackingUpdates = tripDuration * trackingUpdatesPerMinute; // 672 updates
        
        // FASE 1: Busca de viagem (2 minutos)
        Logger.log('\n📍 FASE 1: BUSCA DE VIAGEM (2 minutos)');
        await this.trackGoogleMapsCost('geocoding', 2); // Origem + destino
        await this.trackGoogleMapsCost('directions', 1); // Rota inicial
        await this.trackRedisCost(10, 1); // Operações Redis
        await this.trackMobileAPICost(3); // Chamadas API
        await this.trackLocationCost(4); // Updates de localização
        
        // FASE 2: Aceitação da viagem (30 segundos)
        Logger.log('\n✅ FASE 2: ACEITAÇÃO DA VIAGEM (30 segundos)');
        await this.trackFirebaseFunctionCost('update_booking', 1);
        await this.trackFirebaseDatabaseCost('reads', 3);
        await this.trackFirebaseDatabaseCost('writes', 3);
        await this.trackWebSocketCost(2, 10); // 2 conexões + 10 mensagens
        
        // FASE 3: Motorista indo até o ponto de embarque (5 minutos)
        Logger.log('\n🚗 FASE 3: MOTORISTA INDO ATÉ EMBARQUE (5 minutos)');
        const pickupTrackingUpdates = 5 * trackingUpdatesPerMinute; // 120 updates
        await this.trackLocationCost(pickupTrackingUpdates);
        await this.trackMobileAPICost(pickupTrackingUpdates);
        await this.trackRedisCost(pickupTrackingUpdates * 2, 1); // 2 operações por update
        await this.trackWebSocketCost(0, pickupTrackingUpdates);
        
        // FASE 4: Viagem em andamento (20 minutos) - TRACKING 2-3 SEGUNDOS
        Logger.log('\n🚗 FASE 4: VIAGEM EM ANDAMENTO (20 minutos) - TRACKING 2-3 SEGUNDOS');
        const tripTrackingUpdates = 20 * trackingUpdatesPerMinute; // 480 updates
        await this.trackLocationCost(tripTrackingUpdates);
        await this.trackMobileAPICost(tripTrackingUpdates);
        await this.trackRedisCost(tripTrackingUpdates * 2, 1); // 2 operações por update
        await this.trackWebSocketCost(0, tripTrackingUpdates);
        
        // FASE 5: Finalização e pagamento (2 minutos)
        Logger.log('\n💳 FASE 5: FINALIZAÇÃO E PAGAMENTO (2 minutos)');
        await this.trackFirebaseFunctionCost('complete_trip', 1);
        await this.trackFirebaseDatabaseCost('reads', 5);
        await this.trackFirebaseDatabaseCost('writes', 5);
        await this.trackPaymentCost('woovi', 30.00); // Valor da corrida
        
        // Estatísticas finais
        const costs = await this.getCurrentCosts();
        const totalCost = costs.total;
        
        Logger.log('\n📊 ESTATÍSTICAS FINAIS:');
        Logger.log(`   Total de tracking updates: ${totalTrackingUpdates}`);
        Logger.log(`   Updates por minuto: ${trackingUpdatesPerMinute}`);
        Logger.log(`   Intervalo de tracking: ${trackingInterval} segundos`);
        Logger.log(`   Custo total da corrida: R$ ${totalCost.toFixed(6)}`);
        
        return {
            totalCost,
            trackingUpdates: totalTrackingUpdates,
            trackingInterval,
            costs
        };
    }
}

// Instância singleton
const costMonitoringService = new CostMonitoringService();

module.exports = { costMonitoringService }; 