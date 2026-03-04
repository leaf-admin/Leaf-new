import Logger from '../../utils/Logger';
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
import { useTranslation } from '../i18n/LanguageProvider';
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';

export default function RatingUI({ userToRate, onSubmit }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRatingPress = (selectedRating) => {
    setRating(selectedRating);
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert(t('messages.error'), t('rating.pleaseSelectRating'));
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

      Alert.alert(t('messages.success'), t('rating.submittedSuccessfully'));
    } catch (error) {
      Logger.error('Erro ao enviar avaliação:', error);
      Alert.alert(t('messages.error'), t('rating.submitError'));
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
    <View style={[styles.container, { backgroundColor: theme.card }]}>
      {/* Header */}
      <View style={styles.header}>
        <Typography variant="h1" align="center" color={theme.text}>{t('rate_your_experience')}</Typography>
        <Typography variant="body" align="center" color={theme.textSecondary} style={{ marginTop: 8 }}>
          {t('rate_user', { name: userToRate?.name || t('user') })}
        </Typography>
      </View>

      {/* Estrelas de avaliação */}
      <View style={styles.ratingContainer}>
        <View style={styles.starsRow}>
          {renderStars()}
        </View>
        <Typography variant="h2" color={theme.leafGreen || '#41D274'} align="center">{getRatingText()}</Typography>
      </View>

      {/* Campo de comentário */}
      <View style={styles.commentContainer}>
        <Typography variant="label" color={theme.textSecondary} style={{ marginBottom: 10 }}>{t('additional_comments')}</Typography>
        <TextInput
          style={[styles.commentInput, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : '#F5F5F5', color: theme.text, borderColor: theme.border }]}
          placeholder={t('comment_placeholder')}
          placeholderTextColor={theme.textSecondary}
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={3}
          maxLength={200}
        />
        <Typography variant="caption" color={theme.textSecondary} align="right" style={{ marginTop: 5 }}>
          {comment.length}/200 {t('characters')}
        </Typography>
      </View>

      {/* Botões de ação */}
      <View style={styles.actionButtons}>
        <AnimatedButton
          title={t('submit_rating')}
          onPress={handleSubmit}
          disabled={isSubmitting || rating === 0}
          isLoading={isSubmitting}
          style={{ marginBottom: 12 }}
        />

        <AnimatedButton
          title={t('skip_rating')}
          variant="ghost"
          onPress={() => onSubmit && onSubmit({ rating: 0, comment: '', skipped: true })}
          disabled={isSubmitting}
        />
      </View>

      {/* Informações adicionais */}
      <View style={[styles.infoContainer, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.02)' : '#F8F9FA' }]}>
        <Typography variant="caption" color={theme.textSecondary} align="center">
          {t('rating_info')}
        </Typography>
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