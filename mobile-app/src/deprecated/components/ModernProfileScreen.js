import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    Platform,
    StatusBar,
    Animated,
    ScrollView,
    Image,
    Alert,
    ActivityIndicator
} from 'react-native';
import { MaterialCommunityIcons, Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { fonts } from '../common/font';

const { width, height } = Dimensions.get('window');

const ModernProfileScreen = ({ navigation, route }) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [profileData, setProfileData] = useState({
        name: 'João Silva',
        email: 'joao@email.com',
        phone: '+55 (11) 99999-9999',
        rating: 4.8,
        trips: 127,
        memberSince: '2023',
        profileImage: null
    });

    // Animações
    const [fadeAnim] = useState(new Animated.Value(0));
    const [slideAnim] = useState(new Animated.Value(30));
    const [scaleAnim] = useState(new Animated.Value(1));
    const [headerAnim] = useState(new Animated.Value(0));

    const currentTheme = isDarkMode ? darkTheme : lightTheme;

    useEffect(() => {
        // Animação de entrada
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.timing(headerAnim, {
                toValue: 1,
                duration: 1000,
                useNativeDriver: true,
            })
        ]).start();
    }, []);

    const handlePress = () => {
        Animated.sequence([
            Animated.timing(scaleAnim, {
                toValue: 0.95,
                duration: 100,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
            })
        ]).start();
    };

    const renderProfileHeader = () => {
        return (
            <Animated.View
                style={[
                    styles.profileHeader,
                    {
                        opacity: headerAnim,
                        transform: [
                            {
                                translateY: headerAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [-50, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                <LinearGradient
                    colors={isDarkMode ? ['#2d2d2d', '#1a1a1a'] : ['#4CAF50', '#2E7D32']}
                    style={styles.headerGradient}
                >
                    {/* Botão de voltar */}
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <MaterialCommunityIcons
                            name="arrow-left"
                            size={24}
                            color="#fff"
                        />
                    </TouchableOpacity>

                    {/* Foto do perfil */}
                    <View style={styles.profileImageContainer}>
                        <View style={styles.profileImageWrapper}>
                            {profileData.profileImage ? (
                                <Image
                                    source={{ uri: profileData.profileImage }}
                                    style={styles.profileImage}
                                />
                            ) : (
                                <View style={styles.profileImagePlaceholder}>
                                    <MaterialCommunityIcons
                                        name="account"
                                        size={40}
                                        color="#fff"
                                    />
                                </View>
                            )}
                            <TouchableOpacity
                                style={styles.editImageButton}
                                onPress={() => Alert.alert('Editar foto')}
                            >
                                <MaterialCommunityIcons
                                    name="camera"
                                    size={16}
                                    color="#fff"
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Informações do usuário */}
                    <View style={styles.userInfo}>
                        <Text style={styles.userName}>{profileData.name}</Text>
                        <View style={styles.ratingContainer}>
                            <MaterialCommunityIcons
                                name="star"
                                size={16}
                                color="#FFD700"
                            />
                            <Text style={styles.ratingText}>{profileData.rating}</Text>
                            <Text style={styles.tripsText}>({profileData.trips} viagens)</Text>
                        </View>
                        <Text style={styles.memberText}>
                            Membro desde {profileData.memberSince}
                        </Text>
                    </View>
                </LinearGradient>
            </Animated.View>
        );
    };

    const renderStatsCard = () => {
        const stats = [
            { label: 'Viagens', value: profileData.trips, icon: 'car' },
            { label: 'Avaliação', value: profileData.rating, icon: 'star' },
            { label: 'Economia', value: 'R$ 1.250', icon: 'wallet' },
        ];

        return (
            <Animated.View
                style={[
                    styles.statsCard,
                    {
                        backgroundColor: currentTheme.card,
                        opacity: fadeAnim,
                        transform: [
                            {
                                translateY: slideAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [30, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                {stats.map((stat, index) => (
                    <View key={index} style={styles.statItem}>
                        <View style={[
                            styles.statIcon,
                            { backgroundColor: `${currentTheme.primary}15` }
                        ]}>
                            <MaterialCommunityIcons
                                name={stat.icon}
                                size={20}
                                color={currentTheme.primary}
                            />
                        </View>
                        <Text style={[
                            styles.statValue,
                            { color: currentTheme.text }
                        ]}>
                            {stat.value}
                        </Text>
                        <Text style={[
                            styles.statLabel,
                            { color: currentTheme.textSecondary }
                        ]}>
                            {stat.label}
                        </Text>
                    </View>
                ))}
            </Animated.View>
        );
    };

    const renderMenuSection = (title, items) => {
        return (
            <Animated.View
                style={[
                    styles.menuSection,
                    {
                        opacity: fadeAnim,
                        transform: [
                            {
                                translateY: slideAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [30, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                <Text style={[
                    styles.sectionTitle,
                    { color: currentTheme.text }
                ]}>
                    {title}
                </Text>
                <View style={[
                    styles.menuCard,
                    { backgroundColor: currentTheme.card }
                ]}>
                    {items.map((item, index) => (
                        <TouchableOpacity
                            key={index}
                            style={[
                                styles.menuItem,
                                index < items.length - 1 && {
                                    borderBottomWidth: 1,
                                    borderBottomColor: currentTheme.divider
                                }
                            ]}
                            onPress={() => {
                                handlePress();
                                item.onPress();
                            }}
                        >
                            <View style={styles.menuItemLeft}>
                                <View style={[
                                    styles.menuIcon,
                                    { backgroundColor: `${item.iconColor}15` }
                                ]}>
                                    <MaterialCommunityIcons
                                        name={item.icon}
                                        size={20}
                                        color={item.iconColor}
                                    />
                                </View>
                                <View style={styles.menuText}>
                                    <Text style={[
                                        styles.menuTitle,
                                        { color: currentTheme.text }
                                    ]}>
                                        {item.title}
                                    </Text>
                                    {item.subtitle && (
                                        <Text style={[
                                            styles.menuSubtitle,
                                            { color: currentTheme.textSecondary }
                                        ]}>
                                            {item.subtitle}
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <MaterialCommunityIcons
                                name="chevron-right"
                                size={20}
                                color={currentTheme.textSecondary}
                            />
                        </TouchableOpacity>
                    ))}
                </View>
            </Animated.View>
        );
    };

    const accountItems = [
        {
            title: 'Editar Perfil',
            subtitle: 'Alterar informações pessoais',
            icon: 'account-edit',
            iconColor: '#4CAF50',
            onPress: () => navigation.navigate('EditProfile')
        },
        {
            title: 'Configurações',
            subtitle: 'Preferências do app',
            icon: 'cog',
            iconColor: '#2196F3',
            onPress: () => navigation.navigate('Settings')
        },
        {
            title: 'Carteira',
            subtitle: 'Saldo e pagamentos',
            icon: 'wallet',
            iconColor: '#FF9800',
            onPress: () => navigation.navigate('WalletDetails')
        }
    ];

    const supportItems = [
        {
            title: 'Ajuda',
            subtitle: 'Central de suporte',
            icon: 'help-circle',
            iconColor: '#9C27B0',
            onPress: () => Alert.alert('Ajuda')
        },
        {
            title: 'Sobre',
            subtitle: 'Informações do app',
            icon: 'information',
            iconColor: '#607D8B',
            onPress: () => navigation.navigate('About')
        },
        {
            title: 'Sair',
            subtitle: 'Fazer logout',
            icon: 'logout',
            iconColor: '#F44336',
            onPress: () => Alert.alert('Sair', 'Deseja sair da conta?')
        }
    ];

    return (
        <View style={[styles.container, { backgroundColor: currentTheme.background }]}>
            <StatusBar 
                barStyle="light-content"
                backgroundColor="transparent"
                translucent
            />

            {renderProfileHeader()}

            <ScrollView 
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {renderStatsCard()}
                {renderMenuSection('Conta', accountItems)}
                {renderMenuSection('Suporte', supportItems)}

                {/* Espaço extra no final */}
                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    profileHeader: {
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 30,
    },
    headerGradient: {
        paddingHorizontal: 24,
        paddingBottom: 20,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    profileImageContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    profileImageWrapper: {
        position: 'relative',
    },
    profileImage: {
        width: 100,
        height: 100,
        borderRadius: 50,
    },
    profileImagePlaceholder: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    editImageButton: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#4CAF50',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: '#fff',
    },
    userInfo: {
        alignItems: 'center',
    },
    userName: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        color: '#fff',
        marginBottom: 8,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    ratingText: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        color: '#fff',
        marginLeft: 4,
    },
    tripsText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: 'rgba(255, 255, 255, 0.8)',
        marginLeft: 4,
    },
    memberText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        color: 'rgba(255, 255, 255, 0.7)',
    },
    scrollView: {
        flex: 1,
        marginTop: -20,
    },
    scrollContent: {
        paddingHorizontal: 24,
    },
    statsCard: {
        borderRadius: 20,
        padding: 24,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 6,
    },
    statItem: {
        alignItems: 'center',
        flex: 1,
    },
    statIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    statValue: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
    menuSection: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 12,
        marginLeft: 4,
    },
    menuCard: {
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    menuItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    menuIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    menuText: {
        flex: 1,
    },
    menuTitle: {
        fontSize: 16,
        fontFamily: fonts.SemiBold,
        marginBottom: 2,
    },
    menuSubtitle: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
});

export default ModernProfileScreen; 