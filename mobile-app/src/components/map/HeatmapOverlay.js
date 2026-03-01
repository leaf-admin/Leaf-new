import Logger from '../../utils/Logger';
import React, { useMemo } from 'react';
import { WebView } from 'react-native-webview';
import { GOOGLE_MAPS_API_KEY } from '../../../config/api-keys';


/**
 * Componente HeatmapOverlay - WebView transparente para renderizar Heat Map do Google Maps
 * Sobreposto ao MapView principal para manter todas as funcionalidades
 */
const HeatmapOverlay = ({ 
  region, 
  heatmapData = [], 
  visible = true,
  opacity = 0.7,
  radius = 50 
}) => {
  // Calcular zoom baseado no latitudeDelta
  const calculateZoom = (latitudeDelta) => {
    return Math.round(Math.log(360 / latitudeDelta) / Math.LN2);
  };

  // Gerar HTML com Google Maps Heat Map
  const htmlContent = useMemo(() => {
    if (!region || !region.latitude || !region.longitude || !heatmapData.length) {
      return '<html><body style="background: transparent;"></body></html>';
    }

    const zoom = calculateZoom(region.latitudeDelta);
    
    // Converter dados para formato do Google Maps (sem usar google.maps.LatLng ainda)
    const googleMapsData = heatmapData.map(point => ({
      lat: point.latitude,
      lng: point.longitude,
      weight: point.weight || 1
    }));

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=visualization"></script>
        <style>
          body { 
            margin: 0; 
            padding: 0; 
            background: transparent;
            overflow: hidden;
          }
          #heatmap { 
            width: 100vw; 
            height: 100vh; 
            background: transparent;
          }
        </style>
      </head>
      <body>
        <div id="heatmap"></div>
        <script>
          // Função para inicializar o Heat Map quando Google Maps estiver carregado
          function initHeatmap() {
            try {
              // Verificar se Google Maps está disponível
              if (typeof google === 'undefined' || !google.maps || !google.maps.visualization) {
                Logger.log('⏳ Aguardando carregamento do Google Maps...');
                setTimeout(initHeatmap, 100);
                return;
              }

              // Converter dados para formato correto do Google Maps
              const heatmapData = ${JSON.stringify(googleMapsData)}.map(point => ({
                location: new google.maps.LatLng(point.lat, point.lng),
                weight: point.weight
              }));

              // Configurar mapa
              const map = new google.maps.Map(document.getElementById('heatmap'), {
                center: { lat: ${region.latitude}, lng: ${region.longitude} },
                zoom: ${zoom},
                disableDefaultUI: true,
                gestureHandling: 'none',
                draggable: false,
                zoomControl: false,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                styles: [
                  {
                    featureType: 'all',
                    elementType: 'all',
                    stylers: [{ visibility: 'off' }]
                  }
                ]
              });

              // Criar Heat Map Layer
              const heatmap = new google.maps.visualization.HeatmapLayer({
                data: heatmapData,
                radius: ${radius},
                opacity: ${opacity},
                gradient: [
                  'rgba(0, 255, 0, 0)',      // Verde transparente
                  'rgba(255, 255, 0, 0.3)',  // Amarelo
                  'rgba(255, 165, 0, 0.6)',  // Laranja
                  'rgba(255, 0, 0, 0.8)'     // Vermelho
                ],
                maxIntensity: 10
              });

              // Aplicar Heat Map ao mapa
              heatmap.setMap(map);

              // Log para debug
              Logger.log('🔥 Heat Map renderizado com', heatmapData.length, 'pontos');
              
            } catch (error) {
              Logger.error('❌ Erro ao renderizar Heat Map:', error);
            }
          }

          // Inicializar quando a página carregar
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initHeatmap);
          } else {
            initHeatmap();
          }
        </script>
      </body>
      </html>
    `;
  }, [region, heatmapData, opacity, radius]);

  if (!visible || !region) {
    return null;
  }

  return (
    <WebView
      source={{ html: htmlContent }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        zIndex: 50 // Acima do mapa, abaixo dos botões
      }}
      pointerEvents="none" // Não intercepta toques
      scrollEnabled={false}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      startInLoadingState={false}
      scalesPageToFit={false}
      mixedContentMode="compatibility"
      onError={(error) => {
        Logger.error('❌ WebView Heat Map Error:', error);
      }}
      onLoadEnd={() => {
        Logger.log('✅ WebView Heat Map carregado');
      }}
    />
  );
};

export default HeatmapOverlay;
