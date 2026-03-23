import React, { useState } from 'react';
import { View, TouchableOpacity, Alert as NativeAlert, StyleSheet, Text, TextInput } from 'react-native';
import auth from '@react-native-firebase/auth';
import { fonts } from '../../../common-local/font';
import { isReviewAccount, getReviewAccountInfo } from '../../../config/reviewAccounts';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import Logger from '../../../utils/Logger';
import Constants from 'expo-constants';
import onboardingTheme from '../common/onboardingTheme';
import ContinueButton from '../common/ContinueButton';
import { toUserFriendlyMessage } from '../../../utils/friendlyErrorMessages';

const { color, radius, spacing } = onboardingTheme;

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

const PhoneInputStep = ({ onSwitchToRegister, onVerificationSent }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);

    const IS_REVIEW_ENV = Constants.expoConfig?.extra?.isReview === true;
    const ENABLE_CUSTOM_OTP_FALLBACK =
        Constants.expoConfig?.extra?.enableCustomOtpFallback === true ||
        IS_REVIEW_ENV ||
        __DEV__;

    const requestOtpWithFallback = async (fullPhoneNumber) => {
        const { api } = require('../../../common-local/api');
        const endpoints = [
            '/api/custom-otp/request-otp',
            '/custom-otp/request-otp'
        ];

        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                return await api.post(endpoint, { phone: fullPhoneNumber });
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

            // ✅ BYPASS PARA CONTAS DE REVIEW
            // IMPORTANTE: Bypass só funciona se IS_REVIEW_ENV for true
            if (isReviewAccount(phoneNumber)) {
                // ✅ Verificar se bypass está habilitado
                if (!IS_REVIEW_ENV && !__DEV__) {
                    Logger.warn('🚫 Bypass de OTP bloqueado: ambiente de produção detectado');
                    // Continuar com fluxo normal de OTP
                } else {
                    const reviewAccount = getReviewAccountInfo(phoneNumber);
                    Logger.log('🔐 REVIEW ACCESS: Conta de review detectada - pulando OTP', {
                        phoneNumber,
                        userType: reviewAccount?.userType,
                        isReviewEnv: IS_REVIEW_ENV,
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
                                // Aceitar OTP fixo 000000 para contas de review
                                if (otpCode === '000000') {
                                    Logger.log('✅ OTP fixo 000000 aceito para conta de review.');
                                    return { user: reviewUser };
                                }
                                throw new Error('Código OTP inválido para conta de review.');
                            }
                        };
                        // ✅ Passar skipOTP=true apenas se bypass estiver habilitado
                        onVerificationSent(reviewConfirmation, fullPhoneNumber, false, IS_REVIEW_ENV || __DEV__);
                    }

                    setLoading(false);
                    setChecking(false);
                    return;
                }
            }

            // 📱 Fluxo principal: Firebase Phone Auth (produção)
            Logger.log('📱 Enviando OTP via Firebase Auth...');
            try {
                const firebaseConfirmation = await auth().signInWithPhoneNumber(fullPhoneNumber);
                if (onVerificationSent) {
                    onVerificationSent(firebaseConfirmation, fullPhoneNumber, false);
                }
                return;
            } catch (firebaseError) {
                Logger.error('❌ Falha no envio OTP via Firebase:', firebaseError);
                if (!ENABLE_CUSTOM_OTP_FALLBACK) {
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

            // ✅ Mensagens de erro específicas e humanas
            let errorTitle = 'Erro de Autenticação';
            let errorMessage = 'Não foi possível verificar o número. Verifique se ele está correto e tente novamente.';

            if (error.message) {
                if (error.message.includes('Muitas tentativas') || error.message.includes('rate limit')) {
                    errorTitle = 'Limite de Tentativas';
                    errorMessage = 'Você excedeu o limite de tentativas. Por favor, aguarde alguns minutos antes de tentar novamente.';
                } else if (error.message.includes('invalid') || error.message.includes('inválido')) {
                    errorMessage = 'Número de telefone inválido. Verifique se o número está correto e tente novamente.';
                } else if (error.message.includes('network') || error.message.includes('rede') || error.message.includes('connection')) {
                    errorMessage = 'Erro de conexão. Verifique sua internet e tente novamente.';
                } else if (error.message.includes('quota') || error.message.includes('cota')) {
                    errorMessage = 'Limite de SMS atingido. Tente novamente mais tarde.';
                } else if (error.message.includes('timeout')) {
                    errorMessage = 'Tempo limite excedido. Verifique sua conexão e tente novamente.';
                } else {
                    errorMessage = `Erro: ${error.message}`;
                }
            }

            Alert.alert(errorTitle, errorMessage);
        } finally {
            setLoading(false);
            setChecking(false);
        }
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
        backgroundColor: color.panelSoft,
        borderWidth: 1,
        borderColor: color.glassStroke,
        borderRadius: radius.lg,
        padding: spacing.sm,
        shadowColor: '#0E1522',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 9,
        marginBottom: spacing.md
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: color.surfaceMuted,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        paddingRight: 4,
        minHeight: 48
    },
    countrySelector: {
        paddingHorizontal: spacing.sm,
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: color.border,
        height: 48
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
        height: 48,
        paddingHorizontal: spacing.sm,
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: 0.2,
        color: color.textPrimary,
        fontFamily: fonts.Medium
    },
    footer: {
        marginTop: spacing.sm
    },
    continueButton: {
        marginBottom: spacing.xs
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
