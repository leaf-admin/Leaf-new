import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    StatusBar,
    Platform,
    Image,
    Alert,
    ActivityIndicator,
    Switch,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { cardTypography } from '../common-local/typography';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logOut } from '../common-local/actions/authactions';
import * as ImagePicker from 'expo-image-picker';
import { updateProfileImage } from '../common-local/actions/authactions';


const { width } = require('react-native').Dimensions.get('window');

export default function SettingsScreen({ navigation }) {
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [userData, setUserData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadUserData();
    }, []);

    const loadUserData = async () => {
        try {
            setIsLoading(true);
            const storedUserData = await AsyncStorage.getItem('@user_data');
            if (storedUserData) {
                const data = JSON.parse(storedUserData);
                setUserData(data);
            }
        } catch (error) {
            Logger.error('Erro ao carregar dados do usuário:', error);
        } finally {
            setIsLoading(false);
        }
    };

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

    const handleCameraPress = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão negada', 'É necessário permitir acesso à galeria para alterar a foto.');
                return;
            }
            
            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const image = result.assets[0];
                if (image.uri) {
                    try {
                        const response = await fetch(image.uri);
                        const blob = await response.blob();
                        const result = await updateProfileImage(blob, image.uri);
                        
                        if (result && result.url) {
                            setUserData({ ...userData, profile_image: result.url });
                        }
                        
                        Alert.alert('Sucesso', 'Foto de perfil atualizada com sucesso!');
                    } catch (e) {
                        Logger.error('Erro ao atualizar foto:', e);
                        Alert.alert('Erro', `Não foi possível atualizar a foto: ${e.message}`);
                    }
                }
            }
        } catch (err) {
            Logger.error('Erro ao selecionar imagem:', err);
            Alert.alert('Erro', String(err));
        }
    };

    const userType = auth?.profile?.usertype || auth?.profile?.userType;
    const isDriver = userType === 'driver';

    const menuItems = [
        ...(isDriver ? [
            { id: 'profile', title: 'Editar Perfil', icon: 'person-outline', screen: 'EditProfile' },
            { id: 'documents', title: 'Documentos', icon: 'document-text-outline', screen: 'DriverDocuments' },
            { id: 'earnings', title: 'Relatório de Ganhos', icon: 'cash-outline', screen: 'MyEarning' },
            { id: 'vehicles', title: 'Meus Veículos', icon: 'car-outline', screen: 'Cars' },
        ] : [
            { id: 'profile', title: 'Editar Perfil', icon: 'person-outline', screen: 'EditProfileScreen' },
        ]),
        { id: 'trips', title: 'Histórico de Viagens', icon: 'time-outline', screen: 'RideListScreen' },
        { id: 'messages', title: 'Mensagens', icon: 'chatbubbles-outline', screen: 'Messages' },
        { id: 'settings', title: 'Configurações', icon: 'settings-outline', screen: 'Settings' },
        { id: 'help', title: 'Ajuda', icon: 'help-circle-outline', screen: 'Help' },
        { id: 'ride-flow-test', title: '🧪 Testar Fluxo de Corrida', icon: 'car-sport-outline', screen: 'RideFlowTest' },
    ];

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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                Configurações
            </Text>
            <View style={styles.headerRightContainer} />
        </View>
    );

    const ProfileSection = () => (
        <View style={[styles.profileSection, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
            <View style={styles.profileImageWrapper}>
                {userData?.profile_image ? (
                    <Image
                        source={{ uri: userData.profile_image }}
                        style={styles.profileImage}
                    />
                ) : (
                    <View style={styles.profileImageFallback}>
                        <Text style={styles.profileImageInitials}>
                            {(userData?.firstName?.[0] || '').toUpperCase()}
                            {(userData?.lastName?.[0] || '').toUpperCase()}
                        </Text>
                    </View>
                )}
                <TouchableOpacity style={styles.cameraIcon} onPress={handleCameraPress}>
                    <Ionicons name="camera" size={18} color="#fff" />
                </TouchableOpacity>
            </View>
            <Text style={[styles.profileName, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                {userData?.firstName} {userData?.lastName}
            </Text>
            <Text style={[cardTypography.subtitle, styles.profileEmail, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                {userData?.email}
            </Text>
            <TouchableOpacity 
                style={styles.editProfileButton}
                onPress={() => navigation.navigate(isDriver ? 'EditProfile' : 'EditProfileScreen')}
            >
                <Text style={[cardTypography.title, styles.editProfileButtonText]}>Editar Perfil</Text>
            </TouchableOpacity>
        </View>
    );

    const MenuItem = ({ item }) => (
        <TouchableOpacity
            style={[styles.menuItem, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}
            onPress={() => navigation.navigate(item.screen)}
            activeOpacity={0.7}
        >
            <View style={[styles.menuIconContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}>
                <Ionicons 
                    name={item.icon} 
                    size={22} 
                    color={isDarkMode ? '#fff' : MAIN_COLOR} 
                />
            </View>
            <Text style={[cardTypography.title, styles.menuText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                {item.title}
            </Text>
            <Ionicons 
                name="chevron-forward" 
                size={20} 
                color={isDarkMode ? '#666' : colors.GRAY} 
            />
        </TouchableOpacity>
    );

    const LogoutButton = () => (
        <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.7}
        >
            <Ionicons name="log-out-outline" size={22} color="#FF3B30" />
            <Text style={[cardTypography.title, styles.logoutText]}>Logout</Text>
        </TouchableOpacity>
    );

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5' }]}>
                <Header />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={MAIN_COLOR} />
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            <Header />
            
            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <ProfileSection />
                
                <View style={styles.menuContainer}>
                    {menuItems.map((item) => (
                        <MenuItem key={item.id} item={item} />
                    ))}
                </View>

                <LogoutButton />

                <Text style={[cardTypography.subtitle, styles.appVersion, { color: isDarkMode ? '#666' : colors.GRAY }]}>
                    Versão 1.0.0
                </Text>
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
        paddingTop: Platform.OS === 'ios' ? 50 : 24,
        paddingBottom: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
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
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    profileSection: {
        alignItems: 'center',
        paddingVertical: 24,
        marginTop: 16,
        marginHorizontal: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    profileImageWrapper: {
        position: 'relative',
        marginBottom: 12,
    },
    profileImage: {
        width: 100,
        height: 100,
        borderRadius: 50,
    },
    profileImageFallback: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: '#e0e0e0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    profileImageInitials: {
        fontSize: 32,
        fontFamily: fonts.Bold,
        color: '#999',
    },
    cameraIcon: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        backgroundColor: MAIN_COLOR,
        borderRadius: 16,
        padding: 6,
        borderWidth: 2,
        borderColor: '#fff',
    },
    profileName: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        marginTop: 8,
        marginBottom: 4,
    },
    profileEmail: {
        // Usa cardTypography.subtitle via style prop
        marginBottom: 16,
    },
    editProfileButton: {
        backgroundColor: MAIN_COLOR,
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderRadius: 20,
    },
    editProfileButtonText: {
        color: '#fff',
        // Usa cardTypography.title via style prop
    },
    menuContainer: {
        marginTop: 16,
        marginHorizontal: 16,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
    menuIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    menuText: {
        flex: 1,
        // Usa cardTypography.title via style prop
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 24,
        marginBottom: 16,
        marginHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 16,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#FF3B30',
    },
    logoutText: {
        color: '#FF3B30',
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginLeft: 8,
    },
    appVersion: {
        textAlign: 'center',
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginBottom: 24,
    },
});
