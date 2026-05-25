// Configuração das API Keys para Provedores de Mapas
// Modo atual: Google como padrão de produção.
// OSM permanece em standby para P&D via flags em src/config/mapProvider.js

module.exports = {
    // Google Maps (já configurado)
    GOOGLE_MAPS_API_KEY:
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
        '',
    
    // MapBox - R$ 0,0025 por request, 600 req/min
    MAPBOX_API_KEY:
        process.env.MAPBOX_API_KEY ||
        process.env.EXPO_PUBLIC_MAPBOX_API_KEY ||
        '',
    
    // LocationIQ - R$ 0,0025 por request, 2000 req/seg
    LOCATIONIQ_API_KEY:
        process.env.LOCATIONIQ_API_KEY ||
        process.env.EXPO_PUBLIC_LOCATIONIQ_API_KEY ||
        '',
    
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
