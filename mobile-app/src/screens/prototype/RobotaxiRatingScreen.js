import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 98;
const FALLBACK_CARD_HEIGHT = 336;

const QUICK_TAGS = ['Conducao segura', 'Pontualidade', 'Veiculo limpo', 'Boa comunicacao'];

export default function RobotaxiRatingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [selectedTags, setSelectedTags] = useState(['Conducao segura']);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const fromReceipt = Boolean(route?.params?.fromReceipt);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-rating',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const toggleTag = useCallback(tag => {
    setSelectedTags(previous => {
      if (previous.includes(tag)) {
        return previous.filter(item => item !== tag);
      }

      return [...previous, tag];
    });
  }, []);

  const summary = useMemo(() => {
    if (selectedTags.length === 0) {
      return comment.trim();
    }
    return [...selectedTags, comment.trim()].filter(Boolean).join(' | ');
  }, [comment, selectedTags]);

  const handleSubmit = useCallback(() => {
    Alert.alert('Avaliacao enviada', `Nota ${rating}/5 registrada com sucesso.`);
    navigation.navigate(fromReceipt ? 'RobotaxiPrototypeReceipt' : 'RobotaxiPrototype');
  }, [fromReceipt, navigation, rating]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <Text style={styles.title}>Avalie a viagem</Text>
            <Text style={styles.subtitle}>Sua opiniao ajuda a melhorar o pareamento no proximo trajeto.</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(value => {
                const active = value <= rating;
                return (
                  <TouchableOpacity key={value} onPress={() => setRating(value)} activeOpacity={0.86}>
                    <Ionicons name={active ? 'star' : 'star-outline'} size={30} color={active ? '#303945' : '#94A0AF'} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.tagsWrap}>
              {QUICK_TAGS.map(tag => {
                const active = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.tagChip, active && styles.tagChipActive]}
                    activeOpacity={0.86}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Comentario opcional"
              placeholderTextColor={color.text.muted}
              style={styles.input}
              multiline
            />

            <Text numberOfLines={1} style={styles.summaryText}>
              {summary ? `Resumo: ${summary}` : 'Selecione tags ou escreva um comentario.'}
            </Text>

            <PrototypePrimaryButton
              label="Enviar avaliacao"
              icon="checkmark-outline"
              onPress={handleSubmit}
              style={styles.submitButton}
            />
          </PrototypeCard>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  sheetWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  card: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    textAlign: 'center'
  },
  subtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center'
  },
  starsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8
  },
  tagsWrap: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8
  },
  tagChip: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tagChipActive: {
    borderColor: color.border.strong,
    backgroundColor: color.surface.activeSoft
  },
  tagText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  tagTextActive: {
    color: color.text.primary
  },
  input: {
    marginTop: 10,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: color.text.primary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlignVertical: 'top'
  },
  summaryText: {
    marginTop: 8,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  submitButton: {
    marginTop: 10
  }
});
