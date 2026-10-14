import leafTypography from '../../prototype/LeafTypography';
import React, { useRef } from 'react';
import { Animated, Text, StyleSheet, Pressable } from 'react-native';
import onboardingTheme from './onboardingTheme';
import { useHapticFeedback } from '../../../hooks/useHapticFeedback';

const { color } = onboardingTheme;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ContinueButton = ({
    onPress,
    disabled = false,
    text = 'Continuar',
    style = {},
    textStyle = {},
    accessibilityRole = 'button',
    accessibilityState,
    ...props
}) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const haptic = useHapticFeedback();

    const animateTo = (value) => {
        Animated.timing(scaleAnim, {
            toValue: value,
            duration: 120,
            useNativeDriver: true
        }).start();
    };

    return (
        <AnimatedPressable
            style={[
                styles.continueButton,
                disabled && styles.continueButtonDisabled,
                style,
                { transform: [{ scale: scaleAnim }] }
            ]}
            onPress={disabled ? undefined : (event) => { haptic('tap'); onPress?.(event); }}
            disabled={disabled}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={props.accessibilityLabel || text}
            accessibilityState={{ ...(accessibilityState || {}), disabled }}
            onPressIn={() => !disabled && animateTo(0.97)}
            onPressOut={() => !disabled && animateTo(1)}
            {...props}
        >
            <Text style={[
                styles.continueButtonText,
                disabled && styles.continueButtonTextDisabled,
                textStyle
            ]}>
                {text}
            </Text>
        </AnimatedPressable>
    );
};

// Botão principal do onboarding: pílula escura, toque com escala e vibração leve.
const styles = StyleSheet.create({
    continueButton: {
        backgroundColor: '#191B18',
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
        alignSelf: 'stretch'
    },
    continueButtonDisabled: {
        opacity: 0.32
    },
    continueButtonText: {
        color: '#FFFFFF',
        fontSize: 17,
        lineHeight: 22,
        ...leafTypography.semiBold,
        textAlign: 'center'
    },
    continueButtonTextDisabled: {
        color: '#FFFFFF'
    }
});

export default ContinueButton;
