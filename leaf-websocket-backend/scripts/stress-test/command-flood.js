#!/usr/bin/env node
/**
 * STRESS TEST: Command Flood
 * 
 * Simula flood de comandos createBooking para testar capacidade do sistema.
 * 
 * Uso:
 *   node scripts/stress-test/command-flood.js --count 1000 --concurrency 10
 *   node scripts/stress-test/command-flood.js --count 5000 --concurrency 50
 *   node scripts/stress-test/command-flood.js --count 10000 --concurrency 100
 */

const io = require('socket.io-client');
const axios = require('axios');
const { logStructured, logError } = require('../../utils/logger');
const { metrics } = require('../../utils/prometheus-metrics');

// Parse arguments
const args = process.argv.slice(2);
const count = args.includes('--count') 
    ? parseInt(args[args.indexOf('--count') + 1]) || 1000
    : 1000;
const concurrency = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1]) || 10
    : 10;
const serverUrl = args.includes('--url')
    ? args[args.indexOf('--url') + 1]
    : 'http://localhost:3001';
const customerId = args.includes('--customer')
    ? args[args.indexOf('--customer') + 1]
    : `stress_test_customer_${Date.now()}`;
const baseLat = args.includes('--base-lat')
    ? parseFloat(args[args.indexOf('--base-lat') + 1])
    : -23.5505;
const baseLng = args.includes('--base-lng')
    ? parseFloat(args[args.indexOf('--base-lng') + 1])
    : -46.6333;
const geoRadius = args.includes('--radius')
    ? parseFloat(args[args.indexOf('--radius') + 1])
    : 0.05;
const authTokenArg = args.includes('--token')
    ? args[args.indexOf('--token') + 1]
    : '';
const authEmail = args.includes('--email')
    ? args[args.indexOf('--email') + 1]
    : '';
const authPassword = args.includes('--password')
    ? args[args.indexOf('--password') + 1]
    : '';
const firebaseApiKey = args.includes('--firebase-api-key')
    ? args[args.indexOf('--firebase-api-key') + 1]
    : (process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '');

// Estatísticas
const stats = {
    total: count,
    sent: 0,
    success: 0,
    failed: 0,
    timeout: 0,
    errors: [],
    latencies: [],
    startTime: Date.now(),
    endTime: null
};

// Gerar localização aleatória (centro de São Paulo)
function randomLocation() {
    const radius = Number.isFinite(geoRadius) ? geoRadius : 0.05;
    const centerLat = Number.isFinite(baseLat) ? baseLat : -23.5505;
    const centerLng = Number.isFinite(baseLng) ? baseLng : -46.6333;

    return {
        lat: centerLat + (Math.random() - 0.5) * radius,
        lng: centerLng + (Math.random() - 0.5) * radius
    };
}

