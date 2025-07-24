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
import { colors } from '../common/theme';
import { fonts } from '../common/font';
import { MAIN_COLOR } from '../common/sharedFunctions';
import database from '@react-native-firebase/database';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Meus Veículos</Text>
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

    // Função para carregar veículos do usuário
    const loadVehicles = async () => {
        setLoading(true);
        try {
            // Aqui você implementaria a busca dos veículos do usuário
            // Por enquanto, vamos simular dados
            const mockVehicles = [
                {
                    id: '1',
                    brand: 'Toyota',
                    model: 'Corolla',
                    year: '2020',
                    plate: 'ABC-1234',
                    status: 'approved', // 'pending', 'rejected', 'approved', 'needs_info'
                    crlvImage: null,
                    createdAt: new Date().toISOString(),
                    isActive: true,
                },
                {
                    id: '2',
                    brand: 'Honda',
                    model: 'Civic',
                    year: '2019',
                    plate: 'XYZ-5678',
                    status: 'pending',
                    crlvImage: null,
                    createdAt: new Date().toISOString(),
                    isActive: false,
                }
            ];
            
            setVehicles(mockVehicles);
        } catch (error) {
            Alert.alert('Erro', 'Não foi possível carregar os veículos');
        } finally {
            setLoading(false);
        }
    };

    // Função para obter o status do veículo
    const getVehicleStatus = (status) => {
        switch (status) {
            case 'approved':
                return { text: 'Pronto para dirigir', color: '#4CAF50', icon: 'checkmark-circle' };
            case 'pending':
                return { text: 'Em análise', color: '#FF9800', icon: 'time' };
            case 'rejected':
                return { text: 'Veículo recusado', color: '#F44336', icon: 'close-circle' };
            case 'needs_info':
                return { text: 'Verificar pendências', color: '#2196F3', icon: 'information-circle' };
            default:
                return { text: 'Status desconhecido', color: '#9E9E9E', icon: 'help-circle' };
        }
    };

    // Substitua o toggleVehicleStatus para garantir apenas um ativo
    const selectActiveVehicle = (vehicleId) => {
        setVehicles(prev => prev.map(v =>
            v.id === vehicleId ? { ...v, isActive: true } : { ...v, isActive: false }
        ));
        // Aqui você pode disparar uma action para atualizar o backend se necessário
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
                    onPress: () => {
                        // Aqui você implementaria a remoção do veículo
                        setVehicles(prev => prev.filter(v => v.id !== vehicleId));
                    }
                }
            ]
        );
    };

    // Função para confirmar seleção do veículo ativo
    const confirmActiveVehicle = async () => {
        const selected = vehicles.find(v => v.isActive && v.status === 'approved');
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
                            // Atualiza no backend: define isActive=true para o selecionado, false para os outros do mesmo driver
                            const driverUid = auth.profile?.uid;
                            if (!driverUid) throw new Error('Usuário não autenticado');
                            // Busca todos os veículos do driver
                            const snapshot = await database().ref('vehicles').orderByChild('driver').equalTo(driverUid).once('value');
                            const updates = {};
                            snapshot.forEach(child => {
                                updates[`/vehicles/${child.key}/isActive`] = (child.key === selected.id);
                            });
                            await database().ref().update(updates);
                            if (Platform.OS === 'android') {
                                ToastAndroid.show('Veículo principal atualizado com sucesso!', ToastAndroid.LONG);
                            } else {
                                Alert.alert('Sucesso', 'Veículo principal atualizado com sucesso!');
                            }
                        } catch (err) {
                            Alert.alert('Erro', 'Não foi possível atualizar o veículo principal. Tente novamente.');
                        }
                    }
                }
            ]
        );
    };

    // Componente de veículo
    const VehicleCard = ({ vehicle }) => {
        const status = getVehicleStatus(vehicle.status);
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
                        {vehicle.status === 'approved' && (
                            <TouchableOpacity
                                style={{ marginRight: 8 }}
                                onPress={() => selectActiveVehicle(vehicle.id)}
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
                            onPress={() => removeVehicle(vehicle.id)}
                        >
                            <Ionicons name="trash" size={20} color="#F44336" />
                        </TouchableOpacity>
                    </View>
                </View>
                <View style={styles.statusContainer}>
                    <Ionicons name={status.icon} size={16} color={status.color} />
                    <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text>
                </View>
                {vehicle.status === 'needs_info' && (
                    <TouchableOpacity
                        style={[styles.infoButton, { backgroundColor: status.color }]}
                        onPress={() => navigation.navigate('VehicleDetails', { vehicle })}
                    >
                        <Text style={styles.infoButtonText}>Ver detalhes</Text>
                    </TouchableOpacity>
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

    useEffect(() => {
        loadVehicles();
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
                        onPress={() => navigation.navigate('AddVehicleScreen')}
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
                            opacity: vehicles.some(v => v.isActive && v.status === 'approved') ? 1 : 0.5
                        }}
                        disabled={!vehicles.some(v => v.isActive && v.status === 'approved')}
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
}); 