import Logger from '../../utils/Logger';
import React, { useEffect, useRef, useState, memo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Marker, Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';


/**
 * Componente de marcador de motorista com efeito de radar (círculo expandindo)
 * Usa múltiplos círculos estáticos que são atualizados periodicamente para simular animação
 * ✅ Otimizado com React.memo para evitar re-renders desnecessários
 */
const DriverMarkerWithRadar = memo(function DriverMarkerWithRadar({ driver, index = 0 }) {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const opacityAnim = useRef(new Animated.Value(0.6)).current;
    const animationRef = useRef(null);
    
    // Estado para controlar os círculos de radar no mapa
    const [radarCircles, setRadarCircles] = useState([
        { id: 0, radius: 50, opacity: 0.4, strokeOpacity: 0.8 },
        { id: 1, radius: 50, opacity: 0.3, strokeOpacity: 0.6 },
        { id: 2, radius: 50, opacity: 0.2, strokeOpacity: 0.4 },
    ]);
    const radarIntervalRef = useRef(null);
    const frameRef = useRef(0);

    // Log de debug quando componente monta
    useEffect(() => {
        Logger.log(`🎯 [DriverMarkerWithRadar] Renderizando motorista ${index}:`, {
            driverId: driver?.id?.substring(0, 8),
            hasLocation: !!(driver?.location?.lat && driver?.location?.lng),
            location: driver?.location ? `${driver.location.lat.toFixed(6)}, ${driver.location.lng.toFixed(6)}` : 'N/A',
            carType: driver?.carType
        });
    }, [driver, index]);

    // Animação do marcador (ícone)
    useEffect(() => {
        const startAnimation = () => {
            scaleAnim.setValue(1);
            opacityAnim.setValue(0.6);

            const animation = Animated.loop(
                Animated.parallel([
                    Animated.sequence([
                        Animated.timing(scaleAnim, {
                            toValue: 2.5,
                            duration: 2000,
                            useNativeDriver: true,
                        }),
                        Animated.timing(scaleAnim, {
                            toValue: 1,
                            duration: 0,
                            useNativeDriver: true,
                        }),
                    ]),
                    Animated.sequence([
                        Animated.timing(opacityAnim, {
                            toValue: 0,
                            duration: 2000,
                            useNativeDriver: true,
                        }),
                        Animated.timing(opacityAnim, {
                            toValue: 0.6,
                            duration: 0,
                            useNativeDriver: true,
                        }),
                    ]),
                ])
            );

            animation.start();
            animationRef.current = animation;
        };

        startAnimation();

        return () => {
            if (animationRef.current) {
                animationRef.current.stop();
            }
        };
    }, []);

    // Animação dos círculos de radar no mapa (atualização periódica)
    useEffect(() => {
        const maxFrames = 60; // 60 frames = ~2 segundos a 30fps
        
        const updateRadar = () => {
            frameRef.current = (frameRef.current + 1) % maxFrames;
            
            // Calcular progresso da animação (0 a 1)
            const progress = frameRef.current / maxFrames;
            
            // Atualizar cada círculo com delay escalonado
            setRadarCircles([
                {
                    id: 0,
                    radius: 50 + (progress * 200), // Expande de 50m para 250m
                    opacity: Math.max(0, 0.4 * (1 - progress)),
                    strokeOpacity: Math.max(0, 0.8 * (1 - progress)),
                },
                {
                    id: 1,
                    radius: 50 + (((progress + 0.33) % 1) * 200),
                    opacity: Math.max(0, 0.3 * (1 - ((progress + 0.33) % 1))),
                    strokeOpacity: Math.max(0, 0.6 * (1 - ((progress + 0.33) % 1))),
                },
                {
                    id: 2,
                    radius: 50 + (((progress + 0.66) % 1) * 200),
                    opacity: Math.max(0, 0.2 * (1 - ((progress + 0.66) % 1))),
                    strokeOpacity: Math.max(0, 0.4 * (1 - ((progress + 0.66) % 1))),
                },
            ]);
        };

        // Atualizar a cada ~33ms (30fps)
        radarIntervalRef.current = setInterval(updateRadar, 33);
        
        // Primeira atualização imediata
        updateRadar();

        return () => {
            if (radarIntervalRef.current) {
                clearInterval(radarIntervalRef.current);
                radarIntervalRef.current = null;
            }
        };
    }, []);

    if (!driver || !driver.location || !driver.location.lat || !driver.location.lng) {
        Logger.warn(`⚠️ [DriverMarkerWithRadar] Motorista ${index} sem localização válida:`, {
            hasDriver: !!driver,
            hasLocation: !!driver?.location,
            lat: driver?.location?.lat,
            lng: driver?.location?.lng
        });
        return null;
    }

    const coordinate = {
        latitude: driver.location.lat,
        longitude: driver.location.lng,
    };

    return (
        <>
            {/* Círculo fixo base (sempre visível) - mais visível */}
            <Circle
                center={coordinate}
                radius={30}
                strokeWidth={2}
                strokeColor="rgba(65, 211, 116, 1)"
                fillColor="rgba(65, 211, 116, 0.3)"
                zIndex={600}
            />
            
            {/* Círculos de radar animados no mapa (efeito expandindo em cascata) */}
            {radarCircles.map((circle) => (
                <Circle
                    key={`radar-${driver.id || index}-${circle.id}`}
                    center={coordinate}
                    radius={circle.radius}
                    strokeWidth={2}
                    strokeColor={`rgba(65, 211, 116, ${circle.strokeOpacity})`}
                    fillColor={`rgba(65, 211, 116, ${circle.opacity})`}
                    zIndex={500 + circle.id}
                />
            ))}
            
            {/* Marcador do motorista */}
            <Marker
                coordinate={coordinate}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={1000 + index}
            >
                <View style={styles.markerContainer}>
                    <Animated.View
                        style={[
                            styles.radarCircle,
                            {
                                transform: [{ scale: scaleAnim }],
                                opacity: opacityAnim,
                            },
                        ]}
                    />
                    <View style={styles.driverIcon}>
                        <Ionicons name="car" size={20} color="#FFFFFF" />
                    </View>
                </View>
            </Marker>
        </>
    );
}, (prevProps, nextProps) => {
    // Comparação customizada para evitar re-renders desnecessários
    return (
        prevProps.driver?.id === nextProps.driver?.id &&
        prevProps.driver?.location?.lat === nextProps.driver?.location?.lat &&
        prevProps.driver?.location?.lng === nextProps.driver?.location?.lng &&
        prevProps.index === nextProps.index
    );
});

const styles = StyleSheet.create({
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
    },
    radarCircle: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(65, 211, 116, 0.3)',
        borderWidth: 2,
        borderColor: 'rgba(65, 211, 116, 0.6)',
    },
    driverIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#41D274',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFFFFF',
        zIndex: 1,
    },
});

export default DriverMarkerWithRadar;
