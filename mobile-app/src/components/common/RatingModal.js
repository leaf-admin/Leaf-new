import Logger from '../../utils/Logger';
import React, { useState, useEffect, memo, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    ScrollView,
    TextInput,
    Alert,
    Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch } from 'react-redux';
// Função de tradução temporária para evitar erro de provider
const t = (key) => {
    const translations = {
        'messages.attention': 'Atenção',
        'rating.fillRequiredFields': 'Por favor, preencha todos os campos obrigatórios',
        'messages.success': 'Sucesso',
        'rating.submittedSuccessfully': 'Avaliação enviada com sucesso!',
        'messages.error': 'Erro',
        'rating.submitError': 'Erro ao enviar avaliação. Tente novamente.'
    };
    return translations[key] || key;
};

const { width, height } = Dimensions.get('window');

const RatingModal = memo(function RatingModal({ 
    visible, 
    onClose, 
    userType, // 'passenger' ou 'driver'
    tripData,
    onSubmit 
}) {
    const dispatch = useDispatch();
    
    // Estados da avaliação
    const [rating, setRating] = useState(0);
    const [selectedOptions, setSelectedOptions] = useState([]);
    const [comment, setComment] = useState('');
    const [suggestion, setSuggestion] = useState('');
    
    // Opções baseadas no tipo de usuário e avaliação (memoizado)
    const getRatingOptions = useMemo(() => {
        if (rating >= 5) {
            return userType === 'passenger' 
                ? ['Veículo limpo', 'Ótimo trajeto', 'Ambiente agradável', 'Direção segura']
                : ['Passageiro educado', 'Embarque preciso', 'Instruções claras', 'Respeito'];
        } else if (rating >= 3) {
            return userType === 'passenger'
                ? ['Limpeza do carro', 'Trajeto', 'Ambiente (música e temperatura)', 'Segurança']
                : ['Embarque impreciso', 'Falta de cordialidade', 'Instruções confusas', 'Falta de respeito'];
        }
        return [];
    }, [rating, userType]);
    
    // Título baseado na avaliação (memoizado)
    const getRatingTitle = useMemo(() => {
        if (rating >= 5) return 'O que você mais gostou?';
        if (rating >= 3) return 'O que poderia ser melhor?';
        return 'O que poderia ser melhor?';
    }, [rating]);
    
    // Verificar se campos obrigatórios estão preenchidos
    const isFormValid = () => {
        if (rating === 0) return false;
        if (rating <= 2 && suggestion.trim() === '') return false;
        return true;
    };
    
    // Limpar formulário
    const resetForm = () => {
        setRating(0);
        setSelectedOptions([]);
        setComment('');
        setSuggestion('');
    };
    
    // Fechar modal (memoizado)
    const handleClose = useCallback(() => {
        resetForm();
        onClose();
    }, [onClose]);
    
    // Submeter avaliação (memoizado)
    const handleSubmit = useCallback(async () => {
        if (!isFormValid()) {
            Alert.alert(t('messages.attention'), t('rating.fillRequiredFields'));
            return;
        }
        
        try {
            const ratingData = {
                tripId: tripData?.id || tripData?.bookingId,
                rating,
                selectedOptions,
                comment: comment.trim(),
                suggestion: suggestion.trim(),
                userType,
                timestamp: new Date().toISOString(),
                tripData
            };
            
            // Chamar função de submit passada como prop
            if (onSubmit) {
                await onSubmit(ratingData);
            }
            
            // Limpar formulário e fechar
            resetForm();
            onClose();
            
            Alert.alert(t('messages.success'), t('rating.submittedSuccessfully'));
            
        } catch (error) {
            Logger.error('❌ Erro ao enviar avaliação:', error);
            Alert.alert(t('messages.error'), t('rating.submitError'));
        }
    }, [rating, selectedOptions, comment, suggestion, userType, tripData, onSubmit, onClose]);
    
    // Toggle opção selecionada (memoizado)
    const toggleOption = useCallback((option) => {
        setSelectedOptions(prev => 
            prev.includes(option) 
                ? prev.filter(item => item !== option)
                : [...prev, option]
        );
    }, []);
    
    // Renderizar estrelas (memoizado)
    const renderStars = useCallback(() => {
        const stars = [];
        for (let i = 1; i <= 5; i++) {
            stars.push(
                <TouchableOpacity
                    key={i}
                    style={styles.starButton}
                    onPress={() => setRating(i)}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name={i <= rating ? 'star' : 'star-outline'}
                        size={40}
                        color={i <= rating ? '#FFD700' : '#CCCCCC'}
                    />
                </TouchableOpacity>
            );
        }
        return stars;
    }, [rating]);
    
    // Renderizar opções de avaliação (memoizado)
    const renderRatingOptions = useCallback(() => {
        if (getRatingOptions.length === 0) return null;
        
        return (
            <View style={styles.optionsContainer}>
                <Text style={styles.optionsTitle}>{getRatingTitle}</Text>
                <View style={styles.optionsGrid}>
                    {getRatingOptions.map((option, index) => (
                        <TouchableOpacity
                            key={index}
                            style={[
                                styles.optionButton,
                                selectedOptions.includes(option) && styles.optionButtonSelected
                            ]}
                            onPress={() => toggleOption(option)}
                            activeOpacity={0.7}
                        >
                            <Text style={[
                                styles.optionText,
                                selectedOptions.includes(option) && styles.optionTextSelected
                            ]}>
                                {option}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        );
    }, [getRatingOptions, getRatingTitle, selectedOptions, toggleOption]);
    
    // Renderizar campos de texto (memoizado)
    const renderTextFields = useCallback(() => {
        return (
            <View style={styles.textFieldsContainer}>
                {/* Campo de elogio para 5 estrelas */}
                {rating >= 5 && (
                    <View style={styles.textFieldContainer}>
                        <Text style={styles.textFieldLabel}>
                            Deixe um elogio (opcional)
                        </Text>
                        <TextInput
                            style={styles.textInput}
                            placeholder="Conte o que mais gostou..."
                            value={comment}
                            onChangeText={setComment}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                        />
                    </View>
                )}
                
                {/* Campo de sugestão para 3 estrelas ou menos */}
                {rating <= 3 && (
                    <View style={styles.textFieldContainer}>
                        <Text style={styles.textFieldLabel}>
                            {rating <= 2 ? 'Deixe uma sugestão *' : 'Deixe uma sugestão (opcional)'}
                        </Text>
                        <TextInput
                            style={[
                                styles.textInput,
                                rating <= 2 && styles.textInputRequired
                            ]}
                            placeholder={rating <= 2 ? "Sua sugestão é obrigatória..." : "Conte como podemos melhorar..."}
                            value={suggestion}
                            onChangeText={setSuggestion}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                        />
                    </View>
                )}
            </View>
        );
    }, [rating, comment, suggestion]);
    
    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={handleClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContainer}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>
                            Avalie sua corrida
                        </Text>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={handleClose}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="close" size={24} color="#666" />
                        </TouchableOpacity>
                    </View>
                    
                    {/* Conteúdo */}
                    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                        {/* Sistema de estrelas */}
                        <View style={styles.starsContainer}>
                            <Text style={styles.starsTitle}>
                                Como foi sua experiência?
                            </Text>
                            <View style={styles.starsRow}>
                                {renderStars()}
                            </View>
                            {rating > 0 && (
                                <Text style={styles.ratingText}>
                                    {rating === 1 ? 'Péssimo' :
                                     rating === 2 ? 'Ruim' :
                                     rating === 3 ? 'Regular' :
                                     rating === 4 ? 'Bom' : 'Excelente'}
                                </Text>
                            )}
                        </View>
                        
                        {/* Opções baseadas na avaliação */}
                        {rating > 0 && renderRatingOptions()}
                        
                        {/* Campos de texto */}
                        {rating > 0 && renderTextFields()}
                    </ScrollView>
                    
                    {/* Botões de ação */}
                    <View style={styles.footer}>
                        <TouchableOpacity
                            style={[styles.submitButton, !isFormValid() && styles.submitButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={!isFormValid()}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.submitButtonText}>
                                Enviar Avaliação
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
});

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContainer: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: height * 0.8,
        minHeight: height * 0.5,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    closeButton: {
        padding: 5,
    },
    content: {
        flex: 1,
        padding: 20,
    },
    starsContainer: {
        alignItems: 'center',
        marginBottom: 30,
    },
    starsTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 20,
        textAlign: 'center',
    },
    starsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 15,
    },
    starButton: {
        marginHorizontal: 5,
        padding: 5,
    },
    ratingText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFD700',
        marginTop: 10,
    },
    optionsContainer: {
        marginBottom: 25,
    },
    optionsTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 15,
        textAlign: 'center',
    },
    optionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    optionButton: {
        width: (width - 60) / 2 - 10,
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        backgroundColor: '#FFFFFF',
        marginBottom: 10,
        alignItems: 'center',
    },
    optionButtonSelected: {
        backgroundColor: '#4CAF50',
        borderColor: '#4CAF50',
    },
    optionText: {
        fontSize: 12,
        color: '#666',
        textAlign: 'center',
        fontWeight: '500',
    },
    optionTextSelected: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    textFieldsContainer: {
        marginBottom: 20,
    },
    textFieldContainer: {
        marginBottom: 20,
    },
    textFieldLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 8,
    },
    textInput: {
        borderWidth: 1,
        borderColor: '#E0E0E0',
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        color: '#333',
        backgroundColor: '#F9F9F9',
        minHeight: 80,
    },
    textInputRequired: {
        borderColor: '#FF6B6B',
        backgroundColor: '#FFF5F5',
    },
    footer: {
        padding: 20,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    submitButton: {
        backgroundColor: '#4CAF50',
        paddingVertical: 15,
        borderRadius: 8,
        alignItems: 'center',
    },
    submitButtonDisabled: {
        backgroundColor: '#CCCCCC',
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});

export default RatingModal;
