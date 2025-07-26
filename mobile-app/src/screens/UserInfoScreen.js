import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform, PermissionsAndroid } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import OnboardingLayout from '../components/OnboardingLayout';
import * as Device from 'expo-device';
import DeviceInfo from 'react-native-device-info';
import rnauth from '@react-native-firebase/auth';
// testPhoneDetection removido - arquivo não existe

const LEAF_GREEN = '#1A330E';
const LEAF_GRAY = '#B0B0B0';

export default function UserInfoScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const [phone, setPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isDetectingPhone, setIsDetectingPhone] = useState(false);
    
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

    // Função para detectar automaticamente o número do telefone
    const detectPhoneNumber = async () => {
        setIsDetectingPhone(true);
        
        try {
            let detectedNumber = null;
            
            // Verificar se é um dispositivo físico
            const isEmulator = await DeviceInfo.isEmulator();
            if (isEmulator) {
                throw new Error('Emulador detectado');
            }
            
            // Verificar permissões no Android
            if (Platform.OS === 'android') {
                try {
                    const granted = await PermissionsAndroid.request(
                        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
                        {
                            title: 'Permissão necessária',
                            message: 'Precisamos de permissão para detectar o número do seu telefone.',
                            buttonNeutral: 'Perguntar depois',
                            buttonNegative: 'Cancelar',
                            buttonPositive: 'OK',
                        }
                    );
                    
                    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                        throw new Error('Permissão negada');
                    }
                } catch (error) {
                    console.log('Erro ao solicitar permissão:', error);
                }
            }
            
            // MÉTODO 1: getPhoneNumber do DeviceInfo (PRINCIPAL)
            try {
                console.log('🔍 MÉTODO 1 - Tentando DeviceInfo.getPhoneNumber...');
                if (typeof DeviceInfo.getPhoneNumber === 'function') {
                    const phoneNumber = await DeviceInfo.getPhoneNumber();
                    console.log('📱 PhoneNumber do DeviceInfo:', phoneNumber);
                    
                    if (phoneNumber && 
                        phoneNumber !== 'unknown' && 
                        phoneNumber !== 'null' && 
                        phoneNumber !== 'undefined' &&
                        phoneNumber.length > 0) {
                        detectedNumber = phoneNumber;
                        console.log('✅ Número detectado via DeviceInfo:', detectedNumber);
                    }
                }
            } catch (error) {
                console.log('❌ Erro no MÉTODO 1:', error);
            }
            
            // MÉTODO 2: Tentar outras APIs do DeviceInfo
            if (!detectedNumber) {
                try {
                    console.log('🔍 MÉTODO 2 - Verificando outras APIs do DeviceInfo...');
                    
                    // Tentar obter informações do dispositivo
                    const deviceId = await DeviceInfo.getUniqueId();
                    const brand = await DeviceInfo.getBrand();
                    const model = await DeviceInfo.getModel();
                    const systemVersion = await DeviceInfo.getSystemVersion();
                    const carrier = await DeviceInfo.getCarrier();
                    
                    console.log('📱 Device Info:', { deviceId, brand, model, systemVersion, carrier });
                    
                    // Verificar se há outras APIs disponíveis
                    const availableMethods = Object.getOwnPropertyNames(DeviceInfo);
                    const phoneMethods = availableMethods.filter(name => 
                        name.includes('Phone') || 
                        name.includes('Sim') || 
                        name.includes('Carrier') ||
                        name.includes('Telephony')
                    );
                    console.log('📱 APIs de telefone disponíveis:', phoneMethods);
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 2:', error);
                }
            }
            
            // MÉTODO 3: Tentar outras APIs do DeviceInfo
            if (!detectedNumber) {
                try {
                    console.log('🔍 MÉTODO 3 - Verificando outras APIs do DeviceInfo...');
                    
                    // Tentar obter informações do dispositivo
                    const deviceId = await DeviceInfo.getUniqueId();
                    const brand = await DeviceInfo.getBrand();
                    const model = await DeviceInfo.getModel();
                    const systemVersion = await DeviceInfo.getSystemVersion();
                    const carrier = await DeviceInfo.getCarrier();
                    
                    console.log('📱 Device Info:', { deviceId, brand, model, systemVersion, carrier });
                    
                    // Verificar se há outras APIs disponíveis
                    const availableMethods = Object.getOwnPropertyNames(DeviceInfo);
                    const phoneMethods = availableMethods.filter(name => 
                        name.includes('Phone') || 
                        name.includes('Sim') || 
                        name.includes('Carrier') ||
                        name.includes('Telephony')
                    );
                    console.log('📱 APIs de telefone disponíveis:', phoneMethods);
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 3:', error);
                }
            }
            
            // MÉTODO 4: Tentar APIs nativas do React Native
            if (!detectedNumber && Platform.OS === 'android') {
                try {
                    console.log('🔍 MÉTODO 4 - Verificando NativeModules...');
                    
                    // Tentar usar APIs nativas do Android
                    const { NativeModules } = require('react-native');
                    console.log('📱 NativeModules disponíveis:', Object.keys(NativeModules));
                    
                    // Verificar se há módulos relacionados a telefone
                    const phoneModules = Object.keys(NativeModules).filter(name => 
                        name.toLowerCase().includes('phone') || 
                        name.toLowerCase().includes('sim') ||
                        name.toLowerCase().includes('telephony') ||
                        name.toLowerCase().includes('carrier')
                    );
                    console.log('📱 Módulos de telefone:', phoneModules);
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 4:', error);
                }
            }
            
            // MÉTODO 3: Tentar APIs nativas do React Native
            if (!detectedNumber && Platform.OS === 'android') {
                try {
                    console.log('🔍 MÉTODO 3 - Verificando NativeModules...');
                    
                    // Tentar usar APIs nativas do Android
                    const { NativeModules } = require('react-native');
                    console.log('📱 NativeModules disponíveis:', Object.keys(NativeModules));
                    
                    // Verificar se há módulos relacionados a telefone
                    const phoneModules = Object.keys(NativeModules).filter(name => 
                        name.toLowerCase().includes('phone') || 
                        name.toLowerCase().includes('sim') ||
                        name.toLowerCase().includes('telephony') ||
                        name.toLowerCase().includes('carrier')
                    );
                    console.log('📱 Módulos de telefone:', phoneModules);
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 3:', error);
                }
            }
            
            // MÉTODO 4: Tentar usar expo-device
            if (!detectedNumber) {
                try {
                    console.log('🔍 MÉTODO 4 - Verificando Expo Device...');
                    console.log('📱 Device.isDevice:', Device.isDevice);
                    console.log('📱 Device.brand:', Device.brand);
                    console.log('📱 Device.manufacturer:', Device.manufacturer);
                    console.log('📱 Device.modelName:', Device.modelName);
                    console.log('📱 Device.osVersion:', Device.osVersion);
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 4:', error);
                }
            }
            
            // MÉTODO 5: Tentar APIs nativas do Android (última tentativa)
            if (!detectedNumber && Platform.OS === 'android') {
                try {
                    console.log('🔍 MÉTODO 5 - Tentando APIs nativas do Android...');
                    
                    // Tentar usar TelephonyManager via NativeModules
                    const { NativeModules } = require('react-native');
                    
                    // Verificar se há módulos específicos para telefone
                    if (NativeModules.TelephonyModule) {
                        console.log('📱 TelephonyModule encontrado');
                        const phoneNumber = await NativeModules.TelephonyModule.getPhoneNumber();
                        if (phoneNumber) {
                            detectedNumber = phoneNumber;
                            console.log('✅ Número detectado via TelephonyModule:', detectedNumber);
                        }
                    }
                    
                    // Tentar outros módulos nativos
                    const nativeModules = Object.keys(NativeModules);
                    console.log('📱 Todos os NativeModules:', nativeModules);
                    
                    // Procurar por módulos que possam ter informações de telefone
                    for (const moduleName of nativeModules) {
                        const module = NativeModules[moduleName];
                        if (module && typeof module.getPhoneNumber === 'function') {
                            try {
                                const result = await module.getPhoneNumber();
                                if (result && result !== 'unknown') {
                                    console.log(`🎯 Número encontrado via ${moduleName}:`, result);
                                    detectedNumber = result;
                                    break;
                                }
                            } catch (error) {
                                // Ignora erros
                            }
                        }
                    }
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 5:', error);
                }
            }
            
            // MÉTODO 6: Simulação inteligente (fallback)
            if (!detectedNumber) {
                try {
                    console.log('🔍 MÉTODO 6 - Simulação inteligente...');
                    
                    // Tentar obter informações do dispositivo para simular um número realista
                    const brand = await DeviceInfo.getBrand();
                    const model = await DeviceInfo.getModel();
                    const deviceId = await DeviceInfo.getUniqueId();
                    
                    // Gerar um número baseado no deviceId para ser consistente
                    const hash = deviceId.split('').reduce((a, b) => {
                        a = ((a << 5) - a) + b.charCodeAt(0);
                        return a & a;
                    }, 0);
                    
                    // Usar o hash para gerar um número consistente para este dispositivo
                    const ddd = 11 + (Math.abs(hash) % 20); // DDD entre 11 e 30
                    const numero = 900000000 + (Math.abs(hash) % 99999999); // Número entre 900000000 e 999999999
                    
                    const simulatedNumber = `${ddd.toString().padStart(2, '0')} ${numero.toString().slice(0, 5)}-${numero.toString().slice(5)}`;
                    
                    console.log('📱 Dispositivo:', { brand, model, deviceId });
                    console.log('📱 Número simulado:', simulatedNumber);
                    
                    // Perguntar se o usuário quer usar o número simulado
                    Alert.alert(
                        'Número simulado detectado',
                        `Detectamos um número para teste: ${simulatedNumber}\n\nEste é um número simulado baseado no seu dispositivo. Deseja usar este número para teste?`,
                        [
                            { 
                                text: 'Usar para teste', 
                                onPress: () => {
                                    setPhone(simulatedNumber);
                                    console.log('✅ Usando número simulado:', simulatedNumber);
                                }
                            },
                            { 
                                text: 'Digitar manualmente', 
                                onPress: () => setPhone('') 
                            }
                        ]
                    );
                    
                    return; // Não continuar com o erro
                    
                } catch (error) {
                    console.log('❌ Erro no MÉTODO 6:', error);
                }
            }
            
            if (detectedNumber) {
                // Limpar o número detectado para remover código do país se presente
                let cleanNumber = detectedNumber;
                
                // Remove +55, 55, ou qualquer código de país se presente
                cleanNumber = cleanNumber.replace(/^\+55\s*/, ''); // Remove +55 no início
                cleanNumber = cleanNumber.replace(/^55\s*/, '');   // Remove 55 no início
                
                // Remove espaços extras e caracteres especiais
                cleanNumber = cleanNumber.trim();
                
                // Aplicar formatação brasileira
                const numbers = cleanNumber.replace(/\D/g, '');
                if (numbers.length === 11) {
                    cleanNumber = `${numbers.slice(0, 2)} ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
                } else if (numbers.length === 10) {
                    cleanNumber = `${numbers.slice(0, 2)} ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
                }
                
                setPhone(cleanNumber);
                
                Alert.alert(
                    'Número detectado!', 
                    `Detectamos o número ${cleanNumber} no seu dispositivo.`,
                    [
                        { text: 'Usar este número', onPress: () => {} },
                        { text: 'Digitar manualmente', onPress: () => setPhone('') }
                    ]
                );
            } else {
                throw new Error('Nenhum número detectado');
            }
            
        } catch (error) {
            console.error('Erro ao detectar número:', error);
            
            if (error.message === 'Emulador detectado') {
                Alert.alert(
                    'Emulador detectado', 
                    'A detecção automática não funciona em emuladores. Por favor, digite o número manualmente.',
                    [{ text: 'OK' }]
                );
            } else if (error.message === 'Permissão negada') {
                Alert.alert(
                    'Permissão negada', 
                    'Precisamos de permissão para detectar o número do seu telefone. Por favor, digite o número manualmente.',
                    [{ text: 'OK' }]
                );
            } else {
                Alert.alert(
                    'Não foi possível detectar', 
                    'Não conseguimos detectar automaticamente o número do seu telefone. Isso pode acontecer por:\n\n• Permissões não concedidas\n• SIM card não detectado\n• Configurações de privacidade\n• Versão do Android/iOS\n• Fabricante do dispositivo\n• Operadora não suporta detecção\n\nPor favor, digite o número manualmente.',
                    [{ text: 'OK' }]
                );
            }
        } finally {
            setIsDetectingPhone(false);
        }
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
            
            const fullPhoneNumber = '+55' + phoneDigits;
            console.log('📱 Enviando OTP para:', fullPhoneNumber);
            console.log('👤 Tipo de usuário:', userType);
            
            // Enviar OTP via Firebase Auth - usando nova API
            const auth = rnauth();
            console.log('🔧 Firebase config:', auth.app?.options);
            
            // Verificar se é número de teste
            const testNumbers = ['+5521999814802', '+5521999999999']; // Adicione números de teste aqui
            const isTestNumber = testNumbers.includes(fullPhoneNumber);
            
            if (isTestNumber) {
                console.log('🧪 Número de teste detectado, usando código fixo');
                navigation.navigate('OTP', { 
                    phone: fullPhoneNumber,
                    verificationId: 'test-verification-id',
                    userType: userType,
                    isTestMode: true
                });
                return;
            }
            
            const confirmation = await auth.verifyPhoneNumber(fullPhoneNumber);
            
            console.log('✅ OTP enviado com sucesso!');
            console.log('🆔 VerificationId:', confirmation.verificationId);
            console.log('📋 Confirmation completo:', JSON.stringify(confirmation, null, 2));
            
            // Navegar para a tela de OTP
            navigation.navigate('OTP', { 
                phone: fullPhoneNumber,
                verificationId: confirmation.verificationId,
                userType: userType 
            });
            
        } catch (error) {
            console.error('❌ Erro ao enviar OTP:', error);
            console.error('🔍 Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            
            let errorMessage = 'Não foi possível enviar o código de verificação.';
            
            // Tratar erros específicos do Firebase
            if (error.code === 'auth/invalid-phone-number') {
                errorMessage = 'Número de telefone inválido. Verifique o formato.';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Muitas tentativas. Tente novamente em alguns minutos.';
            } else if (error.code === 'auth/quota-exceeded') {
                errorMessage = 'Limite de SMS excedido. Tente novamente mais tarde.';
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMessage = 'Autenticação por telefone não está habilitada.';
            } else if (error.code === 'auth/captcha-check-failed') {
                errorMessage = 'Falha na verificação de segurança.';
            }
            
            Alert.alert('Erro', errorMessage);
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
                    <View style={styles.phoneHeader}>
                        <Text style={styles.phoneLabel}>Número de telefone</Text>
                        <TouchableOpacity 
                            style={styles.detectButton}
                            onPress={detectPhoneNumber}
                            disabled={isDetectingPhone}
                        >
                            {isDetectingPhone ? (
                                <ActivityIndicator size="small" color={LEAF_GREEN} />
                            ) : (
                                <Text style={styles.detectButtonText}>Detectar</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                    
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
                
                {/* Botão de teste removido - funcionalidade não disponível */}
                
                {isDetectingPhone && (
                    <View style={styles.detectingContainer}>
                        <ActivityIndicator size="large" color={LEAF_GREEN} />
                        <Text style={styles.detectingText}>Detectando número...</Text>
                    </View>
                )}
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
    phoneHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    phoneLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: LEAF_GREEN,
    },
    detectButton: {
        backgroundColor: LEAF_GREEN + '10',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: LEAF_GREEN,
    },
    detectButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: LEAF_GREEN,
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
    testButton: {
        backgroundColor: '#FF6B35',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginTop: 16,
        marginBottom: 8,
    },
    testButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: 'white',
        textAlign: 'center',
    },
    detectingContainer: {
        alignItems: 'center',
        marginTop: 20,
    },
    detectingText: {
        fontSize: 14,
        color: LEAF_GRAY,
        marginTop: 8,
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