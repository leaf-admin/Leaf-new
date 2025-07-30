import React, { useState, useEffect } from 'react';
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
  Alert,
  FlatList
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector } from 'react-redux';
import { api } from '../common-local';

const FeedbackScreen = ({ navigation, route }) => {
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previousFeedback, setPreviousFeedback] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const auth = useSelector(state => state.auth);
  const currentUser = auth.profile;

  const categories = [
    { id: 'general', label: 'Geral', icon: 'feedback' },
    { id: 'bug', label: 'Bug/Problema', icon: 'bug-report' },
    { id: 'feature', label: 'Nova Funcionalidade', icon: 'lightbulb' },
    { id: 'ui', label: 'Interface', icon: 'palette' },
    { id: 'performance', label: 'Performance', icon: 'speed' },
    { id: 'payment', label: 'Pagamento', icon: 'payment' }
  ];

  const ratingLabels = [
    'Muito Ruim',
    'Ruim',
    'Regular',
    'Bom',
    'Excelente'
  ];

  useEffect(() => {
    loadPreviousFeedback();
  }, []);

  const loadPreviousFeedback = async () => {
    try {
      setIsLoading(true);
      
      const response = await api.get(`/api/feedback/${currentUser.id}`);
      setPreviousFeedback(response.data.feedback || []);
      
    } catch (error) {
      console.error('Erro ao carregar feedback anterior:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRatingPress = (selectedRating) => {
    setRating(selectedRating);
  };

  const handleSubmitFeedback = async () => {
    if (!feedback.trim()) {
      Alert.alert('Erro', 'Por favor, descreva seu feedback');
      return;
    }

    if (rating === 0) {
      Alert.alert('Erro', 'Por favor, selecione uma avaliação');
      return;
    }

    try {
      setIsSubmitting(true);
      
      const feedbackData = {
        category: selectedCategory,
        rating: rating,
        feedback: feedback.trim(),
        userId: currentUser.id,
        timestamp: new Date().toISOString()
      };
      
      await api.post('/api/feedback', feedbackData);
      
      Alert.alert(
        'Feedback Enviado',
        'Obrigado pelo seu feedback! Nossa equipe irá analisá-lo.',
        [{ text: 'OK', onPress: () => {
          setFeedback('');
          setRating(0);
          loadPreviousFeedback();
        }}]
      );
      
    } catch (error) {
      console.error('Erro ao enviar feedback:', error);
      Alert.alert('Erro', 'Não foi possível enviar o feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderRatingStars = () => (
    <View style={styles.ratingContainer}>
      <Text style={styles.ratingTitle}>Como você avalia sua experiência?</Text>
      
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            style={styles.starButton}
            onPress={() => handleRatingPress(star)}
          >
            <Icon 
              name={star <= rating ? "star" : "star-border"} 
              type="material" 
              color={star <= rating ? "#f39c12" : "#e0e0e0"} 
              size={32} 
            />
          </TouchableOpacity>
        ))}
      </View>
      
      {rating > 0 && (
        <Text style={styles.ratingLabel}>
          {ratingLabels[rating - 1]}
        </Text>
      )}
    </View>
  );

  const renderCategorySelector = () => (
    <View style={styles.categoryContainer}>
      <Text style={styles.categoryTitle}>Categoria do Feedback</Text>
      
      <FlatList
        data={categories}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.categoryButton,
              selectedCategory === item.id && styles.selectedCategoryButton
            ]}
            onPress={() => setSelectedCategory(item.id)}
          >
            <Icon 
              name={item.icon} 
              type="material" 
              color={selectedCategory === item.id ? '#2E8B57' : '#7f8c8d'} 
              size={20} 
            />
            <Text style={[
              styles.categoryButtonText,
              selectedCategory === item.id && styles.selectedCategoryButtonText
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.categoriesList}
      />
    </View>
  );

  const renderFeedbackForm = () => (
    <View style={styles.formContainer}>
      <Text style={styles.formTitle}>Descreva seu Feedback</Text>
      
      <TextInput
        style={styles.feedbackInput}
        value={feedback}
        onChangeText={setFeedback}
        placeholder="Conte-nos sobre sua experiência, sugestões ou problemas encontrados..."
        multiline
        numberOfLines={6}
        maxLength={1000}
        textAlignVertical="top"
      />
      
      <Text style={styles.characterCount}>
        {feedback.length}/1000 caracteres
      </Text>
      
      <TouchableOpacity
        style={[styles.submitButton, (!feedback.trim() || rating === 0) && styles.submitButtonDisabled]}
        onPress={handleSubmitFeedback}
        disabled={!feedback.trim() || rating === 0 || isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Icon name="send" type="material" color="#fff" size={20} />
            <Text style={styles.submitButtonText}>Enviar Feedback</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderPreviousFeedback = () => (
    <View style={styles.previousContainer}>
      <Text style={styles.previousTitle}>Meus Feedbacks Anteriores</Text>
      
      {previousFeedback.length > 0 ? (
        <FlatList
          data={previousFeedback}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.feedbackCard}>
              <View style={styles.feedbackHeader}>
                <View style={styles.feedbackMeta}>
                  <Text style={styles.feedbackCategory}>
                    {categories.find(c => c.id === item.category)?.label}
                  </Text>
                  <Text style={styles.feedbackDate}>
                    {new Date(item.timestamp).toLocaleDateString('pt-BR')}
                  </Text>
                </View>
                
                <View style={styles.feedbackRating}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Icon 
                      key={star}
                      name={star <= item.rating ? "star" : "star-border"} 
                      type="material" 
                      color={star <= item.rating ? "#f39c12" : "#e0e0e0"} 
                      size={16} 
                    />
                  ))}
                </View>
              </View>
              
              <Text style={styles.feedbackText}>
                {item.feedback}
              </Text>
              
              {item.response && (
                <View style={styles.responseContainer}>
                  <Text style={styles.responseLabel}>Resposta da Equipe:</Text>
                  <Text style={styles.responseText}>
                    {item.response}
                  </Text>
                </View>
              )}
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyState}>
          <Icon name="feedback" type="material" color="#ccc" size={64} />
          <Text style={styles.emptyTitle}>Nenhum feedback enviado</Text>
          <Text style={styles.emptySubtitle}>
            Seu primeiro feedback aparecerá aqui
          </Text>
        </View>
      )}
    </View>
  );

  const renderTips = () => (
    <View style={styles.tipsContainer}>
      <Text style={styles.tipsTitle}>Dicas para um Feedback Melhor</Text>
      
      <View style={styles.tipItem}>
        <Icon name="lightbulb" type="material" color="#f39c12" size={20} />
        <Text style={styles.tipText}>
          Seja específico sobre o que funcionou bem ou não
        </Text>
      </View>
      
      <View style={styles.tipItem}>
        <Icon name="lightbulb" type="material" color="#f39c12" size={20} />
        <Text style={styles.tipText}>
          Inclua detalhes sobre quando o problema ocorreu
        </Text>
      </View>
      
      <View style={styles.tipItem}>
        <Icon name="lightbulb" type="material" color="#f39c12" size={20} />
        <Text style={styles.tipText}>
          Sugira melhorias específicas quando possível
        </Text>
      </View>
      
      <View style={styles.tipItem}>
        <Icon name="lightbulb" type="material" color="#f39c12" size={20} />
        <Text style={styles.tipText}>
          Mantenha um tom construtivo e respeitoso
        </Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E8B57" />
        <Text style={styles.loadingText}>Carregando feedback...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Feedback</Text>
        
        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => navigation.navigate('HelpScreen')}
        >
          <Icon name="help-outline" type="material" color="#2c3e50" size={24} />
        </TouchableOpacity>
      </View>
      
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderRatingStars()}
        {renderCategorySelector()}
        {renderFeedbackForm()}
        {renderTips()}
        {renderPreviousFeedback()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  helpButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  ratingContainer: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    alignItems: 'center',
  },
  ratingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
    textAlign: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  starButton: {
    padding: 4,
  },
  ratingLabel: {
    fontSize: 14,
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  categoryContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  categoriesList: {
    paddingVertical: 8,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 16,
    backgroundColor: '#f8f9fa',
  },
  selectedCategoryButton: {
    backgroundColor: '#e8f5e8',
  },
  categoryButtonText: {
    fontSize: 12,
    color: '#7f8c8d',
    marginLeft: 4,
  },
  selectedCategoryButtonText: {
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  formContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
  },
  feedbackInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#2c3e50',
    minHeight: 120,
    textAlignVertical: 'top',
  },
  characterCount: {
    fontSize: 12,
    color: '#7f8c8d',
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2E8B57',
    paddingVertical: 12,
    borderRadius: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  tipsContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tipText: {
    fontSize: 14,
    color: '#2c3e50',
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  previousContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  previousTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 16,
  },
  feedbackCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  feedbackMeta: {
    flex: 1,
  },
  feedbackCategory: {
    fontSize: 12,
    color: '#2E8B57',
    fontWeight: 'bold',
  },
  feedbackDate: {
    fontSize: 10,
    color: '#7f8c8d',
  },
  feedbackRating: {
    flexDirection: 'row',
  },
  feedbackText: {
    fontSize: 14,
    color: '#2c3e50',
    lineHeight: 18,
  },
  responseContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  responseLabel: {
    fontSize: 12,
    color: '#2E8B57',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  responseText: {
    fontSize: 12,
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#7f8c8d',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#95a5a6',
    textAlign: 'center',
  },
});

export default FeedbackScreen; 