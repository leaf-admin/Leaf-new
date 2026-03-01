import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef, useContext } from 'react';
import {
    View,
    Text,
    Dimensions,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Alert,
    Image,
    StatusBar,
    TextInput,
    Modal,
    ActivityIndicator,
} from 'react-native';
import { Icon, Button, Input } from 'react-native-elements'
import { colors } from '../common/theme';
import ActionSheet from "react-native-actions-sheet";
import i18n from '../i18n';
var { height, width } = Dimensions.get('window');
import { useSelector, useDispatch } from 'react-redux';
import { api, FirebaseContext } from '../../common';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons, Entypo } from '@expo/vector-icons';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { fonts } from '../common/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import rnauth from '@react-native-firebase/auth';


export default function EditProfilePage(props) {
    // Verificar se o FirebaseContext está disponível antes de usar
    let config = null;
    try {
        if (FirebaseContext) {
            const context = useContext(FirebaseContext);
            config = context?.config;
        }
    } catch (error) {
        Logger.warn('FirebaseContext não disponível:', error);
    }

    // Fallback para config se não estiver disponível
    if (!config) {
        // Usar firebase diretamente se disponível
        try {
            const { firebase } = require('../../firebase');
            config = firebase?.config;
        } catch (error) {
            Logger.warn('Firebase não disponível:', error);
        }

        // Fallback final
        if (!config) {
            config = {
                projectId: "leaf-reactnative",
                appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
                databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
                storageBucket: "leaf-reactnative.firebasestorage.app",
                apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
                authDomain: "leaf-reactnative.firebaseapp.com",
                messagingSenderId: "106504629884",
                measurementId: "G-22368DBCY9"
            };
        }
    }
    const {
        updateProfile
    } = api;
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const settings = useSelector(state => state.settingsdata.settings);
    const [profileData, setProfileData] = useState(null);
    // Função de tradução com fallback e mapeamento de chaves comuns
    const translations = {
        'alert': 'Alerta',
        'profile_updated': 'Perfil atualizado com sucesso!',
        'ok': 'OK',
        'camera': 'Câmera',
        'medialibrary': 'Biblioteca de Mídia',
        'cancel': 'Cancelar',
        'image_upload_error': 'Erro ao fazer upload da imagem',
        'camera_permission_error': 'Permissão de câmera negada',
        'no_details_error': 'Por favor, preencha todos os detalhes bancários',
        'bankName': 'Nome do Banco',
        'bankCode': 'Código do Banco',
        'bankAccount': 'Conta Bancária',
        'verify_id': 'Verificar ID',
        'upload_verifyIdImage': 'Enviar Imagem de Verificação de ID',
        'image_size_warning': 'Tamanho máximo da imagem: 2MB',
        'verifyid_image': 'Imagem de Verificação de ID',
        'upload_driving_license_front': 'Enviar CNH (Frente)',
        'driving_license_font': 'CNH (Frente)',
        'upload_driving_license_back': 'Enviar CNH (Verso)',
        'driving_license_back': 'CNH (Verso)',
        'update_button': 'Atualizar Perfil'
    };

    const t = (key) => {
        try {
            if (i18n && typeof i18n.t === 'function') {
                return i18n.t(key);
            }
            if (i18n && i18n[key]) {
                return i18n[key];
            }
            // Fallback: usar traduções mapeadas
            if (translations[key]) {
                return translations[key];
            }
            // Último fallback: retornar a chave
            return key;
        } catch (error) {
            Logger.warn('Erro ao traduzir:', key, error);
            return translations[key] || key;
        }
    };
    const isRTL = (i18n && i18n.locale && typeof i18n.locale === 'string')
        ? (i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0)
        : false;
    const actionSheetRef = useRef(null);
    const [capturedImage, setCapturedImage] = useState(null);
    const [capturedImageBack, setCapturedImageback] = useState(null);
    const [capturedIdImage, setCapturedIdImage] = useState(null);
    const [check, setCheck] = useState(null);
    const [loading, setLoading] = useState(false);
    const [updateCalled, setUpdateCalled] = useState(false);
    const [updateSuccess, setUpdateSuccess] = useState(false);
    const fromPage = props.route.params && props.route.params.fromPage ? props.route.params.fromPage : null;

    // Estados para edição de email
    const [isEditingEmail, setIsEditingEmail] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState('');
    const [emailConfirmationCode, setEmailConfirmationCode] = useState('');
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [showEmailCodeModal, setShowEmailCodeModal] = useState(false);

    // Estados para alteração de telefone
    const [showPhoneModal, setShowPhoneModal] = useState(false);
    const [newPhone, setNewPhone] = useState('');
    const [phoneOTP, setPhoneOTP] = useState('');
    const [phoneVerificationId, setPhoneVerificationId] = useState(null);
    const [showPhoneOTPModal, setShowPhoneOTPModal] = useState(false);

    // Estados para redefinição de senha
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showSupportPasswordOption, setShowSupportPasswordOption] = useState(false);

    const [isDarkMode, setIsDarkMode] = useState(false);

    const onPressBack = () => {
        if (fromPage == 'DriverTrips' || fromPage == 'Map' || fromPage == 'Wallet') {
            props.navigation.replace('TabRoot', { screen: fromPage });
        } else {
            props.navigation.goBack()
        }
    }

    useEffect(() => {
        if (auth.profile && auth.profile.uid) {
            setProfileData({ ...auth.profile });

            if (updateSuccess) {
                setLoading(false);
                Alert.alert(
                    t('alert'),
                    t('profile_updated'),
                    [{
                        text: t('ok'),
                        onPress: () => {
                            onPressBack();
                        }
                    }],
                    { cancelable: true }
                );
                setUpdateCalled(false);
                setUpdateSuccess(false);
            }
        }
    }, [auth.profile, updateSuccess]);

    const showActionSheet = (text) => {
        setCheck(text);
        actionSheetRef.current?.setModalVisible(true);
    }

    const [state, setState] = useState({
        licenseImage: null,
        licenseImageBack: null,
        verifyIdImage: null
    });

    const uploadImage = () => {
        return (
            <ActionSheet ref={actionSheetRef}>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, borderColor: colors.CONVERTDRIVER_TEXT, borderBottomWidth: 1, height: 60, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { _pickImage('CAMERA', ImagePicker.launchCameraAsync) }}
                >
                    <Text style={{ color: colors.CAMERA_TEXT, fontFamily: fonts.Bold }}>{t('camera')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, borderBottomWidth: 1, borderColor: colors.CONVERTDRIVER_TEXT, height: 60, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { _pickImage('MEDIA', ImagePicker.launchImageLibraryAsync) }}
                >
                    <Text style={{ color: colors.CAMERA_TEXT, fontFamily: fonts.Bold }}>{t('medialibrary')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, height: 50, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { actionSheetRef.current?.setModalVisible(false); }}>
                    <Text style={{ color: 'red', fontFamily: fonts.Bold }}>{t('cancel')}</Text>
                </TouchableOpacity>
            </ActionSheet>
        )
    }

    const _pickImage = async (permissionType, res) => {
        var pickFrom = res;
        let permisions;
        if (permissionType == 'CAMERA') {
            permisions = await ImagePicker.requestCameraPermissionsAsync();
        } else {
            permisions = await ImagePicker.requestMediaLibraryPermissionsAsync();
        }
        const { status } = permisions;

        if (status == 'granted') {

            let result = await pickFrom({
                allowsEditing: true,
                aspect: [4, 3]
            });

            actionSheetRef.current?.setModalVisible(false);

            if (!result.canceled) {
                if (check == 0) {
                    setCapturedImage(result.assets[0].uri);
                }
                else if (check == 1) {
                    setCapturedImageback(result.assets[0].uri);
                }
                else if (check == 2) {
                    setCapturedIdImage(result.assets[0].uri);
                }

                const blob = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.onload = function () {
                        resolve(xhr.response);
                    };
                    xhr.onerror = function () {
                        Alert.alert(t('alert'), t('image_upload_error'));
                    };
                    xhr.responseType = 'blob';
                    xhr.open('GET', result.assets[0].uri, true);
                    xhr.send(null);
                });
                if (blob) {
                    if (check == 0) {
                        setState({ ...state, licenseImage: blob });
                    }
                    else if (check == 1) {
                        setState({ ...state, licenseImageBack: blob });
                    }
                    else if (check == 2) {
                        setState({ ...state, verifyIdImage: blob });
                    }
                }
            }
        } else {
            Alert.alert(t('alert'), t('camera_permission_error'))
        }
    }

    const cancelPhoto = () => {
        setCapturedImage(null);
    }

    const cancelPhotoback = () => {
        setCapturedImageback(null);
    }

    const cancelIdPhoto = () => {
        setCapturedIdImage(null);
    }

    // Função para validar email
    const validateEmail = (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // Função para formatar telefone
    const formatPhoneNumber = (text) => {
        const numbers = text.replace(/\D/g, '');
        if (numbers.length <= 2) {
            return numbers;
        } else if (numbers.length <= 7) {
            return `${numbers.slice(0, 2)} ${numbers.slice(2)}`;
        } else {
            return `${numbers.slice(0, 2)} ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
        }
    };

    // Função para iniciar alteração de email
    const handleStartEmailChange = () => {
        setNewEmail('');
        setCurrentPasswordForEmail('');
        setEmailConfirmationCode('');
        setShowEmailModal(true);
    };

    // Função para confirmar alteração de email (passo 1: senha)
    const handleConfirmEmailChange = async () => {
        if (!newEmail.trim()) {
            Alert.alert('Erro', 'Por favor, digite um e-mail válido');
            return;
        }

        if (!validateEmail(newEmail)) {
            Alert.alert('Erro', 'Por favor, digite um e-mail válido');
            return;
        }

        if (!currentPasswordForEmail.trim()) {
            Alert.alert('Erro', 'Por favor, digite sua senha atual');
            return;
        }

        if (newEmail.toLowerCase() === (profileData?.email || '').toLowerCase()) {
            Alert.alert('Erro', 'O novo e-mail deve ser diferente do atual');
            return;
        }

        setLoading(true);
        try {
            // Verificação de senha e envio de email de confirmação será processado
            // await api.verifyPassword(currentPasswordForEmail);
            // await api.sendEmailConfirmation(newEmail);

            // Simulação - fechar modal de senha e abrir modal de código
            setShowEmailModal(false);
            setShowEmailCodeModal(true);
        } catch (error) {
            Alert.alert('Erro', error.message || 'Erro ao processar alteração de e-mail');
        } finally {
            setLoading(false);
        }
    };

    // Função para confirmar código de email
    const handleConfirmEmailCode = async () => {
        if (!emailConfirmationCode.trim() || emailConfirmationCode.length !== 6) {
            Alert.alert('Erro', 'Por favor, digite o código de 6 dígitos');
            return;
        }

        setLoading(true);
        try {
            // Verificação do código e atualização do email será processado
            // await api.verifyEmailCode(emailConfirmationCode);
            // await api.updateEmail(newEmail);

            // Simulação
            await new Promise(resolve => setTimeout(resolve, 2000));

            Alert.alert(
                'E-mail alterado',
                'Seu e-mail foi alterado com sucesso!',
                [{
                    text: 'OK', onPress: () => {
                        setShowEmailCodeModal(false);
                        setNewEmail('');
                        setCurrentPasswordForEmail('');
                        setEmailConfirmationCode('');
                    }
                }]
            );
        } catch (error) {
            Alert.alert('Erro', error.message || 'Código inválido. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    // Função para iniciar alteração de telefone
    const handleStartPhoneChange = () => {
        setNewPhone('');
        setPhoneOTP('');
        setPhoneVerificationId(null);
        setShowPhoneModal(true);
    };

    // Função para enviar OTP do telefone
    const handleSendPhoneOTP = async () => {
        const phoneDigits = newPhone.replace(/\D/g, '');
        if (!newPhone || phoneDigits.length < 10) {
            Alert.alert('Erro', 'Por favor, digite um telefone válido');
            return;
        }

        setLoading(true);
        try {
            const fullPhoneNumber = '+55' + phoneDigits;
            const auth = rnauth();
            const confirmation = await auth.verifyPhoneNumber(fullPhoneNumber);

            setPhoneVerificationId(confirmation.verificationId);
            setShowPhoneModal(false);
            setShowPhoneOTPModal(true);
        } catch (error) {
            Alert.alert('Erro', error.message || 'Erro ao enviar código de verificação');
        } finally {
            setLoading(false);
        }
    };

    // Função para confirmar OTP do telefone
    const handleConfirmPhoneOTP = async () => {
        if (!phoneOTP || phoneOTP.replace(/\D/g, '').length !== 6) {
            Alert.alert('Erro', 'Digite o código de 6 dígitos recebido por SMS');
            return;
        }

        if (!phoneVerificationId) {
            Alert.alert('Erro', 'Código de verificação não encontrado');
            return;
        }

        setLoading(true);
        try {
            const credential = rnauth.PhoneAuthProvider.credential(phoneVerificationId, phoneOTP.replace(/\D/g, ''));
            await rnauth().currentUser.linkWithCredential(credential);

            // Atualização do telefone no perfil será processada
            // await api.updatePhone(newPhone);

            Alert.alert(
                'Telefone alterado',
                'Seu telefone foi alterado com sucesso!',
                [{
                    text: 'OK', onPress: () => {
                        setShowPhoneOTPModal(false);
                        setNewPhone('');
                        setPhoneOTP('');
                        setPhoneVerificationId(null);
                    }
                }]
            );
        } catch (error) {
            Alert.alert('Erro', error.message || 'Código inválido. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    // Função para iniciar redefinição de senha
    const handleStartPasswordReset = () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowSupportPasswordOption(false);
        setShowPasswordModal(true);
    };

    // Função para confirmar redefinição de senha
    const handleConfirmPasswordReset = async () => {
        if (showSupportPasswordOption) {
            Alert.alert(
                'Contatar Suporte',
                'Para redefinir sua senha via suporte, entre em contato com nossa equipe através do menu "Ajuda" ou "Suporte".',
                [{
                    text: 'OK', onPress: () => {
                        setShowPasswordModal(false);
                        props.navigation.navigate('Help');
                    }
                }]
            );
            return;
        }

        if (!currentPassword.trim()) {
            Alert.alert('Erro', 'Por favor, digite sua senha atual');
            return;
        }

        if (!newPassword.trim()) {
            Alert.alert('Erro', 'Por favor, digite a nova senha');
            return;
        }

        if (newPassword.length < 6) {
            Alert.alert('Erro', 'A senha deve ter pelo menos 6 caracteres');
            return;
        }

        if (newPassword !== confirmPassword) {
            Alert.alert('Erro', 'As senhas não coincidem');
            return;
        }

        if (currentPassword === newPassword) {
            Alert.alert('Erro', 'A nova senha deve ser diferente da atual');
            return;
        }

        setLoading(true);
        try {
            const user = rnauth().currentUser;
            const cred = rnauth.EmailAuthProvider.credential(user.email, currentPassword);
            await user.reauthenticateWithCredential(cred);
            await user.updatePassword(newPassword);

            Alert.alert(
                'Senha alterada',
                'Sua senha foi alterada com sucesso!',
                [{
                    text: 'OK', onPress: () => {
                        setShowPasswordModal(false);
                        setCurrentPassword('');
                        setNewPassword('');
                        setConfirmPassword('');
                    }
                }]
            );
        } catch (error) {
            Alert.alert('Erro', error.message || 'Erro ao alterar senha. Verifique se a senha atual está correta.');
        } finally {
            setLoading(false);
        }
    };

    // Componente de campo de informação (não editável)
    const InfoField = ({ label, value, icon, locked = false }) => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name={icon} size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>{label}</Text>
                {locked && (
                    <Ionicons name="lock-closed" size={14} color={isDarkMode ? '#666' : '#999'} style={{ marginLeft: 6 }} />
                )}
            </View>
            <View style={styles.valueContainer}>
                <Text style={[styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{value || 'Não informado'}</Text>
                {locked && (
                    <TouchableOpacity
                        onPress={() => {
                            Alert.alert(
                                'Alteração não permitida',
                                'Para alterar este campo, entre em contato com nossa equipe de suporte através do menu "Ajuda" ou "Suporte".',
                                [{ text: 'OK' }]
                            );
                        }}
                    >
                        <Ionicons name="information-circle-outline" size={18} color={isDarkMode ? '#999' : '#666'} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );

    // Componente de campo editável (email)
    const EditableEmailField = () => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name="mail" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>E-mail</Text>
            </View>
            <View style={styles.valueContainer}>
                <Text style={[styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{profileData?.email || 'Não informado'}</Text>
                <TouchableOpacity style={styles.editButton} onPress={handleStartEmailChange}>
                    <Ionicons name="pencil" size={16} color={MAIN_COLOR} />
                </TouchableOpacity>
            </View>
        </View>
    );

    // Componente de campo editável (telefone)
    const EditablePhoneField = () => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name="call" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Telefone</Text>
            </View>
            <View style={styles.valueContainer}>
                <Text style={[styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{profileData?.mobile || 'Não informado'}</Text>
                <TouchableOpacity style={styles.editButton} onPress={handleStartPhoneChange}>
                    <Ionicons name="pencil" size={16} color={MAIN_COLOR} />
                </TouchableOpacity>
            </View>
        </View>
    );

    // Componente de campo de senha
    const PasswordField = () => (
        <TouchableOpacity
            style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}
            onPress={handleStartPasswordReset}
        >
            <View style={styles.fieldHeader}>
                <Ionicons name="lock-closed" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Senha</Text>
            </View>
            <View style={styles.valueContainer}>
                <Text style={[styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>••••••••</Text>
                <TouchableOpacity style={styles.editButton}>
                    <Ionicons name="refresh" size={16} color={MAIN_COLOR} />
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );

    const completeSubmit = async () => {
        let userData = {
            verifyId: profileData.verifyId ? profileData.verifyId : null
        };
        setUpdateCalled(true);
        if ((auth.profile.usertype == 'driver' && settings && settings.bank_fields) || (auth.profile.usertype == 'customer' && settings && settings.bank_fields && settings.RiderWithDraw) && profileData.bankAccount && profileData.bankAccount.length &&
            profileData.bankCode && profileData.bankCode.length &&
            profileData.bankName && profileData.bankName.length) {
            userData.bankAccount = profileData.bankAccount,
                userData.bankCode = profileData.bankCode,
                userData.bankName = profileData.bankName
        }
        if (auth.profile.usertype == 'driver') {
            if (capturedImage) {
                userData.licenseImage = state ? state.licenseImage : profileData.licenseImage ? profileData.licenseImage : null;
            }
            if (capturedImageBack) {
                userData.licenseImageBack = state ? state.licenseImageBack : profileData.licenseImageBack ? profileData.licenseImageBack : null;
            }
        }
        if (capturedIdImage) {
            userData.verifyIdImage = state ? state.verifyIdImage : profileData.verifyIdImage ? profileData.verifyIdImage : null;
        }

        await dispatch(updateProfile(userData));

        setUpdateSuccess(true);
    };

    const saveProfile = async () => {
        if (((auth.profile.usertype == 'driver' && settings && settings.bank_fields) || (auth.profile.usertype == 'customer' && settings && settings.bank_fields && settings.RiderWithDraw)) && !(profileData.bankAccount && profileData.bankCode && profileData.bankName)) {
            Alert.alert(t('alert'), t('no_details_error'));
        }
        else {
            setLoading(true);
            await completeSubmit();
        }
    };



    // Header com botão voltar e título
    const Header = () => (
        <View style={[styles.header, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <TouchableOpacity
                style={[
                    styles.headerButton,
                    {
                        backgroundColor: isDarkMode ? '#2d2d2d' : '#e8e8e8',
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#404040' : '#d0d0d0',
                    }
                ]}
                onPress={onPressBack}
                activeOpacity={0.7}
            >
                <Ionicons name="arrow-back" size={22} color={isDarkMode ? '#fff' : '#1a1a1a'} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Editar Perfil</Text>
            <View style={styles.headerRightContainer} />
        </View>
    );

    // Função para selecionar foto de perfil
    const pickImage = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            });

            if (!result.canceled) {
                const imageUri = result.assets[0].uri;
                setProfileData({ ...profileData, profile_image: imageUri });

                // Extrair blob para upload
                const blob = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.onload = function () {
                        resolve(xhr.response);
                    };
                    xhr.onerror = function () {
                        Alert.alert(t('alert'), t('image_upload_error'));
                        reject(new TypeError('Network request failed'));
                    };
                    xhr.responseType = 'blob';
                    xhr.open('GET', imageUri, true);
                    xhr.send(null);
                });

                if (blob && api.updateProfileImage) {
                    dispatch(api.updateProfileImage(auth.profile, imageUri)).then(url => {
                        dispatch(api.updateProfile({ profile_image: url }));
                        Alert.alert('Sucesso', 'Foto atualizada com sucesso!');
                    }).catch(err => {
                        Alert.alert('Erro', 'Não foi possível atualizar a foto.');
                    });
                } else if (blob) {
                    // Update fallback
                    dispatch(api.updateProfile({ profile_image: imageUri }));
                    Alert.alert('Sucesso', 'Foto selecionada com sucesso!');
                }
            }
        } catch (error) {
            Alert.alert('Erro', 'Erro ao selecionar imagem');
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />

            {/* Header */}
            <Header />

            <ScrollView style={[styles.content, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]} showsVerticalScrollIndicator={false}>
                {/* Foto de Perfil */}
                <View style={styles.profileImageSection}>
                    <TouchableOpacity onPress={pickImage}>
                        <Image
                            source={profileData?.profile_image ? { uri: profileData.profile_image } : require('../../assets/images/profilePic.png')}
                            style={styles.profileImage}
                        />
                        <View style={styles.editImageOverlay}>
                            <Ionicons name="camera" size={20} color="#fff" />
                        </View>
                    </TouchableOpacity>
                    <Text style={[styles.editImageText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Toque para alterar</Text>
                </View>

                {/* Informações Básicas - Não Editáveis */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Informações Básicas</Text>
                    <InfoField
                        label="Nome"
                        value={profileData?.firstName}
                        icon="person"
                        locked={true}
                    />
                    <InfoField
                        label="Sobrenome"
                        value={profileData?.lastName}
                        icon="person-outline"
                        locked={true}
                    />
                </View>

                {/* Campos Editáveis */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Contato</Text>
                    <EditablePhoneField />
                    <EditableEmailField />
                </View>

                {/* Segurança */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Segurança</Text>
                    <PasswordField />
                </View>

                {/* Dados Bancários - Específico do Motorista */}
                {((auth.profile?.usertype == 'driver' && settings && settings.bank_fields) || (auth.profile?.usertype == 'customer' && settings && settings.bank_fields && settings.RiderWithDraw)) && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Dados Bancários</Text>
                        {(auth.profile?.usertype == 'driver' && settings && settings.bank_fields) || (auth.profile?.usertype == 'customer' && settings && settings.bank_fields && settings.RiderWithDraw) ?
                            <View style={styles.textInputContainerStyle}>
                                <Text style={[styles.text1, isRTL ? { textAlign: 'right', marginRight: 30 } : { textAlign: 'left', marginLeft: 7 }]} >{t('bankName')}</Text>
                                <View style={[styles.textInputContainerStyle1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <View style={styles.iconContainer}>
                                        <MaterialCommunityIcons name="bank-outline" size={24} color={colors.HEADER} />
                                    </View>
                                    <View style={{ width: '75%' }}>
                                        <Input
                                            editable={true}
                                            underlineColorAndroid={colors.TRANSPARENT}
                                            placeholder={t('bankName')}
                                            placeholderTextColor={colors.PROFILE_PLACEHOLDER_TEXT}
                                            value={profileData && profileData.bankName ? profileData.bankName : ''}
                                            keyboardType={'email-address'}
                                            inputStyle={[styles.inputTextStyle, isRTL ? { textAlign: 'right', fontSize: 13, } : { textAlign: 'left', fontSize: 13, }]}
                                            onChangeText={(text) => { setProfileData({ ...profileData, bankName: text }) }}
                                            secureTextEntry={false}
                                            errorStyle={styles.errorMessageStyle}
                                            inputContainerStyle={styles.inputContainerStyle}
                                            containerStyle={[styles.textInputStyle, { marginLeft: 0 }]}
                                        />
                                    </View>
                                </View>
                            </View>
                            : null}
                        {(auth.profile.usertype == 'driver' && settings && settings.bank_fields) || (auth.profile.usertype == 'customer' && settings && settings.bank_fields && settings.RiderWithDraw) ?
                            <View style={styles.textInputContainerStyle}>
                                <Text style={[styles.text1, isRTL ? { textAlign: 'right', marginRight: 30 } : { textAlign: 'left', marginLeft: 7 }]} >{t('bankCode')}</Text>
                                <View style={[styles.textInputContainerStyle1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <Icon
                                        name='numeric'
                                        type='material-community'
                                        color={colors.PROFILE_PLACEHOLDER_CONTENT}
                                        size={30}
                                        containerStyle={styles.iconContainer}
                                    />
                                    <View style={{ width: '75%' }}>
                                        <Input
                                            editable={true}
                                            underlineColorAndroid={colors.TRANSPARENT}
                                            placeholder={t('bankCode')}
                                            placeholderTextColor={colors.PROFILE_PLACEHOLDER_TEXT}
                                            value={profileData && profileData.bankCode ? profileData.bankCode : ''}
                                            keyboardType={'email-address'}
                                            inputStyle={[styles.inputTextStyle, isRTL ? { textAlign: 'right', fontSize: 13, } : { textAlign: 'left', fontSize: 13, }]}
                                            onChangeText={(text) => { setProfileData({ ...profileData, bankCode: text }) }}
                                            secureTextEntry={false}
                                            errorStyle={styles.errorMessageStyle}
                                            inputContainerStyle={styles.inputContainerStyle}
                                            containerStyle={[styles.textInputStyle, { marginLeft: 0 }]}
                                        />
                                    </View>
                                </View>
                            </View>
                            : null}
                        {(auth.profile.usertype == 'driver' && settings && settings.bank_fields) || (auth.profile.usertype == 'customer' && settings && settings.bank_fields && settings.RiderWithDraw) ?
                            <View style={styles.textInputContainerStyle}>
                                <Text style={[styles.text1, isRTL ? { textAlign: 'right', marginRight: 30 } : { textAlign: 'left', marginLeft: 7 }]} >{t('bankAccount')}</Text>
                                <View style={[styles.textInputContainerStyle1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <Icon
                                        name='numeric'
                                        type='material-community'
                                        color={colors.PROFILE_PLACEHOLDER_CONTENT}
                                        size={30}
                                        containerStyle={styles.iconContainer}
                                    />
                                    <View style={{ width: '75%' }}>
                                        <Input
                                            editable={true}
                                            underlineColorAndroid={colors.TRANSPARENT}
                                            placeholder={t('bankAccount')}
                                            placeholderTextColor={colors.PROFILE_PLACEHOLDER_TEXT}
                                            value={profileData && profileData.bankAccount ? profileData.bankAccount : ''}
                                            keyboardType={'email-address'}
                                            inputStyle={[styles.inputTextStyle, isRTL ? { textAlign: 'right', fontSize: 13, } : { textAlign: 'left', fontSize: 13, }]}
                                            onChangeText={(text) => { setProfileData({ ...profileData, bankAccount: text }) }}
                                            secureTextEntry={false}
                                            errorStyle={styles.errorMessageStyle}
                                            inputContainerStyle={styles.inputContainerStyle}
                                            containerStyle={[styles.textInputStyle, { marginLeft: 0 }]}
                                        />
                                    </View>
                                </View>
                            </View>
                            : null}

                        {settings && settings.imageIdApproval ?
                            <View style={styles.textInputContainerStyle}>
                                <Text style={[styles.text1, isRTL ? { textAlign: 'right', marginRight: 35 } : { textAlign: 'left', marginLeft: 10 }]} >{t('verify_id')}</Text>
                                <View style={[styles.textInputContainerStyle1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <View style={styles.iconContainer}>
                                        <MaterialCommunityIcons name="cellphone-information" size={24} color={colors.HEADER} />
                                    </View>
                                    <View style={{ width: '75%' }}>
                                        <Input
                                            underlineColorAndroid={colors.TRANSPARENT}
                                            placeholder={t('verify_id')}
                                            placeholderTextColor={colors.PROFILE_PLACEHOLDER_TEXT}
                                            value={profileData && profileData.verifyId ? profileData.verifyId : ''}
                                            keyboardType={'email-address'}
                                            inputStyle={[styles.inputTextStyle, isRTL ? { textAlign: 'right', fontSize: 13, } : { textAlign: 'left', fontSize: 13, }]}
                                            onChangeText={(text) => {
                                                setProfileData({ ...profileData, verifyId: text })
                                            }}
                                            secureTextEntry={false}
                                            errorStyle={styles.errorMessageStyle}
                                            inputContainerStyle={styles.inputContainerStyle}
                                            containerStyle={styles.textInputStyle}
                                        />
                                    </View>
                                </View>
                            </View>
                            : null}

                        {settings && settings.imageIdApproval ?
                            !auth.profile.verifyIdImage ?
                                capturedIdImage ?
                                    <View style={styles.imagePosition}>
                                        <TouchableOpacity style={styles.photoClick} onPress={cancelIdPhoto}>
                                            <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                        </TouchableOpacity>
                                        <Image source={{ uri: capturedIdImage }} style={styles.photoResult} resizeMode={'cover'} />
                                    </View>
                                    :
                                    <View style={styles.capturePhoto}>
                                        <View>
                                            {
                                                state.imageValid ?
                                                    <Text style={styles.capturePhotoTitle}>{t('upload_verifyIdImage')}</Text>
                                                    :
                                                    <Text style={styles.errorPhotoTitle}>{t('upload_verifyIdImage')}</Text>
                                            }

                                        </View>
                                        <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                            <TouchableOpacity style={styles.flexView1} onPress={() => showActionSheet('2')}>
                                                <View>
                                                    <View style={styles.imageFixStyle}>
                                                        <Image source={require('../../assets/images/camera.png')} resizeMode={'contain'} style={styles.imageStyle2} />
                                                    </View>
                                                </View>
                                            </TouchableOpacity>
                                            <View style={styles.myView}>
                                                <View style={styles.myView1} />
                                            </View>
                                            <View style={styles.myView2}>
                                                <View style={styles.myView3}>
                                                    <Text style={styles.textStyle}>{t('image_size_warning')}</Text>
                                                </View>
                                            </View>
                                        </View>
                                    </View>
                                :
                                <View style={styles.imagePosition}>
                                    <View style={{ padding: 5, marginTop: 5 }}>
                                        <Text style={styles.text}>{t('verifyid_image')}</Text>
                                    </View>
                                    {capturedIdImage ?
                                        <TouchableOpacity style={styles.photoClick} onPress={cancelIdPhoto}>
                                            <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                        </TouchableOpacity>
                                        : null}

                                    {capturedIdImage ?
                                        <TouchableOpacity onPress={() => showActionSheet('2')}>
                                            <Image source={{ uri: capturedIdImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </TouchableOpacity>
                                        :
                                        <TouchableOpacity onPress={() => showActionSheet('2')}>
                                            <Image source={{ uri: auth.profile.verifyIdImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </TouchableOpacity>
                                    }
                                </View>
                            : null
                        }

                        {auth.profile.usertype == 'driver' && settings && settings.license_image_required ?
                            !auth.profile.licenseImage ?
                                capturedImage ?
                                    <View style={styles.imagePosition}>
                                        <TouchableOpacity style={styles.photoClick} onPress={cancelPhoto}>
                                            <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                        </TouchableOpacity>
                                        <Image source={{ uri: capturedImage }} style={styles.photoResult} resizeMode={'cover'} />
                                    </View>
                                    :
                                    <View style={styles.capturePhoto}>
                                        <View>
                                            {
                                                state.imageValid ?
                                                    <Text style={styles.capturePhotoTitle}>{t('upload_driving_license_front')}</Text>
                                                    :
                                                    <Text style={styles.errorPhotoTitle}>{t('upload_driving_license_front')}</Text>
                                            }

                                        </View>
                                        <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                            <TouchableOpacity style={styles.flexView1} onPress={() => showActionSheet('0')}>
                                                <View>
                                                    <View style={styles.imageFixStyle}>
                                                        <Image source={require('../../assets/images/camera.png')} resizeMode={'contain'} style={styles.imageStyle2} />
                                                    </View>
                                                </View>
                                            </TouchableOpacity>
                                            <View style={styles.myView}>
                                                <View style={styles.myView1} />
                                            </View>
                                            <View style={styles.myView2}>
                                                <View style={styles.myView3}>
                                                    <Text style={styles.textStyle}>{t('image_size_warning')}</Text>
                                                </View>
                                            </View>
                                        </View>
                                    </View>
                                :
                                <View style={styles.imagePosition}>
                                    <View style={{ padding: 5 }}>
                                        <Text style={styles.text}>{t('driving_license_font')}</Text>
                                    </View>
                                    {capturedImage ?
                                        <TouchableOpacity style={styles.photoClick} onPress={cancelPhoto}>
                                            <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                        </TouchableOpacity>
                                        : null}

                                    {capturedImage ?
                                        <TouchableOpacity onPress={() => showActionSheet('0')}>
                                            <Image source={{ uri: capturedImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </TouchableOpacity>
                                        :
                                        <TouchableOpacity onPress={() => showActionSheet('0')}>
                                            <Image source={{ uri: auth.profile.licenseImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </TouchableOpacity>
                                    }
                                </View>
                            : null
                        }

                        {auth.profile.usertype == 'driver' && settings && settings.license_image_required ?
                            !auth.profile.licenseImageBack ?
                                capturedImageBack ?
                                    <View style={styles.imagePosition}>
                                        <TouchableOpacity style={styles.photoClick} onPress={cancelPhotoback}>
                                            <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                        </TouchableOpacity>
                                        <Image source={{ uri: capturedImageBack }} style={styles.photoResult} resizeMode={'cover'} />
                                    </View>
                                    :
                                    <View style={styles.capturePhoto}>
                                        <View>
                                            {
                                                state.imageValid ?
                                                    <Text style={styles.capturePhotoTitle}>{t('upload_driving_license_back')}</Text>
                                                    :
                                                    <Text style={styles.errorPhotoTitle}>{t('upload_driving_license_back')}</Text>
                                            }

                                        </View>
                                        <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                            <TouchableOpacity style={styles.flexView1} onPress={() => showActionSheet('1')}>
                                                <View>
                                                    <View style={styles.imageFixStyle}>
                                                        <Image source={require('../../assets/images/camera.png')} resizeMode={'contain'} style={styles.imageStyle2} />
                                                    </View>
                                                </View>
                                            </TouchableOpacity>
                                            <View style={styles.myView}>
                                                <View style={styles.myView1} />
                                            </View>
                                            <View style={styles.myView2}>
                                                <View style={styles.myView3}>
                                                    <Text style={styles.textStyle}>{t('image_size_warning')}</Text>
                                                </View>
                                            </View>
                                        </View>
                                    </View>
                                :
                                <View style={styles.imagePosition}>
                                    <View style={{ padding: 5, marginTop: 5 }}>
                                        <Text style={styles.text}>{t('driving_license_back')}</Text>
                                    </View>
                                    {capturedImageBack ?
                                        <TouchableOpacity style={styles.photoClick} onPress={cancelPhotoback}>
                                            <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                        </TouchableOpacity>
                                        : null}

                                    {capturedImageBack ?
                                        <TouchableOpacity onPress={() => showActionSheet('1')}>
                                            <Image source={{ uri: capturedImageBack }} style={styles.photoResult} resizeMode={'cover'} />
                                        </TouchableOpacity>
                                        :
                                        <TouchableOpacity onPress={() => showActionSheet('1')}>
                                            <Image source={{ uri: auth.profile.licenseImageBack }} style={styles.photoResult} resizeMode={'cover'} />
                                        </TouchableOpacity>
                                    }
                                </View>
                            : null
                        }

                    </View>
                )}

                {/* Documentos e CNH - Específico do Motorista */}
                {auth.profile?.usertype == 'driver' && (
                    <>
                        {/* Seção de Verificação de ID */}
                        {settings && settings.imageIdApproval && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Verificação de Identidade</Text>
                                <View style={styles.textInputContainerStyle}>
                                    <Text style={[styles.text1, isRTL ? { textAlign: 'right', marginRight: 35 } : { textAlign: 'left', marginLeft: 10 }]}>{t('verify_id')}</Text>
                                    <View style={[styles.textInputContainerStyle1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                        <View style={styles.iconContainer}>
                                            <MaterialCommunityIcons name="cellphone-information" size={24} color={colors.HEADER} />
                                        </View>
                                        <View style={{ width: '75%' }}>
                                            <Input
                                                underlineColorAndroid={colors.TRANSPARENT}
                                                placeholder={t('verify_id')}
                                                placeholderTextColor={colors.PROFILE_PLACEHOLDER_TEXT}
                                                value={profileData && profileData.verifyId ? profileData.verifyId : ''}
                                                keyboardType={'email-address'}
                                                inputStyle={[styles.inputTextStyle, isRTL ? { textAlign: 'right', fontSize: 13, } : { textAlign: 'left', fontSize: 13, }]}
                                                onChangeText={(text) => {
                                                    setProfileData({ ...profileData, verifyId: text })
                                                }}
                                                secureTextEntry={false}
                                                errorStyle={styles.errorMessageStyle}
                                                inputContainerStyle={styles.inputContainerStyle}
                                                containerStyle={styles.textInputStyle}
                                            />
                                        </View>
                                    </View>
                                </View>

                                {!auth.profile.verifyIdImage ? (
                                    capturedIdImage ? (
                                        <View style={styles.imagePosition}>
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelIdPhoto}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                            <Image source={{ uri: capturedIdImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </View>
                                    ) : (
                                        <View style={styles.capturePhoto}>
                                            <View>
                                                {state.imageValid ? (
                                                    <Text style={styles.capturePhotoTitle}>{t('upload_verifyIdImage')}</Text>
                                                ) : (
                                                    <Text style={styles.errorPhotoTitle}>{t('upload_verifyIdImage')}</Text>
                                                )}
                                            </View>
                                            <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <TouchableOpacity style={styles.flexView1} onPress={() => showActionSheet('2')}>
                                                    <View>
                                                        <View style={styles.imageFixStyle}>
                                                            <Image source={require('../../assets/images/camera.png')} resizeMode={'contain'} style={styles.imageStyle2} />
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                                <View style={styles.myView}>
                                                    <View style={styles.myView1} />
                                                </View>
                                                <View style={styles.myView2}>
                                                    <View style={styles.myView3}>
                                                        <Text style={styles.textStyle}>{t('image_size_warning')}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        </View>
                                    )
                                ) : (
                                    <View style={styles.imagePosition}>
                                        <View style={{ padding: 5, marginTop: 5 }}>
                                            <Text style={styles.text}>{t('verifyid_image')}</Text>
                                        </View>
                                        {capturedIdImage ? (
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelIdPhoto}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                        ) : null}
                                        {capturedIdImage ? (
                                            <TouchableOpacity onPress={() => showActionSheet('2')}>
                                                <Image source={{ uri: capturedIdImage }} style={styles.photoResult} resizeMode={'cover'} />
                                            </TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity onPress={() => showActionSheet('2')}>
                                                <Image source={{ uri: auth.profile.verifyIdImage }} style={styles.photoResult} resizeMode={'cover'} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}
                            </View>
                        )}

                        {/* Seção de CNH */}
                        {settings && settings.license_image_required && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Carteira Nacional de Habilitação</Text>

                                {/* CNH Frente */}
                                {!auth.profile.licenseImage ? (
                                    capturedImage ? (
                                        <View style={styles.imagePosition}>
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelPhoto}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                            <Image source={{ uri: capturedImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </View>
                                    ) : (
                                        <View style={styles.capturePhoto}>
                                            <View>
                                                {state.imageValid ? (
                                                    <Text style={styles.capturePhotoTitle}>{t('upload_driving_license_front')}</Text>
                                                ) : (
                                                    <Text style={styles.errorPhotoTitle}>{t('upload_driving_license_front')}</Text>
                                                )}
                                            </View>
                                            <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <TouchableOpacity style={styles.flexView1} onPress={() => showActionSheet('0')}>
                                                    <View>
                                                        <View style={styles.imageFixStyle}>
                                                            <Image source={require('../../assets/images/camera.png')} resizeMode={'contain'} style={styles.imageStyle2} />
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                                <View style={styles.myView}>
                                                    <View style={styles.myView1} />
                                                </View>
                                                <View style={styles.myView2}>
                                                    <View style={styles.myView3}>
                                                        <Text style={styles.textStyle}>{t('image_size_warning')}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        </View>
                                    )
                                ) : (
                                    <View style={styles.imagePosition}>
                                        <View style={{ padding: 5 }}>
                                            <Text style={styles.text}>{t('driving_license_font')}</Text>
                                        </View>
                                        {capturedImage ? (
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelPhoto}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                        ) : null}
                                        {capturedImage ? (
                                            <TouchableOpacity onPress={() => showActionSheet('0')}>
                                                <Image source={{ uri: capturedImage }} style={styles.photoResult} resizeMode={'cover'} />
                                            </TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity onPress={() => showActionSheet('0')}>
                                                <Image source={{ uri: auth.profile.licenseImage }} style={styles.photoResult} resizeMode={'cover'} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}

                                {/* CNH Verso */}
                                {!auth.profile.licenseImageBack ? (
                                    capturedImageBack ? (
                                        <View style={styles.imagePosition}>
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelPhotoback}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                            <Image source={{ uri: capturedImageBack }} style={styles.photoResult} resizeMode={'cover'} />
                                        </View>
                                    ) : (
                                        <View style={styles.capturePhoto}>
                                            <View>
                                                {state.imageValid ? (
                                                    <Text style={styles.capturePhotoTitle}>{t('upload_driving_license_back')}</Text>
                                                ) : (
                                                    <Text style={styles.errorPhotoTitle}>{t('upload_driving_license_back')}</Text>
                                                )}
                                            </View>
                                            <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <TouchableOpacity style={styles.flexView1} onPress={() => showActionSheet('1')}>
                                                    <View>
                                                        <View style={styles.imageFixStyle}>
                                                            <Image source={require('../../assets/images/camera.png')} resizeMode={'contain'} style={styles.imageStyle2} />
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                                <View style={styles.myView}>
                                                    <View style={styles.myView1} />
                                                </View>
                                                <View style={styles.myView2}>
                                                    <View style={styles.myView3}>
                                                        <Text style={styles.textStyle}>{t('image_size_warning')}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        </View>
                                    )
                                ) : (
                                    <View style={styles.imagePosition}>
                                        <View style={{ padding: 5, marginTop: 5 }}>
                                            <Text style={styles.text}>{t('driving_license_back')}</Text>
                                        </View>
                                        {capturedImageBack ? (
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelPhotoback}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                        ) : null}
                                        {capturedImageBack ? (
                                            <TouchableOpacity onPress={() => showActionSheet('1')}>
                                                <Image source={{ uri: capturedImageBack }} style={styles.photoResult} resizeMode={'cover'} />
                                            </TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity onPress={() => showActionSheet('1')}>
                                                <Image source={{ uri: auth.profile.licenseImageBack }} style={styles.photoResult} resizeMode={'cover'} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}
                            </View>
                        )}
                    </>
                )}
            </ScrollView>

            {/* Modal para alteração de email (passo 1: senha) */}
            <Modal
                visible={showEmailModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowEmailModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Alterar E-mail</Text>
                            <TouchableOpacity onPress={() => setShowEmailModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Para alterar seu e-mail, precisamos confirmar sua identidade e enviar um código de confirmação para o novo endereço.
                        </Text>

                        <TextInput
                            style={[styles.modalInput, {
                                color: isDarkMode ? '#fff' : colors.BLACK,
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                            }]}
                            placeholder="Novo e-mail"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            value={newEmail}
                            onChangeText={setNewEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                        />

                        <TextInput
                            style={[styles.modalInput, {
                                color: isDarkMode ? '#fff' : colors.BLACK,
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                            }]}
                            placeholder="Senha atual"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            value={currentPasswordForEmail}
                            onChangeText={setCurrentPasswordForEmail}
                            secureTextEntry
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonCancel]}
                                onPress={() => {
                                    setShowEmailModal(false);
                                    setNewEmail('');
                                    setCurrentPasswordForEmail('');
                                }}
                            >
                                <Text style={styles.modalButtonTextCancel}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleConfirmEmailChange}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.modalButtonTextConfirm}>Continuar</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal para código de confirmação de email */}
            <Modal
                visible={showEmailCodeModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowEmailCodeModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Código de Confirmação</Text>
                            <TouchableOpacity onPress={() => setShowEmailCodeModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Digite o código de 6 dígitos enviado para {newEmail}
                        </Text>

                        <TextInput
                            style={[styles.modalInput, {
                                color: isDarkMode ? '#fff' : colors.BLACK,
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                            }]}
                            placeholder="Código de 6 dígitos"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            value={emailConfirmationCode}
                            onChangeText={setEmailConfirmationCode}
                            keyboardType="number-pad"
                            maxLength={6}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonCancel]}
                                onPress={() => {
                                    setShowEmailCodeModal(false);
                                    setEmailConfirmationCode('');
                                }}
                            >
                                <Text style={styles.modalButtonTextCancel}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleConfirmEmailCode}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.modalButtonTextConfirm}>Confirmar</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal para alteração de telefone */}
            <Modal
                visible={showPhoneModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowPhoneModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Alterar Telefone</Text>
                            <TouchableOpacity onPress={() => setShowPhoneModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Enviaremos um código de verificação por SMS para o novo número.
                        </Text>

                        <View style={styles.phoneInputContainer}>
                            <Text style={styles.countryCode}>+55</Text>
                            <TextInput
                                style={[styles.phoneInput, {
                                    color: isDarkMode ? '#fff' : colors.BLACK,
                                    backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                                }]}
                                placeholder="11 99999-9999"
                                placeholderTextColor={isDarkMode ? '#999' : '#999'}
                                value={newPhone}
                                onChangeText={(text) => setNewPhone(formatPhoneNumber(text))}
                                keyboardType="phone-pad"
                                maxLength={14}
                            />
                        </View>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonCancel]}
                                onPress={() => {
                                    setShowPhoneModal(false);
                                    setNewPhone('');
                                }}
                            >
                                <Text style={styles.modalButtonTextCancel}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleSendPhoneOTP}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.modalButtonTextConfirm}>Enviar Código</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal para OTP do telefone */}
            <Modal
                visible={showPhoneOTPModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowPhoneOTPModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Código de Verificação</Text>
                            <TouchableOpacity onPress={() => setShowPhoneOTPModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Digite o código de 6 dígitos recebido por SMS no número {newPhone}
                        </Text>

                        <TextInput
                            style={[styles.modalInput, {
                                color: isDarkMode ? '#fff' : colors.BLACK,
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                            }]}
                            placeholder="Código de 6 dígitos"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            value={phoneOTP}
                            onChangeText={setPhoneOTP}
                            keyboardType="number-pad"
                            maxLength={6}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonCancel]}
                                onPress={() => {
                                    setShowPhoneOTPModal(false);
                                    setPhoneOTP('');
                                }}
                            >
                                <Text style={styles.modalButtonTextCancel}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleConfirmPhoneOTP}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.modalButtonTextConfirm}>Confirmar</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal para redefinição de senha */}
            <Modal
                visible={showPasswordModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowPasswordModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Redefinir Senha</Text>
                            <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        {!showSupportPasswordOption ? (
                            <>
                                <Text style={[styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Digite sua senha atual e a nova senha para redefinir.
                                </Text>

                                <TextInput
                                    style={[styles.modalInput, {
                                        color: isDarkMode ? '#fff' : colors.BLACK,
                                        backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                                    }]}
                                    placeholder="Senha atual"
                                    placeholderTextColor={isDarkMode ? '#999' : '#999'}
                                    value={currentPassword}
                                    onChangeText={setCurrentPassword}
                                    secureTextEntry
                                />

                                <TextInput
                                    style={[styles.modalInput, {
                                        color: isDarkMode ? '#fff' : colors.BLACK,
                                        backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                                    }]}
                                    placeholder="Nova senha (mínimo 6 caracteres)"
                                    placeholderTextColor={isDarkMode ? '#999' : '#999'}
                                    value={newPassword}
                                    onChangeText={setNewPassword}
                                    secureTextEntry
                                />

                                <TextInput
                                    style={[styles.modalInput, {
                                        color: isDarkMode ? '#fff' : colors.BLACK,
                                        backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                                    }]}
                                    placeholder="Confirmar nova senha"
                                    placeholderTextColor={isDarkMode ? '#999' : '#999'}
                                    value={confirmPassword}
                                    onChangeText={setConfirmPassword}
                                    secureTextEntry
                                />

                                <TouchableOpacity
                                    style={styles.supportLink}
                                    onPress={() => setShowSupportPasswordOption(true)}
                                >
                                    <Text style={[styles.supportLinkText, { color: MAIN_COLOR }]}>
                                        Esqueci minha senha / Contatar suporte
                                    </Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <Text style={[styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Para redefinir sua senha via suporte, nossa equipe irá verificar sua identidade e realizar a redefinição de forma segura.
                                </Text>
                                <TouchableOpacity
                                    style={styles.supportLink}
                                    onPress={() => setShowSupportPasswordOption(false)}
                                >
                                    <Text style={[styles.supportLinkText, { color: MAIN_COLOR }]}>
                                        Voltar para redefinição com senha atual
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonCancel]}
                                onPress={() => {
                                    setShowPasswordModal(false);
                                    setCurrentPassword('');
                                    setNewPassword('');
                                    setConfirmPassword('');
                                    setShowSupportPasswordOption(false);
                                }}
                            >
                                <Text style={styles.modalButtonTextCancel}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleConfirmPasswordReset}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.modalButtonTextConfirm}>
                                        {showSupportPasswordOption ? 'Contatar Suporte' : 'Confirmar'}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ActionSheet para upload de imagens */}
            {uploadImage()}
        </View>
    );
}


const styles = StyleSheet.create({
    pickerStyle: {
        color: colors.HEADER,
        width: 200,
        fontSize: 15,
        height: 40,
        marginBottom: 27,
        margin: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.HEADER,

    },
    container: {
        height: '100%',
        width: '100%',
    },
    vew: {
        borderTopLeftRadius: 130,
        height: '100%',
        alignItems: 'flex-end'
    },
    textInputContainerStyle: {
        width: '100%',
        height: 82,
        borderRadius: 10,
        marginVertical: 10,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 3,
        },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 3,
        backgroundColor: colors.WHITE
    },

    textInputContainerStyle1: {
        width: '100%',
        height: 60,
        borderRadius: 10,
        marginVertical: -3,
        backgroundColor: colors.WHITE,
        alignItems: 'center',
    },
    vew1: {
        height: '100%',
        borderBottomRightRadius: 120,
        overflow: 'hidden',
        backgroundColor: colors.WHITE,
        width: '100%'
    },
    textInputStyle: {
    },
    inputContainerStyle: {
        width: "100%",
    },
    iconContainer: {
        width: '15%',
        alignItems: 'center'
    },
    gapView: {
        height: 40,
        width: '100%'
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        borderRadius: 40
    },
    registerButton: {
        width: 150,
        height: 50,
        borderColor: colors.TRANSPARENT,
        borderWidth: 0,
        marginTop: 30,
        borderRadius: 10,
        padding: 2
    },
    buttonTitle: {
        fontSize: 16,
        fontFamily: fonts.Regular

    },
    inputTextStyle: {
        color: colors.HEADER,
        fontSize: 13,
        height: 32,
        fontFamily: fonts.Regular
    },
    errorMessageStyle: {
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 0
    },
    containerStyle: {
        flexDirection: 'column',
        width: '100%'
    },
    logo: {
        width: '65%',
        justifyContent: "center",
        height: '15%',
        borderBottomRightRadius: 150,
        shadowColor: "black",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.34,
        shadowRadius: 6.27,
        elevation: 5,
        marginBottom: 5,
    },
    headerStyle: {
        fontSize: 25,
        color: colors.WHITE,
        flexDirection: 'row',
        width: '80%'
    },
    imagePosition: {
        position: 'relative',
    },
    imageStyle: {
        width: 30,
        height: height / 15
    },
    photoResult: {
        alignSelf: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        borderRadius: 10,
        marginLeft: 20,
        marginRight: 20,
        paddingTop: 15,
        paddingBottom: 10,
        marginTop: 15,
        width: '80%',
        height: height / 4
    },
    capturePhoto: {
        width: '70%',
        height: 150,
        alignSelf: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        borderRadius: 10,
        marginTop: 15,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 3,
        backgroundColor: colors.WHITE,
        padding: 2
    },
    capturePhotoTitle: {
        color: colors.BLACK,
        fontSize: 14,
        textAlign: 'center',
        paddingBottom: 15,
        fontFamily: fonts.Regular

    },
    errorPhotoTitle: {
        color: colors.RED,
        fontSize: 13,
        textAlign: 'center',
        paddingBottom: 15,
        fontFamily: fonts.Regular
    },
    photoClick: {
        paddingRight: 48,
        position: 'absolute',
        zIndex: 1,
        marginTop: 18,
        alignSelf: 'flex-end'
    },
    capturePicClick: {
        backgroundColor: colors.WHITE,
        flexDirection: 'row',
        position: 'relative',
        zIndex: 1
    },
    imageStyle: {
        width: 30,
        height: height / 15
    },
    flexView1: {
        flex: 12
    },
    imageFixStyle: {
        alignItems: 'center',
        justifyContent: 'center'
    },
    imageStyle2: {
        width: 150,
        height: height / 15
    },
    myView: {
        flex: 2,
        height: 50,
        width: 1,
        alignItems: 'center'
    },
    myView1: {
        height: height / 18,
        width: 1.5,
        backgroundColor: colors.CONVERTDRIVER_TEXT,
        alignItems: 'center',
        marginTop: 10
    },
    myView2: {
        flex: 20,
        alignItems: 'center',
        justifyContent: 'center'
    },
    myView3: {
        flex: 2.2,
        alignItems: 'center',
        justifyContent: 'center'
    },
    segmentcontrol: {
        color: colors.WHITE,
        fontSize: 18,
        fontFamily: fonts.Regular,
        marginTop: 0,
        alignSelf: "center",
        height: 50
    },
    text1: {
        fontSize: 17,
        left: 10,
        color: colors.PROFILE_PLACEHOLDER_CONTENT,
        fontFamily: fonts.Bold,
        marginTop: 5
    },
    text: {
        color: colors.BLACK,
        fontSize: 18,
        textAlign: 'center',
        fontFamily: fonts.Bold

    },
    textStyle: {
        fontFamily: fonts.Regular
    },
    // Novos estilos para a estrutura do EditProfileScreen
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 45,
        paddingBottom: 16,
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    headerRightContainer: {
        width: 40,
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    profileImageSection: {
        alignItems: 'center',
        marginVertical: 15,
    },
    profileImage: {
        width: 100,
        height: 100,
        borderRadius: 50,
        marginBottom: 10,
    },
    editImageOverlay: {
        position: 'absolute',
        bottom: 10,
        right: 0,
        backgroundColor: MAIN_COLOR,
        borderRadius: 15,
        width: 30,
        height: 30,
        justifyContent: 'center',
        alignItems: 'center',
    },
    editImageText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
        marginBottom: 12,
    },
    fieldContainer: {
        paddingVertical: 12,
        paddingHorizontal: 0,
        marginBottom: 4,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
    fieldHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    fieldLabel: {
        fontSize: 13,
        fontFamily: fonts.Regular,
        marginLeft: 8,
    },
    fieldValue: {
        fontSize: 15,
        fontFamily: fonts.Regular,
    },
    valueContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    editButton: {
        padding: 4,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: width * 0.9,
        borderRadius: 16,
        padding: 20,
        maxHeight: height * 0.8,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    modalDescription: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginBottom: 16,
        lineHeight: 20,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        fontFamily: fonts.Regular,
        marginBottom: 12,
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    modalButtonCancel: {
        backgroundColor: '#f0f0f0',
    },
    modalButtonConfirm: {
        backgroundColor: MAIN_COLOR,
    },
    modalButtonTextCancel: {
        color: colors.BLACK,
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    modalButtonTextConfirm: {
        color: '#fff',
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    supportLink: {
        marginTop: 8,
        marginBottom: 12,
    },
    supportLinkText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textDecorationLine: 'underline',
    },
    phoneInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        marginBottom: 12,
        backgroundColor: '#f8f8f8',
    },
    countryCode: {
        paddingHorizontal: 12,
        fontSize: 16,
        fontFamily: fonts.Regular,
        color: colors.BLACK,
    },
    phoneInput: {
        flex: 1,
        padding: 12,
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
});
