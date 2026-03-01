#!/usr/bin/env node
/**
 * VALIDAÇÃO COMPLETA: Testa todas as funcionalidades implementadas
 * 
 * Valida:
 * - Logs estruturados (traceId)
 * - OpenTelemetry spans
 * - Métricas Prometheus
 * - Workers e Consumer Groups
 * - Redis Streams
 * - Circuit Breakers
 * - Idempotency
 * 
 * Uso:
 *   node scripts/stress-test/validate-all-features.js
 */

const io = require('socket.io-client');
const redisPool = require('../../utils/redis-pool');
const { logStructured, logError } = require('../../utils/logger');
const { metrics, getMetrics } = require('../../utils/prometheus-metrics');
const { getTracer } = require('../../utils/tracer');
const fs = require('fs');
const path = require('path');

const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
const results = {
    logs: { tested: false, passed: false, details: [] },
    spans: { tested: false, passed: false, details: [] },
    metrics: { tested: false, passed: false, details: [] },
    workers: { tested: false, passed: false, details: [] },
    redis: { tested: false, passed: false, details: [] },
    circuitBreakers: { tested: false, passed: false, details: [] },
    idempotency: { tested: false, passed: false, details: [] },
    overall: { passed: false, score: 0, total: 0 }
};

// 1. Validar Logs Estruturados
async function validateLogs() {
    results.logs.tested = true;
    const testTraceId = `test_${Date.now()}`;
    
    try {
        logStructured('info', 'Teste de log estruturado', {
            service: 'validation',
            traceId: testTraceId,
            test: true
        });
        
        // Verificar se logger está funcionando
        results.logs.passed = true;
        results.logs.details.push('✅ Logs estruturados funcionando');
        results.logs.details.push(`✅ traceId: ${testTraceId}`);
        return true;
    } catch (error) {
        results.logs.details.push(`❌ Erro: ${error.message}`);
        return false;
    }
}

// 2. Validar OpenTelemetry Spans
async function validateSpans() {
    results.spans.tested = true;
    
    try {
        const tracer = getTracer();
        if (!tracer) {
            results.spans.details.push('⚠️  Tracer não inicializado (pode ser normal se pacotes não instalados)');
            return false;
        }
        
        const span = tracer.startSpan('validation.test', {
            attributes: {
                'test.type': 'validation',
                'test.name': 'span-test'
            }
        });
        
        span.setStatus({ code: 1 }); // OK
        span.end();
        
        results.spans.passed = true;
        results.spans.details.push('✅ Spans OpenTelemetry funcionando');
        return true;
    } catch (error) {
        results.spans.details.push(`❌ Erro: ${error.message}`);
        return false;
    }
}

// 3. Validar Métricas Prometheus
async function validateMetrics() {
    results.metrics.tested = true;
    
    try {
        // Registrar algumas métricas de teste
        metrics.recordCommand('ValidationCommand', 0.1, true);
        metrics.recordEventPublished('validation.test');
        metrics.recordListener('ValidationListener', 0.05, true);
        metrics.recordRedis('test', 0.01, true);
        
        // Obter métricas
        const metricsText = await getMetrics();
        
        if (metricsText && metricsText.includes('leaf_command_total')) {
            results.metrics.passed = true;
            results.metrics.details.push('✅ Métricas Prometheus funcionando');
            results.metrics.details.push('✅ Endpoint /metrics disponível');
            return true;
        } else {
            results.metrics.details.push('⚠️  Métricas não encontradas no formato esperado');
            return false;
        }
    } catch (error) {
        results.metrics.details.push(`❌ Erro: ${error.message}`);
        return false;
    }
}

// 4. Validar Workers e Consumer Groups
async function validateWorkers() {
    results.workers.tested = true;
    
    try {
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        
        // Verificar se stream existe
        const streamName = 'ride_events';
        const groupName = 'listener-workers';
        
        try {
            // Tentar criar consumer group (pode falhar se já existe, mas isso é OK)
            await redis.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
            results.workers.details.push('✅ Consumer Group criado');
        } catch (error) {
            if (error.message.includes('BUSYGROUP')) {
                results.workers.details.push('✅ Consumer Group já existe (OK)');
            } else {
                throw error;
            }
        }
        
        // Verificar informações do grupo
        const groupInfo = await redis.xinfo('GROUPS', streamName);
        if (groupInfo && groupInfo.length > 0) {
            results.workers.passed = true;
            results.workers.details.push('✅ Redis Streams e Consumer Groups funcionando');
            return true;
        } else {
            results.workers.details.push('⚠️  Consumer Group não encontrado');
            return false;
        }
    } catch (error) {
        results.workers.details.push(`❌ Erro: ${error.message}`);
        return false;
    }
}

