import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../../common-local/theme';
import { fonts } from '../../common-local/font';

export const Typography = ({
    variant = 'body',
    color = colors.text?.primary || '#1C1C1E',
    align = 'left',
    style,
    children,
    ...props
}) => {
    return (
        <Text
            style={[
                styles.base,
                styles[variant],
                { color, textAlign: align },
                style
            ]}
            {...props}
        >
            {children}
        </Text>
    );
};

const styles = StyleSheet.create({
    base: {
        fontFamily: fonts.Regular,
    },
    h1: {
        fontFamily: fonts.Bold,
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: 0.36,
    },
    h2: {
        fontFamily: fonts.Bold,
        fontSize: 22,
        lineHeight: 28,
        letterSpacing: 0.35,
    },
    h3: {
        fontFamily: fonts.Bold,
        fontSize: 20,
        lineHeight: 25,
        letterSpacing: 0.38,
    },
    body: {
        fontFamily: fonts.Regular,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: -0.32,
    },
    bodyMedium: {
        fontFamily: fonts.Medium,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: -0.32,
    },
    caption: {
        fontFamily: fonts.Regular,
        fontSize: 14,
        lineHeight: 20,
        letterSpacing: -0.15,
    },
    button: {
        fontFamily: fonts.Bold,
        fontSize: 16,
        lineHeight: 21,
        letterSpacing: -0.32,
    },
    label: {
        fontFamily: fonts.Medium,
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: -0.08,
    }
});
