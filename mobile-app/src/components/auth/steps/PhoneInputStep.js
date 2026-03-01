import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { auth } from '../../../firebase';
import { isReviewAccount, getReviewAccountInfo } from '../../../config/reviewAccounts';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import Logger from '../../../utils/Logger';
import UserAuthService from '../../../services/UserAuthService';
import { Constants } from 'expo-constants';

const colors = {
    primary: '#003002',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5'
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
            <Text style={styles.title}>Bem-vindo ao Leaf</Text>
            <Text style={styles.subtitle}>Digite seu número de telefone para continuar</Text>

            <View style={styles.inputContainer}>
                <TouchableOpacity style={styles.countrySelector}>
                    <Text style={styles.countryCode}>+55</Text>
                </TouchableOpacity>

                <TextInput
                    style={styles.input}
                    placeholder="Número de telefone"
                    keyboardType="phone-pad"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    maxLength={11}
                    editable={!loading && !checking}
                />
            </View>

            <TouchableOpacity
                style={[styles.continueButton, (loading || checking) && styles.continueButtonDisabled]}
                onPress={handleContinue}
                disabled={loading || checking}
            >
                <Text style={[styles.continueButtonText, (loading || checking) && styles.continueButtonTextDisabled]}>
                    {loading ? 'Enviando...' : checking ? 'Verificando...' : 'Continuar'}
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.registerButton}
                onPress={onSwitchToRegister}
                disabled={loading || checking}
            >
                <Text style={styles.registerText}>Não tem conta? Cadastre-se</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        justifyContent: 'center',
        backgroundColor: colors.white,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 10,
        color: colors.primary,
    },
    subtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 30,
        color: '#666',
    },
    inputContainer: {
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        marginBottom: 20,
        backgroundColor: colors.lightGrey,
    },
    countrySelector: {
        paddingHorizontal: 15,
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: '#ddd',
    },
    countryCode: {
        fontSize: 16,
        color: colors.primary,
        fontWeight: 'bold',
    },
    input: {
        flex: 1,
        padding: 15,
        fontSize: 16,
    },
    continueButton: {
        backgroundColor: colors.primary,
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
        marginBottom: 15,
    },
    continueButtonDisabled: {
        backgroundColor: '#ccc',
    },
    continueButtonText: {
        color: colors.white,
        fontSize: 16,
        fontWeight: 'bold',
    },
    continueButtonTextDisabled: {
        color: '#999',
    },
    registerButton: {
        alignItems: 'center',
        padding: 10,
    },
    registerText: {
        color: colors.primary,
        fontSize: 14,
    },
});

export default PhoneInputStep;
