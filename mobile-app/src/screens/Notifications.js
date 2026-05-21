import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    StatusBar
} from 'react-native';
import i18n from '../i18n';
import { useSelector, useDispatch } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNotifications } from '../services/runtime/notificationsRuntimeBridge';
import moment from 'moment/min/moment-with-locales';
import { MAIN_COLOR } from '../common/sharedFunctions';
import { fonts } from '../common/font';


export default function Notifications(props) {
    const { t } = i18n;
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(true);
    const [notifications, setNotifications] = useState([]);

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
            style={styles.notificationRow}
            activeOpacity={0.78}
            onPress={() => {
                if (item.type === 'booking') {
                    props.navigation.navigate('RideDetails', { bookingId: item.bookingId });
                }
            }}
        >
            <View style={styles.rowDot} />
            <View style={styles.notificationContent}>
                <Text style={styles.notificationTitle} numberOfLines={2}>{item.title}</Text>
                {item.message ? (
                    <Text style={styles.notificationMessage} numberOfLines={2}>{item.message}</Text>
                ) : null}
                <Text style={styles.notificationTime}>
                    {moment(item.createdAt).fromNow()}
                </Text>
            </View>
        </TouchableOpacity>
    );

        return (
        <View style={styles.container}>
            <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

            <View style={[styles.header, { paddingTop: Math.max(insets.top + 26, 58) }]}>
                <TouchableOpacity 
                    style={styles.headerButton}
                    onPress={() => props.navigation.goBack()}
                >
                    <Text style={styles.headerButtonText}>{'<'}</Text>
                </TouchableOpacity>
                
                <View style={styles.headerCopy}>
                    <Text style={styles.headerTitle}>Notificações</Text>
                    <Text style={styles.headerSubtitle}>Defina quais avisos você quer receber.</Text>
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
                    ItemSeparatorComponent={() => <View style={styles.divider} />}
                />
            ) : (
                <View style={styles.emptyContainer}>
                    <View style={styles.emptyDot} />
                    <Text style={styles.emptyText}>Nenhuma notificação</Text>
                    <Text style={styles.emptySubtitle}>Quando houver novidades da sua corrida, elas aparecem aqui.</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F6FAF6',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 31,
        gap: 10,
    },
    headerButton: {
        width: 22,
        height: 30,
        justifyContent: 'center',
        alignItems: 'flex-start',
        marginTop: -2,
    },
    headerButtonText: {
        color: '#102018',
        fontFamily: fonts.SemiBold,
        fontSize: 22,
        lineHeight: 28,
    },
    headerCopy: {
        flex: 1,
    },
    headerTitle: {
        color: '#102018',
        fontFamily: fonts.Medium,
        fontSize: 19,
        lineHeight: 25,
    },
    headerSubtitle: {
        marginTop: 7,
        color: '#66756B',
        fontFamily: fonts.Regular,
        fontSize: 13,
        lineHeight: 18,
    },
    listContainer: {
        paddingHorizontal: 33,
        paddingTop: 42,
        paddingBottom: 34,
    },
    notificationRow: {
        flexDirection: 'row',
        minHeight: 68,
        alignItems: 'flex-start',
        paddingTop: 10,
        gap: 12,
    },
    rowDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#28AD70',
        marginTop: 6,
    },
    notificationContent: {
        flex: 1,
    },
    notificationTitle: {
        color: '#101C14',
        fontFamily: fonts.Medium,
        fontSize: 13,
        lineHeight: 17,
    },
    notificationMessage: {
        marginTop: 2,
        color: '#5F6B62',
        fontFamily: fonts.Regular,
        fontSize: 11,
        lineHeight: 15,
    },
    notificationTime: {
        marginTop: 2,
        color: '#5F6B62',
        fontFamily: fonts.Regular,
        fontSize: 10,
        lineHeight: 14,
    },
    divider: {
        height: 1,
        backgroundColor: '#DDE8E1',
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
        paddingHorizontal: 42,
        },
    emptyDot: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#E8F5EA',
        borderWidth: 1,
        borderColor: '#C9E5D1',
        marginBottom: 14,
    },
    emptyText: {
        color: '#102018',
        fontFamily: fonts.Medium,
        fontSize: 17,
        lineHeight: 23,
        textAlign: 'center',
    },
    emptySubtitle: {
        marginTop: 6,
        color: '#66756B',
        fontFamily: fonts.Regular,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
    },
});
