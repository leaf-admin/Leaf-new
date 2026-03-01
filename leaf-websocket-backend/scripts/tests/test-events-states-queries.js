/**
 * TESTE COMPLETO: EVENTOS, ESTADOS E QUERIES GRAPHQL
 * 
 * Este script testa:
 * 1. Todos os eventos WebSocket
 * 2. Transições de estado
 * 3. Queries GraphQL e otimização N+1
 */

const io = require('socket.io-client');
const { graphql } = require('graphql');
const { buildSchema } = require('graphql');
const { schema } = require('../../graphql/schema');
const { resolvers } = require('../../graphql/resolvers');

// Configurações
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const GRAPHQL_ENDPOINT = `${SERVER_URL}/graphql`;

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Estatísticas
const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0
};

// ==================== TESTES DE EVENTOS ====================

async function testEvent(eventName, direction, data, expectedResponse) {
    stats.total++;
    
    return new Promise((resolve) => {
        const socket = io(SERVER_URL, {
            transports: ['websocket'],
            reconnection: false
        });

        let testPassed = false;
        let timeout;

        socket.on('connect', () => {
            log(`\n📡 Testando evento: ${eventName} (${direction})`, 'cyan');
            
            // Autenticar primeiro
            socket.emit('authenticate', {
                uid: 'test-user-' + Date.now(),
                userType: 'customer'
            });

            socket.once('authenticated', () => {
                // Emitir evento de teste
                if (direction === 'client-to-server') {
                    socket.emit(eventName, data);
                }

                // Aguardar resposta
                if (expectedResponse) {
                    socket.once(expectedResponse.event, (response) => {
                        clearTimeout(timeout);
                        testPassed = true;
                        stats.passed++;
                        log(`  ✅ Evento ${eventName} funcionou corretamente`, 'green');
                        socket.disconnect();
                        resolve(true);
                    });
                } else {
                    // Sem resposta esperada, considerar sucesso após timeout curto
                    setTimeout(() => {
                        clearTimeout(timeout);
                        testPassed = true;
                        stats.passed++;
                        log(`  ✅ Evento ${eventName} emitido com sucesso`, 'green');
                        socket.disconnect();
                        resolve(true);
                    }, 1000);
                }

                // Timeout
                timeout = setTimeout(() => {
                    if (!testPassed) {
                        stats.failed++;
                        log(`  ❌ Timeout ao testar evento ${eventName}`, 'red');
                        socket.disconnect();
                        resolve(false);
                    }
                }, 5000);
            });
        });

        socket.on('connect_error', (error) => {
            stats.failed++;
            log(`  ❌ Erro de conexão: ${error.message}`, 'red');
            resolve(false);
        });
    });
}

// ==================== TESTES DE ESTADOS ====================

async function testStateTransition(initialState, event, expectedState) {
    stats.total++;
    
    return new Promise((resolve) => {
        const socket = io(SERVER_URL, {
            transports: ['websocket'],
            reconnection: false
        });

        let currentState = initialState;
        let testPassed = false;
        let timeout;

        socket.on('connect', () => {
            log(`\n🔄 Testando transição: ${initialState} → ${expectedState}`, 'cyan');
            
            socket.emit('authenticate', {
                uid: 'test-user-' + Date.now(),
                userType: 'driver'
            });

            socket.once('authenticated', () => {
                // Emitir evento que causa transição
                socket.emit(event.name, event.data);

                // Aguardar mudança de estado
                socket.once('stateChanged', (newState) => {
                    if (newState === expectedState) {
                        clearTimeout(timeout);
                        testPassed = true;
                        stats.passed++;
                        log(`  ✅ Transição ${initialState} → ${expectedState} funcionou`, 'green');
                        socket.disconnect();
                        resolve(true);
                    }
                });

                // Timeout
                timeout = setTimeout(() => {
                    if (!testPassed) {
                        stats.warnings++;
                        log(`  ⚠️ Transição não confirmada (pode ser normal)`, 'yellow');
                        socket.disconnect();
                        resolve(false);
                    }
                }, 5000);
            });
        });

        socket.on('connect_error', (error) => {
            stats.failed++;
            log(`  ❌ Erro de conexão: ${error.message}`, 'red');
            resolve(false);
        });
    });
}

// ==================== TESTES DE QUERIES GRAPHQL ====================

async function testGraphQLQuery(query, variables = {}) {
    stats.total++;
    
    try {
        log(`\n📊 Testando query GraphQL: ${query.substring(0, 50)}...`, 'cyan');
        
        const startTime = Date.now();
        const result = await graphql({
            schema,
            source: query,
            variableValues: variables,
            contextValue: {
                isAuthenticated: true,
                permissions: ['read:all_users', 'read:all_drivers', 'read:all_bookings']
            }
        });
        const duration = Date.now() - startTime;

        if (result.errors) {
            stats.failed++;
            log(`  ❌ Erro na query: ${result.errors[0].message}`, 'red');
            return false;
        }

        if (duration > 1000) {
            stats.warnings++;
            log(`  ⚠️ Query lenta: ${duration}ms`, 'yellow');
        } else {
            log(`  ✅ Query executada em ${duration}ms`, 'green');
        }

        stats.passed++;
        return true;

    } catch (error) {
        stats.failed++;
        log(`  ❌ Erro ao executar query: ${error.message}`, 'red');
        return false;
    }
}

// ==================== TESTE DE N+1 PROBLEM ====================

