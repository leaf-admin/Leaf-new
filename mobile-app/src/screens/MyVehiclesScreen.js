import Logger from '../utils/Logger';
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
    FlatList,
    ToastAndroid,
    Platform,
    SafeAreaView,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import database from '@react-native-firebase/database';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import VehicleService from '../services/VehicleService';
import VehicleNotificationService from '../services/VehicleNotificationService';


const { width, height } = Dimensions.get('window');

export default function MyVehiclesScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const insets = useSafeAreaInsets();

    // Componente para alternar entre modo claro/escuro
    function ThemeSwitch({ value, onValueChange }) {
        return (
            <TouchableOpacity 
                style={styles.themeSwitchTouchable}
                onPress={() => onValueChange(!value)}
                activeOpacity={0.7}
            >
                <View style={[
                    styles.themeSwitchTrack,
                    { 
                        backgroundColor: value ? '#2d2d2d' : '#e8e8e8',
                        borderColor: value ? '#404040' : '#d0d0d0',
                    }
                ]}>
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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Meus Veículos</Text>
            <View style={styles.headerRightContainer}>
                <TouchableOpacity 
                    style={[
                        styles.headerButton, 
                        { 
                            backgroundColor: isDarkMode ? '#2d2d2d' : '#e8e8e8',
                            borderWidth: 1,
                            borderColor: isDarkMode ? '#404040' : '#d0d0d0',
                        }
                    ]}
                    onPress={() => navigation.navigate('Notifications')}
                    activeOpacity={0.7}
                >
                    <Ionicons 
                        name="notifications-outline" 
                        color={isDarkMode ? '#fff' : '#1a1a1a'} 
                        size={22} 
                    />
                </TouchableOpacity>
                <ThemeSwitch value={isDarkMode} onValueChange={setIsDarkMode} />
            </View>
        </View>
    );

    // Função para carregar veículos do usuário
    const loadVehicles = async () => {
        setLoading(true);
        try {
            const user = auth.profile;
            if (!user || !user.uid) {
                throw new Error('Usuário não autenticado');
            }

            // Buscar veículos completos do usuário
            const completeVehicles = await VehicleService.getUserVehiclesComplete(user.uid);
            
            // Transformar para o formato esperado pela interface
            const formattedVehicles = completeVehicles.map(item => ({
                id: item.userVehicle.id,
                vehicleId: item.vehicle.id,
                brand: item.vehicle.brand,
                model: item.vehicle.model,
                year: item.vehicle.year.toString(),
                plate: item.vehicle.plate,
                status: item.userVehicle.status,
                isActive: item.userVehicle.isActive,
                createdAt: item.userVehicle.createdAt,
                documents: item.userVehicle.documents,
                possessionDate: item.userVehicle.possessionDate,
                approvedAt: item.userVehicle.approvedAt,
                rejectionReason: item.userVehicle.rejectionReason
            }));
            
            setVehicles(formattedVehicles);
        } catch (error) {
            Logger.error('Erro ao carregar veículos:', error);
            Alert.alert('Erro', 'Não foi possível carregar os veículos');
        } finally {
            setLoading(false);
        }
    };

    // Função para obter o status do veículo
    const getVehicleStatus = (status) => {
        return VehicleService.getVehicleStatusInfo(status);
    };

    // Substitua o toggleVehicleStatus para garantir apenas um ativo
    const selectActiveVehicle = async (vehicleId) => {
        try {
            const user = auth.profile;
            if (!user || !user.uid) {
                throw new Error('Usuário não autenticado');
            }

            // Atualizar no backend
            const success = await VehicleService.setActiveVehicle(user.uid, vehicleId);
            
            if (success) {
                // Atualizar estado local
                setVehicles(prev => prev.map(v =>
                    v.vehicleId === vehicleId ? { ...v, isActive: true } : { ...v, isActive: false }
                ));
            } else {
                Alert.alert('Erro', 'Não foi possível definir o veículo ativo');
            }
        } catch (error) {
            Logger.error('Erro ao definir veículo ativo:', error);
            Alert.alert('Erro', 'Não foi possível definir o veículo ativo');
        }
    };

    // Função para remover veículo
    const removeVehicle = (vehicleId) => {
        Alert.alert(
            'Remover Veículo',
            'Tem certeza que deseja remover este veículo?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { 
                    text: 'Remover', 
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const user = auth.profile;
                            if (!user || !user.uid) {
                                throw new Error('Usuário não autenticado');
                            }

                            const success = await VehicleService.removeUserVehicle(user.uid, vehicleId);
                            
                            if (success) {
                                // Atualizar estado local
                                setVehicles(prev => prev.filter(v => v.vehicleId !== vehicleId));
                                Alert.alert('Sucesso', 'Veículo removido com sucesso');
                            } else {
                                Alert.alert('Erro', 'Não foi possível remover o veículo');
                            }
                        } catch (error) {
                            Logger.error('Erro ao remover veículo:', error);
                            Alert.alert('Erro', 'Não foi possível remover o veículo');
                        }
                    }
                }
            ]
        );
    };

    // Função para confirmar seleção do veículo ativo
    const confirmActiveVehicle = async () => {
        const selected = vehicles.find(v => v.isActive && v.status === 'active');
        if (!selected) return;
        Alert.alert(
            'Confirmar veículo principal',
            `Deseja realmente definir o veículo ${selected.brand} ${selected.model} (${selected.plate}) como principal para corridas?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Confirmar',
                    style: 'default',
                    onPress: async () => {
                        try {
                            const user = auth.profile;
                            if (!user || !user.uid) {
                                throw new Error('Usuário não autenticado');
                            }

                            const success = await VehicleService.setActiveVehicle(user.uid, selected.vehicleId);
                            
                            if (success) {
                                if (Platform.OS === 'android') {
                                    ToastAndroid.show('Veículo principal atualizado com sucesso!', ToastAndroid.LONG);
                                } else {
                                    Alert.alert('Sucesso', 'Veículo principal atualizado com sucesso!');
                                }
                            } else {
                                Alert.alert('Erro', 'Não foi possível atualizar o veículo principal. Tente novamente.');
                            }
                        } catch (err) {
                            Logger.error('Erro ao confirmar veículo ativo:', err);
                            Alert.alert('Erro', 'Não foi possível atualizar o veículo principal. Tente novamente.');
                        }
                    }
                }
            ]
        );
    };

    // Função para visualizar documento do CRLV
    const viewDocument = async (documentUrl) => {
        if (!documentUrl) {
            Alert.alert('Erro', 'Documento não disponível');
            return;
        }

        try {
            // Tentar abrir o PDF no navegador ou visualizador padrão
            const canOpen = await Linking.canOpenURL(documentUrl);
            if (canOpen) {
                await Linking.openURL(documentUrl);
            } else {
                Alert.alert('Erro', 'Não foi possível abrir o documento. Por favor, verifique se o arquivo está disponível.');
            }
        } catch (error) {
            Logger.error('Erro ao abrir documento:', error);
            Alert.alert('Erro', 'Não foi possível abrir o documento. Tente novamente.');
        }
    };

    // Componente de veículo
    const VehicleCard = ({ vehicle }) => {
        const status = getVehicleStatus(vehicle.status);
        const hasDocument = vehicle.documents && vehicle.documents.crlv;
        
        return (
            <View style={[styles.vehicleCard, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}> 
                <View style={styles.vehicleHeader}>
                    <View style={styles.vehicleInfo}>
                        <Text style={[styles.vehicleTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            {vehicle.brand} {vehicle.model}
                        </Text>
                        <Text style={[styles.vehicleSubtitle, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            {vehicle.year} • {vehicle.plate}
                        </Text>
                    </View>
                    <View style={styles.vehicleActions}>
                        {vehicle.status === 'active' && (
                            <TouchableOpacity
                                style={{ marginRight: 8 }}
                                onPress={() => selectActiveVehicle(vehicle.vehicleId)}
                            >
                                <Ionicons
                                    name={vehicle.isActive ? 'radio-button-on' : 'radio-button-off'}
                                    size={24}
                                    color={vehicle.isActive ? MAIN_COLOR : '#ccc'}
                                />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={styles.removeButton}
                            onPress={() => removeVehicle(vehicle.vehicleId)}
                        >
                            <Ionicons name="trash" size={20} color="#F44336" />
                        </TouchableOpacity>
                    </View>
                </View>
                <View style={styles.statusContainer}>
                    <Ionicons name={status.icon} size={16} color={status.color} />
                    <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text>
                </View>
                {hasDocument && (
                    <TouchableOpacity
                        style={[styles.documentButton, { backgroundColor: isDarkMode ? '#2d2d2d' : '#e8e8e8' }]}
                        onPress={() => viewDocument(vehicle.documents.crlv)}
                    >
                        <Ionicons name="document-text" size={20} color={MAIN_COLOR} />
                        <Text style={[styles.documentButtonText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            Ver CRLV (PDF)
                        </Text>
                    </TouchableOpacity>
                )}
                {vehicle.status === 'rejected' && vehicle.rejectionReason && (
                    <View style={styles.rejectionContainer}>
                        <Text style={[styles.rejectionText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                            Motivo: {vehicle.rejectionReason}
                        </Text>
                    </View>
                )}
            </View>
        );
    };

    // Componente para lista vazia
    const EmptyList = () => (
        <View style={styles.emptyContainer}>
            <Ionicons name="car-outline" size={80} color={isDarkMode ? '#666' : '#ccc'} />
            <Text style={[styles.emptyTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                Nenhum veículo cadastrado
            </Text>
            <Text style={[styles.emptySubtitle, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                Adicione seu primeiro veículo para começar a dirigir
            </Text>
        </View>
    );

    // Recarregar veículos quando a tela receber foco (ex: após cadastrar novo veículo)
    useFocusEffect(
        React.useCallback(() => {
            loadVehicles();
        }, [])
    );

    useEffect(() => {
        // Inicializar notificações de veículos
        const initializeNotifications = async () => {
            try {
                // ✅ Verificar se usuário está autenticado antes de inicializar
                const auth = require('@react-native-firebase/auth').default;
                const currentUser = auth().currentUser;
                
                if (!currentUser) {
                    Logger.log('ℹ️ [MyVehiclesScreen] Usuário não autenticado, pulando inicialização de notificações');
                    return;
                }
                
                if (!VehicleNotificationService.isServiceInitialized()) {
                    await VehicleNotificationService.initialize();
                }
            } catch (error) {
                // ✅ Não mostrar erro crítico, apenas log informativo
                Logger.log('ℹ️ [MyVehiclesScreen] Notificações de veículos não disponíveis:', error.message);
            }
        };
        
        initializeNotifications();
    }, []);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff', flex: 1 }]}> 
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            {/* Header */}
            <Header />
            
            <View style={{ flex: 1 }}>
                <View style={styles.content}>
                    {/* Botão Adicionar Veículo */}
                    <TouchableOpacity 
                        style={[styles.addButton, { backgroundColor: MAIN_COLOR }]}
                        onPress={() => navigation.navigate('AddVehicle')}
                    >
                        <Ionicons name="add" size={24} color="#fff" />
                        <Text style={styles.addButtonText}>Adicionar novo veículo</Text>
                    </TouchableOpacity>

                    {/* Lista de Veículos */}
                    <View style={styles.vehiclesContainer}>
                        <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            Veículos Cadastrados ({vehicles.length}/5)
                        </Text>
                        
                        {loading ? (
                            <View style={styles.loadingContainer}>
                                <Text style={[styles.loadingText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Carregando veículos...
                                </Text>
                            </View>
                        ) : (
                            <FlatList
                                data={vehicles}
                                keyExtractor={(item) => item.id}
                                renderItem={({ item }) => <VehicleCard vehicle={item} />}
                                ListEmptyComponent={EmptyList}
                                showsVerticalScrollIndicator={false}
                                contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
                            />
                        )}
                    </View>
                </View>
                {/* Botão fixo na base, sempre visível e dentro da área segura */}
                <View style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: insets.bottom,
                    backgroundColor: isDarkMode ? '#222' : '#fff',
                    padding: 16,
                    borderTopWidth: 1,
                    borderColor: '#eee',
                    zIndex: 10
                }}>
                    <TouchableOpacity
                        style={{
                            backgroundColor: MAIN_COLOR,
                            borderRadius: 10,
                            justifyContent: 'center',
                            alignItems: 'center',
                            width: '100%',
                            height: 52,
                            opacity: vehicles.some(v => v.isActive && v.status === 'active') ? 1 : 0.5
                        }}
                        disabled={!vehicles.some(v => v.isActive && v.status === 'active')}
                        onPress={confirmActiveVehicle}
                    >
                        <Text style={{ color: '#fff', fontFamily: fonts.Bold, fontSize: 18 }}>Confirmar</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
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
        paddingTop: 45,
        paddingBottom: 16,
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
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
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
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 12,
        marginBottom: 20,
        gap: 8,
    },
    addButtonText: {
        color: '#fff',
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    vehiclesContainer: {
        flex: 1,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
        marginBottom: 15,
    },
    vehicleCard: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    vehicleHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    vehicleInfo: {
        flex: 1,
    },
    vehicleTitle: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    vehicleSubtitle: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    vehicleActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusToggle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    removeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ffebee',
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    infoButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignSelf: 'flex-start',
        marginTop: 8,
    },
    infoButtonText: {
        color: '#fff',
        fontSize: 14,
        fontFamily: fonts.Bold,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
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
        paddingHorizontal: 40,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    rejectionContainer: {
        marginTop: 8,
        padding: 8,
        backgroundColor: '#ffebee',
        borderRadius: 8,
    },
    rejectionText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        fontStyle: 'italic',
    },
    documentButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        marginTop: 12,
        gap: 8,
    },
    documentButtonText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
}); 