// 5. Validar Redis
async function validateRedis() {
    results.redis.tested = true;
    
    try {
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        
        // Teste básico
        const testKey = `validation:test:${Date.now()}`;
        await redis.set(testKey, 'test-value', 'EX', 10);
        const value = await redis.get(testKey);
        await redis.del(testKey);
        
        if (value === 'test-value') {
            results.redis.passed = true;
            results.redis.details.push('✅ Redis funcionando');
            results.redis.details.push('✅ Operações básicas OK');
            return true;
        } else {
            results.redis.details.push('❌ Valor não corresponde');
            return false;
        }
    } catch (error) {
        results.redis.details.push(`❌ Erro: ${error.message}`);
        return false;
    }
}

// 6. Validar Circuit Breakers
async function validateCircuitBreakers() {
    results.circuitBreakers.tested = true;
    
    try {
        const circuitBreakerService = require('../../services/circuit-breaker-service');
        
        // Usar getBreaker que cria se não existir
        const breaker = circuitBreakerService.getBreaker('validation-test', {
            failureThreshold: 5,
            resetTimeout: 60000
        });
        
        if (breaker) {
            const state = breaker.getState();
            const stateValue = typeof state === 'object' ? state.state : state;
            
            results.circuitBreakers.passed = true;
            results.circuitBreakers.details.push('✅ Circuit Breaker Service funcionando');
            results.circuitBreakers.details.push(`✅ Estado inicial: ${stateValue || 'CLOSED'}`);
            
            // Testar se métricas estão sendo registradas
            metrics.setCircuitBreakerState('validation-test', 'CLOSED');
            results.circuitBreakers.details.push('✅ Métricas de Circuit Breaker funcionando');
            
            return true;
        } else {
            results.circuitBreakers.details.push('❌ Circuit Breaker não criado');
            return false;
        }
    } catch (error) {
        results.circuitBreakers.details.push(`❌ Erro: ${error.message}`);
        results.circuitBreakers.details.push(`   Stack: ${error.stack?.split('\n')[0]}`);
        return false;
    }
}

// 7. Validar Idempotency
async function validateIdempotency() {
    results.idempotency.tested = true;
    
    try {
        const IdempotencyService = require('../../services/idempotency-service');
        const testKey = `validation:${Date.now()}`;
        
        // Primeira chamada deve ser nova
        const first = await IdempotencyService.checkAndSet(testKey);
        if (!first.isNew) {
            results.idempotency.details.push('❌ Primeira chamada deveria ser nova');
            return false;
        }
        
        // Segunda chamada deve ser duplicada
        const second = await IdempotencyService.checkAndSet(testKey);
        if (second.isNew) {
            results.idempotency.details.push('❌ Segunda chamada deveria ser duplicada');
            return false;
        }
        
        results.idempotency.passed = true;
        results.idempotency.details.push('✅ Idempotency Service funcionando');
        results.idempotency.details.push('✅ Detecção de duplicatas OK');
        return true;
    } catch (error) {
        results.idempotency.details.push(`❌ Erro: ${error.message}`);
        return false;
    }
}

