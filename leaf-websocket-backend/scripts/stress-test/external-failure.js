#!/usr/bin/env node
/**
 * STRESS TEST: External Failure Simulation
 * 
 * Simula falhas de serviços externos (Firebase, Woovi, FCM) para testar resiliência.
 * 
 * Uso:
 *   node scripts/stress-test/external-failure.js --service firebase --duration 60
 *   node scripts/stress-test/external-failure.js --service woovi --duration 120
 *   node scripts/stress-test/external-failure.js --service fcm --duration 60
 */

const io = require('socket.io-client');
const { logStructured, logError } = require('../../utils/logger');
const { metrics } = require('../../utils/prometheus-metrics');

// Parse arguments
const args = process.argv.slice(2);
const service = args.includes('--service')
    ? args[args.indexOf('--service') + 1]
    : 'firebase'; // firebase, woovi, fcm
const duration = args.includes('--duration')
    ? parseInt(args[args.indexOf('--duration') + 1]) || 60
    : 60; // segundos
const serverUrl = args.includes('--url')
    ? args[args.indexOf('--url') + 1]
    : 'http://localhost:3001';
const requestRate = args.includes('--rate')
    ? parseInt(args[args.indexOf('--rate') + 1]) || 10
    : 10; // requisições por segundo

// Estatísticas
const stats = {
    total: 0,
    success: 0,
    failed: 0,
    circuitBreakerOpen: 0,
    fallbackUsed: 0,
    errors: [],
    startTime: Date.now(),
    endTime: null
};

// Simular requisição que depende do serviço externo
async function simulateRequest(socket, index) {
    const startTime = Date.now();
    stats.total++;

    // Diferentes tipos de requisição baseado no serviço
    let requestType;
    let requestData;

    switch (service) {
        case 'firebase':
            // Criar booking (usa Firebase para persistência)
            requestType = 'createBooking';
            requestData = {
                customerId: `failure_test_${index}`,
                pickupLocation: { lat: -23.5505, lng: -46.6333 },
                destinationLocation: { lat: -23.5605, lng: -46.6433 },
                estimatedFare: 25,
                paymentMethod: 'pix'
            };
            break;

        case 'woovi':
            // Criar cobrança (usa Woovi)
            requestType = 'createCharge';
            requestData = {
                value: 25,
                description: 'Test charge',
                correlationID: `test_${index}`
            };
            break;

        case 'fcm':
            // Enviar notificação (usa FCM)
            requestType = 'sendNotification';
            requestData = {
                userId: `test_user_${index}`,
                title: 'Test',
                body: 'Test notification'
            };
            break;

        default:
            requestType = 'createBooking';
            requestData = {
                customerId: `failure_test_${index}`,
                pickupLocation: { lat: -23.5505, lng: -46.6333 },
                destinationLocation: { lat: -23.5605, lng: -46.6433 },
                estimatedFare: 25,
                paymentMethod: 'pix'
            };
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            stats.failed++;
            stats.errors.push({
                index,
                error: 'Timeout',
                service,
                latency: Date.now() - startTime
            });
            resolve({ success: false, error: 'Timeout' });
        }, 10000);

        socket.emit(requestType, requestData);

        socket.once(`${requestType}Success`, (data) => {
            clearTimeout(timeout);
            stats.success++;
            resolve({ success: true, latency: Date.now() - startTime });
        });

        socket.once(`${requestType}Error`, (error) => {
            clearTimeout(timeout);
            const errorMsg = error.message || error.error || 'Unknown';
            
            if (errorMsg.includes('circuit') || errorMsg.includes('breaker')) {
                stats.circuitBreakerOpen++;
            }
            if (errorMsg.includes('fallback')) {
                stats.fallbackUsed++;
            }

            stats.failed++;
            stats.errors.push({
                index,
                error: errorMsg,
                service,
                latency: Date.now() - startTime
            });
            resolve({ success: false, error: errorMsg });
        });
    });
}

// Função principal
async function runFailureTest() {
    logStructured('info', 'Iniciando stress test de falha externa', {
        service: 'stress-test',
        externalService: service,
        duration,
        requestRate,
        serverUrl
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
        forceNew: true
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
    await new Promise((resolve) => {
        socket.once('authenticated', () => {
            logStructured('info', 'Autenticado com sucesso', {
                service: 'stress-test'
            });
            resolve();
        });
        
        // Autenticar com campos corretos (uid ao invés de userId)
        socket.emit('authenticate', {
            uid: `failure_test_${Date.now()}`,
            userType: 'customer'
        });
        
        // Timeout de segurança
        setTimeout(() => {
            logStructured('warn', 'Timeout na autenticação, continuando...', {
                service: 'stress-test'
            });
            resolve();
        }, 5000);
    });

    // Calcular intervalo entre requisições
    const intervalMs = 1000 / requestRate;
    const endTime = Date.now() + (duration * 1000);
    let index = 0;

    // Enviar requisições na taxa especificada até o tempo acabar
    while (Date.now() < endTime) {
        await simulateRequest(socket, index++);
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        // Log de progresso a cada 10 segundos
        const elapsed = (Date.now() - stats.startTime) / 1000;
        if (index % (requestRate * 10) === 0) {
            logStructured('info', 'Progresso do failure test', {
                service: 'stress-test',
                elapsed: `${elapsed.toFixed(1)}s`,
                total: stats.total,
                success: stats.success,
                failed: stats.failed,
                circuitBreakerOpen: stats.circuitBreakerOpen,
                fallbackUsed: stats.fallbackUsed
            });
        }
    }

    stats.endTime = Date.now();
    const actualDuration = (stats.endTime - stats.startTime) / 1000;
    const successRate = (stats.success / stats.total) * 100;
    const actualRate = stats.total / actualDuration;

    // Relatório final
    const report = {
        test: 'external-failure',
        config: {
            externalService: service,
            duration,
            targetRate: requestRate,
            actualRate: actualRate.toFixed(2)
        },
        results: {
            total: stats.total,
            success: stats.success,
            failed: stats.failed,
            successRate: `${successRate.toFixed(2)}%`,
            circuitBreakerOpen: stats.circuitBreakerOpen,
            fallbackUsed: stats.fallbackUsed,
            actualDuration: `${actualDuration.toFixed(2)}s`,
            actualRate: `${actualRate.toFixed(2)} req/s`,
            errors: stats.errors.slice(0, 20) // Primeiros 20 erros
        },
        timestamp: new Date().toISOString()
    };

    // Salvar relatório
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, `../../stress-test-failure-${service}-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Log resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE FAILURE TEST');
    console.log('='.repeat(60));
    console.log(`Serviço testado: ${service}`);
    console.log(`Total de requisições: ${stats.total}`);
    console.log(`Sucesso: ${stats.success} (${successRate.toFixed(2)}%)`);
    console.log(`Falhas: ${stats.failed}`);
    console.log(`Circuit Breaker aberto: ${stats.circuitBreakerOpen} vezes`);
    console.log(`Fallback usado: ${stats.fallbackUsed} vezes`);
    console.log(`Duração: ${actualDuration.toFixed(2)}s`);
    console.log(`Taxa real: ${actualRate.toFixed(2)} req/s`);
    console.log(`\nRelatório salvo em: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    socket.disconnect();
    process.exit(stats.failed > stats.success ? 1 : 0);
}

// Executar
runFailureTest().catch(error => {
    logError(error, 'Erro fatal no failure test', {
        service: 'stress-test'
    });
    process.exit(1);
});

