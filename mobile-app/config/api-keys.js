// Configuração das API Keys para Provedores de Mapas
// Estratégia Híbrida para otimização de custos (83% de economia vs Google Maps)

module.exports = {
    // Google Maps (já configurado)
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY',
    
    // MapBox - R$ 0,0025 por request, 600 req/min
    MAPBOX_API_KEY: 'pk.eyJ1IjoibGVhZi1hcHAiLCJhIjoiY205MHJxazByMGlybzJrcTIyZ25wdm1maSJ9.aX1wTUINIhk_nsQAACNnyA',
    
    // LocationIQ - R$ 0,0025 por request, 2000 req/seg
    LOCATIONIQ_API_KEY: 'pk.59262794905b7196e5a09bf1fd47911d',
    
    // Geocoding.io - R$ 0,00375 por request, 1000 req/seg (verificar site)
    GEOCODINGIO_API_KEY: null,
    
    // Configuração da Estratégia Híbrida:
    // 1. OSM gratuito (70% dos requests) - Rate limit: 1 req/seg
    // 2. MapBox (15% dos requests) - Rate limit: 600 req/min  
    // 3. LocationIQ (10% dos requests) - Rate limit: 2000 req/seg
    // 4. Google Maps (5% dos requests) - Última instância
    
    // Economia esperada: 83% vs Google Maps puro
    // Custo atual: R$ 0,075 → Custo otimizado: R$ 0,013
    
    // Status das APIs
    API_STATUS: {
        mapbox: 'CONFIGURADO',
        locationiq: 'CONFIGURADO', 
        geocodingio: 'PENDENTE_VERIFICACAO',
        osm: 'GRATUITO_ATIVO'
    }
}; 