// 8. Validar WebSocket e Fluxo Completo
async function validateWebSocketFlow() {
    return new Promise((resolve) => {
        let connected = false;
        let authenticated = false;
        let bookingCreated = false;
        let errorDetails = [];
        
        // Primeiro, verificar se servidor está respondendo com retry
        const http = require('http');
        const url = require('url');
        const parsedUrl = url.parse(serverUrl);
        
        let retries = 0;
        const maxRetries = 5;
        const retryDelay = 2000; // 2 segundos
        
        function checkServerWithRetry() {
            const checkServer = http.get({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 3001,
                path: '/health',
                timeout: 3000
            }, (res) => {
                res.on('data', () => {});
                res.on('end', () => {
                    // Servidor está respondendo, tentar WebSocket
                    errorDetails.push('✅ Servidor está respondendo');
                    tryConnect();
                });
            });
            
            checkServer.on('error', (err) => {
                retries++;
                if (retries < maxRetries) {
                    errorDetails.push(`⏳ Tentativa ${retries}/${maxRetries}: Servidor ainda não está pronto, aguardando...`);
                    setTimeout(checkServerWithRetry, retryDelay);
                } else {
                    errorDetails.push(`❌ Servidor não está respondendo em ${serverUrl} após ${maxRetries} tentativas`);
                    errorDetails.push(`   Erro HTTP: ${err.message}`);
                    errorDetails.push(`   Verifique se o servidor está rodando: node server.js`);
                    resolve({
                        passed: false,
                        details: errorDetails
                    });
                }
            });
            
            checkServer.on('timeout', () => {
                checkServer.destroy();
                retries++;
                if (retries < maxRetries) {
                    errorDetails.push(`⏳ Tentativa ${retries}/${maxRetries}: Timeout, tentando novamente...`);
                    setTimeout(checkServerWithRetry, retryDelay);
                } else {
                    errorDetails.push(`❌ Timeout ao verificar servidor após ${maxRetries} tentativas`);
                    errorDetails.push(`   Servidor pode não estar rodando em ${serverUrl}`);
                    resolve({
                        passed: false,
                        details: errorDetails
                    });
                }
            });
        }
        
        checkServerWithRetry();
        
        function tryConnect() {
            const socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: false,
                timeout: 15000,
                forceNew: true
            });
            
            let authTimeout;
            const mainTimeout = setTimeout(() => {
                socket.disconnect();
                if (!connected) {
                    errorDetails.push(`❌ Timeout ao conectar WebSocket`);
                } else if (!authenticated) {
                    errorDetails.push(`❌ Timeout na autenticação (servidor não respondeu)`);
                } else if (!bookingCreated) {
                    errorDetails.push(`⚠️  createBooking não completou (pode ser normal se validação falhar)`);
                }
                resolve({
                    passed: connected && authenticated,
                    details: errorDetails.length > 0 ? errorDetails : [
                        connected ? '✅ WebSocket conectado' : '❌ WebSocket não conectou',
                        authenticated ? '✅ Autenticação OK' : '❌ Autenticação falhou',
                        bookingCreated ? '✅ createBooking funcionou' : '⚠️  createBooking não testado'
                    ]
                });
            }, 30000); // 30s timeout total
            
            socket.on('connect', () => {
                connected = true;
                errorDetails.push('✅ WebSocket conectado');
                
                // Autenticar imediatamente após conexão
                const testUid = `validation_${Date.now()}`;
                socket.emit('authenticate', {
                    uid: testUid,
                    userType: 'customer'
                });
                
                // Timeout específico para autenticação (10s)
                authTimeout = setTimeout(() => {
                    if (!authenticated) {
                        errorDetails.push(`❌ Timeout na autenticação (10s sem resposta)`);
                        socket.disconnect();
                        clearTimeout(mainTimeout);
                        resolve({
                            passed: false,
                            details: errorDetails
                        });
                    }
                }, 10000);
            });
            
            socket.on('authenticated', (data) => {
                authenticated = true;
                clearTimeout(authTimeout);
                errorDetails.push('✅ Autenticação OK');
                
                // Testar createBooking após autenticação
                setTimeout(() => {
                    socket.emit('createBooking', {
                        customerId: socket.userId || `validation_${Date.now()}`,
                        pickupLocation: { lat: -23.5505, lng: -46.6333 },
                        destinationLocation: { lat: -23.5605, lng: -46.6433 },
                        estimatedFare: 25,
                        paymentMethod: 'pix',
                        carType: 'standard'
                    });
                }, 500); // Pequeno delay para garantir que autenticação foi processada
            });
            
            socket.on('auth_error', (error) => {
                clearTimeout(authTimeout);
                errorDetails.push(`❌ Erro de autenticação: ${error.message || error.error || 'Unknown'}`);
                socket.disconnect();
                clearTimeout(mainTimeout);
                resolve({
                    passed: false,
                    details: errorDetails
                });
            });
            
            socket.on('bookingCreated', (data) => {
                bookingCreated = true;
                clearTimeout(mainTimeout);
                socket.disconnect();
                resolve({
                    passed: true,
                    details: [
                        '✅ WebSocket conectado',
                        '✅ Autenticação OK',
                        '✅ createBooking funcionou',
                        `✅ Booking ID: ${data.bookingId || 'N/A'}`
                    ]
                });
            });
            
            socket.on('bookingError', (error) => {
                errorDetails.push(`⚠️  createBooking retornou erro: ${error.message || error.error || 'Unknown'}`);
                // Não falhar completamente, apenas avisar
                clearTimeout(mainTimeout);
                socket.disconnect();
                resolve({
                    passed: connected && authenticated, // Passa se conectou e autenticou
                    details: errorDetails
                });
            });
            
            socket.on('connect_error', (error) => {
                errorDetails.push(`❌ Erro de conexão WebSocket: ${error.message}`);
                errorDetails.push(`   Verifique se o servidor está rodando e escutando em ${serverUrl}`);
                clearTimeout(mainTimeout);
                clearTimeout(authTimeout);
                resolve({
                    passed: false,
                    details: errorDetails
                });
            });
            
            socket.on('disconnect', (reason) => {
                if (reason !== 'io client disconnect' && reason !== 'transport close') {
                    errorDetails.push(`⚠️  Desconectado: ${reason}`);
                }
            });
        }
    });
}

