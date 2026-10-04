import leafTypography from '../prototype/LeafTypography';
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/runtimeTokens';

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
        ...leafTypography.regular,
    },
    h1: {
        ...leafTypography.bold,
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: 0.36,
    },
    h2: {
        ...leafTypography.bold,
        fontSize: 22,
        lineHeight: 28,
        letterSpacing: 0.35,
    },
    h3: {
        ...leafTypography.bold,
        fontSize: 20,
        lineHeight: 25,
        letterSpacing: 0.38,
    },
    body: {
        ...leafTypography.regular,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: -0.32,
    },
    bodyMedium: {
        ...leafTypography.medium,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: -0.32,
    },
    caption: {
        ...leafTypography.regular,
        fontSize: 14,
        lineHeight: 20,
        letterSpacing: -0.15,
    },
    button: {
        ...leafTypography.bold,
        fontSize: 16,
        lineHeight: 21,
        letterSpacing: -0.32,
    },
    label: {
        ...leafTypography.medium,
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: -0.08,
    }
});

export default Typography;
