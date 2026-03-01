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
    TextInput,
    ActivityIndicator,
    Modal,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import VehicleService from '../services/VehicleService';
import CRLVPDFUpload from '../components/CRLVPDFUpload';


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

// Cores disponíveis
const COLORS = [
    { id: 'BRANCO', name: 'Branco' },
    { id: 'PRETO', name: 'Preto' },
    { id: 'PRATA', name: 'Prata' },
    { id: 'CINZA', name: 'Cinza' },
    { id: 'AZUL', name: 'Azul' },
    { id: 'VERMELHO', name: 'Vermelho' },
    { id: 'VERDE', name: 'Verde' },
    { id: 'AMARELO', name: 'Amarelo' },
    { id: 'BEGE', name: 'Bege' },
    { id: 'DOURADO', name: 'Dourado' },
    { id: 'MARROM', name: 'Marrom' },
    { id: 'ROSA', name: 'Rosa' },
    { id: 'LARANJA', name: 'Laranja' },
    { id: 'ROXO', name: 'Roxo' },
];

export default function AddVehicleScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [loading, setLoading] = useState(false);
    
    // Estados do formulário
    const [crlvImage, setCrlvImage] = useState(null);
    const [crlvAuditImage, setCrlvAuditImage] = useState(null); // Imagem 640x640 para auditoria
    const [extractedVehicleData, setExtractedVehicleData] = useState(null); // Dados extraídos do OCR
    const [selectedBrand, setSelectedBrand] = useState('');
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedYear, setSelectedYear] = useState('');
    const [plate, setPlate] = useState('');
    const [vin, setVin] = useState('');
    const [vehicleType, setVehicleType] = useState(''); // 'carro' ou 'moto'
    const [selectedColor, setSelectedColor] = useState(''); // Cor do veículo
    
    // Estados de validação
    const [errors, setErrors] = useState({});
    
    // Estados para modais
    const [showBrandModal, setShowBrandModal] = useState(false);
    const [showModelModal, setShowModelModal] = useState(false);
    const [showYearModal, setShowYearModal] = useState(false);
    const [showVehicleTypeModal, setShowVehicleTypeModal] = useState(false);
    const [showColorModal, setShowColorModal] = useState(false);
    const [showCRLVUpload, setShowCRLVUpload] = useState(false);

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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Adicionar Veículo</Text>
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
                    <Ionicons name="notifications-outline" size={22} color={isDarkMode ? '#fff' : '#1a1a1a'} />
                </TouchableOpacity>
                <ThemeSwitch value={isDarkMode} onValueChange={setIsDarkMode} />
            </View>
        </View>
    );

    // Função para abrir upload de PDF
    const pickCrlvImage = () => {
        setShowCRLVUpload(true);
    };

    // Função chamada quando dados são extraídos do OCR
    const handleOCRDataExtracted = (ocrData) => {
        Logger.log('📋 Dados extraídos do OCR:', ocrData);
        
        // Preencher campos automaticamente
        if (ocrData.placa) {
            setPlate(ocrData.placa);
        }
        
        if (ocrData.renavam) {
            setVin(ocrData.renavam); // RENAVAM pode ser usado como VIN
        }
        
        if (ocrData.ano) {
            setSelectedYear(ocrData.ano);
        }
        
        // Preencher tipo de veículo (carro ou moto)
        if (ocrData.vehicleType) {
            setVehicleType(ocrData.vehicleType);
        }
        
        // Preencher cor do veículo
        if (ocrData.cor) {
            // Normalizar cor para formato do catálogo (ex: BRANCA -> BRANCO)
            const corNormalizada = ocrData.cor.toUpperCase();
            const corEncontrada = COLORS.find(c => 
                c.id === corNormalizada || 
                corNormalizada.includes(c.id) ||
                c.id.includes(corNormalizada)
            );
            if (corEncontrada) {
                setSelectedColor(corEncontrada.id);
            } else {
                // Se não encontrar, tentar adicionar como está
                setSelectedColor(corNormalizada);
            }
        }
        
        // Usar dados normalizados se disponíveis, senão usar dados raw
        const marca = ocrData.brand_name || ocrData.marca;
        const modelo = ocrData.model_name || ocrData.modelo;
        
        if (marca) {
            // Tentar encontrar a marca na lista usando nome normalizado
            const brandFound = BRANDS.find(b => 
                b.name.toLowerCase() === marca.toLowerCase() ||
                marca.toLowerCase().includes(b.name.toLowerCase()) ||
                b.name.toLowerCase().includes(marca.toLowerCase())
            );
            if (brandFound) {
                setSelectedBrand(brandFound.id);
                Logger.log('✅ Marca normalizada encontrada:', brandFound.name);
            } else {
                // Se não encontrar, mostrar alerta
                Alert.alert(
                    'Marca não encontrada',
                    `A marca "${marca}" foi detectada mas não está na lista. Por favor, selecione manualmente.`
                );
            }
        }
        
        // Aguardar marca ser selecionada antes de buscar modelo
        if (modelo) {
            // Se já tem marca selecionada, buscar modelo
            if (selectedBrand) {
                const models = MODELS[selectedBrand] || [];
                const modelFound = models.find(m => 
                    m.name.toLowerCase() === modelo.toLowerCase() ||
                    modelo.toLowerCase().includes(m.name.toLowerCase()) ||
                    m.name.toLowerCase().includes(modelo.toLowerCase())
                );
                if (modelFound) {
                    setSelectedModel(modelFound.id);
                    Logger.log('✅ Modelo normalizado encontrado:', modelFound.name);
                }
            } else {
                // Se não tem marca ainda, tentar buscar modelo em todas as marcas
                // Isso pode acontecer se a marca não foi encontrada na lista
                for (const brand of BRANDS) {
                    const models = MODELS[brand.id] || [];
                    const modelFound = models.find(m => 
                        m.name.toLowerCase() === modelo.toLowerCase() ||
                        modelo.toLowerCase().includes(m.name.toLowerCase()) ||
                        m.name.toLowerCase().includes(modelo.toLowerCase())
                    );
                    if (modelFound) {
                        setSelectedBrand(brand.id);
                        setSelectedModel(modelFound.id);
                        Logger.log('✅ Marca e modelo encontrados:', brand.name, modelFound.name);
                        break;
                    }
                }
            }
        }
        
        // Salvar PDF do CRLV e imagem de auditoria
        if (ocrData.pdfUri) {
            setCrlvImage(ocrData.pdfUri);
        }
        
        // Salvar imagem de auditoria (640x640)
        if (ocrData.auditImageUri) {
            setCrlvAuditImage(ocrData.auditImageUri);
        }
        
        // Salvar dados extraídos para envio ao backend (usar dados normalizados se disponíveis)
        setExtractedVehicleData({
            placa: ocrData.placa || ocrData.plate,
            renavam: ocrData.renavam,
            ano: ocrData.ano || ocrData.year,
            uf: ocrData.uf,
            chassi: ocrData.chassi,
            marca: ocrData.brand_name || ocrData.marca, // Preferir normalizado
            modelo: ocrData.model_name || ocrData.modelo, // Preferir normalizado
            cor: ocrData.cor,
            // Dados normalizados completos
            brand_code: ocrData.brand_code,
            brand_name: ocrData.brand_name,
            model_code: ocrData.model_code,
            model_name: ocrData.model_name,
        });
        
        // Limpar erros
        setErrors(prev => ({
            ...prev,
            crlvImage: null,
            plate: null,
        }));
        
        // Mostrar sucesso
        Alert.alert(
            '✅ Dados extraídos!',
            `Os seguintes dados foram preenchidos automaticamente:\n\n` +
            `${ocrData.placa ? `• Placa: ${ocrData.placa}\n` : ''}` +
            `${ocrData.renavam ? `• RENAVAM: ${ocrData.renavam}\n` : ''}` +
            `${ocrData.ano || ocrData.year ? `• Ano: ${ocrData.ano || ocrData.year}\n` : ''}` +
            `${ocrData.brand_name || ocrData.marca ? `• Marca: ${ocrData.brand_name || ocrData.marca}\n` : ''}` +
            `${ocrData.model_name || ocrData.modelo ? `• Modelo: ${ocrData.model_name || ocrData.modelo}\n` : ''}` +
            `${ocrData.cor ? `• Cor: ${ocrData.cor}\n` : ''}` +
            `\nPor favor, revise e complete os campos faltantes.`
        );
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
            newErrors.crlvImage = 'PDF do CRLV-e é obrigatório';
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
        } else if (!VehicleService.validatePlateFormat(plate)) {
            newErrors.plate = 'Formato de placa inválido (ex: ABC-1234)';
        }

        if (!vehicleType) {
            newErrors.vehicleType = 'Selecione o tipo de veículo';
        }

        if (!selectedColor) {
            newErrors.color = 'Selecione a cor do veículo';
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
            // Preparar dados do veículo
            const vehicleData = {
                plate: plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                brand: BRANDS.find(b => b.id === selectedBrand)?.name || selectedBrand,
                model: MODELS[selectedBrand]?.find(m => m.id === selectedModel)?.name || selectedModel,
                year: parseInt(selectedYear),
                vehicleType: vehicleType, // 'carro' ou 'moto'
                color: selectedColor, // Cor do veículo
                vin: vin.trim() || undefined
            };

            // Preparar documentos
            const documents = {
                crlv: crlvImage
            };

            // Preparar dados estruturados para backend (JSON + imagem de auditoria)
            const structuredData = {
                // Dados do veículo (estruturados)
                vehicleData: {
                    ...vehicleData,
                    // Incluir dados extraídos do OCR se disponíveis
                    ...(extractedVehicleData || {}),
                },
                // Imagem de auditoria (640x640)
                auditImage: crlvAuditImage,
                // Metadados
                metadata: {
                    extractedAt: extractedVehicleData ? new Date().toISOString() : null,
                    source: 'ocr',
                }
            };

            // Registrar veículo usando o serviço
            // Nota: O VehicleService deve ser atualizado para enviar structuredData ao backend
            const result = await VehicleService.registerVehicleForUser(vehicleData, documents, structuredData);

            if (result.success) {
                Alert.alert(
                    'Veículo Enviado!',
                    result.message,
                    [
                        {
                            text: 'OK',
                            onPress: () => navigation.goBack()
                        }
                    ]
                );
            } else {
                Alert.alert('Erro', result.message);
            }
        } catch (error) {
            Logger.error('Erro ao enviar veículo:', error);
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
                {/* Upload de Documentos */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                        Documentos do Veículo
                    </Text>
                    
                    {/* CRLV-e - Obrigatório (APENAS PDF) */}
                    <FormField label="CRLV-e (PDF) *" error={errors.crlvImage}>
                        <View style={[styles.pdfInfoContainer, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff3e0' }]}>
                            <View style={styles.pdfInfoRow}>
                                <Ionicons name="information-circle" size={20} color="#FF6B00" />
                                <Text style={[styles.pdfInfoText, { color: isDarkMode ? '#fff' : '#333' }]}>
                                    Certificado de Registro e Licenciamento de Veículo - Digital
                                </Text>
                            </View>
                            <View style={styles.pdfWarningRow}>
                                <Ionicons name="warning" size={18} color="#FF6B00" />
                                <Text style={styles.pdfWarningText}>
                                    Apenas arquivo PDF do CRLV-e é aceito
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity 
                            style={[styles.uploadContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                            onPress={pickCrlvImage}
                        >
                            {crlvImage ? (
                                <View style={styles.pdfContainer}>
                                    <Ionicons name="document-text" size={48} color={MAIN_COLOR} />
                                    <Text style={[styles.pdfText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        PDF do CRLV-e selecionado
                                    </Text>
                                    <Text style={[styles.pdfSubtext, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                                        Toque para selecionar outro arquivo PDF
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.uploadPlaceholder}>
                                    <Ionicons name="document-attach" size={48} color={isDarkMode ? '#666' : '#ccc'} />
                                    <Text style={[styles.uploadText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Toque para fazer upload do PDF do CRLV-e
                                    </Text>
                                    <Text style={[styles.uploadHint, { color: isDarkMode ? '#999' : '#999' }]}>
                                        Apenas arquivos PDF são aceitos
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
                                const formatted = VehicleService.formatPlate(text);
                                setPlate(formatted);
                                if (errors.plate) setErrors(prev => ({ ...prev, plate: null }));
                            }}
                            placeholder="ABC-1234"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            maxLength={8}
                            autoCapitalize="characters"
                        />
                    </FormField>

                    {/* VIN */}
                    <FormField label="VIN (opcional)">
                        <TextInput
                            style={[styles.textInput, { 
                                color: isDarkMode ? '#fff' : colors.BLACK,
                                backgroundColor: isDarkMode ? '#333' : '#f8f8f8'
                            }]}
                            value={vin}
                            onChangeText={setVin}
                            placeholder="Número de identificação do veículo"
                            placeholderTextColor={isDarkMode ? '#999' : '#999'}
                            autoCapitalize="characters"
                        />
                    </FormField>

                    {/* Cor */}
                    <FormField label="Cor" error={errors.color}>
                        <TouchableOpacity 
                            style={[styles.pickerContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                            onPress={() => setShowColorModal(true)}
                        >
                            <Text style={[styles.pickerText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {selectedColor ? COLORS.find(c => c.id === selectedColor)?.name : 'Selecione a cor'}
                            </Text>
                            <Ionicons name="chevron-down" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                        </TouchableOpacity>
                    </FormField>

                    {/* Tipo de Veículo */}
                    <FormField label="Tipo de Veículo" error={errors.vehicleType}>
                        <TouchableOpacity 
                            style={[styles.pickerContainer, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                            onPress={() => setShowVehicleTypeModal(true)}
                        >
                            <Text style={[styles.pickerText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {vehicleType === 'carro' ? 'Carro' : 
                                 vehicleType === 'moto' ? 'Moto' : 'Selecione o tipo de veículo'}
                            </Text>
                            <Ionicons name="chevron-down" size={20} color={isDarkMode ? '#ccc' : colors.GRAY} />
                        </TouchableOpacity>
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

            {/* Modal para seleção de cor */}
            <Modal
                visible={showColorModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowColorModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#333' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Selecione a Cor</Text>
                            <TouchableOpacity onPress={() => setShowColorModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            {COLORS.map((color) => (
                                <TouchableOpacity
                                    key={color.id}
                                    style={[
                                        styles.modalItem,
                                        selectedColor === color.id && styles.modalItemSelected,
                                        { borderBottomColor: isDarkMode ? '#444' : '#f0f0f0' }
                                    ]}
                                    onPress={() => {
                                        setSelectedColor(color.id);
                                        setShowColorModal(false);
                                        if (errors.color) setErrors(prev => ({ ...prev, color: null }));
                                    }}
                                >
                                    <Text style={[styles.modalItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        {color.name}
                                    </Text>
                                    {selectedColor === color.id && (
                                        <Ionicons name="checkmark" size={20} color={MAIN_COLOR} />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal para seleção de tipo de veículo */}
            <Modal
                visible={showVehicleTypeModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowVehicleTypeModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#333' : '#fff' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Selecione o Tipo</Text>
                            <TouchableOpacity onPress={() => setShowVehicleTypeModal(false)}>
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            {[
                                { id: 'carro', name: 'Carro', description: 'Veículo de quatro rodas' },
                                { id: 'moto', name: 'Moto', description: 'Motocicleta' }
                            ].map(vehicleTypeOption => (
                                <TouchableOpacity
                                    key={vehicleTypeOption.id}
                                    style={styles.modalItem}
                                    onPress={() => {
                                        setVehicleType(vehicleTypeOption.id);
                                        if (errors.vehicleType) setErrors(prev => ({ ...prev, vehicleType: null }));
                                        setShowVehicleTypeModal(false);
                                    }}
                                >
                                    <Text style={[styles.modalItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        {vehicleTypeOption.name}
                                    </Text>
                                    <Text style={[styles.modalItemSubtext, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        {vehicleTypeOption.description}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal de upload de PDF com OCR */}
            <CRLVPDFUpload
                visible={showCRLVUpload}
                onClose={() => setShowCRLVUpload(false)}
                onDataExtracted={handleOCRDataExtracted}
            />
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
    uploadHint: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        textAlign: 'center',
        marginTop: 4,
        fontStyle: 'italic',
    },
    pdfContainer: {
        alignItems: 'center',
        padding: 20,
        borderRadius: 12,
        backgroundColor: 'rgba(65, 210, 116, 0.1)',
    },
    pdfText: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginTop: 12,
        textAlign: 'center',
    },
    pdfSubtext: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginTop: 4,
        textAlign: 'center',
    },
    pdfInfoContainer: {
        padding: 12,
        borderRadius: 8,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#FF6B00',
    },
    pdfInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    pdfInfoText: {
        fontSize: 13,
        fontFamily: fonts.Regular,
        flex: 1,
    },
    pdfWarningRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    pdfWarningText: {
        fontSize: 12,
        fontFamily: fonts.Bold,
        color: '#FF6B00',
        flex: 1,
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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    modalItemSelected: {
        backgroundColor: 'rgba(65, 210, 116, 0.1)',
    },
    modalItemText: {
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    modalItemSubtext: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginTop: 2,
    },
}); 