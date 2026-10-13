import leafTypography from '../../prototype/LeafTypography';
import React, { useRef } from 'react';
import { Animated, Text, StyleSheet, Pressable } from 'react-native';
import onboardingTheme from './onboardingTheme';

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
            onPress={onPress}
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

const styles = StyleSheet.create({
    continueButton: {
        backgroundColor: color.accent,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: color.border,
        paddingVertical: 0,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 0,
        marginBottom: 0,
        shadowColor: color.accent,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0,
        shadowRadius: 30,
        elevation: 0,
        minHeight: 54
    },
    continueButtonDisabled: {
        backgroundColor: color.accentSoft,
        shadowOpacity: 0.04
    },
    continueButtonText: {
        color: color.accentText,
        fontSize: 16,
        lineHeight: 22,
        ...leafTypography.semiBold,
        textAlign: 'center'
    },
    continueButtonTextDisabled: {
        color: color.textMuted
    }
});

export default ContinueButton;
