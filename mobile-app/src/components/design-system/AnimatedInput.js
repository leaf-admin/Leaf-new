import React, { useState } from 'react';
import { View, TextInput, StyleSheet, Animated as RNAnimated, Platform } from 'react-native';
import { Typography } from './Typography';
import { colors } from '../../common-local/theme';
import { fonts } from '../../common-local/font';

export const AnimatedInput = ({
    label,
    value,
    onChangeText,
    placeholder,
    secureTextEntry,
    keyboardType = 'default',
    multiline = false,
    error,
    leftIcon,
    rightIcon,
    containerStyle,
    style,
    ...props
}) => {
    const [isFocused, setIsFocused] = useState(false);

    // Usar Animated normal do React Native (mais simples para bordas/cores que SharedValues no input)
    const focusAnim = React.useRef(new RNAnimated.Value(0)).current;

    React.useEffect(() => {
        RNAnimated.timing(focusAnim, {
            toValue: isFocused ? 1 : 0,
            duration: 200,
            useNativeDriver: false, // Necessário false para cor/border
        }).start();
    }, [isFocused]);

    const borderColor = focusAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [error ? colors.error : 'transparent', error ? colors.error : colors.primary]
    });

    const backgroundColor = focusAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.surface, '#FFFFFF']
    });

    return (
        <View style={[styles.wrapper, containerStyle]}>
            {label && (
                <Typography variant="label" color={colors.text.secondary} style={styles.label}>
                    {label}
                </Typography>
            )}

            <RNAnimated.View style={[
                styles.inputContainer,
                {
                    borderColor,
                    backgroundColor,
                    borderWidth: isFocused || error ? 1.5 : 0 // Exemplo: borda visível sutil ou nula quando s/ foco
                }
            ]}>
                {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

                <TextInput
                    style={[styles.input, multiline && styles.multiline, style]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={colors.text.disabled}
                    secureTextEntry={secureTextEntry}
                    keyboardType={keyboardType}
                    multiline={multiline}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    selectionColor={colors.primary}
                    {...props}
                />

                {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
            </RNAnimated.View>

            {error && (
                <Typography variant="caption" color={colors.error} style={styles.errorText}>
                    {error}
                </Typography>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        width: '100%',
        marginBottom: 16,
    },
    label: {
        marginBottom: 8,
        marginLeft: 4,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        borderRadius: 16,
        paddingHorizontal: 16,
        // Sombra sutil opcional:
        // shadowColor: '#000',
        // shadowOffset: { width: 0, height: 2 },
        // shadowOpacity: 0.03,
        // shadowRadius: 3,
        // elevation: 1,
    },
    input: {
        flex: 1,
        fontFamily: fonts.Regular,
        fontSize: 16,
        color: colors.text.primary,
        height: '100%',
        paddingVertical: Platform.OS === 'ios' ? 16 : 8,
    },
    multiline: {
        minHeight: 100,
        textAlignVertical: 'top',
    },
    leftIcon: {
        marginRight: 12,
    },
    rightIcon: {
        marginLeft: 12,
    },
    errorText: {
        marginTop: 6,
        marginLeft: 4,
    }
});
