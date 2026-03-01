#!/usr/bin/env node
/**
 * STRESS TEST: 1000 Corridas Simultâneas
 * 
 * Este script avalia a capacidade do barramento de eventos (Redis Streams) e dos
 * Workers recém-refatorados de suportarem um volume súbito absurdo de Solicitações de Corrida,
 * sem derrubar a API root.
 */

const { performance } = require('perf_hooks');
const RequestRideCommand = require('../../commands/RequestRideCommand');
const redisPool = require('../../utils/redis-pool');
const { logStructured } = require('../../utils/logger');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

async function runScaleTest() {
    console.log('\n🚀 Iniciando Teste de Estresse EDA (1000 Corridas)...');

    // Conectar Redis
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();

    const totalRides = 1000;
    const batchSize = 100; // Enviar em lotes de 100 para não estourar o event-loop de uma vez

    let successes = 0;
    let failures = 0;
    const startTime = performance.now();

    for (let i = 0; i < totalRides; i += batchSize) {
        const batch = [];
        for (let j = 0; j < batchSize && (i + j) < totalRides; j++) {
            const index = i + j;

            // Gerar dados mock para uma corrida
            const rideData = {
                customerId: `bench_customer_${index}`,
                pickupLocation: { lat: -23.5505 + (Math.random() * 0.01), lng: -46.6333 + (Math.random() * 0.01) },
                dropoffLocation: { lat: -23.5600 + (Math.random() * 0.01), lng: -46.6400 + (Math.random() * 0.01) },
                rideType: 'X',
                estimatedFare: 25.50 + Math.random() * 10
            };

            const command = new RequestRideCommand(rideData);

            // Push the execution promise
            batch.push(
                command.execute().then(result => {
                    if (result.success) successes++;
                    else failures++;
                }).catch(err => {
                    failures++;
                })
            );
        }

        // Aguardar o lote inteiro ser despachado no Redis Stream
        await Promise.allSettled(batch);
        console.log(`Lote finalizado. Total processado: ${Math.min(i + batchSize, totalRides)}/${totalRides}...`);
    }

    const endTime = performance.now();
    const durationSecs = (endTime - startTime) / 1000;

    const memUsage = process.memoryUsage();
    console.log('\n📊 RESULTADOS DO BENCHMARK (1000 CORRIDAS):');
    console.log(`Tempo Total: ${durationSecs.toFixed(2)} segundos`);
    console.log(`Throughput: ${(totalRides / durationSecs).toFixed(2)} requisições por segundo`);
    console.log(`Sucessos: ${successes} | Falhas: ${failures}`);
    console.log(`Memória Usada (RSS): ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);

    // Cleanup de teste
    try {
        console.log('Limpando Mock Runs do Redis...');
        const keys = await redis.keys('booking:*');
        const benchKeys = [];
        for (let key of keys) {
            const data = await redis.hgetall(key);
            if (data && data.customerId && data.customerId.startsWith('bench_customer')) {
                benchKeys.push(key);
            }
        }
        if (benchKeys.length > 0) {
            await redis.del(...benchKeys);
        }
        console.log(`Limpeza concluída. ${benchKeys.length} corridas deletadas.`);
    } catch (err) {
        console.error('Erro na limpeza:', err.message);
    }

    process.exit(0);
}

runScaleTest().catch(err => {
    console.error('Erro Fatal:', err);
    process.exit(1);
});
