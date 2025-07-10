import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import OnboardingLayout from '../components/OnboardingLayout';

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

export default function UserInfoScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const [phone, setPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Pegar o tipo de usuário dos parâmetros ou do AsyncStorage
    const userType = route.params?.userType || 'passenger';

    // Função para formatar o telefone no padrão brasileiro
    const formatPhoneNumber = (text) => {
        // Remove tudo que não é número
        const numbers = text.replace(/\D/g, '');
        
        // Aplica a máscara XX XXXXX-XXXX
        if (numbers.length <= 2) {
            return numbers;
        } else if (numbers.length <= 7) {
            return `${numbers.slice(0, 2)} ${numbers.slice(2)}`;
        } else {
            return `${numbers.slice(0, 2)} ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
        }
    };

    const handlePhoneChange = (text) => {
        const formatted = formatPhoneNumber(text);
        setPhone(formatted);
    };

    const handleSendOTP = async () => {
        // Validar se tem pelo menos DDD + número (10 dígitos)
        const phoneDigits = phone.replace(/\D/g, '');
        if (!phone || phoneDigits.length < 10) {
            Alert.alert('Atenção', 'Digite um número de telefone válido com DDD.');
            return;
        }

        try {
            setIsLoading(true);
            
            // Aqui você implementaria a lógica de envio do OTP
            // Por enquanto, vamos simular o envio
            console.log('Enviando OTP para: +55', phone);
            console.log('Tipo de usuário:', userType);
            
            // Simular delay de envio
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Navegar para a tela de OTP com o telefone completo (+55 + número)
            navigation.navigate('OTP', { 
                phone: '+55' + phoneDigits,
                userType: userType 
            });
            
        } catch (error) {
            console.error('Erro ao enviar OTP:', error);
            Alert.alert('Erro', 'Não foi possível enviar o código de verificação.');
        } finally {
            setIsLoading(false);
        }
    };

    // Barra de progresso customizada
    const progressBar = (
        <View style={styles.progressBarContainer}>
            <View style={styles.progressDot} />
            <View style={[styles.progressDot, styles.progressActive]} />
            <View style={styles.progressDot} />
            <View style={styles.progressDot} />
        </View>
    );

    const isPhoneValid = phone.replace(/\D/g, '').length >= 10;

    return (
        <OnboardingLayout
            progress={progressBar}
            onContinue={handleSendOTP}
            continueLabel="Enviar código"
            continueDisabled={!isPhoneValid || isLoading}
        >
            <View style={styles.container}>
                <Text style={styles.title}>
                    {userType === 'driver' ? 'Cadastro de Parceiro' : 'Cadastro de Passageiro'}
                </Text>
                <Text style={styles.subtitle}>
                    Digite seu número de telefone para receber um código de verificação
                </Text>
                
                <View style={styles.phoneContainer}>
                    <Text style={styles.phoneLabel}>Número de telefone</Text>
                    <View style={styles.phoneInputContainer}>
                        <Text style={styles.countryCode}>+55</Text>
                        <TextInput
                            value={phone}
                            onChangeText={handlePhoneChange}
                            style={styles.phoneInput}
                            placeholder="11 99999-9999"
                            placeholderTextColor={LEAF_GRAY}
                            keyboardType="phone-pad"
                            maxLength={14} // XX XXXXX-XXXX = 14 caracteres
                            autoFocus
                        />
                    </View>
                </View>
                
                <Text style={styles.infoText}>
                    Enviaremos um código de verificação por SMS para este número
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
    phoneContainer: {
        width: '100%',
        marginBottom: 24,
    },
    phoneLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: LEAF_GREEN,
        marginBottom: 8,
    },
    phoneInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: LEAF_GRAY,
        paddingVertical: 12,
        paddingHorizontal: 0,
    },
    countryCode: {
        fontSize: 18,
        color: LEAF_GREEN,
        marginRight: 8,
    },
    phoneInput: {
        fontSize: 18,
        color: LEAF_GREEN,
        flex: 1,
        paddingVertical: 0,
        paddingHorizontal: 0,
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
}); 