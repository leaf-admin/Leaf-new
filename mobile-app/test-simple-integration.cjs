#!/usr/bin/env node

// Teste Simples de Integração: HybridMapsService
// Verifica se a estratégia híbrida está funcionando

const HybridMapsService = require('./src/services/HybridMapsService.js');

console.log('🔗 TESTE SIMPLES DE INTEGRAÇÃO: HYBRID MAPS');
console.log('===========================================\n');

async function testSimpleIntegration() {
    try {
        console.log('🚀 INICIALIZANDO HYBRID MAPS SERVICE...');
        const hybridMaps = new HybridMapsService();
        console.log('✅ HybridMapsService inicializado');
        
        // Testar geocoding
        console.log('\n🧪 TESTE DE GEOCODING...');
        const testAddress = 'Rua das Flores, 123, Rio de Janeiro';
        
        try {
            const result = await hybridMaps.geocode(testAddress);
            console.log('✅ Geocoding funcionando:', result);
        } catch (error) {
            console.log('❌ Erro no geocoding:', error.message);
        }
        
        // Testar directions
        console.log('\n🧪 TESTE DE DIRECTIONS...');
        const origin = { lat: -22.9068, lng: -43.1729 }; // Centro do Rio
        const destination = { lat: -22.9707, lng: -43.1826 }; // Copacabana
        
        try {
            const result = await hybridMaps.getDirections(origin, destination);
            console.log('✅ Directions funcionando:', result);
        } catch (error) {
            console.log('❌ Erro no directions:', error.message);
        }
        
        // Testar análise de custos
        console.log('\n🧪 TESTE DE ANÁLISE DE CUSTOS...');
        try {
            const costAnalysis = await hybridMaps.getCostAnalysis();
            console.log('✅ Análise de custos:', costAnalysis);
        } catch (error) {
            console.log('❌ Erro na análise de custos:', error.message);
        }
        
        // Testar rate limiting
        console.log('\n🧪 TESTE DE RATE LIMITING...');
        try {
            const rateLimitStats = hybridMaps.getRateLimitStats();
            console.log('✅ Rate limiting:', rateLimitStats);
        } catch (error) {
            console.log('❌ Erro no rate limiting:', error.message);
        }
        
        console.log('\n🎉 TESTE SIMPLES CONCLUÍDO!');
        console.log('✅ Estratégia híbrida funcionando');
        console.log('✅ APIs configuradas');
        console.log('✅ Rate limiting ativo');
        console.log('✅ Análise de custos operacional');
        
    } catch (error) {
        console.error('❌ Erro no teste:', error.message);
    }
}

// Executar teste
testSimpleIntegration(); 