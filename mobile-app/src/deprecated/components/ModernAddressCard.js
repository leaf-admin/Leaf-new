import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
    Dimensions,
    Platform,
    LinearGradient
} from 'react-native';
import { Icon } from 'react-native-elements';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { fonts } from '../common/font';

const { width } = Dimensions.get('window');

const ModernAddressCard = ({ 
    pickup, 
    drop, 
    onPickupPress, 
    onDropPress, 
    theme = 'light',
    isActive = false 
}) => {
    const [scaleAnim] = useState(new Animated.Value(1));
    const [glowAnim] = useState(new Animated.Value(0));
    const [slideAnim] = useState(new Animated.Value(0));

    const currentTheme = theme === 'dark' ? darkTheme : lightTheme;

    useEffect(() => {
        if (isActive) {
            // Animação de entrada com slide e glow
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(glowAnim, {
                    toValue: 1,
                    duration: 500,
                    useNativeDriver: false,
                })
            ]).start();
        }
    }, [isActive]);

    const handlePress = (type) => {
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

        if (type === 'pickup') {
            onPickupPress();
        } else {
            onDropPress();
        }
    };

    const getStreetAndNumber = (address) => {
        if (!address) return '';
        const parts = address.split(',');
        return parts[0] || address;
    };

    const renderAddressField = (type, data, icon, placeholder, onPress) => {
        const hasData = data && (data.placeName || getStreetAndNumber(data.add));
        const isPickup = type === 'pickup';

        return (
            <Animated.View
                style={[
                    styles.addressField,
                    {
                        transform: [{ scale: scaleAnim }],
                        opacity: slideAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 1],
                        }),
                    }
                ]}
            >
                <TouchableOpacity
                    style={[
                        styles.addressButton,
                        hasData && styles.addressButtonFilled,
                        { backgroundColor: currentTheme.card }
                    ]}
                    onPress={() => handlePress(type)}
                    activeOpacity={0.8}
                >
                    {/* Gradiente de fundo sutil */}
                    <View style={[
                        styles.gradientOverlay,
                        {
                            backgroundColor: hasData 
                                ? (isPickup ? 'rgba(76, 175, 80, 0.1)' : 'rgba(33, 150, 243, 0.1)')
                                : 'transparent'
                        }
                    ]} />

                    {/* Ícone com animação */}
                    <View style={[
                        styles.iconContainer,
                        hasData && styles.iconContainerActive
                    ]}>
                        <MaterialCommunityIcons
                            name={icon}
                            size={24}
                            color={hasData ? currentTheme.primary : currentTheme.icon}
                        />
                    </View>

                    {/* Conteúdo do endereço */}
                    <View style={styles.addressContent}>
                        <Text style={[
                            styles.addressLabel,
                            { color: currentTheme.textSecondary }
                        ]}>
                            {isPickup ? 'Partida' : 'Destino'}
                        </Text>
                        <Text 
                            style={[
                                styles.addressText,
                                { color: hasData ? currentTheme.text : currentTheme.placeholder }
                            ]}
                            numberOfLines={2}
                        >
                            {hasData 
                                ? (data.placeName || getStreetAndNumber(data.add))
                                : placeholder
                            }
                        </Text>
                    </View>

                    {/* Indicador de status */}
                    {hasData && (
                        <View style={[
                            styles.statusIndicator,
                            { backgroundColor: isPickup ? '#4CAF50' : '#2196F3' }
                        ]} />
                    )}
                </TouchableOpacity>
            </Animated.View>
        );
    };

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    transform: [
                        {
                            translateY: slideAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [50, 0],
                            })
                        }
                    ],
                    shadowOpacity: glowAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.1, 0.3],
                    }),
                }
            ]}
        >
            {/* Card principal com gradiente sutil */}
            <View style={[
                styles.mainCard,
                { backgroundColor: currentTheme.card }
            ]}>
                {/* Linha de gradiente no topo */}
                <View style={[
                    styles.gradientLine,
                    {
                        backgroundColor: pickup && drop 
                            ? 'linear-gradient(90deg, #4CAF50, #2196F3)'
                            : currentTheme.divider
                    }
                ]} />

                {/* Campo de partida */}
                {renderAddressField(
                    'pickup',
                    pickup,
                    'map-marker-start',
                    'Escolha o ponto de partida',
                    onPickupPress
                )}

                {/* Separador animado */}
                <View style={[
                    styles.separator,
                    { backgroundColor: currentTheme.divider }
                ]}>
                    <View style={[
                        styles.separatorDot,
                        { backgroundColor: currentTheme.icon }
                    ]} />
                </View>

                {/* Campo de destino */}
                {renderAddressField(
                    'drop',
                    drop,
                    'map-marker-end',
                    'Escolha o destino',
                    onDropPress
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 120 : 90,
        left: 16,
        right: 16,
        zIndex: 1000,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 20,
        elevation: 8,
    },
    mainCard: {
        borderRadius: 24,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 6,
    },
    gradientLine: {
        height: 3,
        width: '100%',
    },
    addressField: {
        marginBottom: 4,
    },
    addressButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
        position: 'relative',
        borderRadius: 16,
        marginHorizontal: 8,
        marginVertical: 4,
    },
    addressButtonFilled: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    gradientOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 16,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    iconContainerActive: {
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
    },
    addressContent: {
        flex: 1,
    },
    addressLabel: {
        fontSize: 12,
        fontFamily: fonts.Medium,
        marginBottom: 2,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    addressText: {
        fontSize: 16,
        fontFamily: fonts.SemiBold,
        lineHeight: 22,
        letterSpacing: 0.2,
    },
    statusIndicator: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 12,
    },
    separator: {
        height: 1,
        marginHorizontal: 16,
        marginVertical: 8,
        position: 'relative',
    },
    separatorDot: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 6,
        height: 6,
        borderRadius: 3,
        marginLeft: -3,
        marginTop: -3,
    },
});

export default ModernAddressCard; 