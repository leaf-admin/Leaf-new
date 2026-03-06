import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    interpolateColor
} from 'react-native-reanimated';
import { Typography } from './Typography';
import { colors } from '../../common-local/theme';

export const AnimatedButton = ({
    onPress,
    title,
    variant = 'primary', // 'primary', 'secondary', 'outline', 'ghost', 'danger'
    disabled = false,
    loading = false,
    style,
    textStyle,
    fullWidth = true,
    children,
    ...props
}) => {
    const scale = useSharedValue(1);
    const pressed = useSharedValue(0);

    const handlePressIn = () => {
        if (disabled || loading) return;
        scale.value = withSpring(0.97, {
            damping: 15,
            stiffness: 300,
            mass: 0.5,
        });
        pressed.value = withSpring(1);
    };

    const handlePressOut = () => {
        scale.value = withSpring(1, {
            damping: 15,
            stiffness: 300,
            mass: 0.5,
        });
        pressed.value = withSpring(0);
    };

    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [{ scale: scale.value }],
        };
    });

    const getContainerStyle = () => {
        switch (variant) {
            case 'primary':
                return [styles.container, styles.primaryContainer, disabled && styles.disabledPrimary];
            case 'secondary':
                return [styles.container, styles.secondaryContainer, disabled && styles.disabledSecondary];
            case 'outline':
                return [styles.container, styles.outlineContainer, disabled && styles.disabledOutline];
            case 'ghost':
                return [styles.container, styles.ghostContainer];
            case 'danger':
                return [styles.container, styles.dangerContainer, disabled && styles.disabledSecondary];
            default:
                return [styles.container, styles.primaryContainer];
        }
    };

    const getTextColor = () => {
        if (disabled) return variant === 'primary' ? colors.background : colors.text.disabled;
        switch (variant) {
            case 'primary': return colors.background;
            case 'secondary': return colors.text.primary;
            case 'outline': return colors.primary;
            case 'ghost': return colors.primary;
            case 'danger': return colors.background;
            default: return colors.background;
        }
    };

    return (
        <Animated.View style={[animatedStyle, fullWidth && styles.fullWidth, style]}>
            <Pressable
                onPress={onPress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={disabled || loading}
                style={getContainerStyle()}
                {...props}
            >
                {children ? children : (
                    <Typography
                        variant="button"
                        color={getTextColor()}
                        style={[styles.text, textStyle]}
                    >
                        {loading ? 'Processando...' : title}
                    </Typography>
                )}
            </Pressable>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    fullWidth: {
        width: '100%',
    },
    container: {
        height: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        paddingHorizontal: 24,
    },
    primaryContainer: {
        backgroundColor: colors.primary,
    },
    secondaryContainer: {
        backgroundColor: colors.surface,
    },
    outlineContainer: {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.border,
    },
    ghostContainer: {
        backgroundColor: 'transparent',
    },
    dangerContainer: {
        backgroundColor: '#000000',
    },
    disabledPrimary: {
        backgroundColor: colors.text.disabled,
    },
    disabledSecondary: {
        backgroundColor: '#F2F2F7',
    },
    disabledOutline: {
        borderColor: colors.border,
        opacity: 0.5,
    },
    text: {
        textAlign: 'center',
    }
});
