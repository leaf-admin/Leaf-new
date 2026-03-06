import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Typography } from '../../design-system/Typography';
import { AnimatedButton } from '../../design-system/AnimatedButton';
import { AnimatedInput } from '../../design-system/AnimatedInput';
import { auth } from '../../../firebase';
import { isReviewAccount, getReviewAccountInfo } from '../../../config/reviewAccounts';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import Logger from '../../../utils/Logger';
import UserAuthService from '../../../services/UserAuthService';
import Constants from 'expo-constants';

const colors = {
    primary: '#1A330E',
    white: '#FFFFFF',
    lightGrey: '#F9F9F9',
    text: { primary: '#1C1C1E', secondary: '#8E8E93' },
    border: '#E5E5EA'
};

const PhoneInputStep = ({ onSwitchToRegister, onVerificationSent, onUserExists }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);

    const IS_REVIEW_ENV = Constants.expoConfig?.extra?.isReview === true;

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

            // 📱 ENVIAR OTP PARA CADASTRO NORMAL
            Logger.log('📱 Enviando OTP via Custom API...');

            // Usando API Local em vez de Firebase Auth para envio do OTP
            const { api } = require('../../../common-local/api');
            const response = await api.post('/custom-otp/request-otp', {
                phone: fullPhoneNumber
            });

            if (response.data && response.data.success) {
                const confirmation = {
                    verificationId: response.data.verificationId,
                    isCustomOtp: true
                };

                // Sucesso! Notifica o componente pai para avançar.
                if (onVerificationSent) {
                    onVerificationSent(confirmation, fullPhoneNumber, false);
                }
            } else {
                throw new Error(response.data?.error || 'Erro ao enviar OTP');
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
                <Typography variant="h1" align="center" style={styles.title}>Bem-vindo(a) à Leaf</Typography>
                <Typography variant="body" color={colors.text.secondary} align="center" style={styles.subtitle}>
                    Digite seu número de telefone para continuar
                </Typography>
            </View>

            <View style={styles.inputContainer}>
                <TouchableOpacity style={styles.countrySelector}>
                    <Typography variant="h3" color={colors.primary} style={styles.countryCode}>+55</Typography>
                </TouchableOpacity>

                <AnimatedInput
                    testID="auth-phone-input"
                    placeholder="Número"
                    keyboardType="phone-pad"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    maxLength={11}
                    editable={!loading && !checking}
                    returnKeyType="done"
                    onSubmitEditing={handleContinue}
                    blurOnSubmit={false}
                    containerStyle={{ flex: 1, marginBottom: 0 }}
                    style={styles.input}
                />
            </View>

            <View style={styles.footer}>
                <AnimatedButton
                    testID="auth-continue-btn"
                    accessibilityLabel="auth-continue-btn"
                    title="Continuar"
                    onPress={handleContinue}
                    loading={loading || checking}
                    disabled={phoneNumber.length < 10}
                    style={styles.continueButton}
                />

                <AnimatedButton
                    title="Não tem conta? Cadastre-se"
                    variant="ghost"
                    onPress={onSwitchToRegister}
                    disabled={loading || checking}
                    style={styles.registerButton}
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 24,
        paddingBottom: 40,
        backgroundColor: colors.white,
        justifyContent: 'space-between',
    },
    header: {
        marginTop: 24,
    },
    title: {
        marginBottom: 8,
    },
    subtitle: {
        marginBottom: 32,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 32,
        backgroundColor: colors.lightGrey,
        borderRadius: 16,
        paddingRight: 4,
    },
    countrySelector: {
        paddingHorizontal: 20,
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: colors.border,
        height: 56,
    },
    countryCode: {
        marginTop: 2, // optical alignment
    },
    input: {
        fontSize: 18,
        letterSpacing: 1,
    },
    footer: {
        marginTop: 'auto',
    },
    continueButton: {
        marginBottom: 8,
    },
    registerButton: {
        marginTop: 4,
    }
});

export default PhoneInputStep;
