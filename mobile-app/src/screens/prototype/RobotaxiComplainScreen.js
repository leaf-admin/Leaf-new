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
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 418;
const ISSUE_TYPES = [
  { id: 'trip', label: 'Problema na corrida', icon: 'car-sport-outline' },
  { id: 'driver', label: 'Conduta do motorista', icon: 'person-outline' },
  { id: 'payment', label: 'Cobranca e pagamento', icon: 'card-outline' }
];

export default function RobotaxiComplainScreen({ navigation, route }) {
  const { openSupportTicket, supportLoading, supportError, supportLastTicket, lastReceipt } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [selectedTypeId, setSelectedTypeId] = useState(ISSUE_TYPES[0].id);
  const [subject, setSubject] = useState(route?.params?.subject || 'Relato sobre esta corrida');
  const [description, setDescription] = useState('');
  const [localHistory, setLocalHistory] = useState([]);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const receipt = route?.params?.receipt || lastReceipt || null;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-complain',
    occludedBottom: sheetBottom + cardHeight
  });

  const selectedType = useMemo(() => {
    return ISSUE_TYPES.find(item => item.id === selectedTypeId) || ISSUE_TYPES[0];
  }, [selectedTypeId]);

  const ticketRows = useMemo(() => {
    const rows = [];
    if (supportLastTicket?.id) {
      rows.push({
        id: String(supportLastTicket.id),
        status: 'Ticket sincronizado',
        createdAt: supportLastTicket.createdAt || new Date().toISOString()
      });
    }

    return [...rows, ...localHistory].slice(0, 3);
  }, [localHistory, supportLastTicket?.createdAt, supportLastTicket?.id]);

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

  const handleSubmit = useCallback(async () => {
    const normalizedSubject = String(subject || '').trim();
    const normalizedDescription = String(description || '').trim();

    if (!normalizedSubject || !normalizedDescription) {
      Alert.alert('Campos obrigatorios', 'Preencha assunto e descricao para enviar a reclamacao.');
      return;
    }

    const routeDescription = receipt?.route ? ` | Corrida: ${receipt.route}` : '';

    try {
      await openSupportTicket({
        type: `complaint-${selectedType.id}`,
        priority: 'N2',
        description: `${normalizedSubject}: ${normalizedDescription}${routeDescription}`
      });

      const localTicket = {
        id: `local-${Date.now()}`,
        status: 'Enviado no prototipo',
        createdAt: new Date().toISOString()
      };
      setLocalHistory(previous => [localTicket, ...previous].slice(0, 3));
      setDescription('');
      Alert.alert('Reclamacao enviada', 'Seu relato foi registrado com sucesso.');
    } catch (error) {
      Alert.alert('Nao foi possivel enviar', error?.message || 'Falha ao enviar reclamacao.');
    }
  }, [description, openSupportTicket, receipt?.route, selectedType.id, subject]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <Text style={styles.title}>Relatar problema</Text>
            <Text style={styles.subtitle}>Abra uma reclamacao com o contexto da viagem.</Text>

            <View style={styles.typeRow}>
              {ISSUE_TYPES.map(item => {
                const active = item.id === selectedTypeId;
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.86}
                    style={[styles.typeChip, active && styles.typeChipActive]}
                    onPress={() => setSelectedTypeId(item.id)}
                  >
                    <Ionicons name={item.icon} size={14} color={color.text.primary} />
                    <Text style={styles.typeChipText}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.inputLabel}>Assunto</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder="Descreva o tema principal"
                placeholderTextColor={color.text.muted}
                style={styles.input}
              />
            </View>

            <View style={[styles.inputBlock, styles.inputBlockLast]}>
              <Text style={styles.inputLabel}>Descricao</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={`Detalhe o ocorrido (${selectedType.label.toLowerCase()})`}
                placeholderTextColor={color.text.muted}
                style={[styles.input, styles.textarea]}
                multiline
                textAlignVertical="top"
              />
            </View>

            <PrototypePrimaryButton
              label={supportLoading ? 'Enviando...' : 'Enviar reclamacao'}
              icon="document-text-outline"
              onPress={supportLoading ? undefined : handleSubmit}
              style={styles.submitButton}
            />

            {ticketRows.length > 0 ? (
              <View style={styles.historyWrap}>
                {ticketRows.map(item => (
                  <View key={item.id} style={styles.historyRow}>
                    <Text style={styles.historyId}>#{item.id}</Text>
                    <Text style={styles.historyStatus}>{item.status}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
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
    lineHeight: typography.subtitle.lineHeight
  },
  subtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  typeRow: {
    marginTop: 10,
    gap: 8
  },
  typeChip: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  typeChipActive: {
    borderColor: color.border.strong,
    backgroundColor: color.surface.activeSoft
  },
  typeChipText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  inputBlock: {
    marginTop: 8
  },
  inputBlockLast: {
    marginTop: 6
  },
  inputLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  input: {
    marginTop: 4,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 10,
    color: color.text.primary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  textarea: {
    minHeight: 90,
    paddingVertical: 8
  },
  submitButton: {
    marginTop: 10
  },
  historyWrap: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: 'hidden'
  },
  historyRow: {
    minHeight: 34,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  historyId: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  historyStatus: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  errorText: {
    marginTop: 8,
    color: '#8A1F2B',
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
