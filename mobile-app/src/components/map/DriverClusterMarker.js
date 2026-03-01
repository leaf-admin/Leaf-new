// DriverClusterMarker.js - Componente de marcador de cluster específico para motoristas
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const DriverClusterMarker = ({ 
    cluster, 
    onPress, 
    onExpand, 
    theme = { 
        primary: '#41D274', 
        background: '#FFFFFF', 
        text: '#000000',
        surface: '#F5F5F5'
    },
    isExpanded = false 
}) => {
    const [animation] = useState(new Animated.Value(1));
    const [pulseAnimation] = useState(new Animated.Value(1));

    // Animação de entrada
    useEffect(() => {
        Animated.spring(animation, {
            toValue: 1,
            useNativeDriver: true,
            tension: 100,
            friction: 8
        }).start();
    }, []);

    // Animação de pulso para clusters de alta demanda
    useEffect(() => {
        if (cluster.metrics.demandLevel === 'high') {
            const pulse = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnimation, {
                        toValue: 1.2,
                        duration: 1000,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnimation, {
                        toValue: 1,
                        duration: 1000,
                        useNativeDriver: true,
                    })
                ])
            );
            pulse.start();
            return () => pulse.stop();
        }
    }, [cluster.metrics.demandLevel]);

    // Determinar cor baseada no nível de demanda
    const getClusterColor = () => {
        switch (cluster.metrics.demandLevel) {
            case 'high':
                return '#FF6B6B'; // Vermelho para alta demanda
            case 'medium':
                return '#FFA726'; // Laranja para média demanda
            case 'low':
                return '#66BB6A'; // Verde para baixa demanda
            default:
                return theme.primary;
        }
    };

    // Determinar ícone baseado no nível de demanda
    const getClusterIcon = () => {
        switch (cluster.metrics.demandLevel) {
            case 'high':
                return 'trending-up';
            case 'medium':
                return 'trending-flat';
            case 'low':
                return 'trending-down';
            default:
                return 'car';
        }
    };

    // Determinar tamanho do cluster baseado na quantidade de motoristas
    const getClusterSize = () => {
        if (cluster.count >= 10) return 60;
        if (cluster.count >= 5) return 50;
        if (cluster.count >= 3) return 40;
        return 35;
    };

    const clusterSize = getClusterSize();
    const clusterColor = getClusterColor();
    const clusterIcon = getClusterIcon();

    return (
        <Animated.View
            style={[
                styles.clusterContainer,
                {
                    transform: [
                        { scale: animation },
                        { scale: cluster.metrics.demandLevel === 'high' ? pulseAnimation : 1 }
                    ]
                }
            ]}
        >
            <TouchableOpacity
                style={[
                    styles.clusterMarker,
                    {
                        width: clusterSize,
                        height: clusterSize,
                        backgroundColor: clusterColor,
                        borderRadius: clusterSize / 2
                    }
                ]}
                onPress={() => onPress(cluster)}
                activeOpacity={0.8}
            >
                {/* Ícone do cluster */}
                <Ionicons 
                    name={clusterIcon} 
                    size={clusterSize * 0.4} 
                    color="#FFFFFF" 
                />
                
                {/* Contador de motoristas */}
                <View style={styles.countContainer}>
                    <Text style={styles.countText}>
                        {cluster.count}
                    </Text>
                </View>
            </TouchableOpacity>

            {/* Informações detalhadas do cluster (quando expandido) */}
            {isExpanded && (
                <View style={[styles.clusterInfo, { backgroundColor: theme.surface }]}>
                    <View style={styles.infoHeader}>
                        <Text style={[styles.infoTitle, { color: theme.text }]}>
                            {cluster.count} Motoristas
                        </Text>
                        <TouchableOpacity
                            onPress={() => onExpand(cluster)}
                            style={styles.expandButton}
                        >
                            <Ionicons name="chevron-down" size={16} color={theme.text} />
                        </TouchableOpacity>
                    </View>

                    {/* Métricas específicas para motoristas */}
                    <View style={styles.metricsContainer}>
                        <View style={styles.metricItem}>
                            <Ionicons name="star" size={14} color="#FFD700" />
                            <Text style={[styles.metricText, { color: theme.text }]}>
                                {cluster.metrics.averageRating.toFixed(1)}
                            </Text>
                        </View>

                        <View style={styles.metricItem}>
                            <Ionicons name="cash" size={14} color="#4CAF50" />
                            <Text style={[styles.metricText, { color: theme.text }]}>
                                R$ {cluster.metrics.totalEarnings.toFixed(0)}
                            </Text>
                        </View>

                        <View style={styles.metricItem}>
                            <Ionicons name="trending-up" size={14} color={clusterColor} />
                            <Text style={[styles.metricText, { color: theme.text }]}>
                                {cluster.metrics.demandLevel === 'high' ? 'Alta' : 
                                 cluster.metrics.demandLevel === 'medium' ? 'Média' : 'Baixa'}
                            </Text>
                        </View>
                    </View>

                    {/* Recomendações para motoristas */}
                    <View style={styles.recommendationsContainer}>
                        <Text style={[styles.recommendationsTitle, { color: theme.text }]}>
                            💡 Recomendações:
                        </Text>
                        <Text style={[styles.recommendationsText, { color: theme.text }]}>
                            {cluster.metrics.demandLevel === 'high' 
                                ? 'Área saturada. Considere outras regiões.'
                                : cluster.metrics.demandLevel === 'medium'
                                ? 'Demanda equilibrada. Boa oportunidade.'
                                : 'Baixa concorrência. Potencial de ganhos.'
                            }
                        </Text>
                    </View>
                </View>
            )}
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    clusterContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    clusterMarker: {
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    countContainer: {
        position: 'absolute',
        top: -8,
        right: -8,
        backgroundColor: '#FF4444',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    countText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: 'bold',
    },
    clusterInfo: {
        position: 'absolute',
        top: 70,
        left: -100,
        width: 200,
        padding: 12,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        zIndex: 1000,
    },
    infoHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    expandButton: {
        padding: 4,
    },
    metricsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 8,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: 'rgba(0,0,0,0.1)',
    },
    metricItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    metricText: {
        fontSize: 12,
        fontWeight: '600',
    },
    recommendationsContainer: {
        marginTop: 8,
    },
    recommendationsTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    recommendationsText: {
        fontSize: 11,
        lineHeight: 16,
        opacity: 0.8,
    },
});

export default DriverClusterMarker;






