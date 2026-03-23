import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { fonts } from '../../../common-local/font';
import onboardingTheme from './onboardingTheme';

const { color, radius, spacing } = onboardingTheme;

const ContinueButton = ({
    onPress,
    disabled = false,
    text = 'Continuar',
    style = {},
    textStyle = {},
    ...props
}) => {
    return (
        <TouchableOpacity
            style={[
                styles.continueButton,
                disabled && styles.continueButtonDisabled,
                style
            ]}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.8}
            {...props}
        >
            <Text style={[
                styles.continueButtonText,
                disabled && styles.continueButtonTextDisabled,
                textStyle
            ]}>
                {text}
            </Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    continueButton: {
        backgroundColor: color.accent,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.borderStrong,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: spacing.sm,
        marginBottom: spacing.md,
        shadowColor: '#0E1522',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 14,
        elevation: 6,
        minHeight: 46
    },
    continueButtonDisabled: {
        backgroundColor: color.accentSoft,
        borderColor: color.border,
        shadowOpacity: 0.06
    },
    continueButtonText: {
        color: color.accentText,
        fontSize: 15,
        fontFamily: fonts.SemiBold,
        textAlign: 'center'
    },
    continueButtonTextDisabled: {
        color: color.textMuted
    }
});

export default ContinueButton;
