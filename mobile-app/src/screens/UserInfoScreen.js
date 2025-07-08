import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, StatusBar, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextInputMask } from 'react-native-masked-text';
import { api } from 'common';
import auth from '@react-native-firebase/auth';
import { FirebaseConfig } from '../../config/FirebaseConfig';
import { CommonActions } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from 'react-redux';
import { generateReferralId } from 'common/src/other/sharedFunctions';

export default function UserInfoScreen({ navigation, route }) {
    const dispatch = useDispatch();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [cpf, setCpf] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const firstNameRef = useRef(null);
    const lastNameRef = useRef(null);
    const cpfRef = useRef(null);
    const passwordRef = useRef(null);
    const emailRef = useRef(null);
    const [userType, setUserType] = React.useState(route?.params?.userType || null);

    React.useEffect(() => {
        if (!userType) {
            AsyncStorage.getItem('@user_type').then(type => {
                if (type) setUserType(type);
            });
        }
    }, []);

    useEffect(() => {
        setCpf(""); // Garante que o campo CPF sempre inicie vazio ao montar a tela
    }, []);

    const allFieldsValid =
        firstName &&
        lastName &&
        cpf.replace(/\D/g, '').length === 11 &&
        password &&
        email;

    const handleContinue = async () => {
        console.log('=== INICIANDO CADASTRO ===');
        const startTime = Date.now();
        console.log('UserCredential:', route.params?.userCredential);
        console.log('Phone:', route.params?.phone);
        
        if (!firstName || !lastName || cpf.replace(/\D/g, '').length !== 11 || !password || !email) {
            console.log('Checked fields:', {
                firstName: !firstName ? 'vazio' : 'ok',
                lastName: !lastName ? 'vazio' : 'ok',
                cpf: cpf.replace(/\D/g, '').length !== 11 ? 'inválido' : 'ok',
                password: !password ? 'vazio' : 'ok',
                email: !email ? 'vazio' : 'ok'
            });
            Alert.alert('Atenção', 'Preencha todos os campos corretamente.');
            return;
        }

        try {
            setIsLoading(true);
            console.log('1. Preparando dados para cadastro');
            const referralId = generateReferralId();
            const regData = {
                firstName,
                lastName,
                email,
                mobile: route.params?.phone,
                password,
                verifyId: cpf,
                usertype: 'customer',
                uid: route.params?.userCredential?.uid,
                referralId
            };
            
            console.log('2. Dados preparados:', { ...regData, password: '***' });
            console.log('3. Chamando updateuserdata...');
            console.log('Dados sendo enviados para updateuserdata:', {
                uid: regData.uid,
                userData: {
                    email: regData.email,
                    mobile: regData.mobile,
                    firstName: regData.firstName,
                    lastName: regData.lastName,
                    usertype: regData.usertype,
                    verifyId: regData.verifyId,
                    created: Date.now(),
                    walletBalance: 0,
                    rating: 5,
                    approved: true,
                    referralId: regData.referralId
                }
            });
            
            const response = await fetch(`https://us-central1-${FirebaseConfig.projectId}.cloudfunctions.net/updateuserdata`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    uid: regData.uid,
                    userData: {
                        email: regData.email,
                        mobile: regData.mobile,
                        firstName: regData.firstName,
                        lastName: regData.lastName,
                        usertype: regData.usertype,
                        verifyId: regData.verifyId,
                        created: Date.now(),
                        walletBalance: 0,
                        rating: 5,
                        approved: true,
                        referralId: regData.referralId
                    }
                })
            });

            const res = await response.json();
            console.log('4. Resposta do updateuserdata:', res);

            if (res.success) {
                // Salvar dados no AsyncStorage
                try {
                    // Salvar o UID separadamente
                    await AsyncStorage.setItem('@auth_uid', regData.uid);
                    console.log('UID salvo no AsyncStorage:', regData.uid);

                    // Salvar os dados completos do usuário
                    await AsyncStorage.setItem('@user_data', JSON.stringify({
                        uid: regData.uid,
                        email: regData.email,
                        mobile: regData.mobile,
                        firstName: regData.firstName,
                        lastName: regData.lastName,
                        usertype: regData.usertype,
                        verifyId: regData.verifyId,
                        created: Date.now(),
                        walletBalance: 0,
                        rating: 5,
                        approved: true,
                        referralId: regData.referralId
                    }));
                    console.log('Dados salvos no AsyncStorage com sucesso');
                } catch (error) {
                    console.error('Erro ao salvar dados no AsyncStorage:', error);
                }
                
                try {
                    // Criar usuário usando user_signup
                    console.log('5. Criando usuário com user_signup...');
                    const userSignupResponse = await fetch(`https://us-central1-${FirebaseConfig.projectId}.cloudfunctions.net/user_signup`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            regData: {
                                email: regData.email,
                                password: regData.password,
                                mobile: regData.mobile,
                                firstName: regData.firstName,
                                lastName: regData.lastName,
                                usertype: regData.usertype,
                                verifyId: regData.verifyId,
                                uid: regData.uid,
                                referralId: regData.referralId
                            }
                        })
                    });

                    const userSignupRes = await userSignupResponse.json();
                    console.log('6. Resposta do user_signup:', userSignupRes);

                    if (userSignupRes.success && regData.uid) {
                        // Salvar dados no AsyncStorage
                        await AsyncStorage.setItem('@auth_uid', regData.uid);
                        await AsyncStorage.setItem('@user_data', JSON.stringify({
                            uid: regData.uid,
                            email: regData.email,
                            mobile: regData.mobile,
                            firstName: regData.firstName,
                            lastName: regData.lastName,
                            usertype: regData.usertype,
                            verifyId: regData.verifyId,
                            created: Date.now(),
                            walletBalance: 0,
                            rating: 5,
                            approved: true,
                            referralId: regData.referralId
                        }));

                        // Redirecionar para a tela de loading principal
                        navigation.replace('AuthLoadingScreen');
                    }
                } catch (error) {
                    console.error('❌ Erro na autenticação:', error);
                    Alert.alert('Erro', 'Não foi possível completar o cadastro. Por favor, tente novamente.');
                    navigation.replace('Login');
                }
            } else {
                console.error('❌ Erro no cadastro:', res);
                Alert.alert('Erro', res.error || 'Não foi possível concluir o cadastro.');
            }
        } catch (error) {
            console.error('❌ Erro durante o cadastro:', error);
            console.error('Mensagem do erro:', error.message);
            console.error('Stack do erro:', error.stack);
            Alert.alert('Erro', error.message || 'Não foi possível concluir o cadastro.');
        } finally {
            setIsLoading(false);
        }
    };

    // Ao avançar para OTP:
    const handleSendOTP = (phone) => {
        navigation.navigate('OTP', { phone, userType });
    };

    return (
        <View style={{ flex: 1, backgroundColor: '#F5F5F5', paddingHorizontal: 24 }}>
            <StatusBar backgroundColor="#1A330E" barStyle="light-content" />
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Ionicons name="chevron-back" size={32} color="#1A330E" />
            </TouchableOpacity>
            <View style={styles.titleContainerStatic}>
                <Text style={styles.titleCustom}>Complete seus dados</Text>
            </View>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1, width: '100%' }}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
                enabled
            >
                <ScrollView
                    contentContainerStyle={{ 
                        flexGrow: 1,
                        paddingTop: 0, 
                        paddingBottom: 40 
                    }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    keyboardDismissMode="none"
                >
                    <View style={{ width: '100%', marginTop: 0 }}>
                        <View style={[styles.inputRow, { marginTop: 0 }]}> 
                            <TextInput
                                ref={firstNameRef}
                                value={firstName}
                                onChangeText={setFirstName}
                                style={styles.input}
                                placeholder="Nome"
                                placeholderTextColor="#B0B0B0"
                                autoCapitalize="words"
                                keyboardType="default"
                                returnKeyType="next"
                                blurOnSubmit={false}
                                onSubmitEditing={() => lastNameRef.current?.focus()}
                            />
                        </View>
                        <View style={styles.inputRow}>
                            <TextInput
                                ref={lastNameRef}
                                value={lastName}
                                onChangeText={setLastName}
                                style={styles.input}
                                placeholder="Sobrenome"
                                placeholderTextColor="#B0B0B0"
                                autoCapitalize="words"
                                keyboardType="default"
                                returnKeyType="next"
                                blurOnSubmit={false}
                                onSubmitEditing={() => cpfRef.current?.focus()}
                            />
                        </View>
                        <View style={styles.inputRow}>
                            <TextInputMask
                                ref={cpfRef}
                                type={'cpf'}
                                placeholder={'CPF'}
                                value={cpf}
                                onChangeText={text => setCpf(text)}
                                keyboardType="number-pad"
                                returnKeyType="next"
                                maxLength={14}
                                style={styles.input}
                                placeholderTextColor="#B0B0B0"
                                blurOnSubmit={false}
                                onSubmitEditing={() => passwordRef.current?.focus()}
                            />
                        </View>
                        <View style={styles.inputRow}>
                            <TextInput
                                ref={passwordRef}
                                value={password}
                                onChangeText={setPassword}
                                style={styles.input}
                                placeholder="Crie uma senha"
                                placeholderTextColor="#B0B0B0"
                                secureTextEntry
                                keyboardType="default"
                                returnKeyType="next"
                                blurOnSubmit={false}
                                onSubmitEditing={() => emailRef.current?.focus()}
                            />
                        </View>
                        <View style={styles.inputRow}>
                            <TextInput
                                ref={emailRef}
                                value={email}
                                onChangeText={setEmail}
                                style={styles.input}
                                placeholder="Email"
                                placeholderTextColor="#B0B0B0"
                                keyboardType="email-address"
                                autoCapitalize="none"
                                returnKeyType="done"
                                onSubmitEditing={handleContinue}
                            />
                        </View>
                    </View>
                </ScrollView>
                <View style={{ width: '100%', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 10 }}>
                    <TouchableOpacity
                        style={allFieldsValid ? styles.buttonCustom : [styles.buttonCustom, styles.buttonNext]}
                        onPress={() => {
                            if (!allFieldsValid) {
                                // Descobre o primeiro campo inválido e foca nele
                                if (!firstName) {
                                    firstNameRef.current?.focus();
                                    return;
                                }
                                if (!lastName) {
                                    lastNameRef.current?.focus();
                                    return;
                                }
                                if (cpf.replace(/\D/g, '').length !== 11) {
                                    cpfRef.current?.focus();
                                    return;
                                }
                                if (!password) {
                                    passwordRef.current?.focus();
                                    return;
                                }
                                if (!email) {
                                    emailRef.current?.focus();
                                    return;
                                }
                            } else {
                                handleContinue();
                            }
                        }}
                    >
                        <Text style={allFieldsValid ? styles.buttonTextCustom : styles.buttonTextNext}>
                            {allFieldsValid ? 'Começar' : 'Próximo'}
                        </Text>
                    </TouchableOpacity>
                    <View style={{ height: 30 }} />
                </View>
            </KeyboardAvoidingView>
        </View>
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
    input: {
        flex: 1,
        color: '#1A330E',
        fontSize: 26,
        borderBottomWidth: 0,
        backgroundColor: '#F5F5F5',
        paddingVertical: 8,
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
    titleContainerStatic: {
        width: '100%',
        alignItems: 'flex-start',
        marginTop: 60,
        marginBottom: 16,
        paddingRight: 24,
        zIndex: 2,
        backgroundColor: '#F5F5F5',
    },
    buttonNext: {
        backgroundColor: '#FFF',
        borderWidth: 2,
        borderColor: '#2A4A1E',
    },
    buttonTextNext: {
        color: '#2A4A1E',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
    },
}); 