import React, { useRef } from 'react';
import { Animated, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { fonts } from '../../../theme/runtimeTokens';
import onboardingTheme from './onboardingTheme';

const { color, radius, spacing } = onboardingTheme;
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
        borderRadius: radius.md,
        borderWidth: 0,
        paddingVertical: 0,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.sm,
        marginBottom: Platform.OS === 'android' ? spacing.xl : spacing.md,
        shadowColor: color.accent,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.20,
        shadowRadius: 30,
        elevation: 8,
        minHeight: 58
    },
    continueButtonDisabled: {
        backgroundColor: color.accentSoft,
        shadowOpacity: 0.04
    },
    continueButtonText: {
        color: color.accentText,
        fontSize: 16,
        fontFamily: fonts.SemiBold,
        textAlign: 'center'
    },
    continueButtonTextDisabled: {
        color: color.textMuted
    }
});

export default ContinueButton;
