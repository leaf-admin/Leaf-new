/**
 * ANÁLISE COMPLETA DE MÉTRICAS - SEM NECESSIDADE DE SERVIDOR
 * 
 * Este script analisa o código diretamente e gera métricas completas:
 * 1. Eventos WebSocket
 * 2. Estados da aplicação
 * 3. Queries GraphQL
 * 4. Otimizações N+1
 * 5. DataLoaders
 */

const fs = require('fs');
const path = require('path');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Estatísticas
const metrics = {
    eventos: {
        total: 0,
        implementados: 0,
        porCategoria: {}
    },
    estados: {
        motorista: 0,
        passageiro: 0,
        servidor: 0
    },
    graphql: {
        queries: 0,
        mutations: 0,
        subscriptions: 0,
        resolvers: 0,
        dataloaders: 0,
        otimizados: 0,
        naoOtimizados: 0
    },
    performance: {
        queriesAssertivas: 0,
        queriesNaoAssertivas: 0,
        cacheImplementado: 0,
        rateLimiting: 0
    }
};

// ==================== ANÁLISE DE EVENTOS ====================

function analisarEventos() {
    log('\n📡 ========== ANÁLISE DE EVENTOS WEBSOCKET ==========', 'blue');
    
    const serverPath = path.join(__dirname, '../../server.js');
    if (!fs.existsSync(serverPath)) {
        log('  ❌ Arquivo server.js não encontrado', 'red');
        return;
    }

    const serverContent = fs.readFileSync(serverPath, 'utf8');
    
    // Eventos conhecidos
    const eventos = [
        'authenticate', 'authenticated',
        'createBooking', 'bookingCreated', 'bookingError',
        'newRideRequest', 'rideRequest',
        'acceptRide', 'rideAccepted', 'acceptRideError',
        'rejectRide', 'rideRejected', 'rejectRideError',
        'confirmPayment', 'paymentConfirmed', 'paymentError',
        'startTrip', 'tripStarted', 'startTripError',
        'completeTrip', 'tripCompleted', 'completeTripError',
        'submitRating', 'ratingSubmitted',
        'cancelRide', 'rideCancelled',
        'sendMessage', 'newMessage',
        'setDriverStatus', 'updateLocation',
        'searchDrivers', 'cancelDriverSearch',
        'reportIncident', 'emergencyContact', 'createSupportTicket'
    ];

    eventos.forEach(evento => {
        const regex = new RegExp(`socket\\.(on|emit)\\(['"]${evento}['"]`, 'g');
        const matches = serverContent.match(regex);
        if (matches && matches.length > 0) {
            metrics.eventos.total++;
            metrics.eventos.implementados++;
            
            // Categorizar
            let categoria = 'Outros';
            if (evento.includes('authenticate')) categoria = 'Autenticação';
            else if (evento.includes('Booking') || evento.includes('booking')) categoria = 'Booking';
            else if (evento.includes('Ride') || evento.includes('ride')) categoria = 'Corrida';
            else if (evento.includes('Payment') || evento.includes('payment')) categoria = 'Pagamento';
            else if (evento.includes('Trip') || evento.includes('trip')) categoria = 'Viagem';
            else if (evento.includes('Message') || evento.includes('message')) categoria = 'Chat';
            else if (evento.includes('Driver') || evento.includes('driver')) categoria = 'Motorista';
            
            metrics.eventos.porCategoria[categoria] = (metrics.eventos.porCategoria[categoria] || 0) + 1;
        }
    });

    log(`  ✅ Total de eventos encontrados: ${metrics.eventos.implementados}`, 'green');
    Object.entries(metrics.eventos.porCategoria).forEach(([cat, count]) => {
        log(`     ${cat}: ${count} eventos`, 'cyan');
    });
}

// ==================== ANÁLISE DE ESTADOS ====================

function analisarEstados() {
    log('\n🔄 ========== ANÁLISE DE ESTADOS ==========', 'blue');
    
    // Estados do motorista
    const driverUI = path.join(__dirname, '../../../mobile-app/src/components/map/DriverUI.js');
    if (fs.existsSync(driverUI)) {
        const content = fs.readFileSync(driverUI, 'utf8');
        const estadosMotorista = ['idle', 'searching', 'accepted', 'enRoute', 'atPickup', 'inProgress', 'completed', 'cancelled'];
        estadosMotorista.forEach(estado => {
            if (content.includes(`'${estado}'`) || content.includes(`"${estado}"`)) {
                metrics.estados.motorista++;
            }
        });
        log(`  ✅ Estados do motorista: ${metrics.estados.motorista}`, 'green');
    }

    // Estados do passageiro
    const passengerUI = path.join(__dirname, '../../../mobile-app/src/components/map/PassengerUI.js');
    if (fs.existsSync(passengerUI)) {
        const content = fs.readFileSync(passengerUI, 'utf8');
        const estadosPassageiro = ['idle', 'searching', 'accepted', 'started', 'completed', 'canceled'];
        estadosPassageiro.forEach(estado => {
            if (content.includes(`'${estado}'`) || content.includes(`"${estado}"`)) {
                metrics.estados.passageiro++;
            }
        });
        log(`  ✅ Estados do passageiro: ${metrics.estados.passageiro}`, 'green');
    }

    // Estados no servidor
    const rideStateManager = path.join(__dirname, '../../services/ride-state-manager.js');
    if (fs.existsSync(rideStateManager)) {
        const content = fs.readFileSync(rideStateManager, 'utf8');
        const estadosServidor = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'];
        estadosServidor.forEach(estado => {
            if (content.includes(estado)) {
                metrics.estados.servidor++;
            }
        });
        log(`  ✅ Estados no servidor: ${metrics.estados.servidor}`, 'green');
    }
}

// ==================== ANÁLISE DE GRAPHQL ====================

function analisarGraphQL() {
    log('\n📊 ========== ANÁLISE DE GRAPHQL ==========', 'blue');
    
    const resolversPath = path.join(__dirname, '../../graphql/resolvers');
    if (!fs.existsSync(resolversPath)) {
        log('  ❌ Diretório de resolvers não encontrado', 'red');
        return;
    }

    const resolvers = fs.readdirSync(resolversPath).filter(f => f.endsWith('.js'));
    metrics.graphql.resolvers = resolvers.length;
    log(`  ✅ Resolvers encontrados: ${resolvers.length}`, 'green');

    // Analisar cada resolver
    resolvers.forEach(resolverFile => {
        const resolverPath = path.join(resolversPath, resolverFile);
        const content = fs.readFileSync(resolverPath, 'utf8');
        
        // Contar queries, mutations, subscriptions
        const queryMatches = content.match(/async\s+\w+\s*\(/g);
        if (queryMatches) {
            metrics.graphql.queries += queryMatches.length;
        }

        // Verificar DataLoader
        if (content.includes('DataLoader')) {
            metrics.graphql.dataloaders++;
            
            // Verificar se usa OptimizedDataLoader
            if (content.includes('OptimizedDataLoader')) {
                metrics.graphql.otimizados++;
                log(`     ✅ ${resolverFile}: Usa OptimizedDataLoader`, 'green');
            } else {
                metrics.graphql.naoOtimizados++;
                log(`     ⚠️ ${resolverFile}: DataLoader não otimizado`, 'yellow');
            }
        }
    });

    log(`  📊 Total de queries: ${metrics.graphql.queries}`, 'cyan');
    log(`  📊 DataLoaders: ${metrics.graphql.dataloaders}`, 'cyan');
    log(`  ✅ Otimizados: ${metrics.graphql.otimizados}`, 'green');
    log(`  ⚠️ Não otimizados: ${metrics.graphql.naoOtimizados}`, 'yellow');
}

// ==================== ANÁLISE DE PERFORMANCE ====================

function analisarPerformance() {
    log('\n⚡ ========== ANÁLISE DE PERFORMANCE ==========', 'blue');
    
    const resolversPath = path.join(__dirname, '../../graphql/resolvers');
    if (!fs.existsSync(resolversPath)) {
        return;
    }

    const resolvers = fs.readdirSync(resolversPath).filter(f => f.endsWith('.js'));
    
    resolvers.forEach(resolverFile => {
        const resolverPath = path.join(resolversPath, resolverFile);
        const content = fs.readFileSync(resolverPath, 'utf8');
        
        // Verificar queries assertivas (com validação de filtros)
        if (content.includes('if (!') && content.includes('throw')) {
            metrics.performance.queriesAssertivas++;
        } else {
            metrics.performance.queriesNaoAssertivas++;
        }

        // Verificar cache
        if (content.includes('cache') || content.includes('Cache')) {
            metrics.performance.cacheImplementado++;
        }

        // Verificar rate limiting
        if (content.includes('rateLimit') || content.includes('rateLimiter')) {
            metrics.performance.rateLimiting++;
        }
    });

    log(`  ✅ Queries assertivas: ${metrics.performance.queriesAssertivas}`, 'green');
    log(`  ⚠️ Queries não assertivas: ${metrics.performance.queriesNaoAssertivas}`, 'yellow');
    log(`  ✅ Cache implementado: ${metrics.performance.cacheImplementado}`, 'green');
    log(`  ✅ Rate limiting: ${metrics.performance.rateLimiting}`, 'green');
}

// ==================== ANÁLISE DE PROBLEMAS N+1 ====================

function analisarNPlusOne() {
    log('\n🔍 ========== ANÁLISE DE PROBLEMAS N+1 ==========', 'blue');
    
    const resolversPath = path.join(__dirname, '../../graphql/resolvers');
    if (!fs.existsSync(resolversPath)) {
        return;
    }

    const problemas = [];
    const resolvers = fs.readdirSync(resolversPath).filter(f => f.endsWith('.js'));
    
    resolvers.forEach(resolverFile => {
        const resolverPath = path.join(resolversPath, resolverFile);
        const content = fs.readFileSync(resolverPath, 'utf8');
        
        // Verificar se busca todos os dados
        if (content.includes('.once(\'value\')') && !content.includes('OptimizedDataLoader')) {
            // Verificar se filtra depois de buscar tudo
            if (content.includes('.filter(') || content.includes('.map(')) {
                problemas.push({
                    arquivo: resolverFile,
                    problema: 'Busca todos os dados e filtra depois',
                    linha: content.split('\n').findIndex(l => l.includes('.once(\'value\')')) + 1
                });
            }
        }
    });

    if (problemas.length > 0) {
        log(`  ⚠️ ${problemas.length} possíveis problemas N+1 encontrados:`, 'yellow');
        problemas.forEach(p => {
            log(`     - ${p.arquivo}: ${p.problema} (linha ${p.linha})`, 'yellow');
        });
    } else {
        log(`  ✅ Nenhum problema N+1 óbvio encontrado`, 'green');
    }
}

// ==================== GERAR RELATÓRIO ====================

function gerarRelatorio() {
    log('\n📊 ========== RELATÓRIO COMPLETO DE MÉTRICAS ==========', 'blue');
    
    // Eventos
    log('\n📡 EVENTOS WEBSOCKET:', 'cyan');
    log(`   Total implementados: ${metrics.eventos.implementados}`, 'green');
    log(`   Taxa de cobertura: ${((metrics.eventos.implementados / 34) * 100).toFixed(1)}%`, 
        metrics.eventos.implementados >= 30 ? 'green' : 'yellow');
    
    // Estados
    log('\n🔄 ESTADOS DA APLICAÇÃO:', 'cyan');
    log(`   Motorista: ${metrics.estados.motorista}/8 estados`, 
        metrics.estados.motorista === 8 ? 'green' : 'yellow');
    log(`   Passageiro: ${metrics.estados.passageiro}/6 estados`, 
        metrics.estados.passageiro === 6 ? 'green' : 'yellow');
    log(`   Servidor: ${metrics.estados.servidor}/5 estados`, 
        metrics.estados.servidor === 5 ? 'green' : 'yellow');
    
    // GraphQL
    log('\n📊 GRAPHQL:', 'cyan');
    log(`   Resolvers: ${metrics.graphql.resolvers}`, 'green');
    log(`   Queries: ${metrics.graphql.queries}`, 'green');
    log(`   DataLoaders: ${metrics.graphql.dataloaders}`, 'green');
    log(`   ✅ Otimizados: ${metrics.graphql.otimizados}`, 'green');
    log(`   ⚠️ Não otimizados: ${metrics.graphql.naoOtimizados}`, 'yellow');
    const taxaOtimizacao = metrics.graphql.dataloaders > 0 
        ? ((metrics.graphql.otimizados / metrics.graphql.dataloaders) * 100).toFixed(1)
        : 0;
    log(`   Taxa de otimização: ${taxaOtimizacao}%`, 
        taxaOtimizacao >= 80 ? 'green' : taxaOtimizacao >= 50 ? 'yellow' : 'red');
    
    // Performance
    log('\n⚡ PERFORMANCE:', 'cyan');
    log(`   Queries assertivas: ${metrics.performance.queriesAssertivas}`, 'green');
    log(`   Queries não assertivas: ${metrics.performance.queriesNaoAssertivas}`, 'yellow');
    log(`   Cache implementado: ${metrics.performance.cacheImplementado}`, 'green');
    log(`   Rate limiting: ${metrics.performance.rateLimiting}`, 'green');
    
    // Pontuação geral
    log('\n🎯 PONTUAÇÃO GERAL:', 'magenta');
    let pontuacao = 0;
    let maxPontos = 0;
    
    // Eventos (20 pontos)
    maxPontos += 20;
    pontuacao += (metrics.eventos.implementados / 34) * 20;
    
    // Estados (20 pontos)
    maxPontos += 20;
    pontuacao += ((metrics.estados.motorista / 8) * 7) + 
                 ((metrics.estados.passageiro / 6) * 7) + 
                 ((metrics.estados.servidor / 5) * 6);
    
    // GraphQL (30 pontos)
    maxPontos += 30;
    const otimizacaoScore = metrics.graphql.dataloaders > 0 
        ? (metrics.graphql.otimizados / metrics.graphql.dataloaders) * 15
        : 0;
    const assertividadeScore = (metrics.performance.queriesAssertivas / 
        (metrics.performance.queriesAssertivas + metrics.performance.queriesNaoAssertivas)) * 15;
    pontuacao += otimizacaoScore + assertividadeScore;
    
    // Performance (30 pontos)
    maxPontos += 30;
    pontuacao += (metrics.performance.cacheImplementado > 0 ? 10 : 0);
    pontuacao += (metrics.performance.rateLimiting > 0 ? 10 : 0);
    pontuacao += (metrics.performance.queriesAssertivas > 0 ? 10 : 0);
    
    const porcentagem = ((pontuacao / maxPontos) * 100).toFixed(1);
    log(`   Pontuação: ${pontuacao.toFixed(1)}/${maxPontos}`, 
        porcentagem >= 80 ? 'green' : porcentagem >= 60 ? 'yellow' : 'red');
    log(`   Porcentagem: ${porcentagem}%`, 
        porcentagem >= 80 ? 'green' : porcentagem >= 60 ? 'yellow' : 'red');
    
    // Status geral
    log('\n📈 STATUS GERAL:', 'blue');
    if (porcentagem >= 80) {
        log('   ✅ EXCELENTE - Sistema pronto para produção', 'green');
    } else if (porcentagem >= 60) {
        log('   ⚠️ BOM - Algumas otimizações necessárias', 'yellow');
    } else {
        log('   ❌ ATENÇÃO - Otimizações críticas necessárias', 'red');
    }
}

// ==================== EXECUTAR ANÁLISE ====================

async function executarAnalise() {
    log('\n🚀 Iniciando análise completa de métricas...\n', 'blue');
    
    analisarEventos();
    analisarEstados();
    analisarGraphQL();
    analisarPerformance();
    analisarNPlusOne();
    gerarRelatorio();
    
    log('\n✅ Análise concluída!\n', 'green');
}

// Executar
executarAnalise().catch(error => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

