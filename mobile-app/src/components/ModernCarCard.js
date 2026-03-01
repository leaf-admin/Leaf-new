import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
    Dimensions,
    Image,
    Platform
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { fonts } from '../common/font';

const { width } = Dimensions.get('window');

const ModernCarCard = ({ 
    car, 
    isSelected = false, 
    onPress, 
    estimate = null,
    currency = 'R$',
    theme = 'light',
    index = 0 
}) => {
    const [scaleAnim] = useState(new Animated.Value(1));
    const [glowAnim] = useState(new Animated.Value(0));
    const [slideAnim] = useState(new Animated.Value(0));
    const [pulseAnim] = useState(new Animated.Value(1));

    const currentTheme = theme === 'dark' ? darkTheme : lightTheme;

    useEffect(() => {
        // Animação de entrada com delay baseado no índice
        const delay = index * 100;
        
        setTimeout(() => {
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: 1,
                    duration: 400,
                    useNativeDriver: true,
                }),
                Animated.timing(glowAnim, {
                    toValue: 1,
                    duration: 600,
                    useNativeDriver: false,
                })
            ]).start();
        }, delay);
    }, []);

    useEffect(() => {
        if (isSelected) {
            // Animação de pulso quando selecionado
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.02,
                        duration: 1000,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 1000,
                        useNativeDriver: true,
                    })
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [isSelected]);

    const handlePress = () => {
        // Micro-interação de press
        Animated.sequence([
            Animated.timing(scaleAnim, {
                toValue: 0.95,
                duration: 100,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
            })
        ]).start();

        onPress();
    };

    const getPrice = () => {
        if (estimate && estimate.estimateFare) {
            return `${currency}${estimate.estimateFare.toFixed(2)}`;
        }
        return `${currency}${car.min_fare.toFixed(2)}`;
    };

    const getCarInfo = () => {
        if (car.extra_info) {
            const info = car.extra_info.toLowerCase();
            if (info.includes('capacity')) {
                const capacityMatch = info.match(/capacity:\s*(\d+)/);
                return capacityMatch ? `${capacityMatch[1]} pessoas` : car.extra_info;
            }
            return car.extra_info;
        }
        return 'Taxi padrão';
    };

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    transform: [
                        { scale: scaleAnim },
                        { scale: pulseAnim },
                        {
                            translateX: slideAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [100, 0],
                            })
                        }
                    ],
                    opacity: slideAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 1],
                    }),
                    shadowOpacity: glowAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.1, isSelected ? 0.4 : 0.2],
                    }),
                }
            ]}
        >
            <TouchableOpacity
                style={[
                    styles.card,
                    {
                        backgroundColor: currentTheme.card,
                        borderColor: isSelected ? currentTheme.primary : 'transparent',
                    }
                ]}
                onPress={handlePress}
                activeOpacity={0.8}
            >
                {/* Gradiente de fundo quando selecionado */}
                {isSelected && (
                    <View style={[
                        styles.selectedGradient,
                        { backgroundColor: `${currentTheme.primary}15` }
                    ]} />
                )}

                {/* Indicador de seleção */}
                {isSelected && (
                    <View style={[
                        styles.selectionIndicator,
                        { backgroundColor: currentTheme.primary }
                    ]}>
                        <MaterialCommunityIcons
                            name="check"
                            size={16}
                            color="#fff"
                        />
                    </View>
                )}

                {/* Conteúdo principal */}
                <View style={styles.content}>
                    {/* Imagem do carro */}
                    <View style={styles.imageContainer}>
                        <Image
                            source={{ uri: car.image }}
                            style={styles.carImage}
                            resizeMode="contain"
                        />
                        <View style={[
                            styles.imageOverlay,
                            { backgroundColor: `${currentTheme.background}20` }
                        ]} />
                    </View>

                    {/* Informações do carro */}
                    <View style={styles.infoContainer}>
                        <View style={styles.headerRow}>
                            <Text style={[
                                styles.carName,
                                { color: currentTheme.text }
                            ]}>
                                {car.name}
                            </Text>
                            <View style={[
                                styles.priceContainer,
                                { backgroundColor: isSelected ? currentTheme.primary : currentTheme.background }
                            ]}>
                                <Text style={[
                                    styles.price,
                                    { color: isSelected ? '#fff' : currentTheme.text }
                                ]}>
                                    {getPrice()}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.detailsRow}>
                            <View style={styles.detailItem}>
                                <MaterialCommunityIcons
                                    name="account-group"
                                    size={16}
                                    color={currentTheme.textSecondary}
                                />
                                <Text style={[
                                    styles.detailText,
                                    { color: currentTheme.textSecondary }
                                ]}>
                                    {getCarInfo()}
                                </Text>
                            </View>

                            {estimate && estimate.duration && (
                                <View style={styles.detailItem}>
                                    <MaterialCommunityIcons
                                        name="clock-outline"
                                        size={16}
                                        color={currentTheme.textSecondary}
                                    />
                                    <Text style={[
                                        styles.detailText,
                                        { color: currentTheme.textSecondary }
                                    ]}>
                                        {Math.round(estimate.duration / 60)}min
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Barra de progresso para tempo estimado */}
                        {estimate && estimate.distance && (
                            <View style={styles.progressContainer}>
                                <View style={[
                                    styles.progressBar,
                                    { backgroundColor: currentTheme.divider }
                                ]}>
                                    <Animated.View
                                        style={[
                                            styles.progressFill,
                                            {
                                                backgroundColor: currentTheme.primary,
                                                width: `${Math.min((estimate.distance / 50) * 100, 100)}%`
                                            }
                                        ]}
                                    />
                                </View>
                                <Text style={[
                                    styles.distanceText,
                                    { color: currentTheme.textSecondary }
                                ]}>
                                    {estimate.distance.toFixed(1)}km
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Badge de recomendação */}
                {car.name.includes('Elite') && (
                    <View style={styles.recommendationBadge}>
                        <MaterialCommunityIcons
                            name="star"
                            size={12}
                            color="#FFD700"
                        />
                        <Text style={styles.recommendationText}>Recomendado</Text>
                    </View>
                )}
            </TouchableOpacity>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
        elevation: 6,
    },
    card: {
        borderRadius: 20,
        borderWidth: 2,
        overflow: 'hidden',
        position: 'relative',
    },
    selectedGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    selectionIndicator: {
        position: 'absolute',
        top: 12,
        right: 12,
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    content: {
        flexDirection: 'row',
        padding: 16,
    },
    imageContainer: {
        width: 80,
        height: 60,
        borderRadius: 12,
        marginRight: 16,
        position: 'relative',
        overflow: 'hidden',
    },
    carImage: {
        width: '100%',
        height: '100%',
    },
    imageOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    infoContainer: {
        flex: 1,
        justifyContent: 'space-between',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    carName: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        flex: 1,
        marginRight: 8,
    },
    priceContainer: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    price: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: '600',
    },
    detailsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    detailText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginLeft: 4,
    },
    progressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    progressBar: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        marginRight: 8,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
    },
    distanceText: {
        fontSize: 12,
        fontFamily: fonts.Medium,
        minWidth: 40,
    },
    recommendationBadge: {
        position: 'absolute',
        top: 12,
        left: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 215, 0, 0.9)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    recommendationText: {
        fontSize: 10,
        fontFamily: fonts.Bold,
        color: '#000',
        marginLeft: 4,
    },
});

export default ModernCarCard; 