import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    StatusBar,
    Dimensions,
    Image,
    Alert,
    TextInput,
    Modal,
    ActivityIndicator,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { cardTypography } from '../common-local/typography';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from '../components/i18n/LanguageProvider';
import { api } from '../common-local';

const { width, height } = Dimensions.get('window');

export default function EditProfileScreen({ navigation }) {
    const { t } = useTranslation();
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    
    // Estados para edição de email
    const [isEditingEmail, setIsEditingEmail] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState('');
    const [showEmailModal, setShowEmailModal] = useState(false);
    
    // Estados para redefinição de senha
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showSupportPasswordOption, setShowSupportPasswordOption] = useState(false);

    // Determinar tipo de usuário
    const userType = auth?.profile?.usertype || auth?.profile?.userType;
    const isDriver = userType === 'driver';
    const isPassenger = userType === 'customer' || !isDriver;

    // Dados do perfil
    const profileData = {
        firstName: auth?.profile?.firstName || '',
        lastName: auth?.profile?.lastName || '',
        email: auth?.profile?.email || '',
        mobile: auth?.profile?.mobile || '',
        profile_image: auth?.profile?.profile_image || null,
        birthDate: auth?.profile?.birthDate || '',
        cpf: auth?.profile?.cpf || '',
        usertype: userType || '',
        approved: auth?.profile?.approved || false,
    };

    // Se for motorista, redirecionar para EditProfile antigo
    useEffect(() => {
        if (isDriver) {
            navigation.replace('EditProfile');
        }
    }, [isDriver]);

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
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
            >
                <Ionicons 
                    name="arrow-back" 
                    color={isDarkMode ? '#fff' : '#1a1a1a'} 
                    size={22} 
                />
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
                // TODO: Implementar upload da imagem
                Logger.log('Imagem selecionada:', result.assets[0].uri);
                Alert.alert('Sucesso', 'Foto atualizada com sucesso!');
            }
        } catch (error) {
            Alert.alert('Erro', 'Erro ao selecionar imagem');
        }
    };

    // Função para validar email
    const validateEmail = (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // Função para iniciar alteração de email
    const handleStartEmailChange = () => {
        setNewEmail('');
        setCurrentPasswordForEmail('');
        setShowEmailModal(true);
    };

    // Função para confirmar alteração de email
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

        if (newEmail.toLowerCase() === profileData.email.toLowerCase()) {
            Alert.alert('Erro', 'O novo e-mail deve ser diferente do atual');
            return;
        }

        setIsLoading(true);
        try {
            // TODO: Implementar verificação de senha e envio de email de confirmação
            // await api.verifyPassword(currentPasswordForEmail);
            // await api.sendEmailConfirmation(newEmail);
            
            // Simulação
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            Alert.alert(
                'E-mail de confirmação enviado',
                'Enviamos um e-mail de confirmação para o novo endereço. Por favor, verifique sua caixa de entrada e clique no link para confirmar a alteração.',
                [{ text: 'OK', onPress: () => {
                    setShowEmailModal(false);
                    setIsEditingEmail(false);
                    setNewEmail('');
                    setCurrentPasswordForEmail('');
                }}]
            );
        } catch (error) {
            Alert.alert('Erro', error.message || 'Erro ao processar alteração de e-mail');
        } finally {
            setIsLoading(false);
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
            // Redefinição via suporte
            Alert.alert(
                'Contatar Suporte',
                'Para redefinir sua senha via suporte, entre em contato com nossa equipe através do menu "Ajuda" ou "Suporte". Nossa equipe irá verificar sua identidade e realizar a redefinição.',
                [{ text: 'OK', onPress: () => {
                    setShowPasswordModal(false);
                    navigation.navigate('Support');
                }}]
            );
            return;
        }

        // Redefinição com senha atual
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

        setIsLoading(true);
        try {
            // TODO: Implementar verificação de senha atual e atualização
            // await api.verifyPassword(currentPassword);
            // await api.updatePassword(newPassword);
            
            // Simulação
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            Alert.alert(
                'Senha alterada',
                'Sua senha foi alterada com sucesso!',
                [{ text: 'OK', onPress: () => {
                    setShowPasswordModal(false);
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                }}]
            );
        } catch (error) {
            Alert.alert('Erro', error.message || 'Erro ao alterar senha. Verifique se a senha atual está correta.');
        } finally {
            setIsLoading(false);
        }
    };

    // Campo de informação (não editável)
    const InfoField = ({ label, value, icon, locked = false }) => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name={icon} size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[cardTypography.subtitle, styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>{label}</Text>
                {locked && (
                    <Ionicons name="lock-closed" size={14} color={isDarkMode ? '#666' : '#999'} style={{ marginLeft: 6 }} />
                )}
            </View>
            <View style={styles.valueContainer}>
                <Text style={[cardTypography.title, styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{value || 'Não informado'}</Text>
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

    // Campo editável (email)
    const EditableEmailField = () => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name="mail" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[cardTypography.subtitle, styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>E-mail</Text>
            </View>
            <View style={styles.valueContainer}>
                <Text style={[cardTypography.title, styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{profileData.email || 'Não informado'}</Text>
                <TouchableOpacity style={styles.editButton} onPress={handleStartEmailChange}>
                    <Ionicons name="pencil" size={16} color={MAIN_COLOR} />
                </TouchableOpacity>
            </View>
        </View>
    );

    // Campo de senha
    const PasswordField = () => (
        <TouchableOpacity 
            style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}
            onPress={handleStartPasswordReset}
        >
            <View style={styles.fieldHeader}>
                <Ionicons name="lock-closed" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[cardTypography.subtitle, styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Senha</Text>
            </View>
            <View style={styles.valueContainer}>
                <Text style={[cardTypography.title, styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>••••••••</Text>
                <TouchableOpacity style={styles.editButton}>
                    <Ionicons name="refresh" size={16} color={MAIN_COLOR} />
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );

    if (isDriver) {
        return null; // Será redirecionado pelo useEffect
    }

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
                            source={profileData.profile_image ? { uri: profileData.profile_image } : require('../../assets/images/profilePic.png')}
                            style={styles.profileImage}
                        />
                        <View style={styles.editImageOverlay}>
                            <Ionicons name="camera" size={20} color="#fff" />
                        </View>
                    </TouchableOpacity>
                    <Text style={[cardTypography.subtitle, styles.editImageText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Toque para alterar</Text>
                </View>

                {/* Informações Básicas - Não Editáveis */}
                <View style={styles.section}>
                    <Text style={[cardTypography.title, styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Informações Básicas</Text>
                    <InfoField 
                        label="Nome" 
                        value={profileData.firstName} 
                        icon="person" 
                        locked={true}
                    />
                    <InfoField 
                        label="Sobrenome" 
                        value={profileData.lastName} 
                        icon="person-outline" 
                        locked={true}
                    />
                    <InfoField 
                        label="Telefone" 
                        value={profileData.mobile} 
                        icon="call" 
                        locked={true}
                    />
                </View>

                {/* Campos Editáveis */}
                <View style={styles.section}>
                    <Text style={[cardTypography.title, styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Contato</Text>
                    <EditableEmailField />
                </View>

                {/* Segurança */}
                <View style={styles.section}>
                    <Text style={[cardTypography.title, styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Segurança</Text>
                    <PasswordField />
                </View>

                {/* Informações Adicionais */}
                {(profileData.birthDate || profileData.cpf) && (
                    <View style={styles.section}>
                        <Text style={[cardTypography.title, styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Informações Adicionais</Text>
                        {profileData.birthDate && (
                            <InfoField label="Data de Nascimento" value={profileData.birthDate} icon="calendar" />
                        )}
                        {profileData.cpf && (
                            <InfoField label="CPF" value={profileData.cpf} icon="card" />
                        )}
                    </View>
                )}
            </ScrollView>

            {/* Modal para alteração de email */}
            <Modal
                visible={showEmailModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowEmailModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[cardTypography.title, styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Alterar E-mail</Text>
                            <TouchableOpacity onPress={() => setShowEmailModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        
                        <Text style={[cardTypography.subtitle, styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Para alterar seu e-mail, precisamos confirmar sua identidade e enviar um e-mail de confirmação para o novo endereço.
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
                                <Text style={[cardTypography.subtitle, styles.modalButtonTextCancel]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleConfirmEmailChange}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={[cardTypography.title, styles.modalButtonTextConfirm]}>Confirmar</Text>
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
                            <Text style={[cardTypography.title, styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Redefinir Senha</Text>
                            <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        
                        {!showSupportPasswordOption ? (
                            <>
                                <Text style={[cardTypography.subtitle, styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
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
                                    <Text style={[cardTypography.subtitle, styles.supportLinkText, { color: MAIN_COLOR }]}>
                                        Esqueci minha senha / Contatar suporte
                                    </Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <Text style={[cardTypography.subtitle, styles.modalDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Para redefinir sua senha via suporte, nossa equipe irá verificar sua identidade e realizar a redefinição de forma segura.
                                </Text>
                                <TouchableOpacity 
                                    style={styles.supportLink}
                                    onPress={() => setShowSupportPasswordOption(false)}
                                >
                                    <Text style={[cardTypography.subtitle, styles.supportLinkText, { color: MAIN_COLOR }]}>
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
                                <Text style={[cardTypography.subtitle, styles.modalButtonTextCancel]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.modalButton, styles.modalButtonConfirm]}
                                onPress={handleConfirmPasswordReset}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={[cardTypography.title, styles.modalButtonTextConfirm]}>
                                        {showSupportPasswordOption ? 'Contatar Suporte' : 'Confirmar'}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
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
        // Usa cardTypography.subtitle via style prop
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        // Usa cardTypography.title via style prop
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
        // Usa cardTypography.subtitle via style prop
        marginLeft: 8,
    },
    fieldValue: {
        // Usa cardTypography.title via style prop
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
        // Usa cardTypography.title via style prop
    },
    modalDescription: {
        // Usa cardTypography.subtitle via style prop
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
});
