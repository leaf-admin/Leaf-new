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

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

export default function OTPScreen({ navigation, route }) {
    const [otp, setOtp] = useState("");
    const [timer, setTimer] = useState(59);
    const [canResend, setCanResend] = useState(false);
    const { phone, verificationId, isTestMode = false } = route.params || {};
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
            Alert.alert('Atenção', 'Digite o código de 6 dígitos recebido por SMS.');
            return;
        }

        try {
            // Limpar o timer antes de prosseguir
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            
            console.log('🔍 Iniciando verificação do OTP...');
            console.log('📱 Telefone:', phone);
            console.log('🆔 VerificationId:', verificationId);
            console.log('🔢 OTP digitado:', otp.replace(/\D/g, ''));
            
            // Em desenvolvimento, usar código de teste se disponível
            const otpCode = __DEV__ ? '123456' : otp.replace(/\D/g, '');
            console.log('🔑 Código final usado:', otpCode);
            
            const credential = rnauth.PhoneAuthProvider.credential(verificationId, otpCode);
            
            console.log('🔐 Credencial criada, tentando autenticar...');
            const userCredential = await rnauth().signInWithCredential(credential);
            
            console.log('✅ Autenticação bem sucedida:', userCredential);
            
            // Se o usuário já existe, vamos para o Map
            if (route.params?.isExistingUser) {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'TabRoot' }]
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
            console.error('Erro na verificação do OTP:', error);
            Alert.alert('Erro', 'Código inválido ou expirado. Tente novamente.');
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
                console.log('Novo código enviado com sucesso');
            }
        } catch (error) {
            console.error('Erro ao reenviar código:', error);
            Alert.alert('Erro', 'Erro ao reenviar código. Tente novamente.');
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
            continueLabel="Verificar código"
            continueDisabled={!isOtpValid}
        >
            <View style={styles.container}>
                <Text style={styles.title}>
                    {userType === 'driver' ? 'Verificação de Parceiro' : 'Verificação de Passageiro'}
                </Text>
                <Text style={styles.subtitle}>
                    Digite o código de 6 dígitos enviado para seu telefone
                </Text>
                
                {isTestMode && (
                    <View style={styles.testModeContainer}>
                        <Text style={styles.testModeText}>
                            🧪 Número de Teste
                        </Text>
                        <Text style={styles.testModeSubtext}>
                            Use o código configurado no Firebase Console
                        </Text>
                        <Text style={styles.testModeCode}>
                            Código padrão: 123456
                        </Text>
                    </View>
                )}
                
                <View style={styles.otpContainer}>
                    <Text style={styles.otpLabel}>Código de verificação</Text>
                    <TextInputMask
                        type={'custom'}
                        options={{ mask: '9 9 9 9 9 9' }}
                        value={otp}
                        onChangeText={setOtp}
                        style={styles.otpInput}
                        placeholder="_ _ _ _ _ _"
                        placeholderTextColor={LEAF_GRAY}
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
                        {canResend ? 'Reenviar código' : `Reenviar em ${timer}s`}
                    </Text>
                </TouchableOpacity>
                
                <Text style={styles.infoText}>
                    Não recebeu o código? Verifique se o número está correto
                </Text>
            </View>
        </OnboardingLayout>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: 48,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: LEAF_GREEN,
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 16,
        color: LEAF_GRAY,
        marginBottom: 32,
        textAlign: 'center',
        lineHeight: 22,
    },
    otpContainer: {
        width: '100%',
        marginBottom: 32,
    },
    otpLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: LEAF_GREEN,
        marginBottom: 8,
    },
    otpInput: {
        fontSize: 24,
        color: LEAF_GREEN,
        borderBottomWidth: 2,
        borderBottomColor: LEAF_GRAY,
        paddingVertical: 12,
        paddingHorizontal: 0,
        textAlign: 'center',
        letterSpacing: 8,
    },
    resendButton: {
        marginBottom: 24,
    },
    resendButtonText: {
        fontSize: 16,
        color: LEAF_GREEN,
        fontWeight: '600',
        textAlign: 'center',
    },
    infoText: {
        fontSize: 14,
        color: LEAF_GRAY,
        textAlign: 'center',
        lineHeight: 20,
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
        backgroundColor: LEAF_GRAY,
        marginHorizontal: 4,
    },
    progressActive: {
        backgroundColor: LEAF_GREEN,
    },
    testModeContainer: {
        backgroundColor: '#FFF3CD',
        borderWidth: 1,
        borderColor: '#FFEAA7',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        alignItems: 'center',
    },
    testModeText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#856404',
        marginBottom: 4,
    },
    testModeSubtext: {
        fontSize: 12,
        color: '#856404',
        fontWeight: '600',
    },
    testModeCode: {
        fontSize: 14,
        color: '#856404',
        fontWeight: 'bold',
        marginTop: 4,
    },
}); 