async function resolveAuthToken() {
    if (authTokenArg) {
        return authTokenArg.trim();
    }

    if (!authEmail || !authPassword || !firebaseApiKey) {
        return '';
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`;
    const payload = {
        email: authEmail,
        password: authPassword,
        returnSecureToken: true
    };

    const response = await axios.post(url, payload, { timeout: 15000 });
    return response.data?.idToken || '';
}

// Criar booking
async function createBooking(socket, index) {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            stats.timeout++;
            stats.failed++;
            stats.errors.push({ index, error: 'Timeout', latency: Date.now() - startTime });
            resolve({ success: false, error: 'Timeout' });
        }, 15000); // 15s timeout

        const bookingData = {
            customerId: `${customerId}_${index}`,
            pickupLocation: randomLocation(),
            destinationLocation: randomLocation(),
            estimatedFare: 20 + Math.random() * 30,
            paymentMethod: 'pix',
            carType: 'standard'
        };

        socket.emit('createBooking', bookingData);

        socket.once('bookingCreated', (data) => {
            clearTimeout(timeout);
            const latency = Date.now() - startTime;
            stats.latencies.push(latency);
            
            if (data.success) {
                stats.success++;
            } else {
                stats.failed++;
                stats.errors.push({ index, error: data.error || 'Unknown', latency });
            }
            
            resolve({ success: data.success, latency });
        });

        socket.once('bookingError', (error) => {
            clearTimeout(timeout);
            const latency = Date.now() - startTime;
            stats.failed++;
            stats.errors.push({ index, error: error.message || 'Unknown', latency });
            resolve({ success: false, error: error.message, latency });
        });
    });
}

// Processar em lotes com concorrência controlada
async function processBatch(socket, batch, batchIndex) {
    const promises = batch.map((index) => createBooking(socket, index));
    const results = await Promise.allSettled(promises);
    
    stats.sent += batch.length;
    
    const progress = ((stats.sent / count) * 100).toFixed(1);
    logStructured('info', `Batch ${batchIndex} processado`, {
        service: 'stress-test',
        batch: batchIndex,
        progress: `${progress}%`,
        sent: stats.sent,
        success: stats.success,
        failed: stats.failed
    });
}

// Função principal
async function runStressTest() {
    const authToken = await resolveAuthToken();

    logStructured('info', 'Iniciando stress test de commands', {
        service: 'stress-test',
        count,
        concurrency,
        serverUrl,
        customerId,
        hasAuthToken: !!authToken,
        authMode: authTokenArg ? 'token' : (authEmail && authPassword ? 'firebase-email-password' : 'none'),
        geofenceBase: { lat: baseLat, lng: baseLng, radius: geoRadius }
    });

    // Verificar se servidor está respondendo
    const http = require('http');
    const url = require('url');
    const parsedUrl = url.parse(serverUrl);
    
    await new Promise((resolve, reject) => {
        const checkServer = http.get({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 3001,
            path: '/health',
            timeout: 5000
        }, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
        });
        
        checkServer.on('error', (err) => {
            logError(err, 'Servidor não está respondendo', {
                service: 'stress-test',
                serverUrl
            });
            reject(new Error(`Servidor não está respondendo em ${serverUrl}. Inicie o servidor com: node server.js`));
        });
        
        checkServer.on('timeout', () => {
            checkServer.destroy();
            reject(new Error(`Timeout ao verificar servidor em ${serverUrl}`));
        });
    });

    // Conectar WebSocket
    const socket = io(serverUrl, {
        transports: ['websocket', 'polling'], // Fallback para polling
        reconnection: false,
        timeout: 20000,
        forceNew: true,
        auth: authToken ? { token: authToken } : undefined
    });

    await new Promise((resolve, reject) => {
        const connectTimeout = setTimeout(() => {
            reject(new Error('Timeout ao conectar WebSocket'));
        }, 15000);
        
        socket.on('connect', () => {
            clearTimeout(connectTimeout);
            logStructured('info', 'WebSocket conectado', {
                service: 'stress-test'
            });
            resolve();
        });

        socket.on('connect_error', (error) => {
            clearTimeout(connectTimeout);
            logError(error, 'Erro ao conectar WebSocket', {
                service: 'stress-test',
                error: error.message,
                serverUrl
            });
            reject(new Error(`Erro ao conectar WebSocket: ${error.message}. Verifique se o servidor está rodando.`));
        });
    });

    // Aguardar autenticação ser processada
    await new Promise((resolve, reject) => {
        const authTimeout = setTimeout(() => {
            reject(new Error('Timeout na autenticação'));
        }, 10000);

        socket.once('authenticated', () => {
            clearTimeout(authTimeout);
            logStructured('info', 'Autenticado com sucesso', {
                service: 'stress-test'
            });
            resolve();
        });

        socket.once('authentication_error', (error) => {
            clearTimeout(authTimeout);
            reject(new Error(error?.message || 'authentication_error'));
        });

        socket.once('auth_error', (error) => {
            clearTimeout(authTimeout);
            reject(new Error(error?.message || 'auth_error'));
        });
        
        // Autenticar com campos corretos (uid ao invés de userId)
        const authPayload = {
            uid: customerId,
            userType: 'customer'
        };
        if (authToken) {
            authPayload.token = authToken;
        }

        socket.emit('authenticate', authPayload);
    });

    // Criar batches
    const batches = [];
    for (let i = 0; i < count; i += concurrency) {
        const batch = [];
        for (let j = 0; j < concurrency && (i + j) < count; j++) {
            batch.push(i + j);
        }
        batches.push(batch);
    }

    // Processar batches sequencialmente
    for (let i = 0; i < batches.length; i++) {
        await processBatch(socket, batches[i], i + 1);
        
        // Pequena pausa entre batches para não sobrecarregar
        if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    stats.endTime = Date.now();
    const duration = (stats.endTime - stats.startTime) / 1000;

    // Calcular estatísticas
    const avgLatency = stats.latencies.length > 0
        ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
        : 0;
    
    const sortedLatencies = [...stats.latencies].sort((a, b) => a - b);
    const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
    const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
    const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0;

    const throughput = stats.sent / duration;
    const successRate = (stats.success / stats.sent) * 100;

    // Relatório final
    const report = {
        test: 'command-flood',
        config: {
            count,
            concurrency,
            serverUrl,
            customerId,
            hasAuthToken: !!authToken,
            geofenceBase: { lat: baseLat, lng: baseLng, radius: geoRadius }
        },
        results: {
            total: stats.total,
            sent: stats.sent,
            success: stats.success,
            failed: stats.failed,
            timeout: stats.timeout,
            successRate: `${successRate.toFixed(2)}%`,
            duration: `${duration.toFixed(2)}s`,
            throughput: `${throughput.toFixed(2)} req/s`,
            latency: {
                avg: `${avgLatency.toFixed(2)}ms`,
                p50: `${p50.toFixed(2)}ms`,
                p95: `${p95.toFixed(2)}ms`,
                p99: `${p99.toFixed(2)}ms`,
                min: `${stats.latencies.length ? Math.min(...stats.latencies) : 0}ms`,
                max: `${stats.latencies.length ? Math.max(...stats.latencies) : 0}ms`
            },
            errors: stats.errors.slice(0, 10) // Primeiros 10 erros
        },
        timestamp: new Date().toISOString()
    };

    // Salvar relatório
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, `../../stress-test-results-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Log resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE STRESS TEST');
    console.log('='.repeat(60));
    console.log(`Total: ${stats.total}`);
    console.log(`Enviados: ${stats.sent}`);
    console.log(`Sucesso: ${stats.success} (${successRate.toFixed(2)}%)`);
    console.log(`Falhas: ${stats.failed}`);
    console.log(`Timeouts: ${stats.timeout}`);
    console.log(`Duração: ${duration.toFixed(2)}s`);
    console.log(`Throughput: ${throughput.toFixed(2)} req/s`);
    console.log(`\nLatência:`);
    console.log(`  Média: ${avgLatency.toFixed(2)}ms`);
    console.log(`  P50: ${p50.toFixed(2)}ms`);
    console.log(`  P95: ${p95.toFixed(2)}ms`);
    console.log(`  P99: ${p99.toFixed(2)}ms`);
    console.log(`\nRelatório salvo em: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    // Registrar métricas
    metrics.recordRideRequested('stress-test', 'standard');
    
    socket.disconnect();
    process.exit(stats.failed > stats.success ? 1 : 0);
}

// Executar
runStressTest().catch(error => {
    logError(error, 'Erro fatal no stress test', {
        service: 'stress-test'
    });
    process.exit(1);
});
