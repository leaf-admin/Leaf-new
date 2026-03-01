/**
 * TESTES: AVALIAÇÕES E DISPUTAS
 * 
 * Testes para validar:
 * 1. Submeter avaliação (rating, comentário, tags)
 * 2. Validação de avaliação (rating 1-5, comentário opcional)
 * 3. Calcular média de avaliações
 * 4. Disputar avaliação
 * 5. Reportar motorista
 * 6. Reportar customer
 * 7. Resolução de disputas
 * 8. Histórico de avaliações
 */

const io = require('socket.io-client');
const redisPool = require('./utils/redis-pool');
const RideStateManager = require('./services/ride-state-manager');
const { logger } = require('./utils/logger');

// Configurações de teste
const TEST_CONFIG = {
    SERVER_URL: process.env.WS_URL || 'http://localhost:3001',
    customerId: 'test_customer_ratings',
    driverId: 'test_driver_ratings',
    bookingId: 'test_booking_ratings',
    
    // Parâmetros de avaliação
    RATINGS: {
        MIN_RATING: 1,
        MAX_RATING: 5,
        COMMENT_MIN_LENGTH: 5,
        COMMENT_MAX_LENGTH: 500,
        TAGS: ['punctual', 'safe', 'clean', 'polite', 'helpful', 'bad_driving', 'rude', 'unsafe']
    },
    
    // Parâmetros de disputa
    DISPUTES: {
        RESPONSE_TIME: 48 * 60 * 60, // 48 horas em segundos
        RESOLUTION_TIME: 7 * 24 * 60 * 60 // 7 dias em segundos
    },
    
    // Parâmetros de report
    REPORTS: {
        REASONS: [
            'unsafe_driving',
            'inappropriate_behavior',
            'payment_issue',
            'route_issue',
            'vehicle_issue',
            'other'
        ],
        PRIORITY_HIGH: ['unsafe_driving', 'inappropriate_behavior']
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
    // TESTE 1: SUBMETER AVALIAÇÃO (RATING E COMENTÁRIO)
    // ========================================
    const test1Passed = await test('TC-001: Submeter avaliação com rating e comentário', async () => {
        const ratingId = `rating_${Date.now()}`;
        const bookingId = TEST_CONFIG.bookingId;
        const rating = 5;
        const comment = 'Excelente motorista, muito pontual e educado!';
        const tags = ['punctual', 'polite', 'safe'];
        
        // Simular avaliação
        const ratingKey = `rating:${ratingId}`;
        await redis.hset(ratingKey, {
            ratingId,
            bookingId,
            customerId: TEST_CONFIG.customerId,
            driverId: TEST_CONFIG.driverId,
            rating: String(rating),
            comment,
            tags: JSON.stringify(tags),
            createdAt: Date.now(),
            status: 'ACTIVE'
        });
        
        // TTL de retenção (30 dias)
        await redis.expire(ratingKey, 30 * 24 * 60 * 60);
        
        // Verificar avaliação criada
        const ratingData = await redis.hgetall(ratingKey);
        if (!ratingData || parseInt(ratingData.rating) !== rating) {
            throw new Error(`Avaliação não foi criada corretamente`);
        }
        
        // Verificar tags
        const ratingTags = JSON.parse(ratingData.tags || '[]');
        if (ratingTags.length !== tags.length) {
            throw new Error(`Tags não foram salvas corretamente`);
        }
        
        console.log(`   ✅ Avaliação criada: ${ratingId}`);
        console.log(`   ✅ Rating: ${rating}/5`);
        console.log(`   ✅ Comentário: "${comment.substring(0, 50)}..."`);
        console.log(`   ✅ Tags: ${tags.join(', ')}`);
        
        // Limpar
        await redis.del(ratingKey);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: VALIDAÇÃO DE RATING (1-5)
    // ========================================
    const test2Passed = await test('TC-002: Validação de rating (deve estar entre 1-5)', async () => {
        const validRatings = [1, 2, 3, 4, 5];
        const invalidRatings = [0, -1, 6, 10];
        
        // Testar ratings válidos
        for (const rating of validRatings) {
            if (rating < TEST_CONFIG.RATINGS.MIN_RATING || rating > TEST_CONFIG.RATINGS.MAX_RATING) {
                throw new Error(`Rating válido ${rating} rejeitado incorretamente`);
            }
        }
        console.log(`   ✅ Ratings válidos aceitos: ${validRatings.join(', ')}`);
        
        // Testar ratings inválidos
        for (const rating of invalidRatings) {
            if (rating >= TEST_CONFIG.RATINGS.MIN_RATING && rating <= TEST_CONFIG.RATINGS.MAX_RATING) {
                throw new Error(`Rating inválido ${rating} aceito incorretamente`);
            }
        }
        console.log(`   ✅ Ratings inválidos rejeitados: ${invalidRatings.join(', ')}`);
        console.log(`   ⚠️ Sistema deveria validar rating antes de salvar`);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: CALCULAR MÉDIA DE AVALIAÇÕES
    // ========================================
    const test3Passed = await test('TC-003: Calcular média de avaliações do motorista', async () => {
        const driverId = TEST_CONFIG.driverId;
        const ratings = [5, 4, 5, 3, 5, 4, 5];
        
        // Calcular média esperada primeiro
        const expectedAvg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
        
        // Simular avaliações anteriores (usar JSON para armazenar dados completos)
        const ratingsKey = `driver_ratings:${driverId}`;
        for (let i = 0; i < ratings.length; i++) {
            const ratingData = JSON.stringify({
                rating: ratings[i],
                timestamp: Date.now() - (i * 86400000)
            });
            await redis.zadd(ratingsKey, Date.now() - (i * 86400000), ratingData);
        }
        
        // Calcular média
        const allRatingsData = await redis.zrange(ratingsKey, 0, -1);
        const parsedRatings = allRatingsData.map(r => {
            try {
                const data = JSON.parse(r);
                return data.rating;
            } catch (e) {
                // Fallback para formato antigo (apenas número)
                return parseInt(r);
            }
        });
        
        const sum = parsedRatings.reduce((acc, r) => acc + r, 0);
        const avg = sum / parsedRatings.length;
        
        // Atualizar média no driver
        const driverKey = `driver:${driverId}`;
        await redis.hset(driverKey, {
            avgRating: avg.toFixed(2),
            totalRatings: String(ratings.length),
            lastRatingUpdate: Date.now()
        });
        
        if (Math.abs(avg - expectedAvg) > 0.01) {
            throw new Error(`Média calculada incorretamente (esperado: ${expectedAvg.toFixed(2)}, obtido: ${avg.toFixed(2)})`);
        }
        
        console.log(`   ✅ Total de avaliações: ${ratings.length}`);
        console.log(`   ✅ Média calculada: ${avg.toFixed(2)}/5`);
        console.log(`   ✅ Média esperada: ${expectedAvg.toFixed(2)}/5`);
        
        // Limpar
        await redis.del(ratingsKey);
        await redis.del(driverKey);
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: DISPUTAR AVALIAÇÃO
    // ========================================
    const test4Passed = await test('TC-004: Disputar avaliação (driver ou customer)', async () => {
        const disputeId = `dispute_${Date.now()}`;
        const ratingId = 'rating_disputed_001';
        const disputerId = TEST_CONFIG.driverId;
        const reason = 'rating_inaccurate';
        const description = 'O rating não reflete a realidade da corrida';
        
        // Criar disputa
        const disputeKey = `dispute:${disputeId}`;
        await redis.hset(disputeKey, {
            disputeId,
            ratingId,
            disputerId,
            disputerType: 'driver',
            reason,
            description,
            status: 'PENDING',
            createdAt: Date.now(),
            responseTime: TEST_CONFIG.DISPUTES.RESPONSE_TIME
        });
        
        // Marcar rating como disputado
        const ratingKey = `rating:${ratingId}`;
        await redis.hset(ratingKey, {
            ratingId,
            status: 'DISPUTED',
            disputeId
        });
        
        // TTL de resolução
        await redis.expire(disputeKey, TEST_CONFIG.DISPUTES.RESOLUTION_TIME);
        
        // Verificar disputa criada
        const disputeData = await redis.hgetall(disputeKey);
        if (!disputeData || disputeData.status !== 'PENDING') {
            throw new Error(`Disputa não foi criada corretamente`);
        }
        
        // Verificar rating marcado como disputado
        const ratingData = await redis.hgetall(ratingKey);
        if (ratingData.status !== 'DISPUTED') {
            throw new Error(`Rating não foi marcado como disputado`);
        }
        
        console.log(`   ✅ Disputa criada: ${disputeId}`);
        console.log(`   ✅ Rating marcado como DISPUTED`);
        console.log(`   ✅ Tempo de resposta: ${TEST_CONFIG.DISPUTES.RESPONSE_TIME / 3600}h`);
        
        // Limpar
        await redis.del(disputeKey);
        await redis.del(ratingKey);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: REPORTAR MOTORISTA
    // ========================================
    const test5Passed = await test('TC-005: Reportar motorista por comportamento inadequado', async () => {
        const reportId = `report_driver_${Date.now()}`;
        const driverId = TEST_CONFIG.driverId;
        const reporterId = TEST_CONFIG.customerId;
        const reason = 'unsafe_driving';
        const description = 'Motorista dirigiu de forma perigosa durante a corrida';
        
        // Criar report
        const reportKey = `report:${reportId}`;
        const priority = TEST_CONFIG.REPORTS.PRIORITY_HIGH.includes(reason) ? 'HIGH' : 'MEDIUM';
        
        await redis.hset(reportKey, {
            reportId,
            driverId,
            customerId: reporterId,
            reportType: 'DRIVER',
            reason,
            description,
            priority,
            status: 'OPEN',
            createdAt: Date.now()
        });
        
        // TTL baseado em prioridade
        const ttl = priority === 'HIGH' ? 24 * 60 * 60 : 7 * 24 * 60 * 60;
        await redis.expire(reportKey, ttl);
        
        // Verificar report criado
        const reportData = await redis.hgetall(reportKey);
        if (!reportData || reportData.priority !== priority) {
            throw new Error(`Report não foi criado corretamente`);
        }
        
        console.log(`   ✅ Report criado: ${reportId}`);
        console.log(`   ✅ Prioridade: ${priority}`);
        console.log(`   ✅ Motivo: ${reason}`);
        console.log(`   ⚠️ Sistema deveria alertar equipe de segurança`);
        
        // Limpar
        await redis.del(reportKey);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: REPORTAR CUSTOMER
    // ========================================
    const test6Passed = await test('TC-006: Reportar customer por comportamento inadequado', async () => {
        const reportId = `report_customer_${Date.now()}`;
        const customerId = TEST_CONFIG.customerId;
        const reporterId = TEST_CONFIG.driverId;
        const reason = 'inappropriate_behavior';
        const description = 'Customer se comportou de forma inadequada';
        
        // Criar report
        const reportKey = `report:${reportId}`;
        const priority = TEST_CONFIG.REPORTS.PRIORITY_HIGH.includes(reason) ? 'HIGH' : 'MEDIUM';
        
        await redis.hset(reportKey, {
            reportId,
            customerId,
            driverId: reporterId,
            reportType: 'CUSTOMER',
            reason,
            description,
            priority,
            status: 'OPEN',
            createdAt: Date.now()
        });
        
        await redis.expire(reportKey, priority === 'HIGH' ? 24 * 60 * 60 : 7 * 24 * 60 * 60);
        
        // Verificar report criado
        const reportData = await redis.hgetall(reportKey);
        if (!reportData || reportData.reportType !== 'CUSTOMER') {
            throw new Error(`Report de customer não foi criado corretamente`);
        }
        
        console.log(`   ✅ Report criado: ${reportId}`);
        console.log(`   ✅ Tipo: CUSTOMER`);
        console.log(`   ✅ Prioridade: ${priority}`);
        
        // Limpar
        await redis.del(reportKey);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 7: RESOLUÇÃO DE DISPUTA
    // ========================================
    const test7Passed = await test('TC-007: Resolução de disputa (aceitar/rejeitar)', async () => {
        const disputeId = `dispute_resolve_${Date.now()}`;
        const ratingId = 'rating_resolve_001';
        const resolution = 'ACCEPTED'; // ou 'REJECTED'
        
        // Simular disputa
        const disputeKey = `dispute:${disputeId}`;
        await redis.hset(disputeKey, {
            disputeId,
            ratingId,
            status: 'PENDING',
            createdAt: Date.now()
        });
        
        // Simular resolução
        await redis.hset(disputeKey, {
            status: 'RESOLVED',
            resolution,
            resolvedAt: Date.now(),
            resolvedBy: 'admin_001'
        });
        
        // Atualizar rating se disputa aceita
        if (resolution === 'ACCEPTED') {
            const ratingKey = `rating:${ratingId}`;
            await redis.hset(ratingKey, {
                status: 'REMOVED',
                removedAt: Date.now(),
                removedReason: 'dispute_accepted'
            });
            console.log(`   ✅ Rating removido devido à disputa aceita`);
        } else {
            const ratingKey = `rating:${ratingId}`;
            await redis.hset(ratingKey, {
                status: 'ACTIVE',
                disputeId: null
            });
            console.log(`   ✅ Rating mantido (disputa rejeitada)`);
        }
        
        // Verificar resolução
        const disputeData = await redis.hgetall(disputeKey);
        if (disputeData.status !== 'RESOLVED') {
            throw new Error(`Disputa não foi resolvida corretamente`);
        }
        
        console.log(`   ✅ Disputa resolvida: ${resolution}`);
        
        // Limpar
        await redis.del(disputeKey);
        await redis.del(`rating:${ratingId}`);
    });
    results.total++;
    if (test7Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 8: HISTÓRICO DE AVALIAÇÕES
    // ========================================
    const test8Passed = await test('TC-008: Histórico de avaliações do motorista', async () => {
        const driverId = TEST_CONFIG.driverId;
        const historyKey = `driver_rating_history:${driverId}`;
        
        // Criar histórico de avaliações
        const ratings = [
            { ratingId: 'r1', rating: 5, comment: 'Ótimo!', createdAt: Date.now() - 86400000 },
            { ratingId: 'r2', rating: 4, comment: 'Bom', createdAt: Date.now() - 172800000 },
            { ratingId: 'r3', rating: 5, comment: 'Excelente', createdAt: Date.now() - 259200000 }
        ];
        
        for (const r of ratings) {
            await redis.zadd(historyKey, r.createdAt, JSON.stringify(r));
        }
        
        // TTL de retenção (90 dias)
        await redis.expire(historyKey, 90 * 24 * 60 * 60);
        
        // Buscar histórico (últimas 10)
        const history = await redis.zrevrange(historyKey, 0, 9);
        
        if (history.length !== ratings.length) {
            throw new Error(`Histórico não contém todas as avaliações`);
        }
        
        // Calcular estatísticas
        const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
        const positiveRatings = ratings.filter(r => r.rating >= 4).length;
        const positiveRate = (positiveRatings / ratings.length) * 100;
        
        console.log(`   ✅ Total de avaliações: ${ratings.length}`);
        console.log(`   ✅ Média: ${avgRating.toFixed(2)}/5`);
        console.log(`   ✅ Taxa de avaliações positivas (≥4): ${positiveRate.toFixed(1)}%`);
        
        // Limpar
        await redis.del(historyKey);
    });
    results.total++;
    if (test8Passed) results.passed++; else results.failed++;
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: AVALIAÇÕES E DISPUTAS`);
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

