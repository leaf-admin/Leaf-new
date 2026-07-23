import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 418;
const ISSUE_TYPES = [
  {
    id: 'trip',
    label: 'Problema na corrida',
    icon: 'car-sport-outline',
    priority: 'N2',
    severity: 'ride_issue',
  },
  {
    id: 'driver',
    label: 'Conduta do motorista',
    icon: 'person-outline',
    priority: 'N2',
    severity: 'safety',
  },
  {
    id: 'payment',
    label: 'Cobrança e pagamento',
    icon: 'card-outline',
    priority: 'N2',
    severity: 'payment',
  }
];

function pickComplainContextText(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(Boolean) || '';
}

function resolveInitialIssueTypeId(routeParams = {}) {
  const requestedType = pickComplainContextText(
    routeParams?.type,
    routeParams?.initialTopicId,
    routeParams?.severity,
  ).toLowerCase();

  if (requestedType.includes('payment') || requestedType.includes('billing') || requestedType.includes('pix')) {
    return 'payment';
  }
  if (requestedType.includes('driver') || requestedType.includes('safety')) {
    return 'driver';
  }
  return 'trip';
}

function resolveComplainReturnRoute({ bookingId, bookingStatus, source } = {}) {
  const normalizedSource = String(source || '').toLowerCase();
  const normalizedStatus = normalizeRuntimeRideStatus(bookingStatus);

  if (normalizedSource === 'receipt' || normalizedStatus === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (normalizedSource === 'driver-trip') {
    return 'RobotaxiPrototype';
  }
  if (bookingId) {
    return 'RobotaxiPrototypeTrip';
  }
  return 'RobotaxiPrototype';
}

export default function RobotaxiComplainScreen({ navigation, route }) {
  const { openSupportTicket, supportLoading, supportError, supportLastTicket, lastReceipt } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [selectedTypeId, setSelectedTypeId] = useState(() => resolveInitialIssueTypeId(route?.params));
  const [subject, setSubject] = useState(route?.params?.subject || 'Relato sobre esta corrida');
  const [description, setDescription] = useState('');
  const [localHistory, setLocalHistory] = useState([]);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const cardMaxHeight = Math.max(390, windowHeight - insets.top - insets.bottom - 82);
  const receipt = route?.params?.receipt || lastReceipt || null;
  const bookingId = pickComplainContextText(
    route?.params?.bookingId,
    route?.params?.rideId,
    route?.params?.tripId,
    route?.params?.activeBookingId,
    receipt?.bookingId,
    receipt?.id,
  );
  const bookingStatus = normalizeRuntimeRideStatus(pickComplainContextText(
    route?.params?.bookingStatus,
    route?.params?.status,
    receipt?.status,
  ));
  const supportSource = pickComplainContextText(route?.params?.source, bookingId ? 'complain' : '');
  const complainContext = useMemo(
    () => ({
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(bookingStatus ? { bookingStatus } : {}),
      ...(supportSource ? { source: supportSource } : {}),
    }),
    [bookingId, bookingStatus, supportSource],
  );

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
    navigation.navigate(resolveComplainReturnRoute(complainContext), complainContext);
  };

  const handleSubmit = useCallback(async () => {
    const normalizedSubject = String(subject || '').trim();
    const normalizedDescription = String(description || '').trim();

    if (!normalizedSubject || !normalizedDescription) {
      Alert.alert('Campos obrigatórios', 'Conte rapidamente o que aconteceu para a gente ajudar melhor.');
      return;
    }

    const routeDescription = receipt?.route ? ` | Corrida: ${receipt.route}` : '';

    try {
      await openSupportTicket({
        type: `complaint-${selectedType.id}`,
        priority: selectedType.priority,
        severity: selectedType.severity,
        subject: normalizedSubject,
        description: `${normalizedSubject}: ${normalizedDescription}${routeDescription}`,
        ...complainContext,
      });

      const localTicket = {
        id: `local-${Date.now()}`,
        status: 'Enviado',
        createdAt: new Date().toISOString()
      };
      setLocalHistory(previous => [localTicket, ...previous].slice(0, 3));
      setDescription('');
      Alert.alert('Relato enviado', 'Recebemos seu relato e vamos acompanhar por aqui.');
    } catch (error) {
      Alert.alert('Não conseguimos enviar', error?.message || 'Tente novamente em instantes.');
    }
  }, [
    complainContext,
    description,
    openSupportTicket,
    receipt?.route,
    selectedType.id,
    selectedType.priority,
    selectedType.severity,
    subject,
  ]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <KeyboardAvoidingView
            pointerEvents="box-none"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Math.max(0, insets.top - 4)}
            style={styles.keyboardAvoiding}
          >
            <PrototypeCard onLayout={handleCardLayout} style={[styles.card, { maxHeight: cardMaxHeight }]}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.cardScroll}
              >
                <CardHandle />

                <Text style={styles.title}>Relatar problema</Text>
                <Text style={styles.subtitle}>Conte o que aconteceu nesta viagem.</Text>

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
                    testID="robotaxi-complain-subject"
                    accessibilityLabel="robotaxi-complain-subject"
                  />
                </View>

                <View style={[styles.inputBlock, styles.inputBlockLast]}>
                  <Text style={styles.inputLabel}>Descrição</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder={`Detalhe o ocorrido (${selectedType.label.toLowerCase()})`}
                    placeholderTextColor={color.text.muted}
                    style={[styles.input, styles.textarea]}
                    testID="robotaxi-complain-description"
                    accessibilityLabel="robotaxi-complain-description"
                    multiline
                    textAlignVertical="top"
                  />
                </View>

                <PrototypePrimaryButton
                  label={supportLoading ? 'Enviando...' : 'Enviar relato'}
                  icon="document-text-outline"
                  onPress={supportLoading ? undefined : handleSubmit}
                  style={styles.submitButton}
                  testID="robotaxi-complain-submit"
                  accessibilityLabel="robotaxi-complain-submit"
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
              </ScrollView>
            </PrototypeCard>
          </KeyboardAvoidingView>
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
    left: 0,
    right: 0
  },
  keyboardAvoiding: {
    width: '100%'
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16
  },
  cardScroll: {
    paddingBottom: 2
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24
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
    borderRadius: 20,
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
    borderRadius: 18,
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
