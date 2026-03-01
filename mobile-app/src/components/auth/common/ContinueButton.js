import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { fonts } from '../../../common-local/font';

// Cores padronizadas
const colors = {
    leafGreen: '#1A330E',
    lightGrey: '#F5F5F5',
    white: '#FFFFFF',
    greyPlaceholder: '#BDBDBD',
};

const ContinueButton = ({ 
    onPress, 
    disabled = false, 
    text = 'Continuar',
    style = {},
    textStyle = {}
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
        backgroundColor: colors.leafGreen,
        borderRadius: 16,
        paddingVertical: 18,
        alignItems: 'center',
        marginTop: 16,
        marginHorizontal: 24,
        marginBottom: 20, // Garantir que não seja cortado
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        minHeight: 56, // Altura mínima consistente
    },
    continueButtonDisabled: {
        backgroundColor: colors.lightGrey,
    },
    continueButtonText: {
        color: colors.white,
        fontSize: 18,
        fontFamily: fonts.Bold,
        textAlign: 'center',
    },
    continueButtonTextDisabled: {
        color: colors.greyPlaceholder,
    },
});

export default ContinueButton;


