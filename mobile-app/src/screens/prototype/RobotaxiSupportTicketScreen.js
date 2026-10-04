import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';
import { toUserFriendlyMessage } from '../../utils/friendlyErrorMessages';

const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const KYC_IDENTITY_REVIEW_SOURCE = 'kyc_identity_mismatch_appeal';
const SAFE_KYC_CONTEXT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_KYC_REQUIREMENT_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

const TICKET_TYPES = [
  {
    id: 'payment',
    title: 'Pagamento',
    subtitle: 'Cobrança, estorno ou recibo',
    icon: 'card-outline',
  },
  {
    id: 'trip',
    title: 'Viagem',
    subtitle: 'Embarque, rota ou motorista',
    icon: 'car-outline',
  },
  {
    id: 'safety',
    title: 'Segurança',
    subtitle: 'Relato prioritário',
    icon: 'shield-checkmark-outline',
  },
  {
    id: 'account',
    title: 'Conta e identidade',
    subtitle: 'Acesso, cadastro ou validação de identidade',
    icon: 'person-circle-outline',
  },
];

function pickTicketContextText(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(Boolean) || '';
}

function pickSafeKycContextId(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(value => SAFE_KYC_CONTEXT_ID_PATTERN.test(value)) || '';
}

function resolveTicketReturnRoute(context = {}) {
  const source = String(context.source || '').toLowerCase();
  const status = normalizeRuntimeRideStatus(context.bookingStatus);

  if (source === 'receipt' || status === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (source === 'driver-trip') {
    return 'RobotaxiPrototype';
  }
  if (context.bookingId || context.rideId || context.tripId) {
    return 'RobotaxiPrototypeTrip';
  }
  return 'RobotaxiPrototypeSupport';
}

function TicketTypeRow({ item, active, onPress, expanded = null }) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.typeRow, active && styles.typeRowActive]}
      testID={`robotaxi-support-ticket-type-${item.id}`}
      accessibilityRole={expanded === null ? 'radio' : 'button'}
      accessibilityLabel={item.title}
      accessibilityHint={item.subtitle}
      accessibilityState={expanded === null ? { checked: active } : { expanded }}
    >
      <View style={styles.typeIcon}>
        <LeafObjectIcon symbol={item.icon} size={40} />
      </View>
      <View style={styles.typeCopy}>
        <Text style={styles.typeTitle}>{item.title}</Text>
        <Text style={styles.typeSubtitle}>{item.subtitle}</Text>
      </View>
      <Ionicons name={expanded !== null ? (expanded ? 'chevron-up' : 'chevron-down') : active ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={expanded !== null ? leafRideColors.muted : active ? leafRideColors.leaf : leafRideColors.muted} />
    </TouchableOpacity>
  );
}

export default function RobotaxiSupportTicketScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const identityReviewRequested = route?.params?.source === KYC_IDENTITY_REVIEW_SOURCE || Boolean(
    pickSafeKycContextId(
      route?.params?.kycEvidenceId,
      route?.params?.kycReviewCaseId,
    ),
  );
  const requestedType = route?.params?.type || route?.params?.selectedType || 'trip';
  const initialType = identityReviewRequested
    ? 'account'
    : TICKET_TYPES.some(item => item.id === requestedType)
    ? requestedType
    : 'trip';
  const [selectedTypeId, setSelectedTypeId] = useState(initialType);
  const [showTicketTypes, setShowTicketTypes] = useState(false);
  const [subject, setSubject] = useState(route?.params?.subject || '');
  const [description, setDescription] = useState(route?.params?.description || '');
  const [createdTicket, setCreatedTicket] = useState(null);
  const { openSupportTicket, supportLoading, supportError } = usePrototypeRideRuntime();
  const bookingId = pickTicketContextText(
    route?.params?.bookingId,
    route?.params?.rideId,
    route?.params?.tripId,
    route?.params?.activeBookingId,
  );
  const bookingStatus = normalizeRuntimeRideStatus(pickTicketContextText(route?.params?.bookingStatus, route?.params?.status));
  const supportSource = pickTicketContextText(route?.params?.source, bookingId ? 'support-ticket' : '');
  const kycEvidenceId = pickSafeKycContextId(route?.params?.kycEvidenceId);
  const kycReviewCaseId = pickSafeKycContextId(route?.params?.kycReviewCaseId);
  const kycChallengeId = pickSafeKycContextId(route?.params?.kycChallengeId);
  const requestedRequirement = String(route?.params?.requirement || '').trim().toUpperCase();
  const requirement = SAFE_KYC_REQUIREMENT_PATTERN.test(requestedRequirement)
    ? requestedRequirement
    : '';
  const isIdentityReviewFlow = supportSource === KYC_IDENTITY_REVIEW_SOURCE || Boolean(
    kycEvidenceId || kycReviewCaseId,
  );
  const visibleSupportError = isIdentityReviewFlow && supportError
    ? toUserFriendlyMessage(supportError, {
        context: 'api',
        fallbackMessage: 'Não foi possível solicitar a análise agora. Tente novamente em instantes.',
      })
    : supportError;
  const effectiveSupportSource = isIdentityReviewFlow
    ? KYC_IDENTITY_REVIEW_SOURCE
    : supportSource;
  const ticketChatContext = useMemo(
    () => ({
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(bookingStatus ? { bookingStatus } : {}),
      ...(kycEvidenceId ? { kycEvidenceId } : {}),
      ...(kycReviewCaseId ? { kycReviewCaseId } : {}),
      ...(kycChallengeId ? { kycChallengeId } : {}),
      ...(requirement ? { requirement } : {}),
      ...(typeof route?.params?.reviewAvailable === 'boolean'
        ? { reviewAvailable: route.params.reviewAvailable }
        : {}),
      source: effectiveSupportSource || 'support-ticket',
    }),
    [
      bookingId,
      bookingStatus,
      effectiveSupportSource,
      kycChallengeId,
      kycEvidenceId,
      kycReviewCaseId,
      requirement,
      route?.params?.reviewAvailable,
    ],
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-support-ticket',
    occludedBottom: panelHeight,
  });

  const selectedType = useMemo(
    () => TICKET_TYPES.find(item => item.id === selectedTypeId) || TICKET_TYPES[0],
    [selectedTypeId],
  );
  const canSubmit = description.trim().length >= 12;

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate(resolveTicketReturnRoute(ticketChatContext), ticketChatContext);
  }, [navigation, ticketChatContext]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      Alert.alert('Conte um pouco mais', 'Descreva o que aconteceu com pelo menos 12 caracteres.');
      return;
    }

    try {
      const result = await openSupportTicket({
        type: selectedType.id,
        priority: selectedType.id === 'safety'
          ? 'N1'
          : selectedType.id === 'account'
            ? 'N2'
            : 'N3',
        subject: subject.trim() || selectedType.title,
        description: `${subject.trim() || selectedType.title}: ${description.trim()}`,
        ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
        ...(bookingStatus ? { bookingStatus } : {}),
        ...(kycEvidenceId ? { kycEvidenceId } : {}),
        ...(kycReviewCaseId ? { kycReviewCaseId } : {}),
        ...(kycChallengeId ? { kycChallengeId } : {}),
        ...(requirement ? { requirement } : {}),
        ...(typeof route?.params?.reviewAvailable === 'boolean'
          ? { reviewAvailable: route.params.reviewAvailable }
          : {}),
        ...(effectiveSupportSource ? { source: effectiveSupportSource } : {}),
      });
      setCreatedTicket(result?.ticket || null);
    } catch (error) {
      const message = isIdentityReviewFlow
        ? toUserFriendlyMessage(error, {
            context: 'api',
            fallbackMessage: 'Não foi possível solicitar a análise agora. Tente novamente em instantes.',
          })
        : error?.message || 'Tente novamente em instantes.';
      Alert.alert('Não foi possível abrir ticket', message);
    }
  }, [
    bookingId,
    bookingStatus,
    canSubmit,
    description,
    effectiveSupportSource,
    kycChallengeId,
    kycEvidenceId,
    kycReviewCaseId,
    isIdentityReviewFlow,
    openSupportTicket,
    requirement,
    route?.params?.reviewAvailable,
    selectedType.id,
    selectedType.title,
    subject,
  ]);

  const handleOpenCreatedTicketThread = useCallback(() => {
    if (!createdTicket?.id) {
      return;
    }

    navigation.replace('RobotaxiPrototypeSupportThread', {
      ticketId: createdTicket.id,
      ticket: createdTicket,
      ...ticketChatContext,
      source: ticketChatContext.source || 'support-ticket',
    });
  }, [createdTicket, navigation, ticketChatContext]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-support-ticket-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Math.max(0, insets.top - 4)}
            style={styles.keyboardAvoiding}
          >
            <PrototypeMenuSurface
              onLayout={handlePanelLayout}
              eyebrow="Suporte"
              title={isIdentityReviewFlow ? 'Solicitar análise' : 'Abrir ticket'}
              subtitle={isIdentityReviewFlow
                ? 'Conte o que aconteceu. Nossa equipe verificará a validação de identidade e o documento aprovado.'
                : 'Registre o problema com contexto suficiente para a operação agir rápido.'}
              fullScreen
              style={{
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              }}
              headerAccessory={(
                <PrototypeMenuCloseButton
                  onPress={handleDismiss}
                  testID="robotaxi-support-ticket-close-button"
                  accessibilityLabel="Fechar formulário de suporte"
                />
              )}
            >
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <PrototypeMenuSection title="Tipo de atendimento">
                  <TicketTypeRow
                    item={selectedType}
                    active
                    expanded={isIdentityReviewFlow ? null : showTicketTypes}
                    onPress={isIdentityReviewFlow ? undefined : () => setShowTicketTypes(value => !value)}
                  />
                  {showTicketTypes && !isIdentityReviewFlow ? TICKET_TYPES.filter(item => item.id !== selectedTypeId).map(item => (
                    <TicketTypeRow
                      key={item.id}
                      item={item}
                      active={false}
                      onPress={() => { setSelectedTypeId(item.id); setShowTicketTypes(false); }}
                    />
                  )) : null}
                </PrototypeMenuSection>

                <View style={styles.formBlock}>
                  <Text style={styles.inputLabel}>Assunto</Text>
                  <TextInput
                    value={subject}
                    onChangeText={setSubject}
                    placeholder={selectedType.title}
                    placeholderTextColor={leafRideColors.muted}
                    style={styles.input}
                    testID="robotaxi-support-ticket-subject"
                    accessibilityLabel={isIdentityReviewFlow ? 'Assunto do pedido de revisão' : 'Assunto do ticket de suporte'}
                    accessibilityHint={selectedType.title}
                  />
                  <Text style={styles.inputLabel}>Detalhes</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Explique o que aconteceu e quando percebeu o problema."
                    placeholderTextColor={leafRideColors.muted}
                    style={[styles.input, styles.textarea]}
                    multiline
                    textAlignVertical="top"
                    testID="robotaxi-support-ticket-description"
                    accessibilityLabel={isIdentityReviewFlow ? 'Detalhes do pedido de revisão' : 'Detalhes do ticket de suporte'}
                    accessibilityHint={isIdentityReviewFlow
                      ? 'Descreva o motivo da solicitação de revisão.'
                      : 'Explique o que aconteceu e quando percebeu o problema.'}
                  />
                </View>

                <LeafButton
                  label={supportLoading
                    ? 'Enviando...'
                    : isIdentityReviewFlow
                      ? 'Solicitar análise'
                      : 'Enviar ticket'}
                  icon="send-outline"
                  tone="primary"
                  disabled={supportLoading || !canSubmit}
                  onPress={handleSubmit}
                  style={styles.doneButton}
                  testID="robotaxi-support-ticket-submit"
                  accessibilityLabel={supportLoading
                    ? 'Enviando solicitação de suporte'
                    : isIdentityReviewFlow
                      ? 'Solicitar análise de identidade'
                      : 'Enviar ticket de suporte'}
                />

                {supportLoading ? (
                  <View style={styles.feedbackRow}>
                    <ActivityIndicator size="small" color={leafRideColors.leaf} />
                    <Text style={styles.feedbackText}>Sincronizando com suporte...</Text>
                  </View>
                ) : null}
                {visibleSupportError ? <Text style={styles.errorText}>{visibleSupportError}</Text> : null}
                {createdTicket?.id ? (
                  <LeafEmptyState
                    icon="checkmark-circle-outline"
                    title={`Ticket #${createdTicket.id} criado`}
                    message="A operação recebeu sua solicitação. A resposta aparecerá na thread deste ticket."
                    actionLabel="Acompanhar ticket"
                    onAction={handleOpenCreatedTicketThread}
                    testID="robotaxi-support-ticket-created"
                  />
                ) : null}
              </ScrollView>
            </PrototypeMenuSurface>
          </KeyboardAvoidingView>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  content: {
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  typeRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: leafRideColors.line,
    paddingVertical: 10,
  },
  typeRowActive: {
    backgroundColor: '#F5F5F5',
  },
  typeIcon: {
    width: 52,
    alignItems: 'flex-start',
  },
  typeCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  typeTitle: {
    color: leafRideColors.text,
    ...leafTypography.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  typeSubtitle: {
    marginTop: 2,
    color: leafRideColors.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  formBlock: {
    paddingVertical: 4,
  },
  inputLabel: {
    color: leafRideColors.secondary,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  input: {
    minHeight: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 14,
    color: leafRideColors.text,
    ...leafTypography.regular,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 14,
  },
  textarea: {
    minHeight: 145,
    paddingTop: 12,
    marginBottom: 0,
  },
  doneButton: {
    alignSelf: 'stretch',
  },
  feedbackRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    color: leafRideColors.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: leafRideColors.dangerText,
    ...leafTypography.medium,
    fontSize: 14,
    lineHeight: 20,
  },
});
