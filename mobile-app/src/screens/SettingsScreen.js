import React, { useState, useEffect, useContext } from "react";
import { StyleSheet, View, Text, TouchableOpacity, Alert, StatusBar, ScrollView, Image, Platform, Clipboard } from "react-native";
import { Icon } from "react-native-elements";
import i18n from '../i18n';
import { useSelector, useDispatch } from "react-redux";
import { api } from 'common';
import { FirebaseContext } from 'common/src/config/configureFirebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@react-navigation/native';
import { fonts } from "../common/font";
import { logOut, updateProfileImage } from 'common/src/actions/authactions';
import { colors, lightTheme } from '../common/theme';
import { FontAwesome, Ionicons, MaterialIcons, MaterialCommunityIcons, Entypo } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function SettingsScreen(props) {
    const { t } = i18n;
    const dispatch = useDispatch();
    const [userData, setUserData] = useState(null);
    const [userSince, setUserSince] = useState(null);
    const theme = useTheme()?.colors ? useTheme() : { colors: lightTheme };

    useEffect(() => {
        props.navigation.setOptions({ headerShown: false });
        (async () => {
            const storedUserData = await AsyncStorage.getItem('@user_data');
            if (storedUserData) {
                const data = JSON.parse(storedUserData);
                let createdAt = data?.createdAt;
                if (createdAt) {
                    // Suporta timestamp ou string ISO
                    let dateObj = new Date(createdAt);
                    if (!isNaN(dateObj.getTime())) {
                        setUserSince(dateObj);
                    }
                }
                setUserData(data);
            } else {
                Alert.alert(
                    'Sessão Expirada',
                    'Sua sessão expirou. Por favor, faça login novamente.',
                    [
                        { text: 'OK', onPress: () => props.navigation.navigate('Login') }
                    ]
                );
            }
        })();
    }, []);

    const menuList = [
        { name: 'Configurações do Perfil', navigationName: 'Profile', icon: 'account-cog-outline', type: 'material-community' },
        { name: 'Documentos', navigationName: 'editUser', icon: 'description', type: 'materialIcons' },
        { name: 'Ganhos', navigationName: 'MyEarning', icon: 'attach-money', type: 'materialIcons' },
        { name: 'Veículos', navigationName: 'Cars', icon: 'car-cog', type: 'material-community' },
        { name: 'Indique e Ganhe', navigationName: 'Refer', icon: 'cash-outline', type: 'ionicon' },
        { name: 'SOS', navigationName: 'Sos', icon: 'radio-outline', type: 'ionicon' },
        { name: 'Notificações', navigationName: 'Notifications', icon: 'notifications-outline', type: 'ionicon' },
        { name: 'Reclamações', navigationName: 'Complain', icon: 'chatbox-ellipses-outline', type: 'ionicon' },
        { name: 'Sobre', navigationName: 'About', icon: 'info', type: 'entypo' },
        { name: 'Sair', icon: 'logout', navigationName: 'Logout', type: 'antdesign' }
    ];

    // Filtrar menuList conforme o tipo de usuário
    const iconMap = {
        'account-cog-outline': 'user-cog',
        'cash-outline': 'money-bill',
        'radio-outline': 'car',
        'notifications-outline': 'bell',
        'chatbox-ellipses-outline': 'comments',
        'logout': 'sign-out',
    };
    const filteredMenuList = menuList.filter(item => {
        if (['editUser', 'MyEarning', 'Cars'].includes(item.navigationName)) {
            return userData?.usertype === 'driver';
        }
        return true;
    }).map(item => ({
        ...item,
        icon: iconMap[item.icon] || item.icon
    }));

    const handleLogout = () => {
        Alert.alert(
            'Sair',
            'Tem certeza que deseja sair?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sair', style: 'destructive', onPress: () => dispatch(logOut()) }
            ]
        );
    };

    // Função para abrir a galeria e atualizar a foto do perfil
    const handleCameraPress = async () => {
        try {
            console.log('[Camera] Solicitando permissão para galeria...');
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão negada', 'É necessário permitir acesso à galeria para alterar a foto.');
                return;
            }
            console.log('[Camera] Permissão concedida. Abrindo galeria...');
            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7,
            });
            console.log('[Galeria] Resultado:', result);
            if (!result) {
                Alert.alert('Erro', 'A galeria não retornou resultado.');
                return;
            }
            if (result.canceled) {
                Alert.alert('Cancelado', 'A seleção de imagem foi cancelada.');
                return;
            }
            if (!result.assets || !result.assets.length) {
                Alert.alert('Erro', 'Nenhuma imagem foi selecionada.');
                return;
            }
            const image = result.assets[0];
            if (image.uri) {
                let response;
                try {
                    console.log('[Upload] Iniciando fetch da URI:', image.uri);
                    response = await fetch(image.uri);
                    console.log('[Upload] response do fetch:', response);
                } catch (fetchErr) {
                    console.error('[Upload] Erro no fetch da URI:', fetchErr);
                    Alert.alert('Erro', 'Não foi possível acessar a imagem selecionada.');
                    return;
                }
                let blob;
                try {
                    blob = await response.blob();
                    console.log('[Upload] Blob obtido:', blob);
                } catch (blobErr) {
                    console.error('[Upload] Erro ao converter para Blob:', blobErr);
                    Alert.alert('Erro', 'Não foi possível processar a imagem selecionada.');
                    return;
                }
                try {
                    console.log('[Upload] Chamando updateProfileImage...');
                    const result = await updateProfileImage(blob, image.uri);
                    console.log('[Upload] updateProfileImage concluído com sucesso!');
                    
                    // Atualizar o estado com a URL de download
                    if (result && result.url) {
                        setUserData({ ...userData, profile_image: result.url });
                    }
                    
                    Alert.alert('Sucesso', 'Foto de perfil atualizada com sucesso!');
                } catch (e) {
                    console.error('[Upload] Erro ao atualizar foto de perfil:', e);
                    
                    // Tratar erro de autenticação especificamente
                    if (e.message.includes('sessão expirou') || e.message.includes('login novamente')) {
                        Alert.alert(
                            'Sessão Expirada', 
                            'Sua sessão expirou. É necessário fazer login novamente para atualizar a foto de perfil.',
                            [
                                { text: 'OK', onPress: () => {
                                    // Redirecionar para tela de login
                                    props.navigation.navigate('Login');
                                }}
                            ]
                        );
                    } else {
                        Alert.alert('Erro', `Não foi possível atualizar a foto: ${e.message}`);
                    }
                }
            }
        } catch (err) {
            console.error('[Camera/Galeria] Erro global:', err);
            Alert.alert('Erro global', String(err));
        }
    };

    // Função para copiar o referralId
    const handleCopyReferral = () => {
        if (userData?.referralId) {
            Clipboard.setString(userData.referralId);
            Alert.alert('Código copiado!', 'Seu código de indicação foi copiado para a área de transferência.');
        }
    };

    // Lista de opções do menu atualizada
    const menuOptions = [
        { label: 'Começar a dirigir', isMain: true, onPress: () => props.navigation.navigate('ConvertToDriver') },
        { label: 'Minhas viagens', icon: <MaterialIcons name="history" size={22} color="#222" />, onPress: () => props.navigation.navigate('RideListPage') },
        { label: 'Carteira', icon: <MaterialCommunityIcons name="wallet" size={22} color="#222" />, onPress: () => props.navigation.navigate('WalletDetails') },
        { separator: true },
        { label: 'Log Out', icon: <MaterialCommunityIcons name="logout" size={22} color="#D32F2F" />, onPress: handleLogout, isLogout: true },
    ];

    return (
        <View style={[styles.container, { backgroundColor: '#f5f1f1' }]}> 
            <StatusBar barStyle={Platform.OS === 'ios' ? 'dark-content' : 'default'} backgroundColor={'#f5f1f1'} />
            {/* Header */}
            <View style={styles.headerRowProfile}>
                <TouchableOpacity onPress={() => props.navigation.goBack()} style={styles.headerIconBtn}>
                    <Ionicons name="arrow-back" size={26} color="#222" />
                </TouchableOpacity>
                <Text style={styles.headerTitleProfile}>My Profile</Text>
                <TouchableOpacity style={styles.headerIconBtn}>
                    <Ionicons name="settings-outline" size={24} color="#222" />
                </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.scrollContentProfile} showsVerticalScrollIndicator={false}>
                {/* Foto, nome, e-mail, botão */}
                <View style={styles.profileBlockProfile}>
                    <View style={styles.profileImageSection}>
                        <View style={styles.profileImageWrapperProfile}>
                            {userData?.profile_image ? (
                                <Image
                                    source={{ uri: userData.profile_image }}
                                    style={styles.profileImageProfile}
                                />
                            ) : (
                                <View style={styles.profileImageFallbackProfile}>
                                    <Text style={styles.profileImageInitialsProfile}>
                                        {(userData?.firstName?.[0] || '').toUpperCase()}
                                        {(userData?.lastName?.[0] || '').toUpperCase()}
                                    </Text>
                                </View>
                            )}
                            <TouchableOpacity style={styles.cameraIconProfile} onPress={handleCameraPress}>
                                <Ionicons name="camera" size={20} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>
                    <Text style={styles.profileNameProfile}>{userData?.firstName} {userData?.lastName}</Text>
                    <Text style={styles.profileEmailProfile}>{userData?.email}</Text>
                    <TouchableOpacity style={styles.editProfileBtn} onPress={() => props.navigation.navigate('Profile')}>
                        <Text style={styles.editProfileBtnText}>Edit Profile</Text>
                    </TouchableOpacity>
                </View>
                {/* Lista de opções */}
                <View style={styles.menuListProfile}>
                    {menuOptions.map((item, idx) =>
                        item.separator ? (
                            <View key={idx} style={styles.menuSeparatorProfile} />
                        ) : item.isMain ? (
                            <TouchableOpacity
                                key={item.label}
                                style={styles.mainMenuBtn}
                                onPress={item.onPress}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.mainMenuBtnText}>{item.label}</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                key={item.label}
                                style={[styles.menuItemProfile, item.isLogout && styles.menuItemLogoutProfile]}
                                onPress={item.onPress}
                                activeOpacity={0.7}
                            >
                                <View style={styles.menuIconProfile}>{item.icon}</View>
                                <Text style={[styles.menuTextProfile, item.isLogout && styles.menuTextLogoutProfile]}>{item.label}</Text>
                                <Entypo name="chevron-right" size={20} color={item.isLogout ? '#D32F2F' : '#B0B0B0'} style={{ marginLeft: 'auto' }} />
                            </TouchableOpacity>
                        )
                    )}
                </View>
                {/* Versão do app */}
                <Text style={styles.appVersionProfile}>App version 003</Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    title: {
        fontFamily: fonts.Bold,
        fontSize: 22,
        color: '#111',
        textAlign: 'center',
        marginTop: 36,
        marginBottom: 8,
        letterSpacing: 0.1,
    },
    profileHeader: {
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 32,
    },
    profileImageWrapper: {
        width: 150,
        height: 150,
        borderRadius: 75,
        backgroundColor: '#f3f3f3',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
        position: 'relative',
    },
    profileImage: {
        width: 140,
        height: 140,
        borderRadius: 70,
    },
    profileImageFallback: {
        width: 140,
        height: 140,
        borderRadius: 70,
        backgroundColor: '#eaeaea',
        justifyContent: 'center',
        alignItems: 'center',
    },
    profileImageInitials: {
        color: '#7C8288',
        fontSize: 32,
        fontFamily: fonts.Bold,
    },
    profileName: {
        fontSize: 28,
        fontFamily: fonts.Bold,
        color: theme => theme?.colors?.text || '#111',
        textAlign: 'center',
        maxWidth: 320,
        marginBottom: 6,
    },
    profileStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
        gap: 4,
    },
    profileStatus: {
        fontSize: 16,
        fontFamily: fonts.Regular,
        color: '#1a330e',
        textAlign: 'center',
        marginRight: 8,
    },
    profileRating: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        color: '#1a330e',
        marginLeft: 0,
        marginRight: 2,
    },
    profileStarIcon: {
        marginLeft: 0,
        marginTop: 1,
    },
    profileSince: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        color: '#666',
        textAlign: 'center',
        marginBottom: 0,
    },
    infoCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        paddingVertical: 18,
        paddingHorizontal: 24,
        marginHorizontal: 32,
        marginBottom: 24,
        alignItems: 'center',
        shadowColor: 'transparent',
        elevation: 0,
    },
    infoValue: {
        fontSize: 16,
        color: '#222',
        fontFamily: fonts.Regular,
        marginBottom: 2,
        textAlign: 'center',
    },
    menuCardContainer: {
        marginTop: 8,
        marginBottom: 32,
        paddingHorizontal: 0,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'transparent',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
        marginBottom: 2,
        marginHorizontal: 16,
        elevation: 0,
    },
    menuIconWrapper: {
        width: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    menuText: {
        fontSize: 17,
        fontFamily: fonts.Medium,
        color: '#222',
        letterSpacing: 0.1,
    },
    menuTextLogout: {
        color: '#D32F2F',
        fontFamily: fonts.Bold,
    },
    cameraIconWrapper: {
        position: 'absolute',
        bottom: 8,
        alignSelf: 'center',
        backgroundColor: '#1a330e',
        borderRadius: 16,
        padding: 5,
        borderWidth: 2,
        borderColor: '#fff',
        zIndex: 2,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 48 : 24,
        paddingBottom: 8,
        backgroundColor: '#f5f1f1',
    },
    closeButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        color: '#1a330e',
        textAlign: 'center',
    },
    referralBox: {
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 18,
        marginTop: 18,
        marginBottom: 8,
        alignSelf: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
    },
    referralLabel: {
        fontSize: 13,
        color: '#888',
        fontFamily: fonts.Regular,
        marginBottom: 2,
    },
    referralId: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        color: '#1a330e',
        letterSpacing: 2,
    },
    partnerButton: {
        backgroundColor: '#1a330e',
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 32,
        alignSelf: 'center',
        marginTop: 10,
        marginBottom: 18,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
    },
    partnerButtonText: {
        color: '#fff',
        fontSize: 18,
        fontFamily: fonts.Bold,
        letterSpacing: 0.5,
    },
    headerRowProfile: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: Platform.OS === 'ios' ? 48 : 24,
        paddingBottom: 8,
        backgroundColor: '#f5f1f1',
    },
    headerIconBtn: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitleProfile: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        color: '#222',
        textAlign: 'center',
    },
    profileImageSection: {
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 8,
    },
    profileImageWrapperProfile: {
        width: 90,
        height: 90,
        borderRadius: 45,
        backgroundColor: '#eaeaea',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    profileImageProfile: {
        width: 86,
        height: 86,
        borderRadius: 43,
    },
    profileImageFallbackProfile: {
        width: 86,
        height: 86,
        borderRadius: 43,
        backgroundColor: '#d6d6d6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    profileImageInitialsProfile: {
        fontSize: 28,
        fontFamily: fonts.Bold,
        color: '#888',
    },
    cameraIconProfile: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        backgroundColor: '#1a330e',
        borderRadius: 14,
        padding: 5,
        borderWidth: 2,
        borderColor: '#fff',
        zIndex: 2,
    },
    profileNameProfile: {
        fontSize: 19,
        fontFamily: fonts.Bold,
        color: '#222',
        textAlign: 'center',
        marginTop: 10,
        marginBottom: 2,
        letterSpacing: 0.1,
    },
    profileEmailProfile: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        color: '#888',
        textAlign: 'center',
        marginBottom: 10,
        marginTop: 0,
    },
    editProfileBtn: {
        backgroundColor: '#41D274',
        borderRadius: 8,
        paddingVertical: 9,
        paddingHorizontal: 28,
        alignSelf: 'center',
        marginBottom: 6,
        marginTop: 2,
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 2,
        elevation: 1,
    },
    editProfileBtnText: {
        color: '#fff',
        fontSize: 15,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        letterSpacing: 0.1,
    },
    menuListProfile: {
        backgroundColor: '#fff',
        borderRadius: 18,
        marginHorizontal: 16,
        marginBottom: 18,
        paddingVertical: 2,
        paddingHorizontal: 0,
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
    },
    menuItemProfile: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 15,
        paddingHorizontal: 18,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    menuItemLogoutProfile: {
        borderBottomWidth: 0,
    },
    menuIconProfile: {
        width: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    menuTextProfile: {
        fontSize: 16,
        fontFamily: fonts.Regular,
        color: '#222',
    },
    menuTextLogoutProfile: {
        color: '#D32F2F',
        fontFamily: fonts.Bold,
    },
    menuSeparatorProfile: {
        height: 1,
        backgroundColor: '#f0f0f0',
        marginHorizontal: 18,
    },
    appVersionProfile: {
        color: '#bbb',
        fontSize: 13,
        textAlign: 'center',
        marginTop: 18,
        marginBottom: 8,
    },
    mainMenuBtn: {
        backgroundColor: '#41D274',
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 32,
        alignSelf: 'center',
        marginVertical: 12,
        marginHorizontal: 18,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
    },
    mainMenuBtnText: {
        color: '#fff',
        fontSize: 17,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        letterSpacing: 0.5,
    },
    scrollContentProfile: {
        flexGrow: 1,
        justifyContent: 'flex-start',
        paddingBottom: 18,
    },
    profileBlockProfile: {
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 18,
        paddingHorizontal: 8,
    },
});
