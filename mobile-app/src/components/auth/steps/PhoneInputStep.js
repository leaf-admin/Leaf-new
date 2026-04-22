import React, { useState } from 'react';
import { View, TouchableOpacity, Alert as NativeAlert, StyleSheet, Text, TextInput } from 'react-native';
import auth from '@react-native-firebase/auth';
import { fonts } from '../../../theme/runtimeTokens';
import { isReviewAccount, getReviewAccountInfo } from '../../../config/reviewAccounts';
import {
    allowCustomOtpFallback,
    allowQaOtpForceFlow,
    allowReviewAccess
} from '../../../config/runtimeAccessPolicy';
import apiClient from '../../../services/httpClient';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import Logger from '../../../utils/Logger';
import onboardingTheme from '../common/onboardingTheme';
import ContinueButton from '../common/ContinueButton';
import { toUserFriendlyError, toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';

const { color, radius, spacing } = onboardingTheme;
const REVIEW_OTP_CODE = '0'.repeat(6);

const Alert = {
    ...NativeAlert,
    alert: (title, message, buttons, options) =>
        NativeAlert.alert(
            title || 'Atencao',
            toUserFriendlyMessage(message, {
                context: 'auth',
                fallbackMessage: 'Nao foi possivel concluir a autenticacao agora. Tente novamente.'
            }),
            buttons,
            options
        )
};

function resolveAuthAlertTitle(error, friendlyMessage = '') {
    const normalizedCode = String(
        error?.code ||
        error?.nativeErrorCode ||
        error?.userInfo?.code ||
        error?.userInfo?.nativeErrorCode ||
        ''
    ).toUpperCase();
    const normalizedText = [
        error?.message,
        error?.rawMessage,
        friendlyMessage
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (
        normalizedCode === '17010' ||
        normalizedCode === 'AUTH/TOO-MANY-REQUESTS' ||
        /17010|too many requests|muitas tentativas|rate limit/.test(normalizedText)
    ) {
        return 'Limite de Tentativas';
    }

    if (
        normalizedCode === 'AUTH/INVALID-PHONE-NUMBER' ||
        /invalid phone|numero de telefone invalido|telefone invalido/.test(normalizedText)
    ) {
        return 'Telefone Invalido';
    }

    if (
        normalizedCode === 'AUTH/QUOTA-EXCEEDED' ||
        /quota|limite de sms|limite de envios/.test(normalizedText)
    ) {
        return 'Limite de Envios';
    }

    if (
        normalizedCode === 'NETWORK_ERROR' ||
        normalizedCode === 'AUTH/NETWORK-REQUEST-FAILED' ||
        /network|internet|conexao|connection/.test(normalizedText)
    ) {
        return 'Erro de Conexao';
    }

    return 'Erro de Autenticacao';
}

const PhoneInputStep = ({ onSwitchToRegister, onVerificationSent, onPasswordLoginRequested }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);

    const isReviewEnv = allowReviewAccess();
    const enableCustomOtpFallback = allowCustomOtpFallback();
    const allowReviewOtpBypass = isReviewEnv;
    const allowForcedQaOtpFlow = allowQaOtpForceFlow();
    const FORCE_CUSTOM_OTP_NUMBERS = new Set(['11999999999', '11888888888']);

    const requestOtpWithFallback = async (fullPhoneNumber) => {
        const endpoints = [
            '/api/custom-otp/request-otp',
            '/custom-otp/request-otp'
        ];

        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                return await apiClient.post(endpoint, { phone: fullPhoneNumber });
            } catch (error) {
                lastError = error;
                // Se não for 404, não faz sentido tentar fallback
                if (error?.response?.status !== 404) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Falha ao enviar OTP');
    };

    const handleContinue = async () => {
        if (phoneNumber.length < 10) {
            Alert.alert('Erro', 'Por favor, insira um número de telefone válido.');
            return;
        }

        setLoading(true);
        setChecking(true);

        try {
            const fullPhoneNumber = `+55${phoneNumber}`;
            const forceCustomOtpFlow =
                allowForcedQaOtpFlow && FORCE_CUSTOM_OTP_NUMBERS.has(phoneNumber);

            // ✅ BYPASS PARA CONTAS DE REVIEW
            // IMPORTANTE: permitido apenas em ambiente explícito de review
            if (isReviewAccount(phoneNumber)) {
                // ✅ Verificar se bypass está habilitado
                if (!allowReviewOtpBypass) {
                    Logger.warn('🚫 Bypass de OTP bloqueado: ambiente sem modo review');
                    // Continuar com fluxo normal de OTP
                } else {
                    const reviewAccount = getReviewAccountInfo(phoneNumber);
                    Logger.log('🔐 REVIEW ACCESS: Conta de review detectada - pulando OTP', {
                        phoneNumber,
                        userType: reviewAccount?.userType,
                        isReviewEnv,
                        isDev: __DEV__
                    });

                    const reviewUser = {
                        uid: `review-${reviewAccount.userType}-${Date.now()}`,
                        phoneNumber: fullPhoneNumber,
                        isReviewAccount: true,
                        userType: reviewAccount.userType,
                        authMethod: 'review_access'
                    };

                    await saveStepData('phone_validation', {
                        phoneNumber: fullPhoneNumber,
                        isReviewAccount: true,
                        userType: reviewAccount.userType,
                        authMethod: 'review_access'
                    });

                    if (onVerificationSent) {
                        const reviewConfirmation = {
                            verificationId: 'review-access-' + Date.now(),
                            isReviewAccount: true,
                            reviewUser: reviewUser,
                            confirm: async (otpCode) => {
                                if (otpCode === REVIEW_OTP_CODE) {
                                    Logger.log('✅ OTP de review aceito para conta de review.');
                                    return { user: reviewUser };
                                }
                                throw new Error('Código OTP inválido para conta de review.');
                            }
                        };
                        // ✅ Passar skipOTP=true apenas se bypass estiver habilitado
                        onVerificationSent(reviewConfirmation, fullPhoneNumber, false, allowReviewOtpBypass);
                    }

                    setLoading(false);
                    setChecking(false);
                    return;
                }
            }

            // 📱 Fluxo principal: Firebase Phone Auth (produção)
            if (forceCustomOtpFlow) {
                Logger.log('📲 Forçando fluxo OTP customizado para conta QA controlada.');
                const response = await requestOtpWithFallback(fullPhoneNumber);
                if (!response.data || !response.data.success) {
                    throw new Error(response.data?.error || 'Erro ao enviar OTP');
                }

                const confirmation = {
                    verificationId: response.data.verificationId,
                    isCustomOtp: true
                };

                if (onVerificationSent) {
                    onVerificationSent(confirmation, fullPhoneNumber, false);
                }
                return;
            }

            Logger.log('📱 Enviando OTP via Firebase Auth...');
            try {
                const firebaseConfirmation = await auth().signInWithPhoneNumber(fullPhoneNumber);
                if (onVerificationSent) {
                    onVerificationSent(firebaseConfirmation, fullPhoneNumber, false);
                }
                return;
            } catch (firebaseError) {
                Logger.error('❌ Falha no envio OTP via Firebase:', firebaseError);
                if (!enableCustomOtpFallback) {
                    throw firebaseError;
                }
                Logger.warn('⚠️ Aplicando fallback de OTP customizado para ambiente de suporte.');
            }

            // Fallback controlado (dev/review/suporte)
            const response = await requestOtpWithFallback(fullPhoneNumber);
            if (!response.data || !response.data.success) {
                throw new Error(response.data?.error || 'Erro ao enviar OTP');
            }

            const confirmation = {
                verificationId: response.data.verificationId,
                isCustomOtp: true
            };

            if (onVerificationSent) {
                onVerificationSent(confirmation, fullPhoneNumber, false);
            }
        } catch (error) {
            Logger.error("Erro no handleContinue:", error);
            const friendlyError = toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Nao foi possivel concluir a autenticacao agora. Tente novamente.'
            });

            Alert.alert(
                resolveAuthAlertTitle(error, friendlyError.message),
                friendlyError.message
            );
        } finally {
            setLoading(false);
            setChecking(false);
        }
    };

    const handlePasswordLogin = async () => {
        if (phoneNumber.length < 10) {
            Alert.alert('Erro', 'Informe seu telefone para entrar com senha.');
            return;
        }

        const fullPhoneNumber = `+55${phoneNumber}`;
        onPasswordLoginRequested?.(fullPhoneNumber);
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Bem-vindo(a) à Leaf</Text>
                <Text style={styles.subtitle}>
                    Digite seu número de telefone para continuar
                </Text>
            </View>

            <View style={styles.contentCard}>
                <View style={styles.inputContainer}>
                    <TouchableOpacity style={styles.countrySelector}>
                        <Text style={styles.countryCode}>+55</Text>
                    </TouchableOpacity>

                    <TextInput
                        testID="auth-phone-input"
                        placeholder="Número"
                        placeholderTextColor={color.textMuted}
                        keyboardType="phone-pad"
                        value={phoneNumber}
                        onChangeText={setPhoneNumber}
                        maxLength={11}
                        editable={!loading && !checking}
                        returnKeyType="done"
                        onSubmitEditing={handleContinue}
                        blurOnSubmit={false}
                        style={styles.input}
                    />
                </View>
            </View>

            <View style={styles.footer}>
                <ContinueButton
                    testID="auth-continue-btn"
                    accessibilityLabel="auth-continue-btn"
                    onPress={handleContinue}
                    text={loading || checking ? 'Continuando...' : 'Continuar'}
                    disabled={phoneNumber.length < 10}
                    style={styles.continueButton}
                />

                <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={handlePasswordLogin}
                    disabled={loading || checking || phoneNumber.length < 10}
                    style={styles.passwordLoginButton}
                >
                    <Text style={styles.passwordLoginButtonText}>Já tenho senha</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={() => onSwitchToRegister?.(phoneNumber)}
                    disabled={loading || checking}
                    style={styles.registerButton}
                >
                    <Text style={styles.registerButtonText}>Não tem conta? Cadastre-se</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        justifyContent: 'flex-start'
    },
    header: {
        marginTop: spacing.xs,
        marginBottom: spacing.md
    },
    title: {
        marginBottom: spacing.xs,
        color: color.textPrimary,
        fontSize: 20,
        lineHeight: 26,
        fontFamily: fonts.SemiBold,
        textAlign: 'center'
    },
    subtitle: {
        marginBottom: 0,
        color: color.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        fontFamily: fonts.Regular,
        textAlign: 'center'
    },
    contentCard: {
        paddingHorizontal: 2,
        marginTop: spacing.md,
        marginBottom: spacing.lg
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.84)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.92)',
        borderRadius: radius.pill,
        paddingRight: spacing.sm,
        minHeight: 58,
        shadowColor: '#0E1522',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
        elevation: 8
    },
    countrySelector: {
        paddingHorizontal: spacing.sm,
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: 'rgba(15,23,34,0.08)',
        height: 58
    },
    countryCode: {
        marginTop: 1,
        color: color.textPrimary,
        fontSize: 16,
        lineHeight: 20,
        fontFamily: fonts.SemiBold
    },
    input: {
        flex: 1,
        height: 58,
        paddingHorizontal: spacing.sm,
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: 0.2,
        color: color.textPrimary,
        fontFamily: fonts.Medium
    },
    footer: {
        marginTop: spacing.md
    },
    continueButton: {
        marginBottom: spacing.xs
    },
    passwordLoginButton: {
        marginTop: 2,
        alignSelf: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs
    },
    passwordLoginButtonText: {
        color: color.textPrimary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.SemiBold,
        textDecorationLine: 'underline'
    },
    registerButton: {
        marginTop: 4,
        alignSelf: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs
    },
    registerButtonText: {
        color: color.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontFamily: fonts.SemiBold
    }
});

export default PhoneInputStep;
