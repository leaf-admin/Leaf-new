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
    TextInput,
    ActivityIndicator,
    Modal,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common/theme';
import { fonts } from '../common/font';
import { MAIN_COLOR } from '../common/sharedFunctions';
import * as ImagePicker from 'expo-image-picker';

const { width, height } = Dimensions.get('window');

// Dados de marcas e modelos (exemplo)
const BRANDS = [
    { id: 'toyota', name: 'Toyota' },
    { id: 'honda', name: 'Honda' },
    { id: 'volkswagen', name: 'Volkswagen' },
    { id: 'chevrolet', name: 'Chevrolet' },
    { id: 'ford', name: 'Ford' },
    { id: 'fiat', name: 'Fiat' },
    { id: 'hyundai', name: 'Hyundai' },
    { id: 'nissan', name: 'Nissan' },
    { id: 'bmw', name: 'BMW' },
    { id: 'mercedes', name: 'Mercedes-Benz' },
];

const MODELS = {
    toyota: [
        { id: 'corolla', name: 'Corolla' },
        { id: 'camry', name: 'Camry' },
        { id: 'yaris', name: 'Yaris' },
        { id: 'hilux', name: 'Hilux' },
    ],
    honda: [
        { id: 'civic', name: 'Civic' },
        { id: 'accord', name: 'Accord' },
        { id: 'fit', name: 'Fit' },
        { id: 'hr-v', name: 'HR-V' },
    ],
    volkswagen: [
        { id: 'golf', name: 'Golf' },
        { id: 'jetta', name: 'Jetta' },
        { id: 'polo', name: 'Polo' },
        { id: 'tiguan', name: 'Tiguan' },
    ],
    chevrolet: [
        { id: 'onix', name: 'Onix' },
        { id: 'prisma', name: 'Prisma' },
        { id: 'cruze', name: 'Cruze' },
        { id: 'tracker', name: 'Tracker' },
    ],
    ford: [
        { id: 'ka', name: 'Ka' },
        { id: 'fiesta', name: 'Fiesta' },
        { id: 'focus', name: 'Focus' },
        { id: 'ecosport', name: 'EcoSport' },
    ],
    fiat: [
        { id: 'mobi', name: 'Mobi' },
        { id: 'argo', name: 'Argo' },
        { id: 'pulse', name: 'Pulse' },
        { id: 'fastback', name: 'Fastback' },
    ],
    hyundai: [
        { id: 'hb20', name: 'HB20' },
        { id: 'hb20s', name: 'HB20S' },
        { id: 'creta', name: 'Creta' },
        { id: 'tucson', name: 'Tucson' },
    ],
    nissan: [
        { id: 'march', name: 'March' },
        { id: 'versa', name: 'Versa' },
        { id: 'sentra', name: 'Sentra' },
        { id: 'kicks', name: 'Kicks' },
    ],
    bmw: [
        { id: 'series1', name: 'Série 1' },
        { id: 'series3', name: 'Série 3' },
        { id: 'series5', name: 'Série 5' },
        { id: 'x1', name: 'X1' },
    ],
    mercedes: [
        { id: 'classe-a', name: 'Classe A' },
        { id: 'classe-c', name: 'Classe C' },
        { id: 'classe-e', name: 'Classe E' },
        { id: 'gla', name: 'GLA' },
    ],
};

// Anos disponíveis (últimos 30 anos)
const YEARS = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);