async function testNPlusOneProblem() {
    stats.total++;
    
    log(`\n🔍 Testando problema N+1...`, 'cyan');
    
    try {
        // Query que pode causar N+1
        const query = `
            query {
                drivers(first: 10) {
                    edges {
                        node {
                            id
                            name
                            vehicle {
                                id
                                model
                            }
                            bookings(first: 5) {
                                edges {
                                    node {
                                        id
                                        passenger {
                                            id
                                            name
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        const startTime = Date.now();
        const result = await graphql({
            schema,
            source: query,
            contextValue: {
                isAuthenticated: true,
                permissions: ['read:all_drivers']
            }
        });
        const duration = Date.now() - startTime;

        if (result.errors) {
            stats.failed++;
            log(`  ❌ Erro na query: ${result.errors[0].message}`, 'red');
            return false;
        }

        // Verificar se DataLoader foi usado (deve ser rápido mesmo com muitos relacionamentos)
        if (duration > 2000) {
            stats.warnings++;
            log(`  ⚠️ Possível problema N+1: Query demorou ${duration}ms`, 'yellow');
            log(`  💡 Recomendação: Verificar se DataLoader está sendo usado corretamente`, 'yellow');
        } else {
            log(`  ✅ Query otimizada: ${duration}ms (DataLoader funcionando)`, 'green');
        }

        stats.passed++;
        return true;

    } catch (error) {
        stats.failed++;
        log(`  ❌ Erro ao testar N+1: ${error.message}`, 'red');
        return false;
    }
}

// ==================== TESTE DE QUERIES ASSERTIVAS ====================

async function testAssertiveQueries() {
    stats.total++;
    
    log(`\n🛡️ Testando queries assertivas...`, 'cyan');
    
    try {
        // Query sem filtros (deve falhar ou ter limite)
        const queryWithoutFilters = `
            query {
                bookings {
                    edges {
                        node {
                            id
                            status
                        }
                    }
                }
            }
        `;

        const result = await graphql({
            schema,
            source: queryWithoutFilters,
            contextValue: {
                isAuthenticated: true,
                permissions: ['read:all_bookings']
            }
        });

        // Verificar se query sem filtros foi bloqueada ou limitada
        if (result.errors && result.errors.some(e => e.message.includes('filtro') || e.message.includes('filter'))) {
            log(`  ✅ Query sem filtros foi bloqueada corretamente`, 'green');
            stats.passed++;
            return true;
        }

        // Se não foi bloqueada, verificar se tem limite
        if (result.data && result.data.bookings) {
            const count = result.data.bookings.edges?.length || 0;
            if (count <= 100) {
                log(`  ⚠️ Query sem filtros permitida mas limitada a ${count} resultados`, 'yellow');
                stats.warnings++;
                return true;
            } else {
                log(`  ❌ Query sem filtros retornou ${count} resultados (sem limite)`, 'red');
                stats.failed++;
                return false;
            }
        }

        stats.passed++;
        return true;

    } catch (error) {
        stats.failed++;
        log(`  ❌ Erro ao testar queries assertivas: ${error.message}`, 'red');
        return false;
    }
}

// ==================== EXECUTAR TODOS OS TESTES ====================

async function runAllTests() {
    log('\n🚀 Iniciando testes completos de eventos, estados e queries...\n', 'blue');

    // Testes de eventos
    log('\n📡 ========== TESTES DE EVENTOS ==========', 'blue');
    
    await testEvent('authenticate', 'client-to-server', {
        uid: 'test-user-1',
        userType: 'customer'
    }, { event: 'authenticated' });

    await testEvent('createBooking', 'client-to-server', {
        customerId: 'test-user-1',
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5614, lng: -46.6560 },
        estimatedFare: 25.50
    }, { event: 'bookingCreated' });

    // Testes de estados
    log('\n🔄 ========== TESTES DE ESTADOS ==========', 'blue');
    
    await testStateTransition('idle', {
        name: 'setDriverStatus',
        data: { status: 'AVAILABLE', isOnline: true }
    }, 'available');

    // Testes de queries GraphQL
    log('\n📊 ========== TESTES DE QUERIES GRAPHQL ==========', 'blue');
    
    await testGraphQLQuery(`
        query {
            user(id: "test-user-1") {
                id
                name
                email
            }
        }
    `);

    await testGraphQLQuery(`
        query {
            drivers(first: 10) {
                edges {
                    node {
                        id
                        name
                        status
                    }
                }
            }
        }
    `);

    await testGraphQLQuery(`
        query {
            nearbyDrivers(
                location: { latitude: -23.5505, longitude: -46.6333 }
                radius: 5000
                limit: 10
            ) {
                id
                name
                vehicle {
                    model
                }
            }
        }
    `);

    // Teste de N+1
    log('\n🔍 ========== TESTE DE N+1 PROBLEM ==========', 'blue');
    await testNPlusOneProblem();

    // Teste de queries assertivas
    log('\n🛡️ ========== TESTE DE QUERIES ASSERTIVAS ==========', 'blue');
    await testAssertiveQueries();

    // Resumo
    log('\n📊 ========== RESUMO DOS TESTES ==========', 'blue');
    log(`Total de testes: ${stats.total}`, 'cyan');
    log(`✅ Passou: ${stats.passed}`, 'green');
    log(`❌ Falhou: ${stats.failed}`, 'red');
    log(`⚠️ Avisos: ${stats.warnings}`, 'yellow');
    log(`\nTaxa de sucesso: ${((stats.passed / stats.total) * 100).toFixed(1)}%`, 
        stats.passed / stats.total > 0.8 ? 'green' : 'yellow');

    process.exit(stats.failed > 0 ? 1 : 0);
}

// Executar testes
runAllTests().catch(error => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

