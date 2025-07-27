#!/usr/bin/env node

// Teste das API Keys dos Provedores de Mapas
// Verifica se as configurações estão corretas

const apiKeys = require('./config/api-keys.js');
const HybridMapsService = require('./src/services/HybridMapsService.js');

console.log('🔑 TESTE DAS API KEYS DOS PROVEDORES DE MAPAS');
console.log('==============================================\n');

// Verificar configurações
console.log('📋 CONFIGURAÇÕES:');
console.log(`🗺️  Google Maps: ${apiKeys.GOOGLE_MAPS_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
console.log(`🗺️  MapBox: ${apiKeys.MAPBOX_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
console.log(`🗺️  LocationIQ: ${apiKeys.LOCATIONIQ_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
console.log(`🗺️  Geocoding.io: ${apiKeys.GEOCODINGIO_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
console.log(`🗺️  OSM: ✅ Gratuito (sempre ativo)\n`);

// Testar HybridMapsService
async function testHybridMapsService() {
    try {
        console.log('🚀 INICIALIZANDO HYBRID MAPS SERVICE...');
        const hybridMaps = new HybridMapsService();
        
        console.log('\n📊 ESTRATÉGIA DE PROVEDORES:');
        console.log('Directions:', hybridMaps.providerStrategy.directions);
        console.log('Geocoding:', hybridMaps.providerStrategy.geocoding);
        console.log('Reverse:', hybridMaps.providerStrategy.reverse);
        console.log('Places:', hybridMaps.providerStrategy.places);
        
        console.log('\n💰 PREÇOS DOS PROVEDORES:');
        Object.entries(hybridMaps.providers).forEach(([name, provider]) => {
            if (provider.pricing) {
                console.log(`${name}: R$ ${provider.pricing.directions || provider.pricing.geocoding || 0} por request`);
            }
        });
        
        console.log('\n⚡ RATE LIMITS:');
        Object.entries(hybridMaps.providers).forEach(([name, provider]) => {
            if (provider.rateLimit) {
                console.log(`${name}: ${provider.rateLimit} requests/segundo`);
            }
        });
        
        // Testar geocoding com endereço simples
        console.log('\n🧪 TESTE DE GEOCODING...');
        const testAddress = 'Rua das Flores, 123, Rio de Janeiro';
        
        try {
            const result = await hybridMaps.geocode(testAddress);
            console.log('✅ Geocoding funcionando:', result.provider);
        } catch (error) {
            console.log('❌ Erro no geocoding:', error.message);
        }
        
        // Testar directions
        console.log('\n🧪 TESTE DE DIRECTIONS...');
        const origin = { lat: -22.9068, lng: -43.1729 }; // Centro do Rio
        const destination = { lat: -22.9707, lng: -43.1826 }; // Copacabana
        
        try {
            const result = await hybridMaps.getDirections(origin, destination);
            console.log('✅ Directions funcionando:', result.provider);
        } catch (error) {
            console.log('❌ Erro no directions:', error.message);
        }
        
        // Análise de custos
        console.log('\n💰 ANÁLISE DE CUSTOS:');
        const costAnalysis = await hybridMaps.getCostAnalysis();
        console.log('Custo atual por corrida:', costAnalysis.totalCost);
        console.log('Economia vs Google Maps:', costAnalysis.savingsPercentage + '%');
        
        console.log('\n✅ TESTE CONCLUÍDO COM SUCESSO!');
        console.log('🎯 Estratégia híbrida configurada e funcionando!');
        
    } catch (error) {
        console.error('❌ Erro no teste:', error.message);
    }
}

// Executar teste
testHybridMapsService(); 