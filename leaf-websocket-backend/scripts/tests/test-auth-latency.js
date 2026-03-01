#!/usr/bin/env node

/**
 * 🧪 TESTE ISOLADO DE AUTENTICAÇÃO - LATÊNCIA E CORREÇÃO
 * 
 * Este script testa isoladamente o evento de autenticação para:
 * 1. Medir latência entre connect e authenticate
 * 2. Medir latência entre authenticate e authenticated
 * 3. Verificar se está funcionando corretamente
 * 4. Identificar problemas de timing
 */

const io = require('socket.io-client');

// Configuração
const WS_URL = process.env.WS_URL || 'http://localhost:3001';
const TEST_ITERATIONS = 5; // Número de testes para média

// Cores ANSI
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

class AuthLatencyTest {
    constructor(userId, userType) {
        this.userId = userId;
        this.userType = userType;
        this.results = [];
    }

    async runSingleTest(iteration) {
        return new Promise((resolve, reject) => {
            const timings = {
                connectStart: Date.now(),
                connectEnd: null,
                authenticateEmitted: null,
                authenticatedReceived: null,
                error: null
            };

            log(`\n📊 Teste ${iteration + 1}/${TEST_ITERATIONS}`, 'cyan');
            log(`   Usuário: ${this.userId} (${this.userType})`, 'blue');

            const socket = io(WS_URL, {
                transports: ['websocket', 'polling'],
                reconnection: false,
                timeout: 20000
            });

            // Event: connect
            socket.once('connect', () => {
                timings.connectEnd = Date.now();
                const connectLatency = timings.connectEnd - timings.connectStart;
                log(`   ✅ Conectado em ${connectLatency}ms (Socket ID: ${socket.id})`, 'green');

                // Emitir authenticate IMEDIATAMENTE após connect
                timings.authenticateEmitted = Date.now();
                const timeToEmit = timings.authenticateEmitted - timings.connectEnd;
                log(`   📤 Emitindo 'authenticate' após ${timeToEmit}ms do connect`, 'cyan');
                
                socket.emit('authenticate', {
                    uid: this.userId,
                    userType: this.userType
                });
            });

            // Event: authenticated
            socket.once('authenticated', (data) => {
                timings.authenticatedReceived = Date.now();
                const authLatency = timings.authenticatedReceived - timings.authenticateEmitted;
                const totalLatency = timings.authenticatedReceived - timings.connectStart;

                log(`   ✅ 'authenticated' recebido em ${authLatency}ms após emit`, 'green');
                log(`   📊 Latência total (connect → authenticated): ${totalLatency}ms`, 'magenta');
                log(`   📦 Payload: ${JSON.stringify(data)}`, 'blue');

                socket.disconnect();
                resolve({
                    ...timings,
                    connectLatency: timings.connectEnd - timings.connectStart,
                    timeToEmit: timings.authenticateEmitted - timings.connectEnd,
                    authLatency: authLatency,
                    totalLatency: totalLatency,
                    success: true
                });
            });

            // Event: auth_error
            socket.once('auth_error', (error) => {
                timings.error = error;
                log(`   ❌ Erro de autenticação: ${JSON.stringify(error)}`, 'red');
                socket.disconnect();
                resolve({
                    ...timings,
                    success: false,
                    error: error
                });
            });

            // Event: connect_error
            socket.on('connect_error', (error) => {
                log(`   ❌ Erro de conexão: ${error.message}`, 'red');
                socket.disconnect();
                reject(error);
            });

            // Event: disconnect
            socket.on('disconnect', (reason) => {
                if (reason !== 'io client disconnect') {
                    log(`   ⚠️ Desconectado: ${reason}`, 'yellow');
                }
            });

            // Timeout de segurança
            setTimeout(() => {
                if (!timings.authenticatedReceived && !timings.error) {
                    log(`   ❌ Timeout após 20s`, 'red');
                    socket.disconnect();
                    resolve({
                        ...timings,
                        success: false,
                        error: 'Timeout',
                        timeout: true
                    });
                }
            }, 20000);
        });
    }

