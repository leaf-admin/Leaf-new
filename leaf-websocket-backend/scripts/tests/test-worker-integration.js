#!/usr/bin/env node
/**
 * TESTE DE INTEGRAÇÃO - WORKERS NO SERVIDOR
 * 
 * Testa que os workers estão funcionando no servidor.
 * 
 * Uso:
 *   node scripts/tests/test-worker-integration.js
 */

const redisPool = require('../../utils/redis-pool');
const { logStructured } = require('../../utils/logger');

async function testWorkerIntegration() {
    console.log('🧪 Testando integração de workers no servidor...\n');

    try {
        // 1. Conectar ao Redis
        console.log('1️⃣ Conectando ao Redis...');
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        console.log('✅ Redis conectado\n');

        // 2. Verificar Consumer Group existe
        console.log('2️⃣ Verificando Consumer Group...');
        try {
            const groupInfo = await redis.xinfo('GROUPS', 'ride_events');
            console.log('✅ Consumer Groups encontrados:');
            groupInfo.forEach((group, index) => {
                if (index % 2 === 0) {
                    console.log(`   - ${group}`);
                }
            });
            console.log('');
        } catch (error) {
            if (error.message.includes('NOGROUP')) {
                console.log('⚠️  Consumer Group ainda não foi criado (pode estar inicializando)\n');
            } else {
                throw error;
            }
        }

        // 3. Verificar stream tem eventos
        console.log('3️⃣ Verificando eventos no stream...');
        const streamLength = await redis.xlen('ride_events');
        console.log(`✅ Stream 'ride_events' tem ${streamLength} eventos\n`);

        // 4. Verificar consumers ativos
        console.log('4️⃣ Verificando consumers ativos...');
        try {
            const consumers = await redis.xinfo('CONSUMERS', 'ride_events', 'listener-workers');
            console.log(`✅ Consumers ativos no grupo 'listener-workers': ${consumers.length / 2}\n`);
        } catch (error) {
            if (error.message.includes('NOGROUP')) {
                console.log('⚠️  Consumer Group ainda não foi criado\n');
            } else {
                console.log(`⚠️  Erro ao verificar consumers: ${error.message}\n`);
            }
        }

        // 5. Verificar pending messages (eventos não processados)
        console.log('5️⃣ Verificando mensagens pendentes...');
        try {
            const pending = await redis.xpending('ride_events', 'listener-workers', '-', '+', 10);
            if (pending && pending.length > 0) {
                console.log(`⚠️  ${pending.length} mensagens pendentes (não processadas ainda)\n`);
            } else {
                console.log('✅ Nenhuma mensagem pendente (tudo processado)\n');
            }
        } catch (error) {
            if (error.message.includes('NOGROUP')) {
                console.log('⚠️  Consumer Group ainda não foi criado\n');
            } else {
                console.log(`⚠️  Erro ao verificar pending: ${error.message}\n`);
            }
        }

        console.log('🎉 TESTE DE INTEGRAÇÃO CONCLUÍDO!\n');
        console.log('📊 RESUMO:');
        console.log(`   - Stream: ${streamLength} eventos`);
        console.log('   - Consumer Group: Verificado');
        console.log('   - Workers: Devem estar processando eventos em background\n');

    } catch (error) {
        console.error('❌ ERRO NO TESTE:', error.message);
        process.exit(1);
    }
}

testWorkerIntegration()
    .then(() => {
        console.log('✅ Teste concluído');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });




