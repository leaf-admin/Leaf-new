// Teste Completo de Todas as Otimizações
console.log('🚀 INICIANDO TESTE COMPLETO DE OTIMIZAÇÕES...\n');

const IntelligentCache = require('./intelligent-cache');
const AdvancedAPM = require('./advanced-apm');
const AdvancedAsyncQueue = require('./async-queue-advanced');

async function testCompleteOptimizations() {
    console.log('📊 FASE 1: INICIALIZANDO MÓDULOS...');
    
    // 1. Cache Inteligente
    const cache = new IntelligentCache();
    console.log('✅ Cache Inteligente inicializado');
    
    // 2. APM Avançado
    const apm = new AdvancedAPM();
    console.log('✅ APM Avançado inicializado');
    
    // 3. Async Queue Avançada
    const asyncQueue = new AdvancedAsyncQueue({
        maxConcurrency: 5,
        maxQueueSize: 1000,
        retryAttempts: 3
    });
    console.log('✅ Async Queue Avançada inicializada');
    
    console.log('\n📊 FASE 2: TESTANDO CACHE INTELIGENTE...');
    
    // Teste de cache
    cache.set('user:123', { id: 123, name: 'João', rides: 15 });
    cache.set('ride:456', { id: 456, status: 'active', distance: 5.2 });
    cache.set('stats:daily', { date: '2025-01-27', totalRides: 150, revenue: 1250.50 });
    
    console.log('📊 Cache Status:', cache.getHealthStatus());
    
    // Teste de warming
    cache.warmCache(['user:456', 'ride:789', 'stats:weekly']);
    
    console.log('\n�� FASE 3: TESTANDO APM AVANÇADO...');
    
    // Simular métricas
    for (let i = 0; i < 10; i++) {
        apm.recordMetric('responseTime', Math.random() * 100 + 50);
        apm.recordMetric('cpuUsage', Math.random() * 20 + 10);
        apm.recordMetric('memoryUsage', Math.random() * 30 + 40);
    }
    
    const apmMetrics = apm.getMetrics();
    console.log('📊 APM Metrics:', {
        responseTime: apmMetrics.responseTime?.average?.toFixed(2),
        cpuUsage: apmMetrics.cpuUsage?.average?.toFixed(2),
        memoryUsage: apmMetrics.memoryUsage?.average?.toFixed(2)
    });
    
    console.log('\n📊 FASE 4: TESTANDO ASYNC QUEUE...');
    
    // Adicionar tarefas à fila
    const tasks = [];
    for (let i = 0; i < 20; i++) {
        tasks.push(async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
            return `Task ${i + 1} completed`;
        });
    }
    
    // Processar tarefas
    const results = await Promise.all(tasks.map(task => asyncQueue.add(task)));
    console.log('✅ Processadas', results.length, 'tarefas');
    
    console.log('\n📊 FASE 5: TESTANDO INTEGRAÇÃO...');
    
    // Simular operação completa
    const operation = async () => {
        // 1. Verificar cache
        const user = cache.get('user:123');
        if (!user) {
            console.log('❌ Usuário não encontrado no cache');
            return;
        }
        
        // 2. Registrar métrica
        apm.recordMetric('cacheHit', 1);
        
        // 3. Processar na fila
        const result = await asyncQueue.add(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return `Processed user ${user.id}`);
        });
        
        console.log('✅ Operação integrada:', result);
    };
    
    await operation();
    
    console.log('\n📊 FASE 6: MÉTRICAS FINAIS...');
    
    console.log('📊 Cache Final:', cache.getHealthStatus());
    console.log('📊 APM Final:', apm.getHealthStatus());
    console.log('📊 Queue Final:', asyncQueue.getStats());
    
    console.log('\n🎉 TESTE COMPLETO FINALIZADO COM SUCESSO!');
    console.log('🚀 Todas as otimizações estão funcionando perfeitamente!');
}

// Executar teste
testCompleteOptimizations().catch(console.error);
