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
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

export default function ProfileScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    
    // Dados mockados para demonstração - substituir por dados reais
    const userStats = {
        trips: 127,
        kilometers: 2347, // Vai mostrar "2,3k"
        earnings: 15420.50 // Vai mostrar "R$ 15k"
    };

    // Função para formatar valores monetários
    const formatEarnings = (value) => {
        if (value >= 1000) {
            return `R$ ${Math.floor(value / 1000)}k`;
        } else {
            return `R$ ${Math.floor(value)}`;
        }
    };

    // Função para formatar quilômetros
    const formatKilometers = (value) => {
        if (value >= 1000) {
            const kmInK = (value / 1000).toFixed(1);
            return `${kmInK}k`;
        } else {
            return `${value}`;
        }
    };

    // Função para fazer logout
    const handleLogout = () => {
        Alert.alert(
            'Sair do App',
            'Tem certeza que deseja sair?',
            [
                {
                    text: 'Cancelar',
                    style: 'cancel',
                },
                {
                    text: 'Sair',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            // Limpar dados do AsyncStorage
                            await AsyncStorage.removeItem('@user_data');
                            await AsyncStorage.removeItem('@auth_token');
                            
                            // Dispatch para limpar o estado do Redux
                            dispatch({ type: 'LOGOUT' });
                            
                            // Navegar para a tela de login
                            navigation.reset({
                                index: 0,
                                routes: [{ name: 'Welcome' }],
                            });
                        } catch (error) {
                            console.error('Erro ao fazer logout:', error);
                        }
                    },
                },
            ],
            { cancelable: true }
        );
    };

    const menuItems = [
        {
            id: 1,
            title: 'Editar perfil',
            icon: 'person-outline',
            onPress: () => navigation.navigate('EditProfileScreen')
        },
        {
            id: 2,
            title: 'Meus veículos',
            icon: 'car-outline',
            onPress: () => navigation.navigate('MyVehiclesScreen')
        },
        {
            id: 3,
            title: 'Relatório de ganhos',
            icon: 'bar-chart-outline',
            onPress: () => navigation.navigate('EarningsReportScreen', { from: 'menu' })
        },
        {
            id: 4,
            title: 'Histórico de viagens',
            icon: 'time-outline',
            onPress: () => navigation.navigate('DriverTrips')
        },
        {
            id: 5,
            title: 'Configurações',
            icon: 'settings-outline',
            onPress: () => navigation.navigate('SettingsScreen')
        }
    ];

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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Perfil</Text>
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

    // Card de estatísticas
    const StatCard = ({ title, value, color }) => (
        <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#333' : color }]}>
            <Text style={[styles.statTitle, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>{title}</Text>
            <Text style={[styles.statValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{value}</Text>
        </View>
    );

    // Item do menu
    const MenuItem = ({ item }) => (
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: isDarkMode ? '#333' : '#f5f5f5' }]} onPress={item.onPress}>
            <View style={styles.menuItemLeft}>
                <Ionicons name={item.icon} size={22} color={isDarkMode ? '#fff' : colors.BLACK} style={styles.menuIcon} />
                <Text style={[styles.menuItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{item.title}</Text>
            </View>
            <Icon name="chevron-right" type="material" color={isDarkMode ? '#666' : colors.GRAY} size={22} />
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            {/* Header */}
            <Header />
            
            <ScrollView style={[styles.content, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]} showsVerticalScrollIndicator={false}>
                {/* Seção do perfil */}
                <View style={styles.profileSection}>
                    <View style={styles.profileImageContainer}>
                        <Image
                            source={auth?.profile?.profile_image ? { uri: auth.profile.profile_image } : require('../../assets/images/profilePic.png')}
                            style={styles.profileImage}
                        />
                    </View>
                    <View style={styles.profileInfo}>
                        <Text style={[styles.greeting, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Olá,</Text>
                        <Text style={[styles.userName, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{auth?.profile?.firstName || 'Usuário'} {auth?.profile?.lastName || ''}</Text>
                        <Text style={[styles.partnerSince, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Parceiro Leaf desde {new Date().getFullYear()}
                        </Text>
                    </View>
                </View>

                {/* Cards de estatísticas */}
                <View style={styles.statsContainer}>
                    <StatCard 
                        title="Viagens" 
                        value={userStats.trips.toString()} 
                        color="#F0F8F0" 
                    />
                    <StatCard 
                        title="Km rodados" 
                        value={formatKilometers(userStats.kilometers)} 
                        color="#F0F4FF" 
                    />
                    <StatCard 
                        title="Ganhos" 
                        value={formatEarnings(userStats.earnings)} 
                        color="#FFF8F0" 
                    />
                </View>

                {/* Lista de opções */}
                <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                    {menuItems.map((item) => (
                        <MenuItem key={item.id} item={item} />
                    ))}
                </View>

                {/* Botão de Logout */}
                <View style={styles.logoutContainer}>
                    <TouchableOpacity style={[styles.logoutButton, { 
                        backgroundColor: isDarkMode ? '#2a1a1a' : '#FFF5F5',
                        borderColor: isDarkMode ? '#4a2a2a' : '#FFE5E5'
                    }]} onPress={handleLogout}>
                        <Ionicons name="log-out-outline" size={20} color="#FF3B30" style={styles.logoutIcon} />
                        <Text style={styles.logoutText}>Sair do App</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
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
        color: colors.BLACK,
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
    profileSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 25,
        marginBottom: 20,
    },
    profileImageContainer: {
        marginRight: 16,
    },
    profileImage: {
        width: 60,
        height: 60,
        borderRadius: 30,
    },
    profileInfo: {
        flex: 1,
    },
    greeting: {
        fontSize: 14,
        color: colors.GRAY,
        fontFamily: fonts.Regular,
    },
    userName: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.BLACK,
        fontFamily: fonts.Bold,
        marginBottom: 2,
    },
    partnerSince: {
        fontSize: 12,
        color: colors.GRAY,
        fontFamily: fonts.Regular,
    },
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 25,
        paddingHorizontal: 0,
        gap: 8,
    },
    statCard: {
        flex: 1,
        borderRadius: 16,
        padding: 18,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 80,
    },
    statTitle: {
        fontSize: 12,
        color: colors.GRAY,
        fontFamily: fonts.Regular,
        marginBottom: 8,
        textAlign: 'center',
    },
    statValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.BLACK,
        fontFamily: fonts.Bold,
        textAlign: 'center',
    },
    menuContainer: {
        marginBottom: 15,
    },
    menuItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 0,
        borderBottomWidth: 0.5,
    },
    menuItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    menuIcon: {
        marginRight: 12,
    },
    menuItemText: {
        fontSize: 15,
        color: colors.BLACK,
        fontFamily: fonts.Regular,
        marginLeft: 4,
    },
    logoutContainer: {
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 40,
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF5F5',
        borderWidth: 1,
        borderColor: '#FFE5E5',
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 24,
        minWidth: 140,
    },
    logoutIcon: {
        marginRight: 8,
    },
    logoutText: {
        fontSize: 16,
        color: '#FF3B30',
        fontFamily: fonts.Bold,
        fontWeight: '600',
    },
});