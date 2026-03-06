// Configuração das API Keys para Provedores de Mapas
// Modo atual: Google como padrão de produção.
// OSM permanece em standby para P&D via flags em src/config/mapProvider.js

module.exports = {
    // Google Maps (já configurado)
    GOOGLE_MAPS_API_KEY:
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
        'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY',
    
    // MapBox - R$ 0,0025 por request, 600 req/min
    MAPBOX_API_KEY: 'pk.eyJ1IjoibGVhZi1hcHAiLCJhIjoiY205MHJxazByMGlybzJrcTIyZ25wdm1maSJ9.aX1wTUINIhk_nsQAACNnyA',
    
    // LocationIQ - R$ 0,0025 por request, 2000 req/seg
    LOCATIONIQ_API_KEY: 'pk.59262794905b7196e5a09bf1fd47911d',
    
    // Geocoding.io - R$ 0,00375 por request, 1000 req/seg (verificar site)
    GEOCODINGIO_API_KEY: null,
    
    // Status das APIs
    API_STATUS: {
        google: 'ATIVO_PADRAO',
        mapbox: 'CONFIGURADO',
        locationiq: 'CONFIGURADO', 
        geocodingio: 'PENDENTE_VERIFICACAO',
        osm: 'STANDBY_PD'
    }
}; 
