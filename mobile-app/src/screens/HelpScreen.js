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
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../theme/runtimeTokens';
import HelpService from '../services/HelpService';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';

const { color, typography } = robotaxiPrototypeTokens;

const { width } = Dimensions.get('window');

export default function HelpScreen({ navigation }) {
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
        <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} activeOpacity={0.86}>
                <Ionicons name="arrow-back" color={color.text.primary} size={18} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Ajuda</Text>
            <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('Support')} activeOpacity={0.86}>
                <Ionicons name="chatbubbles-outline" size={18} color={color.text.primary} />
            </TouchableOpacity>
        </View>
    );

    const CategoryTabs = () => {
        // Calcular largura para 3 colunas: (largura da tela - padding horizontal - gaps) / 3
        const cardWidth = (width - 32 - 24) / 3; // 32 = padding horizontal (16*2), 24 = gaps (12*2)
        
        return (
            <View style={styles.tabsContainer}>
                <View style={styles.tabsContent}>
                    {categories.map((category) => (
                        <TouchableOpacity
                            key={category.id}
                            style={[
                                styles.categoryCard,
                                { width: cardWidth },
                                selectedCategory === category.id && styles.categoryCardActive,
                                {
                                    backgroundColor: selectedCategory === category.id ? color.accent.primary : color.surface.primary,
                                    borderColor: selectedCategory === category.id ? color.accent.primary : color.border.subtle
                                }
                            ]}
                            onPress={() => setSelectedCategory(category.id)}
                            activeOpacity={0.7}
                        >
                            <View style={[
                                styles.categoryIconContainer,
                                { backgroundColor: selectedCategory === category.id ? 'rgba(255,255,255,0.24)' : color.surface.secondary }
                            ]}>
                                <Ionicons 
                                    name={category.icon} 
                                    size={24} 
                                    color={selectedCategory === category.id ? '#fff' : color.text.secondary} 
                                />
                            </View>
                            <Text style={[
                                styles.categoryText,
                                { color: selectedCategory === category.id ? '#fff' : color.text.primary }
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
            <View style={styles.faqCard}>
                <TouchableOpacity
                    style={styles.faqHeader}
                    onPress={() => setExpandedItem(isExpanded ? null : index)}
                    activeOpacity={0.7}
                >
                    <Text style={styles.faqQuestion}>
                        {item.question}
                    </Text>
                    <Ionicons 
                        name={isExpanded ? "chevron-up" : "chevron-down"} 
                        size={20} 
                        color={color.text.secondary} 
                    />
                </TouchableOpacity>
                {isExpanded && (
                    <Text style={styles.faqAnswer}>
                        {item.answer}
                    </Text>
                )}
            </View>
        );
    };

    const GettingStartedSteps = () => (
        <View style={styles.stepsContainer}>
            <View style={styles.stepCard}>
                <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>1</Text>
                </View>
                <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>
                        Criar Conta
                    </Text>
                    <Text style={styles.stepDescription}>
                        Registre-se com seu telefone e complete seu perfil
                    </Text>
                </View>
            </View>

            <View style={styles.stepCard}>
                <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>2</Text>
                </View>
                <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>
                        Definir Destino
                    </Text>
                    <Text style={styles.stepDescription}>
                        Digite seu destino no mapa ou escolha um local salvo
                    </Text>
                </View>
            </View>

            <View style={styles.stepCard}>
                <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>
                        Pagar e Viajar
                    </Text>
                    <Text style={styles.stepDescription}>
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
                    <Text style={styles.sectionTitle}>
                        Bem-vindo à Leaf!
                    </Text>
                    <Text style={styles.sectionDescription}>
                        Aprenda como usar o app Leaf para suas viagens de forma segura e eficiente.
                    </Text>
                    <GettingStartedSteps />
                </View>
            );
        }

        const faqs = faqData[selectedCategory] || [];
        return (
            <View style={styles.contentSection}>
                <Text style={styles.sectionTitle}>
                    Perguntas Frequentes
                </Text>
                {faqs.length > 0 ? (
                    faqs.map((item, index) => (
                        <FAQItem key={index} item={item} index={index} />
                    ))
                ) : (
                    <Text style={styles.emptyText}>
                        Nenhuma pergunta frequente disponível para esta categoria.
                    </Text>
                )}
            </View>
        );
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <Header />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={color.accent.primary} />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={Platform.OS === 'android'} />
            
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
        backgroundColor: color.bg.app
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingTop: Platform.OS === 'ios' ? 54 : 34,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: color.border.subtle
    },
    headerButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: color.surface.primary,
        borderWidth: 1,
        borderColor: color.border.subtle
    },
    headerTitle: {
        fontSize: typography.subtitle.size,
        lineHeight: typography.subtitle.lineHeight,
        fontFamily: fonts.SemiBold,
        color: color.text.primary
    },
    tabsContainer: {
        borderBottomWidth: 1,
        borderBottomColor: color.border.subtle,
        backgroundColor: color.surface.primary
    },
    tabsContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 8,
    },
    categoryCard: {
        height: 94,
        borderRadius: 16,
        padding: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1
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
        marginBottom: 7,
    },
    categoryText: {
        fontSize: typography.micro.size,
        lineHeight: typography.micro.lineHeight,
        fontFamily: fonts.SemiBold,
        textAlign: 'center',
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
        padding: 14,
    },
    sectionTitle: {
        fontSize: typography.subtitle.size,
        lineHeight: typography.subtitle.lineHeight,
        fontFamily: fonts.SemiBold,
        marginBottom: 6,
        color: color.text.primary
    },
    sectionDescription: {
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        fontFamily: fonts.Regular,
        color: color.text.secondary,
        marginBottom: 16
    },
    stepsContainer: {
        gap: 12,
    },
    stepCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: color.border.subtle,
        backgroundColor: color.surface.primary
    },
    stepNumber: {
        width: 34,
        height: 34,
        borderRadius: 17,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
        backgroundColor: color.accent.primary
    },
    stepNumberText: {
        color: '#fff',
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        fontFamily: fonts.SemiBold
    },
    stepContent: {
        flex: 1,
    },
    stepTitle: {
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        fontFamily: fonts.SemiBold,
        color: color.text.primary,
        marginBottom: 3
    },
    stepDescription: {
        fontSize: typography.micro.size,
        lineHeight: typography.micro.lineHeight,
        fontFamily: fonts.Regular,
        color: color.text.secondary
    },
    faqCard: {
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: color.border.subtle,
        backgroundColor: color.surface.primary,
        overflow: 'hidden',
    },
    faqHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12
    },
    faqQuestion: {
        flex: 1,
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        fontFamily: fonts.Medium,
        color: color.text.primary,
        marginRight: 10
    },
    faqAnswer: {
        fontSize: typography.micro.size,
        lineHeight: typography.micro.lineHeight,
        fontFamily: fonts.Regular,
        color: color.text.secondary,
        paddingHorizontal: 12,
        paddingBottom: 12
    },
    emptyText: {
        fontSize: typography.caption.size,
        lineHeight: typography.caption.lineHeight,
        fontFamily: fonts.Regular,
        color: color.text.muted
    }
});
