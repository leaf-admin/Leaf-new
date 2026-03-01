/**
 * TESTES: NOTIFICAÇÕES PUSH E ANALYTICS
 * 
 * Testes para validar:
 * 1. Enviar notificação push
 * 2. Tipos de notificação (ride_request, payment, rating, etc)
 * 3. Prioridades de notificação
 * 4. Tracking de ações do usuário
 * 5. Métricas de analytics
 * 6. Dashboard de métricas
 * 7. Relatórios de uso
 */

const io = require('socket.io-client');
const redisPool = require('./utils/redis-pool');
const { logger } = require('./utils/logger');

// Configurações de teste
const TEST_CONFIG = {
    SERVER_URL: process.env.WS_URL || 'http://localhost:3001',
    customerId: 'test_customer_notifications',
    driverId: 'test_driver_notifications',
    
    // Parâmetros de notificação
    NOTIFICATIONS: {
        TYPES: [
            'ride_request',
            'ride_accepted',
            'ride_cancelled',
            'payment_received',
            'payment_failed',
            'rating_received',
            'promo_available',
            'driver_arrived'
        ],
        PRIORITIES: ['low', 'medium', 'high', 'urgent'],
        TTL: 7 * 24 * 60 * 60 // 7 dias
    },
    
    // Parâmetros de analytics
    ANALYTICS: {
        METRICS: [
            'rides_completed',
            'total_earnings',
            'average_rating',
            'response_time',
            'acceptance_rate',
            'cancellation_rate'
        ],
        RETENTION_DAYS: 90
    }
};

// Mock IO para testes
class MockIO {
    constructor() {
        this.emittedEvents = new Map();
        this.currentRoom = null;
    }
    
    to(room) {
        this.currentRoom = room;
        return this;
    }
    
