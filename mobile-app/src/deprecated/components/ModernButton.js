import React, { useRef, useEffect } from 'react';
import {
    TouchableOpacity,
    Text,
    StyleSheet,
    Animated,
    View,
    ActivityIndicator,
    Platform,
    Vibration
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../common-local/font';
import { useResponsiveLayout } from './ResponsiveLayout';

const ButtonVariants = {
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
    OUTLINE: 'outline',
    GHOST: 'ghost',
    DANGER: 'danger',
    SUCCESS: 'success',
};

const ButtonSizes = {
    SMALL: 'small',
    MEDIUM: 'medium',
    LARGE: 'large',
};

const ButtonColors = {
    [ButtonVariants.PRIMARY]: {
        background: '#10B981',
        text: '#FFFFFF',
        border: '#10B981',
        pressed: '#059669',
        disabled: '#D1D5DB',
    },
    [ButtonVariants.SECONDARY]: {
        background: '#6B7280',
        text: '#FFFFFF',
        border: '#6B7280',
        pressed: '#4B5563',
        disabled: '#D1D5DB',
    },
    [ButtonVariants.OUTLINE]: {
        background: 'transparent',
        text: '#10B981',
        border: '#10B981',
        pressed: '#F0FDF4',
        disabled: '#D1D5DB',
    },
    [ButtonVariants.GHOST]: {
        background: 'transparent',
        text: '#6B7280',
        border: 'transparent',
        pressed: '#F3F4F6',
        disabled: '#D1D5DB',
    },
    [ButtonVariants.DANGER]: {
        background: '#EF4444',
        text: '#FFFFFF',
        border: '#EF4444',
        pressed: '#DC2626',
        disabled: '#D1D5DB',
    },
    [ButtonVariants.SUCCESS]: {
        background: '#10B981',
        text: '#FFFFFF',
        border: '#10B981',
        pressed: '#059669',
        disabled: '#D1D5DB',
    },
};

const ButtonSizeConfig = {
    [ButtonSizes.SMALL]: {
        height: 36,
        paddingHorizontal: 12,
        fontSize: 14,
        iconSize: 16,
    },
    [ButtonSizes.MEDIUM]: {
        height: 44,
        paddingHorizontal: 16,
        fontSize: 16,
        iconSize: 18,
    },
    [ButtonSizes.LARGE]: {
        height: 52,
        paddingHorizontal: 20,
        fontSize: 18,
        iconSize: 20,
    },
};

export default function ModernButton({
    title,
    onPress,
    variant = ButtonVariants.PRIMARY,
    size = ButtonSizes.MEDIUM,
    disabled = false,
    loading = false,
    icon = null,
    iconPosition = 'left',
    fullWidth = false,
    style,
    textStyle,
    children,
    hapticFeedback = true,
    ...props
}) {
    const { config } = useResponsiveLayout();
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const opacityAnim = useRef(new Animated.Value(1)).current;

    const colors = ButtonColors[variant];
    const sizeConfig = ButtonSizeConfig[size];

    // Ajustar tamanho baseado no dispositivo
    const responsiveHeight = size === ButtonSizes.LARGE && config.deviceType === 'tablet' 
        ? sizeConfig.height + 8 
        : sizeConfig.height;

    const handlePressIn = () => {
        if (disabled || loading) return;

        if (hapticFeedback && Platform.OS === 'ios') {
            Vibration.vibrate(10);
        }

        Animated.parallel([
            Animated.timing(scaleAnim, {
                toValue: 0.95,
                duration: 100,
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: 0.8,
                duration: 100,
                useNativeDriver: true,
            }),
        ]).start();
    };

    const handlePressOut = () => {
        if (disabled || loading) return;

        Animated.parallel([
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
            }),
        ]).start();
    };

    const handlePress = () => {
        if (disabled || loading) return;
        onPress && onPress();
    };

    const isOutline = variant === ButtonVariants.OUTLINE;
    const isGhost = variant === ButtonVariants.GHOST;

    const buttonStyle = [
        styles.button,
        {
            height: responsiveHeight,
            paddingHorizontal: sizeConfig.paddingHorizontal,
            backgroundColor: disabled ? colors.disabled : colors.background,
            borderColor: colors.border,
            borderWidth: isOutline || isGhost ? 0 : 1,
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
            width: fullWidth ? '100%' : 'auto',
        },
        style,
    ];

    const textStyleCombined = [
        styles.text,
        {
            fontSize: sizeConfig.fontSize,
            color: disabled ? '#9CA3AF' : colors.text,
            fontFamily: fonts.Medium,
        },
        textStyle,
    ];

    const renderContent = () => {
        if (loading) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator 
                        size="small" 
                        color={colors.text} 
                        style={styles.loadingSpinner}
                    />
                    <Text style={textStyleCombined}>{title}</Text>
                </View>
            );
        }

        if (children) {
            return children;
        }

        return (
            <View style={styles.contentContainer}>
                {icon && iconPosition === 'left' && (
                    <Ionicons
                        name={icon}
                        size={sizeConfig.iconSize}
                        color={disabled ? '#9CA3AF' : colors.text}
                        style={styles.leftIcon}
                    />
                )}
                <Text style={textStyleCombined}>{title}</Text>
                {icon && iconPosition === 'right' && (
                    <Ionicons
                        name={icon}
                        size={sizeConfig.iconSize}
                        color={disabled ? '#9CA3AF' : colors.text}
                        style={styles.rightIcon}
                    />
                )}
            </View>
        );
    };

    return (
        <Animated.View style={buttonStyle}>
            <TouchableOpacity
                onPress={handlePress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={disabled || loading}
                activeOpacity={1}
                style={styles.touchable}
                accessibilityRole="button"
                accessibilityState={{ disabled: disabled || loading }}
                {...props}
            >
                {renderContent()}
            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    button: {
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    touchable: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    contentContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingSpinner: {
        marginRight: 8,
    },
    text: {
        textAlign: 'center',
        fontWeight: '600',
    },
    leftIcon: {
        marginRight: 8,
    },
    rightIcon: {
        marginLeft: 8,
    },
});

// Botões especializados para o app LEAF
export const BookNowButton = ({ onPress, loading, disabled, price, ...props }) => (
    <ModernButton
        title="Agendar Agora"
        onPress={onPress}
        variant={ButtonVariants.PRIMARY}
        size={ButtonSizes.LARGE}
        loading={loading}
        disabled={disabled}
        fullWidth
        icon="car"
        iconPosition="left"
        style={styles.bookNowButton}
        {...props}
    >
        <View style={styles.bookNowContent}>
            <View style={styles.bookNowLeft}>
                <Ionicons name="car" size={24} color="#FFFFFF" style={styles.bookNowIcon} />
                <Text style={styles.bookNowText}>Agendar Agora</Text>
            </View>
            {price && (
                <View style={styles.bookNowPrice}>
                    <Text style={styles.bookNowPriceText}>{price}</Text>
                </View>
            )}
        </View>
    </ModernButton>
);

export const CancelButton = ({ onPress, loading, ...props }) => (
    <ModernButton
        title="Cancelar"
        onPress={onPress}
        variant={ButtonVariants.DANGER}
        size={ButtonSizes.MEDIUM}
        loading={loading}
        icon="close"
        iconPosition="left"
        {...props}
    />
);

export const CallButton = ({ onPress, phoneNumber, ...props }) => (
    <ModernButton
        title="Ligar"
        onPress={onPress}
        variant={ButtonVariants.SUCCESS}
        size={ButtonSizes.MEDIUM}
        icon="call"
        iconPosition="left"
        {...props}
    />
);

export const ChatButton = ({ onPress, ...props }) => (
    <ModernButton
        title="Chat"
        onPress={onPress}
        variant={ButtonVariants.OUTLINE}
        size={ButtonSizes.MEDIUM}
        icon="chatbubble"
        iconPosition="left"
        {...props}
    />
);

// Estilos específicos para botões do LEAF
const leafButtonStyles = StyleSheet.create({
    bookNowButton: {
        shadowColor: '#10B981',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    bookNowContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    bookNowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bookNowIcon: {
        marginRight: 8,
    },
    bookNowText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontFamily: fonts.Bold,
        fontWeight: '700',
    },
    bookNowPrice: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    bookNowPriceText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: '700',
    },
});

export { ButtonVariants, ButtonSizes }; 