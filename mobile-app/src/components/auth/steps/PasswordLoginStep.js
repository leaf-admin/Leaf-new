import Logger from '../../../utils/Logger';
/**
 * 🔐 TELA DE LOGIN COM SENHA
 * 
 * Exibida quando o usuário já existe no banco e tem senha cadastrada
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { fonts } from '../../../theme/runtimeTokens';
import { Ionicons } from '@expo/vector-icons';
import ContinueButton from '../common/ContinueButton';
import UserAuthService from '../../../services/UserAuthService';
import onboardingTheme from '../common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

const PasswordLoginStep = ({ phoneNumber, onLoginSuccess, onForgotPassword, onBack }) => {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = useCallback(async () => {
        if (!password || password.length < 6) {
            setError('Por favor, insira sua senha.');
            return;
        }

        setError('');
        setLoading(true);

        try {
            // Verificar rate limit
            await UserAuthService.checkRateLimit(phoneNumber);
            
            // Tentar login com senha
            const userData = await UserAuthService.loginWithPassword(phoneNumber, password);
            
            // Sucesso!
            if (onLoginSuccess) {
                onLoginSuccess(userData);
            }
        } catch (error) {
            Logger.error('❌ Erro no login:', error);
            
            // Registrar tentativa falha
            await UserAuthService.recordAttempt(phoneNumber, false);
            
            if (error.message && error.message.includes('Muitas tentativas')) {
                setError(error.message);
            } else if (error.message && error.message.includes('Senha incorreta')) {
                setError('Senha incorreta. Tente novamente.');
            } else if (error.message && error.message.includes('Usuário não encontrado')) {
                setError('Usuário não encontrado.');
            } else {
                setError('Erro ao fazer login. Verifique sua senha e tente novamente.');
            }
        } finally {
            setLoading(false);
        }
    }, [password, phoneNumber, onLoginSuccess]);

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Bem-vindo de volta!</Text>
            <Text style={styles.subtitle}>
                Digite sua senha para continuar
            </Text>

            <View style={styles.card}>
                {/* Campo de senha */}
                <View style={styles.passwordContainer}>
                    <TextInput
                        style={[styles.passwordInput, error && styles.inputError]}
                        value={password}
                        onChangeText={(text) => {
                            setPassword(text);
                            setError('');
                        }}
                        placeholder="Digite sua senha"
                        placeholderTextColor={color.textMuted}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoFocus
                        onSubmitEditing={handleLogin}
                    />
                    <TouchableOpacity
                        style={styles.eyeButton}
                        onPress={() => setShowPassword(!showPassword)}
                    >
                        <Ionicons 
                            name={showPassword ? 'eye-off' : 'eye'} 
                            size={22} 
                            color={color.textMuted} 
                        />
                    </TouchableOpacity>
                </View>

                {error ? (
                    <Text style={styles.errorText}>{error}</Text>
                ) : null}
            </View>

            {/* Botão de login */}
            <ContinueButton
                onPress={handleLogin}
                disabled={!password || loading}
                text={loading ? 'Entrando...' : 'Entrar'}
            />

            {/* Link "Esqueci a senha" */}
            <TouchableOpacity 
                style={styles.forgotPasswordButton}
                onPress={onForgotPassword}
                disabled={loading}
            >
                <Text style={styles.forgotPasswordText}>Esqueci minha senha</Text>
            </TouchableOpacity>

            {/* Botão voltar */}
            <TouchableOpacity 
                style={styles.backButton} 
                onPress={onBack}
                disabled={loading}
            >
                <Text style={styles.backButtonText}>Voltar</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm
    },
    title: {
        fontSize: 22,
        lineHeight: 28,
        color: color.textPrimary,
        fontFamily: fonts.Bold,
        textAlign: 'left',
        marginBottom: 6
    },
    subtitle: {
        fontSize: 13,
        lineHeight: 19,
        color: color.textSecondary,
        fontFamily: fonts.Regular,
        marginBottom: spacing.sm
    },
    card: {
        borderWidth: 1,
        borderColor: color.glassStroke,
        borderRadius: radius.lg,
        backgroundColor: color.panelSoft,
        padding: spacing.sm,
        shadowColor: '#0E1522',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 9
    },
    passwordContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        backgroundColor: color.surfaceMuted,
        marginBottom: 8,
        minHeight: 46
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        lineHeight: 18,
        fontFamily: fonts.Medium,
        color: color.textPrimary
    },
    inputError: {
        borderColor: color.error
    },
    eyeButton: {
        paddingHorizontal: 12,
        paddingVertical: 10
    },
    errorText: {
        color: color.error,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: fonts.Medium,
        marginBottom: 2,
        textAlign: 'left'
    },
    forgotPasswordButton: {
        alignItems: 'center',
        paddingVertical: 10,
        marginTop: 6
    },
    forgotPasswordText: {
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline'
    },
    backButton: {
        alignItems: 'center',
        paddingVertical: 10,
        marginTop: 2
    },
    backButtonText: {
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline'
    }
});

export default PasswordLoginStep;
