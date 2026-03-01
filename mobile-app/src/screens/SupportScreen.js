import Logger from '../utils/Logger';
import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    StatusBar,
    Platform,
    ActivityIndicator,
    FlatList,
    Alert,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import WebSocketManager from '../services/WebSocketManager';
import SupportService from '../services/SupportService';
import SupportChatService from '../services/SupportChatService';


export default function SupportScreen({ navigation }) {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [selectedTab, setSelectedTab] = useState('chat');
    const [message, setMessage] = useState('');
    const [chatMessages, setChatMessages] = useState([]);
    const [isTyping, setIsTyping] = useState(false);
    const [tickets, setTickets] = useState([]);
    const [faqs, setFaqs] = useState([]);
    const [expandedFaq, setExpandedFaq] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    
    const auth = useSelector(state => state.auth);
    const currentUser = auth.profile;
    const wsManager = WebSocketManager.getInstance();
    const chatRef = useRef(null);

    useEffect(() => {
        loadSupportData();
        connectChat();
        initializeSupportChat();
        
        // Cleanup ao desmontar
        return () => {
            SupportChatService.disconnect();
        };
    }, []);

    const loadSupportData = async () => {
        try {
            setIsLoading(true);
            const userId = currentUser?.uid || currentUser?.id;
            
            if (userId) {
                // ✅ Carregar tickets (para problemas graves) e FAQ
                // Chat em tempo real é carregado separadamente via initializeSupportChat
                const [ticketsResult, faqResult] = await Promise.all([
                    SupportService.getTickets(userId),
                    SupportService.getFAQ()
                ]);
                
                if (ticketsResult.success) {
                    setTickets(ticketsResult.tickets || []);
                }
                if (faqResult.success) {
                    setFaqs(faqResult.faqs || []);
                }
            }
        } catch (error) {
            Logger.error('❌ Erro ao carregar dados de suporte:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const connectChat = async () => {
        try {
            if (!wsManager.isConnected()) {
                await wsManager.connect();
            }
        } catch (error) {
            Logger.error('Erro ao conectar chat de suporte:', error);
        }
    };

    const initializeSupportChat = async () => {
        try {
            const userId = currentUser?.uid || currentUser?.id;
            if (!userId) return;

            // Inicializar chat de suporte
            await SupportChatService.initialize(userId);

            // Carregar mensagens existentes
            const messages = await SupportChatService.getMessages(userId);
            setChatMessages(messages.map(msg => ({
                id: msg.id,
                text: msg.message,
                sender: msg.senderType === 'user' ? 'user' : 'support',
                timestamp: msg.timestamp
            })));

            // Escutar novas mensagens em tempo real
            const unsubscribe = SupportChatService.onNewMessage((newMessage) => {
                Logger.log('💬 Nova mensagem recebida:', newMessage);
                setChatMessages(prev => {
                    // Evitar duplicatas
                    if (prev.find(m => m.id === newMessage.id)) {
                        return prev;
                    }
                    return [...prev, {
                        id: newMessage.id,
                        text: newMessage.message,
                        sender: newMessage.senderType === 'user' ? 'user' : 'support',
                        timestamp: newMessage.timestamp
                    }];
                });
            }, userId);

            // Armazenar função de cleanup
            return unsubscribe;

        } catch (error) {
            Logger.error('❌ Erro ao inicializar chat de suporte:', error);
        }
    };

    const sendMessage = async () => {
        if (!message.trim()) return;
        
        try {
            const userId = currentUser?.uid || currentUser?.id;
            if (!userId) {
                Alert.alert('Erro', 'Usuário não identificado');
                return;
            }

            const messageText = message.trim();
            setMessage(''); // Limpar campo imediatamente para melhor UX

            // ✅ Adicionar mensagem localmente primeiro (otimista)
            const tempMessage = {
                id: `temp-${Date.now()}`,
                text: messageText,
                sender: 'user',
                timestamp: new Date().toISOString()
            };
            setChatMessages(prev => [...prev, tempMessage]);

            // ✅ Enviar via SupportChatService (chat em tempo real)
            Logger.log('💬 Enviando mensagem no chat de suporte...');
            const result = await SupportChatService.sendMessage(messageText, userId);
            
            if (result.success) {
                // Substituir mensagem temporária pela real
                setChatMessages(prev => {
                    const filtered = prev.filter(m => m.id !== tempMessage.id);
                    return [...filtered, {
                        id: result.messageId,
                        text: result.message.message,
                        sender: 'user',
                        timestamp: result.message.timestamp
                    }];
                });

                // Marcar como lida
                await SupportChatService.markAsRead(userId);
            } else {
                // Remover mensagem temporária em caso de erro
                setChatMessages(prev => prev.filter(m => m.id !== tempMessage.id));
                Alert.alert('Erro', result.error || 'Não foi possível enviar a mensagem');
                setMessage(messageText); // Restaurar mensagem
            }
        } catch (error) {
            Logger.error('❌ Erro ao enviar mensagem:', error);
            Alert.alert('Erro', error.message || 'Não foi possível enviar a mensagem');
            setMessage(message.trim()); // Restaurar mensagem
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
                Suporte
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
            <TouchableOpacity
                style={[
                    styles.tab,
                    selectedTab === 'chat' && styles.tabActive,
                    { backgroundColor: selectedTab === 'chat' ? MAIN_COLOR : 'transparent' }
                ]}
                onPress={() => setSelectedTab('chat')}
            >
                <Ionicons 
                    name="chatbubbles-outline" 
                    size={20} 
                    color={selectedTab === 'chat' ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY)} 
                />
                <Text style={[
                    styles.tabText,
                    { color: selectedTab === 'chat' ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                ]}>
                    Chat
                </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
                style={[
                    styles.tab,
                    selectedTab === 'tickets' && styles.tabActive,
                    { backgroundColor: selectedTab === 'tickets' ? MAIN_COLOR : 'transparent' }
                ]}
                onPress={() => setSelectedTab('tickets')}
            >
                <Ionicons 
                    name="document-text-outline" 
                    size={20} 
                    color={selectedTab === 'tickets' ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY)} 
                />
                <Text style={[
                    styles.tabText,
                    { color: selectedTab === 'tickets' ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                ]}>
                    Tickets
                </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
                style={[
                    styles.tab,
                    selectedTab === 'faq' && styles.tabActive,
                    { backgroundColor: selectedTab === 'faq' ? MAIN_COLOR : 'transparent' }
                ]}
                onPress={() => setSelectedTab('faq')}
            >
                <Ionicons 
                    name="help-circle-outline" 
                    size={20} 
                    color={selectedTab === 'faq' ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY)} 
                />
                <Text style={[
                    styles.tabText,
                    { color: selectedTab === 'faq' ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                ]}>
                    FAQ
                </Text>
            </TouchableOpacity>
        </View>
    );

    const renderChat = () => (
        <View style={styles.chatContainer}>
            <View style={[styles.chatHeader, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <View style={styles.supportInfo}>
                    <View style={[styles.avatarContainer, { backgroundColor: MAIN_COLOR }]}>
                        <Ionicons name="headset-outline" size={24} color="#fff" />
                    </View>
                    <View style={styles.supportDetails}>
                        <Text style={[styles.supportName, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            Suporte Leaf
                        </Text>
                        <Text style={[styles.supportStatus, { color: '#4CAF50' }]}>Online</Text>
                    </View>
                </View>
            </View>
            
            <FlatList
                ref={chatRef}
                data={chatMessages}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                    <View style={[
                        styles.messageContainer,
                        item.sender === 'user' ? styles.userMessage : styles.supportMessage
                    ]}>
                        <Text style={[
                            styles.messageText,
                            item.sender === 'user' ? styles.userMessageText : styles.supportMessageText
                        ]}>
                            {item.text}
                        </Text>
                        <Text style={styles.messageTime}>
                            {new Date(item.timestamp).toLocaleTimeString('pt-BR', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                            })}
                        </Text>
                    </View>
                )}
                style={styles.messagesList}
                contentContainerStyle={styles.messagesContent}
                onContentSizeChange={() => chatRef.current?.scrollToEnd()}
            />
            
            {isTyping && (
                <View style={styles.typingIndicator}>
                    <Text style={[styles.typingText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                        Suporte está digitando...
                    </Text>
                </View>
            )}
            
            <View style={[styles.inputContainer, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                <TextInput
                    style={[styles.messageInput, { 
                        backgroundColor: isDarkMode ? '#333' : '#f8f8f8',
                        color: isDarkMode ? '#fff' : colors.BLACK
                    }]}
                    value={message}
                    onChangeText={setMessage}
                    placeholder="Digite sua mensagem..."
                    placeholderTextColor={isDarkMode ? '#666' : colors.GRAY}
                    multiline
                    maxLength={500}
                />
                <TouchableOpacity
                    style={[styles.sendButton, !message.trim() && styles.sendButtonDisabled]}
                    onPress={sendMessage}
                    disabled={!message.trim()}
                >
                    <Ionicons name="send" size={20} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderTickets = () => (
        <View style={styles.ticketsContainer}>
            {tickets.length > 0 ? (
                <FlatList
                    data={tickets}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={[styles.ticketCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}
                            onPress={() => navigation.navigate('TicketDetails', { ticket: item })}
                        >
                            <View style={styles.ticketHeader}>
                                <Text style={[styles.ticketTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                    {item.title || 'Ticket #' + item.id}
                                </Text>
                                <View style={[styles.statusBadge, { backgroundColor: '#4CAF50' }]}>
                                    <Text style={styles.statusText}>{item.status || 'Aberto'}</Text>
                                </View>
                            </View>
                            <Text style={[styles.ticketDescription, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                                {item.description || 'Sem descrição'}
                            </Text>
                        </TouchableOpacity>
                    )}
                />
            ) : (
                <View style={styles.emptyState}>
                    <Ionicons name="document-text-outline" size={64} color={isDarkMode ? '#666' : colors.GRAY} />
                    <Text style={[styles.emptyTitle, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                        Nenhum ticket encontrado
                    </Text>
                    <Text style={[styles.emptySubtitle, { color: isDarkMode ? '#666' : colors.GRAY }]}>
                        Crie um novo ticket para obter ajuda
                    </Text>
                </View>
            )}
        </View>
    );

    const faqData = [
        { question: 'Como entrar em contato com o suporte?', answer: 'Você pode entrar em contato através do chat em tempo real, criando um ticket ou enviando um e-mail para suporte@leaf.com.br' },
        { question: 'Qual o horário de atendimento?', answer: 'Nosso suporte está disponível 24 horas por dia, 7 dias por semana.' },
        { question: 'Como criar um ticket?', answer: 'Na aba "Tickets", toque em "Novo Ticket" e preencha as informações solicitadas.' },
    ];

    const renderFAQ = () => (
        <View style={styles.faqContainer}>
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                Perguntas Frequentes
            </Text>
            
            {faqData.map((item, index) => (
                <View 
                    key={index}
                    style={[styles.faqCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}
                >
                    <TouchableOpacity
                        style={styles.faqHeader}
                        onPress={() => setExpandedFaq(expandedFaq === index ? null : index)}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.faqQuestion, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            {item.question}
                        </Text>
                        <Ionicons 
                            name={expandedFaq === index ? "chevron-up" : "chevron-down"} 
                            size={20} 
                            color={isDarkMode ? '#999' : colors.GRAY} 
                        />
                    </TouchableOpacity>
                    {expandedFaq === index && (
                        <Text style={[styles.faqAnswer, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            {item.answer}
                        </Text>
                    )}
                </View>
            ))}
        </View>
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
            <Tabs />

            <View style={styles.content}>
                {selectedTab === 'chat' && renderChat()}
                {selectedTab === 'tickets' && renderTickets()}
                {selectedTab === 'faq' && renderFAQ()}
            </View>
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    chatContainer: {
        flex: 1,
    },
    chatHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
    supportInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    supportDetails: {
        flex: 1,
    },
    supportName: {
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    supportStatus: {
        fontSize: 12,
        fontFamily: fonts.Regular,
    },
    messagesList: {
        flex: 1,
    },
    messagesContent: {
        padding: 16,
    },
    messageContainer: {
        marginBottom: 12,
        maxWidth: '80%',
    },
    userMessage: {
        alignSelf: 'flex-end',
        backgroundColor: MAIN_COLOR,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    supportMessage: {
        alignSelf: 'flex-start',
        backgroundColor: '#f0f0f0',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    messageText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
    userMessageText: {
        color: '#fff',
    },
    supportMessageText: {
        color: colors.BLACK,
    },
    messageTime: {
        fontSize: 10,
        fontFamily: fonts.Regular,
        color: colors.GRAY,
        alignSelf: 'flex-end',
    },
    typingIndicator: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    typingText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        fontStyle: 'italic',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderTopWidth: 0.5,
        borderTopColor: '#f0f0f0',
        gap: 8,
    },
    messageInput: {
        flex: 1,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        maxHeight: 100,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: MAIN_COLOR,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonDisabled: {
        backgroundColor: '#ccc',
    },
    ticketsContainer: {
        flex: 1,
        padding: 16,
    },
    ticketCard: {
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    ticketHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    ticketTitle: {
        flex: 1,
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 10,
        fontFamily: fonts.Bold,
        color: '#fff',
    },
    ticketDescription: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        lineHeight: 20,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlign: 'center',
    },
    faqContainer: {
        flex: 1,
        padding: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 16,
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
