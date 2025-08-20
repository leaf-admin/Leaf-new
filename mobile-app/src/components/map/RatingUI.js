import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// import { useTranslation } from 'react-i18next';

export default function RatingUI({ userToRate, onSubmit }) {
  // Função de tradução temporária
  const t = (key) => key;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRatingPress = (selectedRating) => {
    setRating(selectedRating);
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert(t('error'), t('please_select_rating'));
      return;
    }

    setIsSubmitting(true);
    
    try {
      const ratingData = {
        rating: rating,
        comment: comment.trim(),
        timestamp: new Date().toISOString(),
        ratedUser: userToRate?.name || 'Unknown'
      };

      if (onSubmit) {
        await onSubmit(ratingData);
      }

      Alert.alert(t('success'), t('rating_submitted_successfully'));
    } catch (error) {
      console.error('Erro ao enviar avaliação:', error);
      Alert.alert(t('error'), t('error_submitting_rating'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStars = () => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <TouchableOpacity
          key={i}
          onPress={() => handleRatingPress(i)}
          style={styles.starContainer}
        >
          <Ionicons
            name={i <= rating ? 'star' : 'star-outline'}
            size={40}
            color={i <= rating ? '#FFD700' : '#DDD'}
          />
        </TouchableOpacity>
      );
    }
    return stars;
  };

  const getRatingText = () => {
    if (rating === 0) return t('select_rating');
    if (rating === 1) return t('very_poor');
    if (rating === 2) return t('poor');
    if (rating === 3) return t('average');
    if (rating === 4) return t('good');
    if (rating === 5) return t('excellent');
    return '';
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('rate_your_experience')}</Text>
        <Text style={styles.subtitle}>
          {t('rate_user', { name: userToRate?.name || t('user') })}
        </Text>
      </View>

      {/* Estrelas de avaliação */}
      <View style={styles.ratingContainer}>
        <View style={styles.starsRow}>
          {renderStars()}
        </View>
        <Text style={styles.ratingText}>{getRatingText()}</Text>
      </View>

      {/* Campo de comentário */}
      <View style={styles.commentContainer}>
        <Text style={styles.commentLabel}>{t('additional_comments')}</Text>
        <TextInput
          style={styles.commentInput}
          placeholder={t('comment_placeholder')}
          placeholderTextColor="#999"
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={3}
          maxLength={200}
        />
        <Text style={styles.characterCount}>
          {comment.length}/200 {t('characters')}
        </Text>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <TouchableOpacity 
          style={styles.submitButton} 
          onPress={handleSubmit}
          disabled={isSubmitting || rating === 0}
        >
          {isSubmitting ? (
            <View style={styles.loadingContainer}>
              <Ionicons name="hourglass" size={20} color="#FFFFFF" />
              <Text style={styles.submitButtonText}>{t('submitting')}</Text>
            </View>
          ) : (
            <Text style={styles.submitButtonText}>{t('submit_rating')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.skipButton} 
          onPress={() => onSubmit && onSubmit({ rating: 0, comment: '', skipped: true })}
          disabled={isSubmitting}
        >
          <Text style={styles.skipButtonText}>{t('skip_rating')}</Text>
        </TouchableOpacity>
      </View>

      {/* Informações adicionais */}
      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          {t('rating_info')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  ratingContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 15,
  },
  starContainer: {
    marginHorizontal: 5,
  },
  ratingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#41D274',
    textAlign: 'center',
  },
  commentContainer: {
    marginBottom: 30,
  },
  commentLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  commentInput: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    color: '#333',
    textAlignVertical: 'top',
    minHeight: 80,
  },
  characterCount: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
    marginTop: 5,
  },
  actionButtons: {
    marginBottom: 20,
  },
  submitButton: {
    backgroundColor: '#41D274',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 15,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skipButton: {
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDD',
  },
  skipButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  infoContainer: {
    backgroundColor: '#F8F9FA',
    padding: 15,
    borderRadius: 10,
  },
  infoText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
  },
}); 