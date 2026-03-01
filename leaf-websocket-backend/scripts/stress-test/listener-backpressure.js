#!/usr/bin/env node
/**
 * STRESS TEST: Listener Backpressure
 * 
 * Testa backpressure: publica eventos mais rápido que os workers conseguem consumir.
 * 
 * Uso:
 *   node scripts/stress-test/listener-backpressure.js --events 10000 --rate 100
 */

const redisPool = require('../../utils/redis-pool');
const { logStructured, logError } = require('../../utils/logger');
const { metrics } = require('../../utils/prometheus-metrics');

// Parse arguments
const args = process.argv.slice(2);
const eventCount = args.includes('--events')
    ? parseInt(args[args.indexOf('--events') + 1]) || 10000
    : 10000;
const rate = args.includes('--rate')
    ? parseInt(args[args.indexOf('--rate') + 1]) || 100
    : 100; // eventos por segundo

// Estatísticas
const stats = {
    published: 0,
    failed: 0,
    startTime: Date.now(),
    endTime: null
};

// Publicar evento no stream
async function publishEvent(redis, index) {
    try {
        const eventData = {
            type: 'ride_requested',
            timestamp: new Date().toISOString(),
            data: JSON.stringify({
                bookingId: `stress_booking_${index}`,
                customerId: `stress_customer_${index}`,
                pickupLocation: {
                    lat: -23.5505 + (Math.random() - 0.5) * 0.1,
                    lng: -46.6333 + (Math.random() - 0.5) * 0.1
                },
                traceId: `stress_trace_${index}`
            }),
            bookingId: `stress_booking_${index}`,
            customerId: `stress_customer_${index}`
        };

        await redis.xadd(
            'ride_events',
            '*',
            ...Object.entries(eventData).flat()
        );

        stats.published++;
        metrics.recordEventPublished('ride_requested');
        
        return { success: true };
    } catch (error) {
        stats.failed++;
        logError(error, 'Erro ao publicar evento', {
            service: 'stress-test',
            index
        });
        return { success: false, error: error.message };
    }
}

// Monitorar lag do stream
async function monitorLag(redis) {
    const interval = setInterval(async () => {
        try {
            // Obter tamanho do stream
            const streamLength = await redis.xlen('ride_events');
            
            // Obter último ID processado pelo consumer group
            const groupInfo = await redis.xinfo('GROUPS', 'ride_events');
            const group = groupInfo.find(g => g[1] === 'listener-workers');
            
            let lag = 0;
            if (group) {
                const lastDelivered = group[3] || '0-0';
                const lastDeliveredId = parseInt(lastDelivered.split('-')[0]);
                const lastEntry = await redis.xrevrange('ride_events', '+', '-', 'COUNT', 1);
                if (lastEntry.length > 0) {
                    const lastEntryId = parseInt(lastEntry[0][0].split('-')[0]);
                    lag = lastEntryId - lastDeliveredId;
                }
            }

            logStructured('info', 'Monitoramento de lag', {
                service: 'stress-test',
                streamLength,
                lag,
                published: stats.published,
                failed: stats.failed
            });

            metrics.setEventBacklog(lag, 'pending');
        } catch (error) {
            // Ignorar erros de monitoramento
        }
    }, 5000); // A cada 5 segundos

    return interval;
}

// Função principal
async function runBackpressureTest() {
    logStructured('info', 'Iniciando stress test de backpressure', {
        service: 'stress-test',
        eventCount,
        rate
    });

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();

    // Iniciar monitoramento
    const monitorInterval = await monitorLag(redis);

    // Calcular intervalo entre eventos (ms)
    const intervalMs = 1000 / rate;

    // Publicar eventos na taxa especificada
    for (let i = 0; i < eventCount; i++) {
        await publishEvent(redis, i);

        // Aguardar intervalo (exceto no último)
        if (i < eventCount - 1) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

        // Log de progresso a cada 1000 eventos
        if ((i + 1) % 1000 === 0) {
            const progress = ((i + 1) / eventCount) * 100;
            logStructured('info', 'Progresso do backpressure test', {
                service: 'stress-test',
                progress: `${progress.toFixed(1)}%`,
                published: stats.published,
                failed: stats.failed
            });
        }
    }

    stats.endTime = Date.now();
    const duration = (stats.endTime - stats.startTime) / 1000;
    const actualRate = stats.published / duration;

    // Parar monitoramento
    clearInterval(monitorInterval);

    // Aguardar um pouco para ver lag final
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verificar lag final
    const finalStreamLength = await redis.xlen('ride_events');
    const groupInfo = await redis.xinfo('GROUPS', 'ride_events');
    const group = groupInfo.find(g => g[1] === 'listener-workers');
    
    let finalLag = 0;
    if (group) {
        const lastDelivered = group[3] || '0-0';
        const lastDeliveredId = parseInt(lastDelivered.split('-')[0]);
        const lastEntry = await redis.xrevrange('ride_events', '+', '-', 'COUNT', 1);
        if (lastEntry.length > 0) {
            const lastEntryId = parseInt(lastEntry[0][0].split('-')[0]);
            finalLag = lastEntryId - lastDeliveredId;
        }
    }

    // Relatório final
    const report = {
        test: 'listener-backpressure',
        config: {
            eventCount,
            targetRate: rate,
            actualRate: actualRate.toFixed(2)
        },
        results: {
            published: stats.published,
            failed: stats.failed,
            duration: `${duration.toFixed(2)}s`,
            actualRate: `${actualRate.toFixed(2)} events/s`,
            finalStreamLength,
            finalLag,
            backpressure: finalLag > 1000 ? 'HIGH' : finalLag > 100 ? 'MEDIUM' : 'LOW'
        },
        timestamp: new Date().toISOString()
    };

    // Salvar relatório
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, `../../stress-test-backpressure-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Log resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE BACKPRESSURE TEST');
    console.log('='.repeat(60));
    console.log(`Eventos publicados: ${stats.published}`);
    console.log(`Falhas: ${stats.failed}`);
    console.log(`Duração: ${duration.toFixed(2)}s`);
    console.log(`Taxa real: ${actualRate.toFixed(2)} events/s`);
    console.log(`Tamanho final do stream: ${finalStreamLength}`);
    console.log(`Lag final: ${finalLag}`);
    console.log(`Backpressure: ${report.results.backpressure}`);
    console.log(`\nRelatório salvo em: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    process.exit(0);
}

// Executar
runBackpressureTest().catch(error => {
    logError(error, 'Erro fatal no backpressure test', {
        service: 'stress-test'
    });
    process.exit(1);
});

