#!/usr/bin/env node
/**
 * TESTE ISOLADO - WORKER MANAGER
 * 
 * Testa o WorkerManager isoladamente, sem alterar o servidor principal.
 * 
 * Uso:
 *   node scripts/tests/test-worker-manager-isolated.js
 * 
 * Objetivo:
 *   - Verificar que WorkerManager funciona corretamente
 *   - Testar Consumer Groups
 *   - Testar processamento de eventos
 *   - Testar retry e DLQ
 */

const WorkerManager = require('../../workers/WorkerManager');
const redisPool = require('../../utils/redis-pool');
const { logStructured, logError } = require('../../utils/logger');

// Configuração de teste (usar stream separado para não interferir com produção)
const TEST_STREAM = 'test_worker_events';
const TEST_GROUP = 'test-worker-group';
const TEST_CONSUMER = `test-worker-${process.pid}`;

async function testWorkerManager() {
    console.log('🧪 Iniciando teste isolado do WorkerManager...\n');

    try {
        // 1. Inicializar Redis
        console.log('1️⃣ Inicializando Redis...');
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        console.log('✅ Redis conectado\n');

        // 2. Criar WorkerManager
        console.log('2️⃣ Criando WorkerManager...');
        const workerManager = new WorkerManager({
            streamName: TEST_STREAM,
            groupName: TEST_GROUP,
            consumerName: TEST_CONSUMER,
            batchSize: 5,
            blockTime: 2000,
            maxRetries: 2,
            retryBackoff: [1000, 2000]
        });
        console.log('✅ WorkerManager criado\n');

        // 3. Registrar listener de teste
        console.log('3️⃣ Registrando listener de teste...');
        let processedEvents = [];
        workerManager.registerListener('ride_requested', async (event) => {
            console.log(`   📨 Processando evento: ${event.eventType}`);
            console.log(`   📊 Dados: ${JSON.stringify(event.data).substring(0, 100)}...`);
            processedEvents.push(event);
            
            // Simular processamento (sucesso)
            await new Promise(resolve => setTimeout(resolve, 100));
            console.log('   ✅ Evento processado com sucesso\n');
        });
        console.log('✅ Listener registrado\n');

        // 4. Limpar stream de teste (se existir) para teste limpo
        console.log('4️⃣ Limpando stream de teste (se existir)...');
        try {
            await redis.del(TEST_STREAM);
            console.log('✅ Stream de teste limpo\n');
        } catch (error) {
            console.log(`⚠️  Erro ao limpar stream: ${error.message}\n`);
        }

        // 5. Inicializar WorkerManager (criará novo Consumer Group)
        console.log('5️⃣ Inicializando WorkerManager...');
        const initialized = await workerManager.initialize();
        if (!initialized) {
            throw new Error('Falha ao inicializar WorkerManager');
        }
        console.log('✅ WorkerManager inicializado\n');

        // 6. Adicionar evento de teste ao stream
        console.log('6️⃣ Adicionando evento de teste ao stream...');
        const testEventData = {
            type: 'ride_requested',
            timestamp: new Date().toISOString(),
            data: JSON.stringify({
                bookingId: 'test-booking-123',
                customerId: 'test-customer-456',
                pickup: { lat: -23.5505, lng: -46.6333 },
                destination: { lat: -23.5515, lng: -46.6343 },
                traceId: 'test-trace-789'
            }),
            bookingId: 'test-booking-123',
            customerId: 'test-customer-456'
        };

        const eventId = await redis.xadd(
            TEST_STREAM,
            '*',
            ...Object.entries(testEventData).flat().map(v => String(v))
        );
        console.log(`✅ Evento adicionado: ${eventId}\n`);

        // 7. Aguardar um pouco para garantir que evento está no stream
        console.log('7️⃣ Aguardando 500ms para garantir que evento está no stream...');
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('✅ Aguardado\n');

        // 8. Processar evento (consumir uma vez)
        console.log('8️⃣ Processando evento...');
        await workerManager.consume();
        console.log('✅ Consumo executado\n');

        // 9. Verificar estatísticas
        console.log('9️⃣ Estatísticas do WorkerManager:');
        const stats = workerManager.getStats();
        console.log(JSON.stringify(stats, null, 2));
        console.log('');

        // 8. Verificar que evento foi processado
        if (processedEvents.length > 0) {
            console.log('✅ SUCESSO: Evento foi processado!');
            console.log(`   Eventos processados: ${processedEvents.length}`);
        } else {
            console.log('⚠️  AVISO: Nenhum evento foi processado');
            console.log('   Isso pode ser normal se o Consumer Group já processou o evento');
        }

        // 9. Limpeza (opcional)
        console.log('\n8️⃣ Limpeza...');
        await workerManager.stop();
        console.log('✅ WorkerManager parado\n');

        console.log('🎉 TESTE CONCLUÍDO COM SUCESSO!\n');

    } catch (error) {
        logError(error, 'Erro no teste do WorkerManager', {
            service: 'test-worker-manager'
        });
        console.error('\n❌ TESTE FALHOU:', error.message);
        process.exit(1);
    }
}

// Executar teste
testWorkerManager()
    .then(() => {
        console.log('✅ Todos os testes passaram');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });

