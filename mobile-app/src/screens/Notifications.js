import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    Dimensions,
    Platform,
    StatusBar
} from 'react-native';
import { Icon } from 'react-native-elements';
import { colors } from '../common/theme';
import i18n from '../i18n';
import { useSelector, useDispatch } from 'react-redux';
import { api } from '../common-local/api';
import moment from 'moment/min/moment-with-locales';
import { MAIN_COLOR } from '../common/sharedFunctions';
import { fonts } from '../common/font';


export default function Notifications(props) {
    const { t } = i18n;
    const { getNotifications } = api;
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const [loading, setLoading] = useState(true);
    const [notifications, setNotifications] = useState([]);
    const [isDarkMode, setIsDarkMode] = useState(false);

    // Tema dinâmico baseado no modo escuro/claro
    const theme = {
        background: isDarkMode ? '#1A1A1A' : '#FFFFFF',
        card: isDarkMode ? '#2A2A2A' : '#FFFFFF',
        text: isDarkMode ? '#FFFFFF' : '#000000',
        textSecondary: isDarkMode ? '#AAAAAA' : '#666666',
        border: isDarkMode ? '#333333' : '#E0E0E0',
        icon: isDarkMode ? '#FFFFFF' : '#000000',
    };

    useEffect(() => {
        loadNotifications();
    }, []);

    const loadNotifications = async () => {
        try {
            setLoading(true);
            
            // Verificar se getNotifications existe e se temos um UID
            if (!getNotifications || typeof getNotifications !== 'function') {
                Logger.error('getNotifications não está disponível no api');
                return;
            }

            const uid = auth?.profile?.uid || auth?.profile?.id;
            if (!uid) {
                Logger.warn('UID do usuário não encontrado');
                setNotifications([]);
                return;
            }

            const response = await getNotifications(uid);
            if (response && Array.isArray(response) && response.length > 0) {
                setNotifications(response);
            } else {
                setNotifications([]);
            }
        } catch (error) {
            Logger.error('Erro ao carregar notificações:', error);
            setNotifications([]);
        } finally {
            setLoading(false);
        }
    };

    const renderNotification = ({ item }) => (
        <TouchableOpacity 
            style={[styles.notificationCard, { backgroundColor: theme.card }]}
            onPress={() => {
                if (item.type === 'booking') {
                    props.navigation.navigate('RideDetails', { bookingId: item.bookingId });
                }
            }}
        >
            <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? '#333333' : '#F5F5F5' }]}>
                <Icon
                    name={item.type === 'booking' ? 'directions-car' : 'notifications'}
                    type="material"
                    color={theme.icon}
                    size={24}
                />
            </View>
            <View style={styles.notificationContent}>
                <Text style={[styles.notificationTitle, { color: theme.text }]}>{item.title}</Text>
                <Text style={[styles.notificationMessage, { color: theme.textSecondary }]}>{item.message}</Text>
                <Text style={[styles.notificationTime, { color: theme.textSecondary }]}>
                    {moment(item.createdAt).fromNow()}
                </Text>
            </View>
        </TouchableOpacity>
    );

        return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar hidden={true} />
            
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.card }]}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: theme.card }]}
                    onPress={() => props.navigation.goBack()}
                >
                    <Icon name="arrow-back" type="material" color={theme.icon} size={24} />
                </TouchableOpacity>
                
                <Text style={[styles.headerTitle, { color: theme.text }]}>Notificações</Text>
                
                <View style={styles.headerRightContainer}>
                    <TouchableOpacity 
                        style={[styles.headerButton, { backgroundColor: theme.card }]}
                        onPress={() => setIsDarkMode(!isDarkMode)}
                    >
                            <Icon
                            name={isDarkMode ? "light-mode" : "dark-mode"} 
                            type="material" 
                            color={theme.icon} 
                            size={24} 
                        />
                    </TouchableOpacity>
                </View>
            </View>

            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={MAIN_COLOR} />
                </View>
            ) : notifications.length > 0 ? (
            <FlatList
                    data={notifications}
                    renderItem={renderNotification}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContainer}
                />
            ) : (
                <View style={styles.emptyContainer}>
                    <Icon
                        name="notifications-off"
                        type="material"
                        color={theme.textSecondary}
                        size={64}
            />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        Nenhuma notificação
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 50 : 40,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    listContainer: {
        padding: 16,
    },
    notificationCard: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    notificationContent: {
        flex: 1,
    },
    notificationTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    notificationMessage: {
        fontSize: 14,
        marginBottom: 8,
    },
    notificationTime: {
        fontSize: 12,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
    },
});