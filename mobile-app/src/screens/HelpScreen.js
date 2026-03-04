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
    ActivityIndicator,
    Dimensions,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import HelpService from '../services/HelpService';


const { width } = Dimensions.get('window');

export default function HelpScreen({ navigation }) {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('getting-started');
    const [expandedItem, setExpandedItem] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [faqData, setFaqData] = useState({});

    const [categories, setCategories] = useState([]);

    useEffect(() => {
        loadHelpData();
    }, []);

    useEffect(() => {
        loadFAQForCategory();
    }, [selectedCategory]);

    const loadHelpData = async () => {
        try {
            setIsLoading(true);
            const result = await HelpService.getHelpContent();
            if (result.success && result.data) {
                setCategories(result.data.categories || []);
            }
        } catch (error) {
            Logger.error('Erro ao carregar dados de ajuda:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadFAQForCategory = async () => {
        try {
            const result = await HelpService.getFAQ(selectedCategory);
            if (result.success) {
                setFaqData(prev => ({
                    ...prev,
                    [selectedCategory]: result.faqs || []
                }));
            }
        } catch (error) {
            Logger.error('Erro ao carregar FAQ:', error);
        }
    };

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
                Ajuda
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
                onPress={() => navigation.navigate('Support')}
                activeOpacity={0.7}
            >
                <Ionicons name="chatbubbles-outline" size={22} color={isDarkMode ? '#fff' : '#1a1a1a'} />
            </TouchableOpacity>
        </View>
    );

    const CategoryTabs = () => {
        // Calcular largura para 3 colunas: (largura da tela - padding horizontal - gaps) / 3
        const cardWidth = (width - 32 - 24) / 3; // 32 = padding horizontal (16*2), 24 = gaps (12*2)
        
        return (
            <View style={[styles.tabsContainer, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                <View style={styles.tabsContent}>
                    {categories.map((category) => (
                        <TouchableOpacity
                            key={category.id}
                            style={[
                                styles.categoryCard,
                                { width: cardWidth },
                                selectedCategory === category.id && styles.categoryCardActive,
                                { 
                                    backgroundColor: selectedCategory === category.id ? MAIN_COLOR : (isDarkMode ? '#2a2a2a' : '#fff'),
                                    borderColor: selectedCategory === category.id ? MAIN_COLOR : (isDarkMode ? '#444' : '#e0e0e0')
                                }
                            ]}
                            onPress={() => setSelectedCategory(category.id)}
                            activeOpacity={0.7}
                        >
                            <View style={[
                                styles.categoryIconContainer,
                                { backgroundColor: selectedCategory === category.id ? 'rgba(255,255,255,0.2)' : (isDarkMode ? '#333' : '#f8f8f8') }
                            ]}>
                                <Ionicons 
                                    name={category.icon} 
                                    size={24} 
                                    color={selectedCategory === category.id ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY)} 
                                />
                            </View>
                            <Text style={[
                                styles.categoryText,
                                { color: selectedCategory === category.id ? '#fff' : (isDarkMode ? '#fff' : colors.BLACK) }
                            ]} numberOfLines={2}>
                                {category.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        );
    };

    const FAQItem = ({ item, index }) => {
        const isExpanded = expandedItem === index;
        return (
            <View style={[styles.faqCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <TouchableOpacity
                    style={styles.faqHeader}
                    onPress={() => setExpandedItem(isExpanded ? null : index)}
                    activeOpacity={0.7}
                >
                    <Text style={[styles.faqQuestion, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        {item.question}
                    </Text>
                    <Ionicons 
                        name={isExpanded ? "chevron-up" : "chevron-down"} 
                        size={20} 
                        color={isDarkMode ? '#999' : colors.GRAY} 
                    />
                </TouchableOpacity>
                {isExpanded && (
                    <Text style={[styles.faqAnswer, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        {item.answer}
                    </Text>
                )}
            </View>
        );
    };

    const GettingStartedSteps = () => (
        <View style={styles.stepsContainer}>
            <View style={[styles.stepCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <View style={[styles.stepNumber, { backgroundColor: MAIN_COLOR }]}>
                    <Text style={styles.stepNumberText}>1</Text>
                </View>
                <View style={styles.stepContent}>
                    <Text style={[styles.stepTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Criar Conta
                    </Text>
                    <Text style={[styles.stepDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        Registre-se com seu telefone e complete seu perfil
                    </Text>
                </View>
            </View>

            <View style={[styles.stepCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <View style={[styles.stepNumber, { backgroundColor: MAIN_COLOR }]}>
                    <Text style={styles.stepNumberText}>2</Text>
                </View>
                <View style={styles.stepContent}>
                    <Text style={[styles.stepTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Definir Destino
                    </Text>
                    <Text style={[styles.stepDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        Digite seu destino no mapa ou escolha um local salvo
                    </Text>
                </View>
            </View>

            <View style={[styles.stepCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <View style={[styles.stepNumber, { backgroundColor: MAIN_COLOR }]}>
                    <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View style={styles.stepContent}>
                    <Text style={[styles.stepTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Pagar e Viajar
                    </Text>
                    <Text style={[styles.stepDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        Pague via PIX e aguarde o motorista chegar
                    </Text>
                </View>
            </View>
        </View>
    );

    const renderContent = () => {
        if (selectedCategory === 'getting-started') {
            return (
                <View style={styles.contentSection}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Bem-vindo à Leaf!
                    </Text>
                    <Text style={[styles.sectionDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        Aprenda como usar o app Leaf para suas viagens de forma segura e eficiente.
                    </Text>
                    <GettingStartedSteps />
                </View>
            );
        }

        const faqs = faqData[selectedCategory] || [];
        if (selectedCategory === 'getting-started') {
            return (
                <View style={styles.contentSection}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Bem-vindo à Leaf!
                    </Text>
                    <Text style={[styles.sectionDescription, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        Aprenda como usar o app Leaf para suas viagens de forma segura e eficiente.
                    </Text>
                    <GettingStartedSteps />
                </View>
            );
        }
        return (
            <View style={styles.contentSection}>
                <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                    Perguntas Frequentes
                </Text>
                {faqs.length > 0 ? (
                    faqs.map((item, index) => (
                        <FAQItem key={index} item={item} index={index} />
                    ))
                ) : (
                    <Text style={[styles.emptyText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                        Nenhuma pergunta frequente disponível para esta categoria.
                    </Text>
                )}
            </View>
        );
    };

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
            <CategoryTabs />

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {renderContent()}
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
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
    tabsContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 12,
    },
    categoryCard: {
        height: 100,
        borderRadius: 16,
        padding: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    categoryCardActive: {
        // backgroundColor já definido inline
    },
    categoryIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    categoryText: {
        fontSize: 13,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        lineHeight: 16,
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
    contentSection: {
        padding: 16,
    },
    sectionTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        marginBottom: 8,
    },
    sectionDescription: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        lineHeight: 20,
        marginBottom: 24,
    },
    stepsContainer: {
        gap: 12,
    },
    stepCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    stepNumber: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    stepNumberText: {
        color: '#fff',
        fontSize: 18,
        fontFamily: fonts.Bold,
    },
    stepContent: {
        flex: 1,
    },
    stepTitle: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    stepDescription: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        lineHeight: 20,
    },
    faqCard: {
        borderRadius: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        overflow: 'hidden',
    },
    faqHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
    },
    faqQuestion: {
        flex: 1,
        fontSize: 15,
        fontFamily: fonts.Medium,
        marginRight: 12,
    },
    faqAnswer: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        lineHeight: 20,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
});
