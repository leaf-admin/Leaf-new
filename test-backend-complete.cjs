const axios = require('axios');

const BASE_URL = 'http://216.238.107.59:3005';

console.log('🔍 Iniciando validação completa do backend...\n');

// Função para testar endpoint
async function testEndpoint(name, method, path, data = null) {
    try {
        const start = Date.now();
        let response;
        
        switch (method.toLowerCase()) {
            case 'get':
                response = await axios.get(`${BASE_URL}${path}`);
                break;
            case 'post':
                response = await axios.post(`${BASE_URL}${path}`, data);
                break;
            case 'put':
                response = await axios.put(`${BASE_URL}${path}`, data);
                break;
            case 'delete':
                response = await axios.delete(`${BASE_URL}${path}`);
                break;
        }
        
        const duration = Date.now() - start;
        console.log(`✅ ${name}: ${response.status} (${duration}ms)`);
        
        if (response.data) {
            console.log(`   📊 Dados: ${JSON.stringify(response.data).substring(0, 100)}...`);
        }
        
        return { success: true, status: response.status, duration, data: response.data };
        
    } catch (error) {
        console.log(`❌ ${name}: ${error.response?.status || 'ERRO'} - ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Função principal de teste
async function runBackendTests() {
    console.log('🚀 TESTE 1: APIs e Endpoints do Backend\n');
    
    const results = [];
    
    // Teste de Health Check
    results.push(await testEndpoint('Health Check', 'GET', '/health'));
    
    // Teste da rota raiz
    results.push(await testEndpoint('Rota Raiz', 'GET', '/'));
    
    // Teste de busca de motoristas (sem parâmetros - deve dar erro 400)
    results.push(await testEndpoint('Busca Motoristas (sem params)', 'GET', '/drivers/nearby'));
    
    // Teste de busca de motoristas (com parâmetros válidos)
    results.push(await testEndpoint('Busca Motoristas (com params)', 'GET', '/drivers/nearby?lat=-23.5505&lng=-46.6333&radius=5000'));
    
    // Teste de status do motorista (inexistente)
    results.push(await testEndpoint('Status Motorista (inexistente)', 'GET', '/drivers/inexistente/status'));
    
    // Teste de métricas (se existir)
    try {
        results.push(await testEndpoint('Métricas', 'GET', '/metrics'));
    } catch (e) {
        console.log('⚠️ Endpoint /metrics não disponível');
    }
    
    // Teste de status do sistema (se existir)
    try {
        results.push(await testEndpoint('Status Sistema', 'GET', '/status'));
    } catch (e) {
        console.log('⚠️ Endpoint /status não disponível');
    }
    
    // Resumo dos resultados
    console.log('\n📊 RESUMO DOS TESTES:');
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const avgDuration = results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / successful || 0;
    
    console.log(`✅ Sucessos: ${successful}`);
    console.log(`❌ Falhas: ${failed}`);
    console.log(`⏱️  Duração média: ${avgDuration.toFixed(1)}ms`);
    console.log(`📊 Taxa de sucesso: ${((successful / results.length) * 100).toFixed(1)}%`);
    
    return results;
}

// Executar testes
runBackendTests().catch(console.error);