export default function AddVehicleScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [loading, setLoading] = useState(false);
    
    // Estados do formulário
    const [crlvImage, setCrlvImage] = useState(null);
    const [selectedBrand, setSelectedBrand] = useState('');
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedYear, setSelectedYear] = useState('');
    const [plate, setPlate] = useState('');
    
    // Estados de validação
    const [errors, setErrors] = useState({});
    
    // Estados para modais
    const [showBrandModal, setShowBrandModal] = useState(false);
    const [showModelModal, setShowModelModal] = useState(false);
    const [showYearModal, setShowYearModal] = useState(false);

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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Adicionar Veículo</Text>
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

    // Função para selecionar imagem do CRLV
    const pickCrlvImage = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.8,
            });

            if (!result.canceled) {
                setCrlvImage(result.assets[0].uri);
                // Limpar erro se existir
                if (errors.crlvImage) {
                    setErrors(prev => ({ ...prev, crlvImage: null }));
                }
            }
        } catch (error) {
            Alert.alert('Erro', 'Não foi possível selecionar a imagem');
        }
    };

    // Função para validar placa (formato brasileiro)
    const validatePlate = (plateText) => {
        const plateRegex = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;
        return plateRegex.test(plateText.replace(/[^A-Z0-9]/g, ''));
    };

    // Função para formatar placa
    const formatPlate = (text) => {
        const cleaned = text.replace(/[^A-Z0-9]/g, '').toUpperCase();
        if (cleaned.length <= 3) {
            return cleaned;
        } else if (cleaned.length <= 5) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
        } else {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5, 7)}`;
        }
    };

    // Função para validar formulário
    const validateForm = () => {
        const newErrors = {};

        if (!crlvImage) {
            newErrors.crlvImage = 'Foto do CRLV é obrigatória';
        }

        if (!selectedBrand) {
            newErrors.brand = 'Selecione a marca do veículo';
        }

        if (!selectedModel) {
            newErrors.model = 'Selecione o modelo do veículo';
        }

        if (!selectedYear) {
            newErrors.year = 'Selecione o ano do veículo';
        }

        if (!plate.trim()) {
            newErrors.plate = 'Placa é obrigatória';
        } else if (!validatePlate(plate)) {
            newErrors.plate = 'Formato de placa inválido (ex: ABC-1234)';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Função para enviar formulário
    const handleSubmit = async () => {
        if (!validateForm()) {
            Alert.alert('Erro', 'Por favor, corrija os erros no formulário');
            return;
        }

        setLoading(true);
        try {
            // Aqui você implementaria o envio dos dados
            // Simulando envio
            await new Promise(resolve => setTimeout(resolve, 2000));

            Alert.alert(
                'Veículo Enviado!',
                'Em até 24 horas retornaremos com a aprovação do veículo ou solicitando novas informações.',
                [
                    {
                        text: 'OK',
                        onPress: () => navigation.goBack()
                    }
                ]
            );
        } catch (error) {
            Alert.alert('Erro', 'Não foi possível enviar o veículo. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    // Componente de campo de formulário
    const FormField = ({ label, error, children }) => (
        <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{label}</Text>
            {children}
            {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            {/* Header */}
            <Header />
            
            <ScrollView style={[styles.content, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]} showsVerticalScrollIndicator={false}>
                {/* Upload CRLV */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Enviar CRLV
                    </Text>
                    
                    <FormField label="Foto do CRLV" error={errors.crlvImage}>
                        <TouchableOpacity 
                            style={[styles.uploadContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                            onPress={pickCrlvImage}
                        >
                            {crlvImage ? (
                                <Image source={{ uri: crlvImage }} style={styles.uploadedImage} />
                            ) : (
                                <View style={styles.uploadPlaceholder}>
                                    <Ionicons name="camera" size={40} color={isDarkMode ? '#666' : '#ccc'} />
                                    <Text style={[styles.uploadText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Toque para selecionar a foto do CRLV
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </FormField>
                </View>

                {/* Informações do Veículo */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Informações do Veículo
                    </Text>

                    {/* Marca */}
                    <FormField label="Marca" error={errors.brand}>
                        <TouchableOpacity 
                            style={[styles.pickerContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                            onPress={() => setShowBrandModal(true)}
                        >
                            <Text style={[styles.pickerText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {selectedBrand ? BRANDS.find(b => b.id === selectedBrand)?.name : 'Selecione a marca'}
                            </Text>
                            <Ionicons name="chevron-down" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                        </TouchableOpacity>
                    </FormField>

                    {/* Modelo */}
                    <FormField label="Modelo" error={errors.model}>
                        <TouchableOpacity 
                            style={[styles.pickerContainer, { 
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8',
                                opacity: selectedBrand ? 1 : 0.5
                            }]}
                            onPress={() => selectedBrand && setShowModelModal(true)}
                            disabled={!selectedBrand}
                        >
                            <Text style={[styles.pickerText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {selectedModel ? MODELS[selectedBrand]?.find(m => m.id === selectedModel)?.name : 'Selecione o modelo'}
                            </Text>
                            <Ionicons name="chevron-down" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                        </TouchableOpacity>
                    </FormField>

                    {/* Ano */}
                    <FormField label="Ano" error={errors.year}>
                        <TouchableOpacity 
                            style={[styles.pickerContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                            onPress={() => setShowYearModal(true)}
                        >
                            <Text style={[styles.pickerText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {selectedYear || 'Selecione o ano'}
                            </Text>
                            <Ionicons name="chevron-down" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                        </TouchableOpacity>
                    </FormField>

                    {/* Placa */}
                    <FormField label="Placa" error={errors.plate}>
                        <TextInput
                            style={[styles.textInput, { 
                                color: isDarkMode ? '#fff' : colors.BLACK,
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                            }]}
                            value={plate}
                            onChangeText={(text) => {
                                const formatted = formatPlate(text);
                                setPlate(formatted);
                                if (errors.plate) setErrors(prev => ({ ...prev, plate: null }));
                            }}
                            placeholder="ABC-1234"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            maxLength={8}
                            autoCapitalize="characters"
                        />
                    </FormField>
                </View>

                {/* Botão Enviar */}
                <TouchableOpacity 
                    style={[
                        styles.submitButton, 
                        { 
                            backgroundColor: loading ? '#ccc' : MAIN_COLOR,
                            opacity: loading ? 0.7 : 1
                        }
                    ]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" size="small" />
                    ) : (
                        <Text style={styles.submitButtonText}>Enviar</Text>
                    )}
                </TouchableOpacity>
            </ScrollView>

            {/* Modal para seleção de marca */}
            <Modal
                visible={showBrandModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowBrandModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#333' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Selecione a Marca</Text>
                            <TouchableOpacity onPress={() => setShowBrandModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            {BRANDS.map(brand => (
                                <TouchableOpacity
                                    key={brand.id}
                                    style={styles.modalItem}
                                    onPress={() => {
                                        setSelectedBrand(brand.id);
                                        setSelectedModel(''); // Reset modelo
                                        if (errors.brand) setErrors(prev => ({ ...prev, brand: null }));
                                        setShowBrandModal(false);
                                    }}
                                >
                                    <Text style={[styles.modalItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        {brand.name}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal para seleção de modelo */}
            <Modal
                visible={showModelModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowModelModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#333' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Selecione o Modelo</Text>
                            <TouchableOpacity onPress={() => setShowModelModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            {selectedBrand && MODELS[selectedBrand]?.map(model => (
                                <TouchableOpacity
                                    key={model.id}
                                    style={styles.modalItem}
                                    onPress={() => {
                                        setSelectedModel(model.id);
                                        if (errors.model) setErrors(prev => ({ ...prev, model: null }));
                                        setShowModelModal(false);
                                    }}
                                >
                                    <Text style={[styles.modalItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        {model.name}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal para seleção de ano */}
            <Modal
                visible={showYearModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowYearModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#333' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Selecione o Ano</Text>
                            <TouchableOpacity onPress={() => setShowYearModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            {YEARS.map(year => (
                                <TouchableOpacity
                                    key={year}
                                    style={styles.modalItem}
                                    onPress={() => {
                                        setSelectedYear(year.toString());
                                        if (errors.year) setErrors(prev => ({ ...prev, year: null }));
                                        setShowYearModal(false);
                                    }}
                                >
                                    <Text style={[styles.modalItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        {year}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
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
    section: {
        marginBottom: 25,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
        marginBottom: 15,
    },
    formField: {
        marginBottom: 16,
    },
    fieldLabel: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginBottom: 8,
    },
    uploadContainer: {
        borderRadius: 12,
        overflow: 'hidden',
        minHeight: 200,
        justifyContent: 'center',
        alignItems: 'center',
    },
    uploadedImage: {
        width: '100%',
        height: 200,
        resizeMode: 'cover',
    },
    uploadPlaceholder: {
        alignItems: 'center',
        padding: 20,
    },
    uploadText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlign: 'center',
        marginTop: 8,
    },
    pickerContainer: {
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pickerText: {
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    textInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    errorText: {
        color: '#F44336',
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginTop: 4,
    },
    submitButton: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 40,
    },
    submitButtonText: {
        color: '#fff',
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    modalTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
    },
    modalList: {
        maxHeight: 400,
    },
    modalItem: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    modalItemText: {
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
}); 