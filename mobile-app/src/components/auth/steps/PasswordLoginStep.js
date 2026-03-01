import Logger from '../../../utils/Logger';
/**
 * 🔐 TELA DE LOGIN COM SENHA
 * 
 * Exibida quando o usuário já existe no banco e tem senha cadastrada
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { fonts } from '../../../common-local/font';
import { Ionicons } from '@expo/vector-icons';
import ContinueButton from '../common/ContinueButton';
import UserAuthService from '../../../services/UserAuthService';

const colors = {
    black: '#000000',
    grey80: '#333333',
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5',
    error: '#FF3B30'
};

const PasswordLoginStep = ({ phoneNumber, existingUser, onLoginSuccess, onForgotPassword, onBack }) => {
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

            {/* Campo de senha */}
            <View style={styles.passwordContainer}>
                <TextInput
                    style={[styles.passwordInput, error && styles.inputError]}
                    value={password}
                    onChangeText={(text) => {
                        setPassword(text);
                        setError(''); // Limpar erro ao digitar
                    }}
                    placeholder="Digite sua senha"
                    placeholderTextColor={colors.greyPlaceholder}
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
                        size={24} 
                        color={colors.greyPlaceholder} 
                    />
                </TouchableOpacity>
            </View>

            {error ? (
                <Text style={styles.errorText}>{error}</Text>
            ) : null}

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
        paddingVertical: 20,
    },
    title: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'left',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 17,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        marginBottom: 32,
        lineHeight: 22,
    },
    passwordContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: colors.lightGrey,
        borderRadius: 8,
        backgroundColor: colors.white,
        marginBottom: 16,
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 16,
        fontSize: 17,
        fontFamily: fonts.Medium,
        color: colors.black,
    },
    inputError: {
        borderColor: colors.error,
    },
    eyeButton: {
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    errorText: {
        color: colors.error,
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginBottom: 16,
        textAlign: 'left',
    },
    forgotPasswordButton: {
        alignItems: 'center',
        paddingVertical: 12,
        marginTop: 8,
    },
    forgotPasswordText: {
        color: colors.leafGreen,
        fontSize: 17,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline',
    },
    backButton: {
        alignItems: 'center',
        paddingVertical: 12,
        marginTop: 8,
    },
    backButtonText: {
        color: colors.leafGreen,
        fontSize: 17,
        fontFamily: fonts.Medium,
        textDecorationLine: 'underline',
    },
});

export default PasswordLoginStep;

