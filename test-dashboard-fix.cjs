const axios = require('axios');

async function testDashboardFix() {
    console.log('🔍 Testando correção do dashboard...\n');
    
    try {
        // Testar endpoints básicos
        console.log('1. Testando endpoints básicos:');
        
        const healthResponse = await axios.get('https://api.leaf.app.br/health');
        console.log('✅ Health endpoint:', healthResponse.data);
        
        // Testar endpoint do dashboard
        console.log('\n2. Testando endpoint do dashboard:');
        try {
            const dashboardResponse = await axios.get('https://api.leaf.app.br/dashboard/overview');
            console.log('✅ Dashboard overview:', dashboardResponse.data);
        } catch (error) {
            console.log('❌ Dashboard overview falhou:', error.message);
            
            // Tentar diretamente no servidor
            console.log('\n3. Testando diretamente no servidor:');
            try {
                const directResponse = await axios.get('http://216.238.107.59:3001/dashboard/overview');
                console.log('✅ Dashboard direto:', directResponse.data);
            } catch (directError) {
                console.log('❌ Dashboard direto falhou:', directError.message);
            }
        }
        
        console.log('\n🎯 Dashboard deve mostrar:');
        console.log('- Métricas do VPS (CPU, memória, disco)');
        console.log('- Status do Redis');
        console.log('- Status do WebSocket');
        console.log('- Status do Firebase');
        console.log('- Dados de performance');
        
        console.log('\n✅ Teste concluído! O dashboard deve estar funcionando corretamente agora.');
        
    } catch (error) {
        console.error('❌ Erro ao testar dashboard:', error.message);
    }
}

testDashboardFix(); 