    async run() {
        log(`\n${colors.bold}🧪 TESTE DE LATÊNCIA DE AUTENTICAÇÃO${colors.reset}`, 'cyan');
        log(`URL: ${WS_URL}`, 'blue');
        log(`Usuário: ${this.userId} (${this.userType})`, 'blue');
        log(`Iterações: ${TEST_ITERATIONS}`, 'blue');

        for (let i = 0; i < TEST_ITERATIONS; i++) {
            try {
                const result = await this.runSingleTest(i);
                this.results.push(result);
                
                // Pequeno delay entre testes
                if (i < TEST_ITERATIONS - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                log(`   ❌ Erro no teste ${i + 1}: ${error.message}`, 'red');
                this.results.push({
                    success: false,
                    error: error.message
                });
            }
        }

        this.printStatistics();
    }

    printStatistics() {
        log(`\n${colors.bold}📊 ESTATÍSTICAS${colors.reset}`, 'cyan');
        log(`================================`, 'cyan');

        const successful = this.results.filter(r => r.success);
        const failed = this.results.filter(r => !r.success);

        log(`\n✅ Sucessos: ${successful.length}/${this.results.length}`, successful.length === this.results.length ? 'green' : 'yellow');
        log(`❌ Falhas: ${failed.length}/${this.results.length}`, failed.length > 0 ? 'red' : 'green');

        if (failed.length > 0) {
            log(`\n⚠️ Falhas:`, 'yellow');
            failed.forEach((f, i) => {
                log(`   ${i + 1}. ${f.error || 'Timeout'}`, 'red');
            });
        }

        if (successful.length > 0) {
            const connectLatencies = successful.map(r => r.connectLatency);
            const timeToEmit = successful.map(r => r.timeToEmit);
            const authLatencies = successful.map(r => r.authLatency);
            const totalLatencies = successful.map(r => r.totalLatency);

            const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
            const min = (arr) => Math.min(...arr);
            const max = (arr) => Math.max(...arr);
            const median = (arr) => {
                const sorted = [...arr].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
            };

            log(`\n⏱️ LATÊNCIAS (em ms):`, 'cyan');
            log(`\n   📡 Connect:`, 'blue');
            log(`      Média: ${avg(connectLatencies).toFixed(2)}ms`, 'green');
            log(`      Mín: ${min(connectLatencies)}ms | Máx: ${max(connectLatencies)}ms | Mediana: ${median(connectLatencies).toFixed(2)}ms`, 'cyan');

            log(`\n   ⏱️ Time to Emit (connect → emit authenticate):`, 'blue');
            log(`      Média: ${avg(timeToEmit).toFixed(2)}ms`, 'green');
            log(`      Mín: ${min(timeToEmit)}ms | Máx: ${max(timeToEmit)}ms | Mediana: ${median(timeToEmit).toFixed(2)}ms`, 'cyan');

            log(`\n   🔐 Auth Latency (emit → authenticated):`, 'blue');
            log(`      Média: ${avg(authLatencies).toFixed(2)}ms`, 'green');
            log(`      Mín: ${min(authLatencies)}ms | Máx: ${max(authLatencies)}ms | Mediana: ${median(authLatencies).toFixed(2)}ms`, 'cyan');

            log(`\n   📊 Total Latency (connect → authenticated):`, 'blue');
            log(`      Média: ${avg(totalLatencies).toFixed(2)}ms`, 'green');
            log(`      Mín: ${min(totalLatencies)}ms | Máx: ${max(totalLatencies)}ms | Mediana: ${median(totalLatencies).toFixed(2)}ms`, 'cyan');

            // Análise
            log(`\n🔍 ANÁLISE:`, 'cyan');
            if (avg(authLatencies) > 5000) {
                log(`   ⚠️ Latência de autenticação alta (>5s) - pode indicar problema no servidor`, 'yellow');
            } else if (avg(authLatencies) > 2000) {
                log(`   ⚠️ Latência de autenticação moderada (>2s) - verificar Redis/Firebase`, 'yellow');
            } else {
                log(`   ✅ Latência de autenticação aceitável (<2s)`, 'green');
            }

            if (avg(timeToEmit) > 100) {
                log(`   ⚠️ Tempo para emitir após connect alto (>100ms) - pode precisar de delay`, 'yellow');
            } else {
                log(`   ✅ Tempo para emitir após connect OK (<100ms)`, 'green');
            }
        }

        log(`\n${colors.bold}✅ Teste concluído!${colors.reset}\n`, 'green');
    }
}

// Executar testes
async function main() {
    try {
        // Teste 1: Customer
        log(`\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`, 'cyan');
        const customerTest = new AuthLatencyTest('customer_test_001', 'customer');
        await customerTest.run();

        // Teste 2: Driver
        log(`\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`, 'cyan');
        const driverTest = new AuthLatencyTest('driver_test_001', 'driver');
        await driverTest.run();

        log(`\n${colors.bold}🎯 RESUMO FINAL${colors.reset}`, 'cyan');
        log(`Todos os testes concluídos. Verifique as estatísticas acima.`, 'blue');

    } catch (error) {
        log(`\n❌ Erro fatal: ${error.message}`, 'red');
        log(`Stack: ${error.stack}`, 'red');
        process.exit(1);
    }
}

main();