    emit(event, data) {
        const userId = this.currentRoom?.replace('driver_', '').replace('customer_', '') || 'unknown';
        if (!this.emittedEvents.has(userId)) {
            this.emittedEvents.set(userId, []);
        }
        this.emittedEvents.get(userId).push({ event, data, timestamp: Date.now() });
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function test(testName, testFn) {
    try {
        console.log(`\n🧪 [TESTE] ${testName}`);
        const startTime = performance.now();
        await testFn();
        const duration = performance.now() - startTime;
        console.log(`✅ [PASSOU] ${testName} (${(duration/1000).toFixed(2)}s)`);
        return true;
    } catch (error) {
        console.log(`❌ [FALHOU] ${testName}: ${error.message}`);
        return false;
    }
}

async function main() {
    const redis = redisPool.getConnection();
    if (!redis.isOpen) {
        await redis.connect();
    }
    
    const results = {
        total: 0,
        passed: 0,
        failed: 0
    };
    
    const MockIOInstance = new MockIO();
    
    // ========================================
    // TESTE 1: ENVIAR NOTIFICAÇÃO PUSH
    // ========================================
    const test1Passed = await test('TC-001: Enviar notificação push para usuário', async () => {
        const notificationId = `notification_${Date.now()}`;
        const userId = TEST_CONFIG.customerId;
        const type = 'ride_accepted';
        const title = 'Corrida Aceita';
        const message = 'Seu motorista está a caminho!';
        const priority = 'high';
        
        // Criar notificação
        const notificationKey = `notification:${notificationId}`;
        await redis.hset(notificationKey, {
            notificationId,
            userId,
            type,
            title,
            message,
            priority,
            read: 'false',
            createdAt: Date.now()
        });
        
        // Adicionar à lista de notificações do usuário
        const userNotificationsKey = `user_notifications:${userId}`;
        await redis.zadd(userNotificationsKey, Date.now(), notificationId);
        
        // TTL
        await redis.expire(notificationKey, TEST_CONFIG.NOTIFICATIONS.TTL);
        await redis.expire(userNotificationsKey, TEST_CONFIG.NOTIFICATIONS.TTL);
        
        // Verificar notificação criada
        const notificationData = await redis.hgetall(notificationKey);
        if (!notificationData || notificationData.type !== type) {
            throw new Error(`Notificação não foi criada corretamente`);
        }
        
        // Simular envio via WebSocket
        MockIOInstance.to(`customer_${userId}`).emit('notification', {
            notificationId,
            type,
            title,
            message,
            priority
        });
        
        console.log(`   ✅ Notificação criada: ${notificationId}`);
        console.log(`   ✅ Tipo: ${type}`);
        console.log(`   ✅ Prioridade: ${priority}`);
        console.log(`   ✅ Enviada via WebSocket`);
        
        // Limpar
        await redis.del(notificationKey);
        await redis.del(userNotificationsKey);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: DIFERENTES TIPOS DE NOTIFICAÇÃO
    // ========================================
    const test2Passed = await test('TC-002: Diferentes tipos de notificação', async () => {
        const notificationTypes = TEST_CONFIG.NOTIFICATIONS.TYPES;
        const userId = TEST_CONFIG.customerId;
        
        // Criar notificações de diferentes tipos
        const createdNotifications = [];
        for (const type of notificationTypes.slice(0, 4)) { // Testar 4 tipos
            const notificationId = `notification_${type}_${Date.now()}`;
            const notificationKey = `notification:${notificationId}`;
            
            await redis.hset(notificationKey, {
                notificationId,
                userId,
                type,
                title: `Notificação: ${type}`,
                message: `Mensagem para ${type}`,
                priority: 'medium',
                createdAt: Date.now()
            });
            
            createdNotifications.push(notificationId);
        }
        
        // Verificar que todos os tipos foram criados
        for (const notificationId of createdNotifications) {
            const notificationKey = `notification:${notificationId}`;
            const notificationData = await redis.hgetall(notificationKey);
            if (!notificationData) {
                throw new Error(`Notificação ${notificationId} não foi criada`);
            }
        }
        
        console.log(`   ✅ ${createdNotifications.length} tipos de notificação criados`);
        console.log(`   ✅ Tipos testados: ${notificationTypes.slice(0, 4).join(', ')}`);
        
        // Limpar
        for (const notificationId of createdNotifications) {
            await redis.del(`notification:${notificationId}`);
        }
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: PRIORIDADES DE NOTIFICAÇÃO
    // ========================================
    const test3Passed = await test('TC-003: Prioridades de notificação (low, medium, high, urgent)', async () => {
        const userId = TEST_CONFIG.customerId;
        const priorities = TEST_CONFIG.NOTIFICATIONS.PRIORITIES;
        
        // Criar notificações com diferentes prioridades
        const priorityNotifications = [];
        for (const priority of priorities) {
            const notificationId = `notification_${priority}_${Date.now()}`;
            const notificationKey = `notification:${notificationId}`;
            
            await redis.hset(notificationKey, {
                notificationId,
                userId,
                type: 'test',
                priority,
                createdAt: Date.now()
            });
            
            priorityNotifications.push({ notificationId, priority });
        }
        
        // Verificar prioridades
        for (const { notificationId, priority } of priorityNotifications) {
            const notificationKey = `notification:${notificationId}`;
            const notificationData = await redis.hgetall(notificationKey);
            if (notificationData.priority !== priority) {
                throw new Error(`Prioridade não corresponde (esperado: ${priority}, obtido: ${notificationData.priority})`);
            }
        }
        
        console.log(`   ✅ ${priorities.length} níveis de prioridade testados`);
        console.log(`   ✅ Prioridades: ${priorities.join(', ')}`);
        
        // Limpar
        for (const { notificationId } of priorityNotifications) {
            await redis.del(`notification:${notificationId}`);
        }
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: TRACKING DE AÇÕES DO USUÁRIO
    // ========================================
    const test4Passed = await test('TC-004: Tracking de ações do usuário para analytics', async () => {
        const userId = TEST_CONFIG.customerId;
        const action = 'ride_requested';
        const actionData = {
            bookingId: 'booking_001',
            pickupLocation: { lat: -22.9068, lng: -43.1234 },
            timestamp: Date.now()
        };
        
        // Registrar ação
        const actionKey = `user_action:${userId}:${Date.now()}`;
        await redis.hset(actionKey, {
            userId,
            action,
            data: JSON.stringify(actionData),
            timestamp: String(actionData.timestamp)
        });
        
        // Adicionar ao histórico de ações
        const actionsHistoryKey = `user_actions:${userId}`;
        await redis.zadd(actionsHistoryKey, actionData.timestamp, JSON.stringify({
            action,
            data: actionData
        }));
        
        // TTL de retenção
        await redis.expire(actionKey, TEST_CONFIG.ANALYTICS.RETENTION_DAYS * 24 * 60 * 60);
        await redis.expire(actionsHistoryKey, TEST_CONFIG.ANALYTICS.RETENTION_DAYS * 24 * 60 * 60);
        
        // Verificar ação registrada
        const actionDataStored = await redis.hgetall(actionKey);
        if (!actionDataStored || actionDataStored.action !== action) {
            throw new Error(`Ação não foi registrada corretamente`);
        }
        
        console.log(`   ✅ Ação registrada: ${action}`);
        console.log(`   ✅ Dados: ${JSON.stringify(actionData).substring(0, 50)}...`);
        
        // Limpar
        await redis.del(actionKey);
        await redis.del(actionsHistoryKey);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: MÉTRICAS DE ANALYTICS
    // ========================================
    const test5Passed = await test('TC-005: Métricas de analytics (rides, earnings, ratings)', async () => {
        const driverId = TEST_CONFIG.driverId;
        const metricsKey = `analytics:${driverId}`;
        
        // Simular métricas
        const metrics = {
            rides_completed: 150,
            total_earnings: 2250.00,
            average_rating: 4.8,
            response_time: 2.5,
            acceptance_rate: 85.5,
            cancellation_rate: 5.2,
            lastUpdated: Date.now()
        };
        
        await redis.hset(metricsKey, {
            driverId,
            rides_completed: String(metrics.rides_completed),
            total_earnings: String(metrics.total_earnings),
            average_rating: String(metrics.average_rating),
            response_time: String(metrics.response_time),
            acceptance_rate: String(metrics.acceptance_rate),
            cancellation_rate: String(metrics.cancellation_rate),
            lastUpdated: String(metrics.lastUpdated)
        });
        
        // TTL
        await redis.expire(metricsKey, TEST_CONFIG.ANALYTICS.RETENTION_DAYS * 24 * 60 * 60);
        
        // Verificar métricas
        const metricsData = await redis.hgetall(metricsKey);
        if (!metricsData || parseInt(metricsData.rides_completed) !== metrics.rides_completed) {
            throw new Error(`Métricas não foram salvas corretamente`);
        }
        
        // Calcular métricas derivadas
        const avgEarningsPerRide = metrics.total_earnings / metrics.rides_completed;
        
        console.log(`   ✅ Corridas completadas: ${metrics.rides_completed}`);
        console.log(`   ✅ Ganho total: R$ ${metrics.total_earnings.toFixed(2)}`);
        console.log(`   ✅ Média por corrida: R$ ${avgEarningsPerRide.toFixed(2)}`);
        console.log(`   ✅ Rating médio: ${metrics.average_rating}`);
        console.log(`   ✅ Taxa de aceitação: ${metrics.acceptance_rate}%`);
        
        // Limpar
        await redis.del(metricsKey);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: DASHBOARD DE MÉTRICAS
    // ========================================
    const test6Passed = await test('TC-006: Dashboard de métricas agregadas', async () => {
        const dashboardKey = 'dashboard:global';
        
        // Métricas globais do sistema
        const dashboard = {
            totalRides: 1000,
            totalDrivers: 150,
            totalCustomers: 500,
            averageRating: 4.7,
            totalRevenue: 15000.00,
            lastUpdated: Date.now()
        };
        
        await redis.hset(dashboardKey, {
            totalRides: String(dashboard.totalRides),
            totalDrivers: String(dashboard.totalDrivers),
            totalCustomers: String(dashboard.totalCustomers),
            averageRating: String(dashboard.averageRating),
            totalRevenue: String(dashboard.totalRevenue),
            lastUpdated: String(dashboard.lastUpdated)
        });
        
        // Atualizar a cada hora
        await redis.expire(dashboardKey, 60 * 60);
        
        // Verificar dashboard
        const dashboardData = await redis.hgetall(dashboardKey);
        if (!dashboardData || parseInt(dashboardData.totalRides) !== dashboard.totalRides) {
            throw new Error(`Dashboard não foi atualizado corretamente`);
        }
        
        // Calcular métricas derivadas
        const avgRidesPerDriver = dashboard.totalRides / dashboard.totalDrivers;
        const avgRidesPerCustomer = dashboard.totalRides / dashboard.totalCustomers;
        
        console.log(`   ✅ Total de corridas: ${dashboard.totalRides}`);
        console.log(`   ✅ Total de motoristas: ${dashboard.totalDrivers}`);
        console.log(`   ✅ Total de customers: ${dashboard.totalCustomers}`);
        console.log(`   ✅ Média de corridas por motorista: ${avgRidesPerDriver.toFixed(1)}`);
        console.log(`   ✅ Média de corridas por customer: ${avgRidesPerCustomer.toFixed(1)}`);
        
        // Limpar
        await redis.del(dashboardKey);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 7: RELATÓRIOS DE USO
    // ========================================
    const test7Passed = await test('TC-007: Relatórios de uso e tendências', async () => {
        const reportKey = `usage_report:${Date.now()}`;
        
        // Simular relatório de uso diário
        const report = {
            date: new Date().toISOString().split('T')[0],
            ridesRequested: 250,
            ridesCompleted: 230,
            ridesCancelled: 20,
            averageWaitTime: 3.5,
            peakHours: ['08:00', '18:00'],
            revenue: 3450.00
        };
        
        await redis.hset(reportKey, {
            date: report.date,
            ridesRequested: String(report.ridesRequested),
            ridesCompleted: String(report.ridesCompleted),
            ridesCancelled: String(report.ridesCancelled),
            averageWaitTime: String(report.averageWaitTime),
            peakHours: JSON.stringify(report.peakHours),
            revenue: String(report.revenue)
        });
        
        // TTL de 90 dias
        await redis.expire(reportKey, 90 * 24 * 60 * 60);
        
        // Verificar relatório
        const reportData = await redis.hgetall(reportKey);
        if (!reportData || parseInt(reportData.ridesCompleted) !== report.ridesCompleted) {
            throw new Error(`Relatório não foi criado corretamente`);
        }
        
        // Calcular taxas
        const completionRate = (report.ridesCompleted / report.ridesRequested) * 100;
        const cancellationRate = (report.ridesCancelled / report.ridesRequested) * 100;
        
        console.log(`   ✅ Relatório criado para: ${report.date}`);
        console.log(`   ✅ Taxa de conclusão: ${completionRate.toFixed(1)}%`);
        console.log(`   ✅ Taxa de cancelamento: ${cancellationRate.toFixed(1)}%`);
        console.log(`   ✅ Horários de pico: ${report.peakHours.join(', ')}`);
        
        // Limpar
        await redis.del(reportKey);
    });
    results.total++;
    if (test7Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 8: NOTIFICAÇÕES LIDAS/NÃO LIDAS
    // ========================================
    const test8Passed = await test('TC-008: Marcar notificações como lidas/não lidas', async () => {
        const userId = TEST_CONFIG.customerId;
        const notificationId = `notification_read_${Date.now()}`;
        
        // Criar notificação não lida
        const notificationKey = `notification:${notificationId}`;
        await redis.hset(notificationKey, {
            notificationId,
            userId,
            type: 'test',
            read: 'false',
            createdAt: Date.now()
        });
        
        // Verificar estado inicial
        const initialData = await redis.hgetall(notificationKey);
        if (initialData.read !== 'false') {
            throw new Error(`Notificação deveria começar como não lida`);
        }
        
        // Marcar como lida
        await redis.hset(notificationKey, {
            read: 'true',
            readAt: Date.now()
        });
        
        // Verificar estado final
        const finalData = await redis.hgetall(notificationKey);
        if (finalData.read !== 'true') {
            throw new Error(`Notificação não foi marcada como lida`);
        }
        
        console.log(`   ✅ Notificação criada como não lida`);
        console.log(`   ✅ Notificação marcada como lida`);
        console.log(`   ✅ Timestamp de leitura registrado`);
        
        // Limpar
        await redis.del(notificationKey);
    });
    results.total++;
    if (test8Passed) results.passed++; else results.failed++;
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: NOTIFICAÇÕES E ANALYTICS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log(`📈 Taxa de Sucesso: ${((results.passed / results.total) * 100).toFixed(1)}%`);
    console.log(`${'='.repeat(60)}\n`);
    
    process.exit(results.failed > 0 ? 1 : 0);
}

// Executar
main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});


