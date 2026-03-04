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
    Linking,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import AppInfoService from '../services/AppInfoService';

export default function AboutScreen({ navigation }) {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [selectedTab, setSelectedTab] = useState('overview');
    const [appInfo, setAppInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadAppInfo();
    }, []);

    const loadAppInfo = async () => {
        try {
            setIsLoading(true);
            const result = await AppInfoService.getAppInfo();
            if (result.success) {
                setAppInfo(result.appInfo);
            }
        } catch (error) {
            Logger.error('Erro ao carregar informações do app:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const tabs = [
        { id: 'overview', label: 'Visão Geral', icon: 'information-circle-outline' },
        { id: 'features', label: 'Recursos', icon: 'star-outline' },
        { id: 'legal', label: 'Legal', icon: 'document-text-outline' },
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
                Sobre o App
            </Text>
            <TouchableOpacity 
                style={[
                    styles.headerButton, 
                    { 
                        backgroundColor: isDarkMode ? '#2d2d2d' : '#e8e8e8',
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#404040' : '#d0d0d0',
                    }
                ]}
                onPress={() => navigation.navigate('Help')}
                activeOpacity={0.7}
            >
                <Ionicons name="help-circle-outline" size={22} color={isDarkMode ? '#fff' : '#1a1a1a'} />
            </TouchableOpacity>
        </View>
    );

    const Tabs = () => (
        <View style={[styles.tabsContainer, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            {tabs.map((tab) => (
                <TouchableOpacity
                    key={tab.id}
                    style={[
                        styles.tab,
                        selectedTab === tab.id && styles.tabActive,
                        { backgroundColor: selectedTab === tab.id ? MAIN_COLOR : 'transparent' }
                    ]}
                    onPress={() => setSelectedTab(tab.id)}
                >
                    <Ionicons 
                        name={tab.icon} 
                        size={20} 
                        color={selectedTab === tab.id ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY)} 
                    />
                    <Text style={[
                        styles.tabText,
                        { color: selectedTab === tab.id ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                    ]}>
                        {tab.label}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );

    const handleLinkPress = (url, title) => {
        Alert.alert(
            'Abrir Link',
            `Deseja abrir ${title}?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Abrir', onPress: () => Linking.openURL(url) }
            ]
        );
    };

    const renderOverview = () => {
        if (isLoading || !appInfo) {
            return (
                <View style={styles.tabContent}>
                    <ActivityIndicator size="large" color={MAIN_COLOR} />
                </View>
            );
        }

        return (
            <View style={styles.tabContent}>
                <View style={[styles.appHeader, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                    <View style={[styles.appLogo, { backgroundColor: isDarkMode ? '#333' : '#f0f0f0' }]}>
                        <Ionicons name="leaf" size={48} color={MAIN_COLOR} />
                    </View>
                    <Text style={[styles.appName, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Leaf</Text>
                    <Text style={[styles.appTagline, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                        Mobilidade Inteligente
                    </Text>
                    <Text style={[styles.appVersion, { color: isDarkMode ? '#666' : colors.GRAY }]}>
                        Versão {appInfo.version}
                    </Text>
                </View>

                <View style={[styles.descriptionCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                    <Text style={[styles.descriptionText, { color: isDarkMode ? '#ccc' : colors.BLACK }]}>
                        A Leaf é uma plataforma de mobilidade urbana que conecta passageiros 
                        a motoristas parceiros de forma segura, rápida e eficiente. 
                        Nossa missão é transformar a forma como as pessoas se movem pela cidade.
                    </Text>
                </View>

                <View style={styles.statsContainer}>
                    <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <Text style={[styles.statNumber, { color: MAIN_COLOR }]}>50K+</Text>
                        <Text style={[styles.statLabel, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                            Usuários Ativos
                        </Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <Text style={[styles.statNumber, { color: MAIN_COLOR }]}>100K+</Text>
                        <Text style={[styles.statLabel, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                            Viagens Realizadas
                        </Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <Text style={[styles.statNumber, { color: MAIN_COLOR }]}>4.8</Text>
                        <Text style={[styles.statLabel, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                            Avaliação Média
                        </Text>
                    </View>
                </View>

                <View style={[styles.contactCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Entre em Contato
                    </Text>
                    <TouchableOpacity
                        style={styles.contactItem}
                        onPress={() => Linking.openURL('mailto:contato@leaf.com.br')}
                    >
                        <Ionicons name="mail-outline" size={20} color={MAIN_COLOR} />
                        <Text style={[styles.contactText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            contato@leaf.com.br
                        </Text>
                        <Ionicons name="chevron-forward" size={20} color={isDarkMode ? '#666' : colors.GRAY} />
                    </TouchableOpacity>
                </View>
            </View>
        );

    const renderFeatures = () => (
        <View style={styles.tabContent}>
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                Recursos Principais
            </Text>

            {[
                { icon: 'card-outline', title: 'Pagamento PIX', description: 'Pagamento instantâneo e seguro via PIX' },
                { icon: 'shield-checkmark-outline', title: 'Segurança Total', description: 'Motoristas verificados e viagens monitoradas' },
                { icon: 'location-outline', title: 'Rastreamento em Tempo Real', description: 'Acompanhe sua viagem em tempo real' },
                { icon: 'chatbubbles-outline', title: 'Suporte 24/7', description: 'Suporte ao cliente disponível 24 horas' },
            ].map((feature, index) => (
                <View 
                    key={index}
                    style={[styles.featureCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}
                >
                    <View style={[styles.featureIcon, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}>
                        <Ionicons name={feature.icon} size={24} color={MAIN_COLOR} />
                    </View>
                    <View style={styles.featureContent}>
                        <Text style={[styles.featureTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            {feature.title}
                        </Text>
                        <Text style={[styles.featureDescription, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                            {feature.description}
                        </Text>
                    </View>
                </View>
            ))}
        </View>
    );

    const renderLegal = () => (
        <View style={styles.tabContent}>
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                Informações Legais
            </Text>

            <View style={[styles.legalCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <TouchableOpacity
                    style={styles.legalItem}
                    onPress={() => navigation.navigate('PrivacyPolicy')}
                >
                    <Ionicons name="lock-closed-outline" size={20} color={MAIN_COLOR} />
                    <Text style={[styles.legalText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Política de Privacidade
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color={isDarkMode ? '#666' : colors.GRAY} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.legalItem}
                    onPress={() => navigation.navigate('Legal')}
                >
                    <Ionicons name="document-text-outline" size={20} color={MAIN_COLOR} />
                    <Text style={[styles.legalText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Termos de Uso
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color={isDarkMode ? '#666' : colors.GRAY} />
                </TouchableOpacity>
            </View>

            <View style={[styles.legalInfo, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <Text style={[styles.legalInfoTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                    Informações da Aplicação
                </Text>
                <Text style={[styles.legalInfoText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                    Versão: 1.0.0
                </Text>
                <Text style={[styles.legalInfoText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                    Build: 1
                </Text>
                <Text style={[styles.legalInfoText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                    © 2025 Leaf. Todos os direitos reservados.
                </Text>
            </View>
        </View>
    );

    const renderTabContent = () => {
        switch (selectedTab) {
            case 'overview':
                return renderOverview();
            case 'features':
                return renderFeatures();
            case 'legal':
                return renderLegal();
            default:
                return null;
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            <Header />
            <Tabs />

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {renderTabContent()}
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
    tabsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
        gap: 8,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        gap: 6,
    },
    tabActive: {
        // backgroundColor já definido inline
    },
    tabText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
    content: {
        flex: 1,
    },
    tabContent: {
        padding: 16,
    },
    appHeader: {
        alignItems: 'center',
        padding: 24,
        borderRadius: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    appLogo: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    appName: {
        fontSize: 28,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    appTagline: {
        fontSize: 16,
        fontFamily: fonts.Regular,
        marginBottom: 8,
    },
    appVersion: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    descriptionCard: {
        padding: 16,
        borderRadius: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    descriptionText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        lineHeight: 20,
        textAlign: 'center',
    },
    statsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 16,
    },
    statCard: {
        flex: 1,
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    statNumber: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        textAlign: 'center',
    },
    contactCard: {
        padding: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 16,
    },
    contactItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        gap: 12,
    },
    contactText: {
        flex: 1,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    featureCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    featureIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    featureContent: {
        flex: 1,
    },
    featureTitle: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    featureDescription: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        lineHeight: 20,
    },
    legalCard: {
        borderRadius: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        overflow: 'hidden',
    },
    legalItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
        gap: 12,
    },
    legalText: {
        flex: 1,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    legalInfo: {
        padding: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    legalInfoTitle: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginBottom: 12,
    },
    legalInfoText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
});
};