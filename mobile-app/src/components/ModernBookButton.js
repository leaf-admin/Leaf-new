import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
    Dimensions,
    Platform,
    ActivityIndicator
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { fonts } from '../common/font';

const { width } = Dimensions.get('window');

const ModernBookButton = ({ 
    onPress, 
    loading = false, 
    disabled = false,
    price = null,
    currency = 'R$',
    theme = 'light',
    text = 'Agendar Agora',
    subText = 'Toque para confirmar'
}) => {
    const [scaleAnim] = useState(new Animated.Value(1));
    const [glowAnim] = useState(new Animated.Value(0));
    const [pulseAnim] = useState(new Animated.Value(1));
    const [slideAnim] = useState(new Animated.Value(0));

    const currentTheme = theme === 'dark' ? darkTheme : lightTheme;

    useEffect(() => {
        // Animação de entrada
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
    }, []);

    useEffect(() => {
        if (!disabled && !loading) {
            // Animação de pulso sutil para chamar atenção
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.02,
                        duration: 2000,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 2000,
                        useNativeDriver: true,
                    })
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [disabled, loading]);

    const handlePress = () => {
        if (disabled || loading) return;

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

    const getButtonStyle = () => {
        if (disabled) {
            return [styles.button, styles.buttonDisabled];
        }
        if (loading) {
            return [styles.button, styles.buttonLoading];
        }
        return [styles.button, styles.buttonActive];
    };

    const getGradientColors = () => {
        if (disabled) {
            return ['#9E9E9E', '#757575'];
        }
        if (loading) {
            return ['#FF9800', '#F57C00'];
        }
        return ['#4CAF50', '#2E7D32'];
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
                            translateY: slideAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [50, 0],
                            })
                        }
                    ],
                    opacity: slideAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 1],
                    }),
                    shadowOpacity: glowAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.2, 0.4],
                    }),
                }
            ]}
        >
            <TouchableOpacity
                style={getButtonStyle()}
                onPress={handlePress}
                disabled={disabled || loading}
                activeOpacity={0.8}
            >
                {/* Gradiente de fundo */}
                <View style={[
                    styles.gradientBackground,
                    { backgroundColor: getGradientColors()[0] }
                ]} />

                {/* Conteúdo do botão */}
                <View style={styles.content}>
                    {/* Ícone */}
                    <View style={styles.iconContainer}>
                        {loading ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <MaterialCommunityIcons
                                name={disabled ? "close-circle" : "check-circle"}
                                size={24}
                                color="#fff"
                            />
                        )}
                    </View>

                    {/* Texto principal */}
                    <View style={styles.textContainer}>
                        <Text style={styles.mainText}>
                            {loading ? 'Processando...' : text}
                        </Text>
                        
                        {/* Preço ou subtexto */}
                        <Text style={styles.subText}>
                            {price 
                                ? `${currency}${price.toFixed(2)}`
                                : subText
                            }
                        </Text>
                    </View>

                    {/* Indicador de status */}
                    {!disabled && !loading && (
                        <View style={styles.statusIndicator}>
                            <MaterialCommunityIcons
                                name="arrow-right"
                                size={20}
                                color="#fff"
                            />
                        </View>
                    )}
                </View>

                {/* Efeito de brilho */}
                <View style={[
                    styles.shineEffect,
                    {
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        transform: [
                            {
                                translateX: glowAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [-width, width],
                                })
                            }
                        ]
                    }
                ]} />
            </TouchableOpacity>

            {/* Linha decorativa inferior */}
            <View style={[
                styles.bottomLine,
                { backgroundColor: getGradientColors()[1] }
            ]} />
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 16,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 20,
        elevation: 10,
    },
    button: {
        borderRadius: 24,
        overflow: 'hidden',
        position: 'relative',
        minHeight: 64,
    },
    buttonActive: {
        backgroundColor: '#4CAF50',
    },
    buttonLoading: {
        backgroundColor: '#FF9800',
    },
    buttonDisabled: {
        backgroundColor: '#9E9E9E',
    },
    gradientBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 16,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    textContainer: {
        flex: 1,
    },
    mainText: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        color: '#fff',
        marginBottom: 2,
        letterSpacing: 0.5,
    },
    subText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: 'rgba(255, 255, 255, 0.8)',
        letterSpacing: 0.3,
    },
    statusIndicator: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    shineEffect: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 50,
        transform: [{ skewX: '-20deg' }],
    },
    bottomLine: {
        height: 4,
        borderRadius: 2,
        marginTop: 8,
    },
});

export default ModernBookButton; 