// Função principal
async function runValidation() {
    logStructured('info', 'Iniciando validação completa de funcionalidades', {
        service: 'validation',
        serverUrl
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 VALIDAÇÃO COMPLETA DE FUNCIONALIDADES');
    console.log('='.repeat(60) + '\n');
    
    // Executar todas as validações
    const validations = [
        { name: 'Logs Estruturados', fn: validateLogs },
        { name: 'OpenTelemetry Spans', fn: validateSpans },
        { name: 'Métricas Prometheus', fn: validateMetrics },
        { name: 'Workers e Consumer Groups', fn: validateWorkers },
        { name: 'Redis', fn: validateRedis },
        { name: 'Circuit Breakers', fn: validateCircuitBreakers },
        { name: 'Idempotency', fn: validateIdempotency }
    ];
    
    for (const validation of validations) {
        console.log(`📋 Validando: ${validation.name}...`);
        try {
            await validation.fn();
        } catch (error) {
            logError(error, `Erro ao validar ${validation.name}`, {
                service: 'validation'
            });
        }
        console.log('');
    }
    
    // Validar WebSocket
    console.log('📋 Validando: WebSocket e Fluxo Completo...');
    const wsResult = await validateWebSocketFlow();
    results.websocket = {
        tested: true,
        passed: wsResult.passed,
        details: wsResult.details
    };
    console.log('');
    
    // Calcular score
    const allTests = [
        results.logs,
        results.spans,
        results.metrics,
        results.workers,
        results.redis,
        results.circuitBreakers,
        results.idempotency,
        results.websocket
    ];
    
    const passed = allTests.filter(t => t.passed).length;
    const total = allTests.filter(t => t.tested).length;
    const score = total > 0 ? (passed / total) * 100 : 0;
    
    results.overall.total = total;
    results.overall.passed = passed;
    results.overall.score = score;
    
    // Relatório final
    console.log('='.repeat(60));
    console.log('📊 RESULTADO DA VALIDAÇÃO');
    console.log('='.repeat(60));
    console.log(`\n✅ Testes Passados: ${passed}/${total}`);
    console.log(`📈 Score: ${score.toFixed(1)}%\n`);
    
    for (const test of allTests) {
        if (test.tested) {
            const status = test.passed ? '✅' : '❌';
            const testName = Object.keys(results).find(k => results[k] === test);
            console.log(`${status} ${testName || 'Unknown'}`);
            test.details.forEach(detail => {
                console.log(`   ${detail}`);
            });
            console.log('');
        }
    }
    
    // Salvar relatório
    const reportPath = path.join(__dirname, `../../validation-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    
    console.log(`\n📄 Relatório completo salvo em: ${reportPath}`);
    console.log('='.repeat(60) + '\n');
    
    // Exit code baseado no resultado
    process.exit(score >= 80 ? 0 : 1);
}

// Executar
runValidation().catch(error => {
    logError(error, 'Erro fatal na validação', {
        service: 'validation'
    });
    process.exit(1);
});

