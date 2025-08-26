const io = require('socket.io-client');

console.log('⚡ Iniciando teste de carga...');

const CONCURRENT_USERS = 10;
const TEST_DURATION = 30000; // 30 segundos
let activeConnections = 0;
let successfulConnections = 0;
let failedConnections = 0;
let totalMessages = 0;

// Função para criar um usuário simulado
function createSimulatedUser(userId) {
    return new Promise((resolve) => {
        const socket = io('http://216.238.107.59:3005', {
            transports: ['websocket'],
            timeout: 10000,
            forceNew: true
        });

        socket.on('connect', () => {
            activeConnections++;
            successfulConnections++;
            console.log(`✅ Usuário ${userId} conectado (${activeConnections}/${CONCURRENT_USERS})`);
            
            // Simular atividade
            socket.emit('updateLocation', {
                lat: -23.5505 + (Math.random() - 0.5) * 0.01,
                lng: -46.6333 + (Math.random() - 0.5) * 0.01
            });
            
            // Enviar mensagens periódicas
            const interval = setInterval(() => {
                socket.emit('getStats');
                totalMessages++;
            }, 2000);
            
            // Limpar intervalo quando desconectar
            socket.on('disconnect', () => {
                clearInterval(interval);
                activeConnections--;
            });
            
            resolve(socket);
        });

        socket.on('connect_error', (error) => {
            failedConnections++;
            console.log(`❌ Usuário ${userId} falhou:`, error.message);
            resolve(null);
        });

        // Timeout para conexão
        setTimeout(() => {
            if (!socket.connected) {
                failedConnections++;
                console.log(`⏰ Usuário ${userId} timeout`);
                resolve(null);
            }
        }, 10000);
    });
}

// Função principal do teste
async function runLoadTest() {
    console.log(`🚀 Iniciando teste com ${CONCURRENT_USERS} usuários simultâneos...`);
    
    const startTime = Date.now();
    const connections = [];
    
    // Criar usuários simultaneamente
    const promises = [];
    for (let i = 0; i < CONCURRENT_USERS; i++) {
        promises.push(createSimulatedUser(`user_${i + 1}`));
    }
    
    const results = await Promise.all(promises);
    results.forEach(socket => {
        if (socket) connections.push(socket);
    });
    
    console.log(`\n📊 Estatísticas do teste:`);
    console.log(`✅ Conexões bem-sucedidas: ${successfulConnections}`);
    console.log(`❌ Conexões falharam: ${failedConnections}`);
    console.log(`🔌 Conexões ativas: ${activeConnections}`);
    
    // Manter conexões ativas por um tempo
    console.log(`\n⏳ Mantendo conexões ativas por ${TEST_DURATION/1000} segundos...`);
    
    setTimeout(() => {
        console.log('\n🔄 Encerrando teste...');
        connections.forEach(socket => socket.disconnect());
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`\n📈 RESULTADOS FINAIS:`);
        console.log(`⏱️  Duração total: ${duration}ms`);
        console.log(`📨 Total de mensagens: ${totalMessages}`);
        console.log(`📊 Taxa de sucesso: ${((successfulConnections / CONCURRENT_USERS) * 100).toFixed(1)}%`);
        console.log(`⚡ Performance: ${(totalMessages / (duration / 1000)).toFixed(1)} msg/s`);
        
        process.exit(0);
    }, TEST_DURATION);
}

// Executar teste
runLoadTest().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔄 Teste interrompido pelo usuário');
    process.exit(0);
});
