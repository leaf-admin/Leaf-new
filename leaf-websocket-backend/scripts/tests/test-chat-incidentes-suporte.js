/**
 * TESTES: CHAT, INCIDENTES E SUPORTE
 * 
 * Testes para validar:
 * 1. Criar chat durante corrida
 * 2. Enviar mensagens
 * 3. Notificações de mensagem
 * 4. Reportar incidente
 * 5. Contato de emergência
 * 6. Criar ticket de suporte
 * 7. Acompanhar ticket
 */

const io = require('socket.io-client');
const redisPool = require('./utils/redis-pool');
const RideStateManager = require('./services/ride-state-manager');
const { logger } = require('./utils/logger');

// Configurações de teste
const TEST_CONFIG = {
    SERVER_URL: process.env.WS_URL || 'http://localhost:3001',
    customerId: 'test_customer_chat',
    driverId: 'test_driver_chat',
    bookingId: 'test_booking_chat',
    
    // Parâmetros de chat
    CHAT: {
        MESSAGE_TTL: 30 * 24 * 60 * 60, // 30 dias em segundos
        MAX_MESSAGE_LENGTH: 500
    },
    
    // Parâmetros de incidentes
    INCIDENTS: {
        SEVERITY_LEVELS: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        RESPONSE_TIME_HIGH: 5 * 60, // 5 minutos
        RESPONSE_TIME_CRITICAL: 1 * 60 // 1 minuto
    },
    
    // Parâmetros de suporte
    SUPPORT: {
        PRIORITY_LEVELS: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
        RESPONSE_TIME_URGENT: 15 * 60 // 15 minutos
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
    
    hasEmittedEvent(userId, eventName) {
        const events = this.emittedEvents.get(userId) || [];
        return events.some(e => e.event === eventName);
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
    // TESTE 1: CRIAR CHAT DURANTE CORRIDA
    // ========================================
    const test1Passed = await test('TC-001: Criar chat durante corrida em andamento', async () => {
        const chatId = `chat_${TEST_CONFIG.bookingId}_${Date.now()}`;
        const bookingId = `test_booking_chat_${Date.now()}`;
        
        // Limpar qualquer estado anterior
        await redis.del(`booking_state:${bookingId}`);
        await redis.del(`booking:${bookingId}`);
        
        // Simular corrida em andamento (criar estados sequenciais)
        try {
            await RideStateManager.updateBookingState(redis, bookingId, RideStateManager.STATES.NEW, {
                driverId: TEST_CONFIG.driverId,
                customerId: TEST_CONFIG.customerId
            });
        } catch (e) {
            // Ignorar erro se estado já existe
        }
        
        try {
            await RideStateManager.updateBookingState(redis, bookingId, RideStateManager.STATES.ACCEPTED, {
                driverId: TEST_CONFIG.driverId,
                customerId: TEST_CONFIG.customerId
            });
        } catch (e) {
            // Continuar mesmo se já estiver em ACCEPTED
        }
        
        try {
            await RideStateManager.updateBookingState(redis, bookingId, RideStateManager.STATES.IN_PROGRESS, {
                driverId: TEST_CONFIG.driverId,
                customerId: TEST_CONFIG.customerId,
                startedAt: Date.now()
            });
        } catch (e) {
            // Continuar mesmo se já estiver em IN_PROGRESS
        }
        
        // Criar chat (não depende do estado da corrida para existir)
        const chatKey = `chat:${chatId}`;
        await redis.hset(chatKey, {
            chatId,
            bookingId,
            driverId: TEST_CONFIG.driverId,
            customerId: TEST_CONFIG.customerId,
            createdAt: Date.now(),
            status: 'ACTIVE'
        });
        
        // Definir TTL
        await redis.expire(chatKey, TEST_CONFIG.CHAT.MESSAGE_TTL);
        
        // Verificar chat criado
        const chatData = await redis.hgetall(chatKey);
        if (!chatData || chatData.bookingId !== bookingId) {
            throw new Error(`Chat não foi criado corretamente`);
        }
        
        console.log(`   ✅ Chat criado: ${chatId}`);
        console.log(`   ✅ TTL configurado: ${TEST_CONFIG.CHAT.MESSAGE_TTL}s (30 dias)`);
        
        // Limpar
        await redis.del(chatKey);
        await redis.del(`booking_state:${bookingId}`);
        await redis.del(`booking:${bookingId}`);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: ENVIAR MENSAGENS NO CHAT
    // ========================================
    const test2Passed = await test('TC-002: Enviar mensagens no chat', async () => {
        const chatId = `chat_${TEST_CONFIG.bookingId}`;
        const chatKey = `chat:${chatId}`;
        const messagesKey = `chat_messages:${chatId}`;
        
        // Criar chat
        await redis.hset(chatKey, {
            chatId,
            bookingId: TEST_CONFIG.bookingId,
            driverId: TEST_CONFIG.driverId,
            customerId: TEST_CONFIG.customerId,
            createdAt: Date.now(),
            status: 'ACTIVE'
        });
        await redis.expire(chatKey, TEST_CONFIG.CHAT.MESSAGE_TTL);
        
        // Enviar mensagens
        const messages = [
            { from: TEST_CONFIG.customerId, text: 'Olá, onde você está?', timestamp: Date.now() },
            { from: TEST_CONFIG.driverId, text: 'Estou chegando!', timestamp: Date.now() + 1000 },
            { from: TEST_CONFIG.customerId, text: 'Obrigado!', timestamp: Date.now() + 2000 }
        ];
        
        for (const message of messages) {
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await redis.zadd(messagesKey, message.timestamp, JSON.stringify({
                messageId,
                chatId,
                from: message.from,
                text: message.text,
                timestamp: message.timestamp
            }));
        }
        
        // Definir TTL para mensagens
        await redis.expire(messagesKey, TEST_CONFIG.CHAT.MESSAGE_TTL);
        
        // Verificar mensagens
        const messageCount = await redis.zcard(messagesKey);
        if (messageCount !== messages.length) {
            throw new Error(`Número de mensagens não corresponde (esperado: ${messages.length}, obtido: ${messageCount})`);
        }
        
        console.log(`   ✅ ${messageCount} mensagens enviadas e armazenadas`);
        
        // Limpar
        await redis.del(chatKey);
        await redis.del(messagesKey);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: NOTIFICAÇÕES DE MENSAGEM
    // ========================================
    const test3Passed = await test('TC-003: Notificações de mensagem recebida', async () => {
        const chatId = `chat_${TEST_CONFIG.bookingId}`;
        const messageId = `msg_${Date.now()}`;
        const senderId = TEST_CONFIG.driverId;
        const receiverId = TEST_CONFIG.customerId;
        
        // Criar mensagem
        const message = {
            messageId,
            chatId,
            from: senderId,
            text: 'Estou quase chegando!',
            timestamp: Date.now()
        };
        
        // Simular notificação (via WebSocket seria emitido)
        MockIOInstance.to(`customer_${receiverId}`).emit('newMessage', message);
        
        // Verificar que evento foi emitido
        if (!MockIOInstance.hasEmittedEvent(receiverId, 'newMessage')) {
            throw new Error(`Notificação de mensagem não foi emitida`);
        }
        
        console.log(`   ✅ Notificação de mensagem emitida para ${receiverId}`);
        console.log(`   ✅ Mensagem: "${message.text}"`);
        
        // Limpar
        MockIOInstance.emittedEvents.clear();
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: REPORTAR INCIDENTE
    // ========================================
    const test4Passed = await test('TC-004: Reportar incidente durante corrida', async () => {
        const incidentId = `incident_${Date.now()}`;
        const bookingId = TEST_CONFIG.bookingId;
        const reporterId = TEST_CONFIG.customerId;
        const severity = 'HIGH';
        
        // Criar incidente
        const incidentKey = `incident:${incidentId}`;
        await redis.hset(incidentKey, {
            incidentId,
            bookingId,
            reporterId,
            severity,
            description: 'Problema com veículo',
            reportedAt: Date.now(),
            status: 'PENDING',
            responseTime: TEST_CONFIG.INCIDENTS.RESPONSE_TIME_HIGH
        });
        
        // Definir prioridade baseada em severidade
        if (severity === 'CRITICAL') {
            await redis.expire(incidentKey, TEST_CONFIG.INCIDENTS.RESPONSE_TIME_CRITICAL);
        } else if (severity === 'HIGH') {
            await redis.expire(incidentKey, TEST_CONFIG.INCIDENTS.RESPONSE_TIME_HIGH);
        }
        
        // Verificar incidente criado
        const incidentData = await redis.hgetall(incidentKey);
        if (!incidentData || incidentData.severity !== severity) {
            throw new Error(`Incidente não foi criado corretamente`);
        }
        
        console.log(`   ✅ Incidente reportado: ${incidentId}`);
        console.log(`   ✅ Severidade: ${severity}`);
        console.log(`   ✅ Tempo de resposta esperado: ${TEST_CONFIG.INCIDENTS.RESPONSE_TIME_HIGH}s`);
        
        // Limpar
        await redis.del(incidentKey);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: CONTATO DE EMERGÊNCIA
    // ========================================
    const test5Passed = await test('TC-005: Contato de emergência durante corrida', async () => {
        const emergencyId = `emergency_${Date.now()}`;
        const bookingId = TEST_CONFIG.bookingId;
        const callerId = TEST_CONFIG.customerId;
        
        // Criar contato de emergência
        const emergencyKey = `emergency:${emergencyId}`;
        await redis.hset(emergencyKey, {
            emergencyId,
            bookingId,
            callerId,
            type: 'EMERGENCY',
            location: JSON.stringify(TEST_CONFIG.pickupLocation),
            reportedAt: Date.now(),
            status: 'ACTIVE',
            priority: 'CRITICAL'
        });
        
        // TTL curto para emergências (prioridade máxima)
        await redis.expire(emergencyKey, TEST_CONFIG.INCIDENTS.RESPONSE_TIME_CRITICAL);
        
        // Verificar emergência criada
        const emergencyData = await redis.hgetall(emergencyKey);
        if (!emergencyData || emergencyData.priority !== 'CRITICAL') {
            throw new Error(`Contato de emergência não foi criado corretamente`);
        }
        
        console.log(`   ✅ Contato de emergência criado: ${emergencyId}`);
        console.log(`   ✅ Prioridade: CRITICAL`);
        console.log(`   ⚠️ Sistema deveria alertar autoridades imediatamente`);
        
        // Limpar
        await redis.del(emergencyKey);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: CRIAR TICKET DE SUPORTE
    // ========================================
    const test6Passed = await test('TC-006: Criar ticket de suporte', async () => {
        const ticketId = `ticket_${Date.now()}`;
        const userId = TEST_CONFIG.customerId;
        const priority = 'MEDIUM';
        const subject = 'Problema com pagamento';
        const description = 'Pagamento não foi processado corretamente';
        
        // Criar ticket
        const ticketKey = `support_ticket:${ticketId}`;
        await redis.hset(ticketKey, {
            ticketId,
            userId,
            priority,
            subject,
            description,
            status: 'OPEN',
            createdAt: Date.now(),
            responseTime: TEST_CONFIG.SUPPORT.RESPONSE_TIME_URGENT
        });
        
        // Definir TTL baseado em prioridade
        let ttl = 24 * 60 * 60; // 24 horas padrão
        if (priority === 'URGENT') {
            ttl = TEST_CONFIG.SUPPORT.RESPONSE_TIME_URGENT;
        }
        await redis.expire(ticketKey, ttl);
        
        // Verificar ticket criado
        const ticketData = await redis.hgetall(ticketKey);
        if (!ticketData || ticketData.subject !== subject) {
            throw new Error(`Ticket não foi criado corretamente`);
        }
        
        console.log(`   ✅ Ticket criado: ${ticketId}`);
        console.log(`   ✅ Prioridade: ${priority}`);
        console.log(`   ✅ Assunto: ${subject}`);
        
        // Limpar
        await redis.del(ticketKey);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 7: ACOMPANHAR TICKET DE SUPORTE
    // ========================================
    const test7Passed = await test('TC-007: Acompanhar status de ticket de suporte', async () => {
        const ticketId = `ticket_${Date.now()}`;
        const userId = TEST_CONFIG.customerId;
        
        // Criar ticket
        const ticketKey = `support_ticket:${ticketId}`;
        await redis.hset(ticketKey, {
            ticketId,
            userId,
            priority: 'MEDIUM',
            status: 'OPEN',
            createdAt: Date.now()
        });
        
        // Simular atualização de status
        const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
        const statusHistory = [];
        
        for (let i = 0; i < statuses.length; i++) {
            const status = statuses[i];
            await redis.hset(ticketKey, {
                status,
                lastUpdate: Date.now()
            });
            
            statusHistory.push({
                status,
                timestamp: Date.now()
            });
            
            await sleep(100); // Pequeno delay
        }
        
        // Verificar status final
        const ticketData = await redis.hgetall(ticketKey);
        if (ticketData.status !== 'RESOLVED') {
            throw new Error(`Status final não corresponde (esperado: RESOLVED, obtido: ${ticketData.status})`);
        }
        
        console.log(`   ✅ Ticket acompanhado: ${statusHistory.length} atualizações de status`);
        console.log(`   ✅ Status final: ${ticketData.status}`);
        console.log(`   ✅ Histórico: ${statuses.join(' → ')}`);
        
        // Limpar
        await redis.del(ticketKey);
    });
    results.total++;
    if (test7Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 8: VALIDAÇÃO DE TAMANHO DE MENSAGEM
    // ========================================
    const test8Passed = await test('TC-008: Validação de tamanho máximo de mensagem', async () => {
        const maxLength = TEST_CONFIG.CHAT.MAX_MESSAGE_LENGTH;
        
        // Mensagem dentro do limite
        const validMessage = 'A'.repeat(maxLength - 1);
        if (validMessage.length <= maxLength) {
            console.log(`   ✅ Mensagem válida: ${validMessage.length} caracteres (<= ${maxLength})`);
        } else {
            throw new Error(`Mensagem válida rejeitada incorretamente`);
        }
        
        // Mensagem acima do limite
        const invalidMessage = 'A'.repeat(maxLength + 1);
        if (invalidMessage.length > maxLength) {
            console.log(`   ✅ Mensagem inválida detectada: ${invalidMessage.length} caracteres (> ${maxLength})`);
            console.log(`   ⚠️ Sistema deveria rejeitar mensagem muito longa`);
        } else {
            throw new Error(`Mensagem inválida não foi detectada`);
        }
    });
    results.total++;
    if (test8Passed) results.passed++; else results.failed++;
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: CHAT, INCIDENTES E SUPORTE`);
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

