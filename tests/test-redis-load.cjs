// test-redis-load.js
// Teste de carga para múltiplos motoristas enviando localização para o backend Redis
// Use: node test-redis-load.js [100|500|1000|2500|5000|10000]

const { io } = require('socket.io-client');

// Configurações
const SERVER_URL = 'http://localhost:3001';
const DRIVER_COUNT = parseInt(process.argv[2]) || 100;
const UPDATE_INTERVAL = 1000; // 1 segundo entre atualizações

console.log(`🚗 Iniciando teste de carga com ${DRIVER_COUNT} motoristas`);
console.log(`📡 Conectando ao servidor: ${SERVER_URL}`);

// Estatísticas
let successCount = 0;
let failCount = 0;
let latencies = [];

// Função para gerar coordenadas aleatórias (São Paulo)
function getRandomLocation() {
    // Coordenadas aproximadas de São Paulo
    const baseLat = -23.5505;
    const baseLng = -46.6333;
    const radius = 0.01; // ~1km
    
    const lat = baseLat + (Math.random() - 0.5) * radius;
    const lng = baseLng + (Math.random() - 0.5) * radius;
    
    return { lat, lng };
}

// Função para simular um motorista
function simulateDriver(driverId) {
    const socket = io(SERVER_URL, {
        transports: ['websocket'],
        timeout: 5000
    });

    // Autenticar o motorista
    socket.emit('authenticate', { uid: `driver_${driverId}` });

    // Escutar resposta de autenticação
    socket.on('authenticated', (data) => {
        console.log(`🔐 Driver ${driverId} autenticado`);
    });

    // Escutar resposta de atualização de localização
    socket.on('locationUpdated', (response) => {
        if (response && response.success) {
            successCount++;
            console.log(`✅ Driver ${driverId}: localização atualizada`);
        } else {
            failCount++;
            console.log(`❌ Driver ${driverId}: ${response?.error || 'Erro'}`);
        }
    });

    // Atualizar localização periodicamente
    const interval = setInterval(() => {
        const startTime = Date.now();
        const location = getRandomLocation();
        
        socket.emit('updateLocation', location);
        
        // Registrar latência (aproximada)
        setTimeout(() => {
            const latency = Date.now() - startTime;
            latencies.push(latency);
        }, 50); // Pequeno delay para simular latência de rede
        
    }, UPDATE_INTERVAL);

    // Retornar função para limpar
    return () => {
        clearInterval(interval);
        socket.disconnect();
    };
}

// Função para calcular estatísticas
function calculateStats() {
    if (latencies.length === 0) {
        console.log('📊 Nenhuma latência registrada');
        return;
    }
    
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
    
    console.log('\n📊 Estatísticas de Latência:');
    console.log(`   Média: ${avg.toFixed(2)}ms`);
    console.log(`   Mínima: ${min}ms`);
    console.log(`   Máxima: ${max}ms`);
    console.log(`   95º percentil: ${p95}ms`);
    console.log(`   Sucessos: ${successCount}`);
    console.log(`   Falhas: ${failCount}`);
    console.log(`   Taxa de sucesso: ${((successCount / (successCount + failCount)) * 100).toFixed(2)}%`);
}

// Função principal async
async function runTest() {
    console.log(`🔄 Iniciando simulação de ${DRIVER_COUNT} motoristas...`);
    
    const cleanupFunctions = [];
    
    // Criar motoristas
    for (let i = 1; i <= DRIVER_COUNT; i++) {
        const cleanup = simulateDriver(i);
        cleanupFunctions.push(cleanup);
        
        // Pequeno delay entre conexões para não sobrecarregar
        if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    console.log(`✅ ${DRIVER_COUNT} motoristas conectados`);
    
    // Executar por 30 segundos
    setTimeout(() => {
        console.log('\n🛑 Finalizando teste...');
        
        // Limpar todos os motoristas
        cleanupFunctions.forEach(cleanup => cleanup());
        
        // Mostrar estatísticas finais
        calculateStats();
        
        process.exit(0);
    }, 30000);
}

// Capturar Ctrl+C
process.on('SIGINT', () => {
    console.log('\n🛑 Teste interrompido pelo usuário');
    calculateStats();
    process.exit(0);
});

// Iniciar o teste
runTest().catch(err => {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
}); 