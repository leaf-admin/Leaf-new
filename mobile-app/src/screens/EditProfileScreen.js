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
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common/theme';
import { fonts } from '../common/font';
import { MAIN_COLOR } from '../common/sharedFunctions';
import * as ImagePicker from 'expo-image-picker';

const { width, height } = Dimensions.get('window');

export default function EditProfileScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isEditingEmail, setIsEditingEmail] = useState(false);
    const [isEditingPhone, setIsEditingPhone] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [newPhone, setNewPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Dados do perfil
    const profileData = {
        firstName: auth?.profile?.firstName || '',
        lastName: auth?.profile?.lastName || '',
        email: auth?.profile?.email || '',
        mobile: auth?.profile?.mobile || '',
        profile_image: auth?.profile?.profile_image || null,
        // Campos que podem existir mas não são editáveis
        birthDate: auth?.profile?.birthDate || '',
        cpf: auth?.profile?.cpf || '',
        usertype: auth?.profile?.usertype || '',
        approved: auth?.profile?.approved || false,
    };

    // Componente para alternar entre modo claro/escuro
    function ThemeSwitch({ value, onValueChange }) {
        return (
            <TouchableOpacity 
                style={styles.themeSwitchTouchable}
                onPress={() => onValueChange(!value)}
            >
                <View style={styles.themeSwitchTrack}>
                    <View style={styles.themeSwitchIconBubble}>
                        <Ionicons 
                            name={value ? 'moon' : 'sunny'} 
                            size={16} 
                            color={value ? '#fff' : '#FFD700'} 
                        />
                    </View>
                </View>
            </TouchableOpacity>
        );
    }

    // Header com botão voltar e título
    const Header = () => (
        <View style={[styles.header, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <TouchableOpacity 
                style={[styles.headerButton, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                onPress={() => navigation.goBack()}
            >
                <Icon name="arrow-back" type="material" color={isDarkMode ? '#fff' : colors.BLACK} size={24} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Editar Perfil</Text>
            <View style={styles.headerRightContainer}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                    onPress={() => navigation.navigate('Notifications')}
                >
                    <Icon name="notifications" type="material" color={isDarkMode ? '#fff' : colors.BLACK} size={24} />
                </TouchableOpacity>
                <ThemeSwitch value={isDarkMode} onValueChange={setIsDarkMode} />
            </View>
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
                // Aqui você implementaria o upload da imagem
                console.log('Imagem selecionada:', result.assets[0].uri);
                Alert.alert('Sucesso', 'Foto de perfil atualizada!');
            }
        } catch (error) {
            Alert.alert('Erro', 'Não foi possível selecionar a imagem');
        }
    };

    // Função para alterar e-mail
    const handleEmailChange = () => {
        if (!newEmail.trim()) {
            Alert.alert('Erro', 'Digite um e-mail válido');
            return;
        }

        Alert.alert(
            'Confirmar Alteração',
            `Deseja alterar o e-mail para ${newEmail}?\n\nUm código de confirmação será enviado para o e-mail atual.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { 
                    text: 'Confirmar', 
                    onPress: () => {
                        setIsLoading(true);
                        // Aqui você implementaria o envio do código de confirmação
                        setTimeout(() => {
                            setIsLoading(false);
                            Alert.alert('Código Enviado', 'Verifique seu e-mail atual para o código de confirmação');
                            setIsEditingEmail(false);
                        }, 2000);
                    }
                }
            ]
        );
    };

    // Função para alterar telefone
    const handlePhoneChange = () => {
        if (!newPhone.trim()) {
            Alert.alert('Erro', 'Digite um telefone válido');
            return;
        }

        Alert.alert(
            'Confirmar Alteração',
            `Deseja alterar o telefone para ${newPhone}?\n\nUm código SMS será enviado para o telefone atual.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { 
                    text: 'Confirmar', 
                    onPress: () => {
                        setIsLoading(true);
                        // Aqui você implementaria o envio do SMS
                        setTimeout(() => {
                            setIsLoading(false);
                            Alert.alert('SMS Enviado', 'Verifique seu telefone atual para o código de confirmação');
                            setIsEditingPhone(false);
                        }, 2000);
                    }
                }
            ]
        );
    };

    // Função para redefinir senha
    const handleResetPassword = () => {
        Alert.alert(
            'Redefinir Senha',
            'Um e-mail será enviado com instruções para redefinir sua senha.',
            [
                { text: 'Cancelar', style: 'cancel' },
                { 
                    text: 'Enviar', 
                    onPress: () => {
                        setIsLoading(true);
                        // Aqui você implementaria o envio do e-mail de redefinição
                        setTimeout(() => {
                            setIsLoading(false);
                            Alert.alert('E-mail Enviado', 'Verifique sua caixa de entrada para redefinir a senha');
                        }, 2000);
                    }
                }
            ]
        );
    };

    // Campo de informação (não editável)
    const InfoField = ({ label, value, icon }) => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name={icon} size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>{label}</Text>
            </View>
            <Text style={[styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{value || 'Não informado'}</Text>
        </View>
    );

    // Campo editável
    const EditableField = ({ label, value, icon, isEditing, onEdit, onSave, onCancel, placeholder, onChangeText }) => (
        <View style={[styles.fieldContainer, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
            <View style={styles.fieldHeader}>
                <Ionicons name={icon} size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                <Text style={[styles.fieldLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>{label}</Text>
            </View>
            
            {isEditing ? (
                <View style={styles.editContainer}>
                    <TextInput
                        style={[styles.textInput, { 
                            color: isDarkMode ? '#fff' : colors.BLACK,
                            backgroundColor: isDarkMode ? '#444' : '#fff'
                        }]}
                        value={onChangeText ? onChangeText : value}
                        placeholder={placeholder}
                        placeholderTextColor={isDarkMode ? '#999' : '#999'}
                        onChangeText={onChangeText}
                    />
                    <View style={styles.editButtons}>
                        <TouchableOpacity style={styles.saveButton} onPress={onSave}>
                            <Text style={styles.saveButtonText}>Salvar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
                            <Text style={styles.cancelButtonText}>Cancelar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <View style={styles.valueContainer}>
                    <Text style={[styles.fieldValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{value || 'Não informado'}</Text>
                    <TouchableOpacity style={styles.editButton} onPress={onEdit}>
                        <Ionicons name="pencil" size={16} color={MAIN_COLOR} />
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );

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
                    <Text style={[styles.editImageText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Toque para alterar</Text>
                </View>

                {/* Campos Não Editáveis */}
                <View style={styles.section}>
                    <InfoField label="Nome" value={`${profileData.firstName} ${profileData.lastName}`} icon="person" />
                    {profileData.birthDate && <InfoField label="Data de Nascimento" value={profileData.birthDate} icon="calendar" />}
                    {profileData.cpf && <InfoField label="CPF" value={profileData.cpf} icon="card" />}
                </View>

                {/* Campos Editáveis */}
                <View style={styles.section}>
                    
                    <EditableField
                        label="E-mail"
                        value={profileData.email}
                        icon="mail"
                        isEditing={isEditingEmail}
                        onEdit={() => setIsEditingEmail(true)}
                        onSave={handleEmailChange}
                        onCancel={() => {
                            setIsEditingEmail(false);
                            setNewEmail('');
                        }}
                        placeholder="Digite o novo e-mail"
                        onChangeText={setNewEmail}
                    />

                    <EditableField
                        label="Telefone"
                        value={profileData.mobile}
                        icon="call"
                        isEditing={isEditingPhone}
                        onEdit={() => setIsEditingPhone(true)}
                        onSave={handlePhoneChange}
                        onCancel={() => {
                            setIsEditingPhone(false);
                            setNewPhone('');
                        }}
                        placeholder="Digite o novo telefone"
                        onChangeText={setNewPhone}
                    />
                </View>

                {/* Segurança */}
                <View style={styles.section}>
                    
                    <TouchableOpacity 
                        style={[styles.securityField, { borderBottomColor: isDarkMode ? '#333' : '#f0f0f0' }]}
                        onPress={handleResetPassword}
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
                </View>

                {/* Informações da Conta */}
                <View style={styles.section}>
                    <InfoField label="Tipo de Conta" value="Motorista" icon="person-circle" />
                    <InfoField label="Status" value={profileData.approved ? 'Aprovado' : 'Pendente'} icon="checkmark-circle" />
                </View>
            </ScrollView>
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
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    themeSwitchTouchable: {
        width: 72,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    themeSwitchTrack: {
        width: 72,
        height: 40,
        borderRadius: 20,
        borderWidth: 1.5,
        flexDirection: 'row',
        alignItems: 'center',
        position: 'relative',
        justifyContent: 'space-between',
        paddingHorizontal: 6,
        backgroundColor: '#fff',
        borderColor: '#ddd',
    },
    themeSwitchIconBubble: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#111',
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
        marginBottom: 15,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
        marginBottom: 15,
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
    editContainer: {
        marginTop: 8,
    },
    textInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        fontFamily: fonts.Regular,
        marginBottom: 12,
    },
    editButtons: {
        flexDirection: 'row',
        gap: 10,
    },
    saveButton: {
        backgroundColor: MAIN_COLOR,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        flex: 1,
        alignItems: 'center',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 14,
        fontFamily: fonts.Bold,
    },
    cancelButton: {
        backgroundColor: '#f0f0f0',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        flex: 1,
        alignItems: 'center',
    },
    cancelButtonText: {
        color: colors.BLACK,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    securityField: {
        paddingVertical: 12,
        paddingHorizontal: 0,
        marginBottom: 4,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
}); 