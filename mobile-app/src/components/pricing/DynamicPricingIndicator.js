// DynamicPricingIndicator.js - Componente visual para indicadores de tarifa dinâmica
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const DynamicPricingIndicator = ({ 
    pricingData, 
    onPress, 
    theme = { 
        primary: '#41D274', 
        background: '#FFFFFF', 
        text: '#000000',
        surface: '#F5F5F5'
    },
    size = 'medium' // 'small', 'medium', 'large'
}) => {
    const [animation] = useState(new Animated.Value(1));
    const [pulseAnimation] = useState(new Animated.Value(1));

    // Configurações de tamanho
    const sizeConfig = {
        small: { container: 40, icon: 16, text: 10, padding: 8 },
        medium: { container: 60, icon: 24, text: 12, padding: 12 },
        large: { container: 80, icon: 32, text: 14, padding: 16 }
    };

    const config = sizeConfig[size];

    // Animação de entrada
    useEffect(() => {
        Animated.spring(animation, {
            toValue: 1,
            useNativeDriver: true,
            tension: 100,
            friction: 8
        }).start();
    }, []);

    // Animação de pulso para alta demanda
    useEffect(() => {
        if (pricingData?.indicator?.color === '#F44336') { // Vermelho - alta demanda
            const pulse = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnimation, {
                        toValue: 1.1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnimation, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    })
                ])
            );
            pulse.start();
            return () => pulse.stop();
        }
    }, [pricingData?.indicator?.color]);

    if (!pricingData || !pricingData.indicator) {
        return null;
    }

    const { indicator, dynamicFactor, finalFare, baseFare } = pricingData;
    const increasePercentage = ((dynamicFactor - 1) * 100).toFixed(1);

    // Determinar ícone baseado no nível de demanda
    const getIndicatorIcon = () => {
        if (indicator.color === '#4CAF50') return 'trending-down'; // Verde - normal
        if (indicator.color === '#FF9800') return 'trending-flat'; // Amarelo - moderada
        if (indicator.color === '#F44336') return 'trending-up'; // Vermelho - alta
        return 'pulse';
    };

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    transform: [
                        { scale: animation },
                        { scale: pulseAnimation }
                    ]
                }
            ]}
        >
            <TouchableOpacity
                style={[
                    styles.indicator,
                    {
                        width: config.container,
                        height: config.container,
                        backgroundColor: indicator.color,
                        borderRadius: config.container / 2,
                        padding: config.padding
                    }
                ]}
                onPress={() => onPress?.(pricingData)}
                activeOpacity={0.8}
            >
                {/* Ícone do indicador */}
                <Ionicons 
                    name={getIndicatorIcon()} 
                    size={config.icon} 
                    color="#FFFFFF" 
                />
                
                {/* Percentual de aumento */}
                <Text style={[styles.percentageText, { fontSize: config.text }]}>
                    +{increasePercentage}%
                </Text>
            </TouchableOpacity>

            {/* Informações detalhadas */}
            <View style={[styles.detailsContainer, { backgroundColor: theme.surface }]}>
                <Text style={[styles.demandLabel, { color: theme.text, fontSize: config.text }]}>
                    {indicator.label}
                </Text>
                
                <View style={styles.priceContainer}>
                    <Text style={[styles.basePrice, { color: theme.text, fontSize: config.text - 1 }]}>
                        R$ {baseFare.toFixed(2)}
                    </Text>
                    <Text style={[styles.finalPrice, { color: indicator.color, fontSize: config.text }]}>
                        R$ {finalFare.toFixed(2)}
                    </Text>
                </View>
                
                <Text style={[styles.description, { color: theme.text, fontSize: config.text - 2 }]}>
                    {indicator.description}
                </Text>
            </View>
        </Animated.View>
    );
};

// Componente compacto para uso em listas
export const CompactPricingIndicator = ({ pricingData, theme }) => {
    if (!pricingData || !pricingData.indicator) {
        return null;
    }

    const { indicator, dynamicFactor } = pricingData;
    const increasePercentage = ((dynamicFactor - 1) * 100).toFixed(0);

    return (
        <View style={[styles.compactContainer, { backgroundColor: indicator.color }]}>
            <Ionicons 
                name="trending-up" 
                size={12} 
                color="#FFFFFF" 
            />
            <Text style={styles.compactText}>
                +{increasePercentage}%
            </Text>
        </View>
    );
};

// Componente de histórico de preços
export const PricingHistoryChart = ({ pricingHistory, theme }) => {
    if (!pricingHistory || pricingHistory.length < 2) {
        return (
            <View style={[styles.chartContainer, { backgroundColor: theme.surface }]}>
                <Text style={[styles.chartTitle, { color: theme.text }]}>
                    Histórico de Preços
                </Text>
                <Text style={[styles.noDataText, { color: theme.text }]}>
                    Dados insuficientes
                </Text>
            </View>
        );
    }

    const maxFactor = Math.max(...pricingHistory.map(p => p.dynamicFactor));
    const minFactor = Math.min(...pricingHistory.map(p => p.dynamicFactor));

    return (
        <View style={[styles.chartContainer, { backgroundColor: theme.surface }]}>
            <Text style={[styles.chartTitle, { color: theme.text }]}>
                Histórico de Preços (Última Hora)
            </Text>
            
            <View style={styles.chart}>
                {pricingHistory.map((entry, index) => {
                    const height = ((entry.dynamicFactor - minFactor) / (maxFactor - minFactor)) * 100;
                    const color = entry.indicator.color;
                    
                    return (
                        <View
                            key={index}
                            style={[
                                styles.chartBar,
                                {
                                    height: `${height}%`,
                                    backgroundColor: color,
                                    width: `${100 / pricingHistory.length}%`
                                }
                            ]}
                        />
                    );
                })}
            </View>
            
            <View style={styles.chartLabels}>
                <Text style={[styles.chartLabel, { color: theme.text }]}>
                    Min: {minFactor.toFixed(2)}x
                </Text>
                <Text style={[styles.chartLabel, { color: theme.text }]}>
                    Max: {maxFactor.toFixed(2)}x
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    indicator: {
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
    percentageText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        marginTop: 2,
    },
    detailsContainer: {
        position: 'absolute',
        top: 70,
        left: -80,
        width: 160,
        padding: 12,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        zIndex: 1000,
    },
    demandLabel: {
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 4,
    },
    priceContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
        paddingVertical: 4,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: 'rgba(0,0,0,0.1)',
    },
    basePrice: {
        textDecorationLine: 'line-through',
        opacity: 0.7,
    },
    finalPrice: {
        fontWeight: 'bold',
    },
    description: {
        textAlign: 'center',
        opacity: 0.8,
    },
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        marginLeft: 4,
    },
    compactText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: 'bold',
        marginLeft: 2,
    },
    chartContainer: {
        padding: 12,
        borderRadius: 12,
        marginVertical: 8,
    },
    chartTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
    },
    chart: {
        height: 60,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    chartBar: {
        borderRadius: 2,
        marginHorizontal: 1,
    },
    chartLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    chartLabel: {
        fontSize: 10,
        opacity: 0.7,
    },
    noDataText: {
        textAlign: 'center',
        opacity: 0.7,
        fontStyle: 'italic',
    },
});

export default DynamicPricingIndicator;






