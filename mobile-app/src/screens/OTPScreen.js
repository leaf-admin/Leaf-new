import React, { useState, useEffect, useRef } from "react";
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    StatusBar,
    Alert
} from "react-native";
import { TextInputMask } from 'react-native-masked-text';
import { Ionicons } from '@expo/vector-icons';
import rnauth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingLayout from '../components/OnboardingLayout';

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
            alert('Digite o código de 6 dígitos recebido por SMS.');
            return;
        }

        try {
            // Limpar o timer antes de prosseguir
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            
            console.log('Iniciando verificação do OTP...');
            const credential = rnauth.PhoneAuthProvider.credential(verificationId, otp.replace(/\D/g, ''));
            
            console.log('Credencial criada, tentando autenticar...');
            const userCredential = await rnauth().signInWithCredential(credential);
            
            console.log('Autenticação bem sucedida:', userCredential);
            
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
                    name: 'UserInfo',
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
            alert('Erro ao reenviar código. Tente novamente.');
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

    // Ao avançar para cadastro final:
    const handleCompleteRegistration = (otpData) => {
        navigation.navigate('CompleteRegistration', { ...otpData, userType });
    };

    // Barra de progresso customizada
    const progressBar = (
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 0 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#1A330E', marginHorizontal: 4 }} />
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#1A330E', marginHorizontal: 4 }} />
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#B0B0B0', marginHorizontal: 4 }} />
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#B0B0B0', marginHorizontal: 4 }} />
      </View>
    );

    return (
      <OnboardingLayout
        progress={progressBar}
        onContinue={handleContinue}
        continueLabel="Continuar"
        continueDisabled={!otp || otp.replace(/\D/g, '').length !== 6}
      >
        {/* Conteúdo principal da tela (instruções, input de código, botão de reenviar) */}
        <Text style={[styles.titleCustom, { marginBottom: 16, marginTop: 0 }]}>Insira abaixo o código recebido por SMS</Text>
        <View style={[styles.inputRow, { marginTop: 0 }]}> 
          <TextInputMask
            type={'custom'}
            options={{ mask: '9 9 9 9 9 9' }}
            value={otp}
            onChangeText={setOtp}
            style={[styles.otpInput, { textAlign: 'left' }]}
            placeholder="_ _ _ _ _ _"
            placeholderTextColor="#B0B0B0"
            keyboardType="number-pad"
            maxLength={11}
          />
        </View>
        <TouchableOpacity
          style={[styles.resendButton, { opacity: canResend ? 1 : 0.5, marginTop: 24 }]}
          onPress={handleResend}
          disabled={!canResend}
        >
          <Text style={styles.resendButtonText}>
            {canResend ? 'Reenviar' : `Reenviar (${timer}s)`}
          </Text>
        </TouchableOpacity>
      </OnboardingLayout>
    );
}

const styles = StyleSheet.create({
    containerCustom: {
        flex: 1,
        backgroundColor: '#F5F5F5',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    backButton: {
        position: 'absolute',
        top: 50,
        left: 16,
        zIndex: 10,
    },
    titleCustom: {
        color: '#1A330E',
        fontSize: 32,
        fontWeight: 'bold',
        marginBottom: 32,
        marginTop: 100,
        textAlign: 'left',
        alignSelf: 'flex-start',
        marginLeft: 0,
        paddingRight: 24,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        width: '100%',
        justifyContent: 'center',
    },
    otpInput: {
        flex: 1,
        color: '#1A330E',
        fontSize: 32,
        borderBottomWidth: 0,
        backgroundColor: '#F5F5F5',
        paddingVertical: 8,
        letterSpacing: 16,
        textAlign: 'center',
    },
    buttonCustom: {
        backgroundColor: '#2A4A1E',
        borderRadius: 8,
        paddingVertical: 16,
        width: 215,
        alignItems: 'center',
        alignSelf: 'center',
        marginBottom: 16,
    },
    buttonTextCustom: {
        color: '#F5F5F5',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    resendButton: {
        marginTop: 0,
        marginBottom: 8,
    },
    resendButtonText: {
        color: '#1A330E',
        fontSize: 16,
        fontWeight: 'bold',
        textAlign: 'center',
    },
}); 