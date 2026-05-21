import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from "react";
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    Alert
} from "react-native";
import { TextInputMask } from 'react-native-masked-text';
import rnauth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingLayout from '../components/OnboardingLayout';
import { fonts } from '../theme/runtimeTokens';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, radius, spacing } = onboardingTheme;

export default function OTPScreen({ navigation, route }) {
    const [otp, setOtp] = useState("");
    const [timer, setTimer] = useState(59);
    const [canResend, setCanResend] = useState(false);
    const { phone, verificationId } = route.params || {};
    const [userType, setUserType] = React.useState(route?.params?.userType || null);

    // Guardar referência do timer para poder limpar manualmente
    const timerRef = useRef();

    useEffect(() => {
        if (timer > 0) {
            timerRef.current = setInterval(() => {
                setTimer((prev) => prev - 1);
            }, 1000);
        } else {
            setCanResend(true);
        }
        
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [timer]);

    useEffect(() => {
        if (!userType) {
            AsyncStorage.getItem('@user_type').then(type => {
                if (type) setUserType(type);
            });
        }
    }, []);

    const handleContinue = async () => {
        if (!otp || otp.replace(/\D/g, '').length !== 6) {
            Alert.alert('Atenção', 'Digite o código de 6 dígitos que enviamos por SMS.');
            return;
        }

        try {
            // Limpar o timer antes de prosseguir
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            
            Logger.log('Iniciando verificação do OTP...');
            const credential = rnauth.PhoneAuthProvider.credential(verificationId, otp.replace(/\D/g, ''));
            
            Logger.log('Credencial criada, tentando autenticar...');
            const userCredential = await rnauth().signInWithCredential(credential);
            
            Logger.log('Autenticação bem sucedida:', userCredential);
            
            // Se o usuário já existe, vamos para o Map
            if (route.params?.isExistingUser) {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Map' }]
                });
                return;
            }
            
            // Se é um novo usuário, vamos para a tela de complemento de dados
            navigation.reset({
                index: 0,
                routes: [{ 
                    name: 'CompleteRegistration',
                    params: { 
                        phone: userCredential.user.phoneNumber,
                        userCredential: {
                            uid: userCredential.user.uid,
                            phoneNumber: userCredential.user.phoneNumber,
                            isNewUser: true
                        },
                        userType: route.params?.userType // garantir propagação
                    }
                }]
            });
        } catch (error) {
            Logger.error('Erro na verificação do OTP:', error);
            Alert.alert('Código não confirmado', 'Não conseguimos confirmar esse código. Verifique e tente novamente.');
        }
    };

    const handleResend = async () => {
        if (!canResend) return;
        
        try {
            // Limpar o timer atual antes de reiniciar
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            
            setTimer(59);
            setCanResend(false);
            
            const auth = rnauth();
            const confirmation = await auth.verifyPhoneNumber(phone);
            
            if (confirmation && confirmation.verificationId) {
                // Atualizar o verificationId se necessário
                // setVerificationId(confirmation.verificationId);
                Logger.log('Novo código enviado com sucesso');
            }
        } catch (error) {
            Logger.error('Erro ao reenviar código:', error);
            Alert.alert('Erro', 'Não foi possível enviar um novo código. Tente novamente.');
            setCanResend(true);
        }
    };

    // Limpar o timer quando o componente for desmontado
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, []);

    // Barra de progresso customizada
    const progressBar = (
        <View style={styles.progressBarContainer}>
            <View style={styles.progressDot} />
            <View style={styles.progressDot} />
            <View style={[styles.progressDot, styles.progressActive]} />
            <View style={styles.progressDot} />
        </View>
    );

    const isOtpValid = otp.replace(/\D/g, '').length === 6;

    return (
        <OnboardingLayout
            progress={progressBar}
            onContinue={handleContinue}
            continueLabel="Confirmar"
            continueDisabled={!isOtpValid}
        >
            <View style={styles.container}>
                <Text style={styles.title}>
                    Confira seu SMS
                </Text>
                <Text style={styles.subtitle}>
                    Enviamos um código de 6 dígitos para confirmar seu celular.
                </Text>
                
                <View style={styles.otpContainer}>
                    <Text style={styles.otpLabel}>Código recebido</Text>
                    <TextInputMask
                        type={'custom'}
                        options={{ mask: '9 9 9 9 9 9' }}
                        value={otp}
                        onChangeText={setOtp}
                        style={styles.otpInput}
                        placeholder="_ _ _ _ _ _"
                        placeholderTextColor={color.textMuted}
                        keyboardType="number-pad"
                        maxLength={11}
                        autoFocus
                    />
                </View>
                
                <TouchableOpacity
                    style={[styles.resendButton, { opacity: canResend ? 1 : 0.5 }]}
                    onPress={handleResend}
                    disabled={!canResend}
                >
                    <Text style={styles.resendButtonText}>
                        {canResend ? 'Enviar novamente' : `Novo código em ${timer}s`}
                    </Text>
                </TouchableOpacity>
                
                <Text style={styles.infoText}>
                    Se não chegou, confira o número ou tente enviar novamente.
                </Text>
            </View>
        </OnboardingLayout>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingTop: spacing.sm
    },
    title: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        color: color.textPrimary,
        marginBottom: 8,
        textAlign: 'center'
    },
    subtitle: {
        fontSize: 16,
        color: color.textSecondary,
        marginBottom: spacing.md,
        textAlign: 'center',
        lineHeight: 22
    },
    otpContainer: {
        width: '100%',
        marginBottom: spacing.md,
        backgroundColor: color.panel,
        borderWidth: 1,
        borderColor: color.borderStrong,
        borderRadius: radius.lg,
        padding: spacing.md
    },
    otpLabel: {
        fontSize: 16,
        fontFamily: fonts.SemiBold,
        color: color.textPrimary,
        marginBottom: 8
    },
    otpInput: {
        fontSize: 24,
        color: color.textPrimary,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        paddingVertical: 12,
        paddingHorizontal: 10,
        backgroundColor: color.surfaceMuted,
        textAlign: 'center',
        letterSpacing: 8
    },
    resendButton: {
        marginBottom: spacing.sm
    },
    resendButtonText: {
        fontSize: 15,
        color: color.textPrimary,
        fontFamily: fonts.SemiBold,
        textAlign: 'center'
    },
    infoText: {
        fontSize: 14,
        color: color.textSecondary,
        textAlign: 'center',
        lineHeight: 20
    },
    progressBarContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 0,
    },
    progressDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: color.borderStrong,
        marginHorizontal: 4
    },
    progressActive: {
        backgroundColor: color.accent
    }
});
