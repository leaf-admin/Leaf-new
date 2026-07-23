import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { DRIVER_ONBOARDING_STAGE_KEYS } from '../../services/DriverOnboardingService';
import { resolveCanonicalLivenessGate } from './driverActivationCanonicalContract';
import Logger from '../../utils/Logger';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 28;
const SURFACE_BOTTOM_PADDING = 18;
const FALLBACK_CARD_HEIGHT = 330;
const DOC_ANALYSIS_SLA_TEXT = 'Até 48 horas';
const ACTIVATION_COLOR = {
  bg: '#F8F6F1',
  text: '#171412',
  title: '#171412',
  secondary: '#756F68',
  muted: '#827B73',
  line: '#E9E2D8',
  leaf: '#1A330E',
  dot: '#1A330E',
  icon: '#514B45',
  chevron: '#827B73',
};

const FIELD_STATUS = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  FAILED: 'failed'
};
const EMPTY_ACTIVATION_STAGES = Object.freeze({});

const STAGE_META = {
  [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
    title: 'Ativação dos dados do motorista',
    description: 'Envie os documentos obrigatórios para liberar o online.',
    fields: [
      {
        key: 'cnhEar',
        label: 'CNH com EAR',
        helper: 'Anexe a CNH digital em PDF.',
        actionLabel: 'Enviar',
        kind: 'document',
        validator: 'cnh'
      },
      {
        key: 'vehicleRegistration',
        label: 'Cadastrar veículo',
        helper: 'Anexe o CRLV em PDF.',
        actionLabel: 'Enviar CRLV',
        kind: 'document',
        validator: 'crlv'
      },
      {
        key: 'backgroundCheckConsent',
        label: 'Autorização para pesquisa de antecedentes',
        helper: 'Aceite para liberar a consulta interna da Leaf.',
        actionLabel: 'Aceitar termos',
        kind: 'consent'
      }
    ]
  },
  [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: {
    title: 'Validação facial',
    description: 'Confirme sua identidade para finalizar o cadastro.',
    fields: [
      {
        key: 'facialValidation',
        label: 'Validação facial concluída',
        helper: 'A biometria é necessária para liberar o modo online.',
        actionLabel: 'Iniciar validação',
        kind: 'task'
      }
    ]
  },
  [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
    title: 'Validação do veículo',
    description: 'Status operacional confirmado pela plataforma.',
    fields: [
      {
        key: 'crlv',
        label: 'CRLV validado pela plataforma',
        helper: 'A liberação depende do cadastro canônico do veículo.',
        actionLabel: 'Pendente',
        kind: 'readonly'
      }
    ]
  }
};

function mapStatusLabel(status) {
  if (status === 'approved') {
    return 'Aprovado';
  }
  if (status === 'needs_attention') {
    return 'Requer atenção';
  }
  if (status === 'locked') {
    return 'Bloqueado';
  }
  if (status === 'in_review') {
    return 'Em análise';
  }
  return 'Pendente';
}

function mapFieldStatusLabel(status) {
  if (status === FIELD_STATUS.APPROVED) return 'Aprovado';
  if (status === FIELD_STATUS.IN_REVIEW) return 'Em análise';
  if (status === FIELD_STATUS.FAILED) return 'Falha';
  return 'Pendente';
}

function resolveActivationRowTitle(field) {
  if (field?.validator === 'cnh') return 'CNH';
  if (field?.validator === 'crlv') return 'CRLV';
  if (field?.kind === 'consent') return 'Termos';
  if (field?.kind === 'task') return 'Validação facial';
  if (field?.kind === 'readonly') return 'Veículo';
  return field?.label || 'Etapa';
}

function pickFirstNonEmptyString(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(Boolean) || '';
}

function resolveActivationVehicleLabel({ driverActivationRemote, documentAnalysisState } = {}) {
  const crlvAnalysis =
    documentAnalysisState?.byType?.crlv ||
    documentAnalysisState?.crlv ||
    {};
  const crlvDocument =
    driverActivationRemote?.documents?.crlv ||
    {};
  const remoteVehicle =
    driverActivationRemote?.vehicle ||
    driverActivationRemote?.summary?.vehicle ||
    crlvDocument?.vehicle ||
    {};
  const crlvData =
    crlvAnalysis?.data ||
    crlvAnalysis?.extractedData ||
    crlvDocument?.data ||
    crlvDocument?.extractedData ||
    {};

  const model = pickFirstNonEmptyString(
    remoteVehicle?.model,
    remoteVehicle?.modelo,
    remoteVehicle?.vehicleModel,
    crlvData?.model,
    crlvData?.modelo,
    crlvData?.vehicleModel,
  );
  const colorLabel = pickFirstNonEmptyString(
    remoteVehicle?.color,
    remoteVehicle?.cor,
    remoteVehicle?.vehicleColor,
    remoteVehicle?.carColor,
    crlvData?.color,
    crlvData?.cor,
    crlvData?.vehicleColor,
    crlvData?.carColor,
  );
  const plate = pickFirstNonEmptyString(
    remoteVehicle?.plate,
    remoteVehicle?.placa,
    remoteVehicle?.vehiclePlate,
    crlvData?.plate,
    crlvData?.placa,
    crlvData?.vehiclePlate,
  );
  const modelAndColor = [model, colorLabel].filter(Boolean).join(' ');

  if (modelAndColor && plate) {
    return `${modelAndColor} · ${plate}`;
  }

  return modelAndColor || plate;
}

function resolveActivationRowSubtitle(field, fieldState, vehicleLabel = '') {
  const status = fieldState?.status || FIELD_STATUS.PENDING;
  if (fieldState?.fileName) {
    return fieldState.fileName;
  }
  if (field?.kind === 'readonly') {
    if (status === FIELD_STATUS.APPROVED) {
      return vehicleLabel || 'Veículo aprovado';
    }
    if (status === FIELD_STATUS.IN_REVIEW) {
      return 'Veículo em análise';
    }
    if (status === FIELD_STATUS.FAILED) {
      return 'Veículo requer atenção';
    }
    return 'Cadastro do veículo pendente';
  }
  return mapFieldStatusLabel(status);
}

function resolveActivationRowIcon(field) {
  if (field?.validator === 'cnh') return 'id-card-outline';
  if (field?.validator === 'crlv') return 'document-text-outline';
  if (field?.kind === 'consent') return 'shield-checkmark-outline';
  if (field?.kind === 'task') return 'scan-outline';
  if (field?.kind === 'readonly') return 'car-outline';
  return 'checkmark-circle-outline';
}

function resolveDocumentTypeByField(field) {
  if (field?.validator === 'cnh') return 'cnh';
  if (field?.validator === 'crlv') return 'crlv';
  return null;
}

function mapRemoteStatusToFieldStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') return FIELD_STATUS.APPROVED;
  if (['failed', 'rejected', 'needs_attention', 'requires_attention', 'review_required'].includes(normalized)) {
    return FIELD_STATUS.FAILED;
  }
  if (['in_review', 'analyzing', 'analysis', 'under_review', 'pending_review'].includes(normalized)) {
    return FIELD_STATUS.IN_REVIEW;
  }
  return FIELD_STATUS.PENDING;
}

function resolveCanonicalVehicleFieldState(driverActivationRemote = null) {
  const activationState = String(
    driverActivationRemote?.activationState || driverActivationRemote?.state || '',
  ).trim().toUpperCase();
  const canonicalVehicleApproved =
    driverActivationRemote?.checklist?.vehicleRegistration === true;
  const canonicalVehicleInReview =
    activationState === 'VEHICLE_IN_REVIEW' ||
    driverActivationRemote?.vehicle?.inReview === true;
  const vehicleScopedReason = ['VEHICLE_PENDING', 'VEHICLE_IN_REVIEW'].includes(activationState)
    ? String(driverActivationRemote?.blockingReason || '')
    : '';

  if (canonicalVehicleApproved) {
    return {
      status: FIELD_STATUS.APPROVED,
      reason: '',
      fileName: '',
      summaryRows: [],
    };
  }

  if (canonicalVehicleInReview) {
    return {
      status: FIELD_STATUS.IN_REVIEW,
      reason: vehicleScopedReason,
      fileName: '',
      summaryRows: [],
    };
  }

  return {
    status: FIELD_STATUS.PENDING,
    reason: vehicleScopedReason,
    fileName: '',
    summaryRows: [],
  };
}

function toFieldKey(stageKey, fieldKey) {
  return `${stageKey}:${fieldKey}`;
}

function toSummaryRows(field, data = {}) {
  if (!data || typeof data !== 'object') {
    return [];
  }

  if (field?.validator === 'cnh') {
    const rows = [
      ['Nome', data.nome],
      ['CPF', data.cpf],
      ['CNH', data.cnh || data.numeroRegistro],
      ['Categoria', data.categoria],
      ['Validade', data.validade],
      ['EAR', typeof data.ear === 'boolean' ? (data.ear ? 'Sim' : 'Não') : null]
    ];
    return rows
      .filter(([, value]) => Boolean(String(value || '').trim()))
      .slice(0, 4)
      .map(([label, value]) => ({ label, value: String(value).trim() }));
  }

  if (field?.validator === 'crlv') {
    const rows = [
      ['Placa', data.placa],
      ['Renavam', data.renavam],
      ['Modelo', data.modelo],
      ['Ano', data.anoModelo || data.anoFabricacao]
    ];
    return rows
      .filter(([, value]) => Boolean(String(value || '').trim()))
      .slice(0, 4)
      .map(([label, value]) => ({ label, value: String(value).trim() }));
  }

  return [];
}

export default function RobotaxiDriverActivationScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const {
    profile,
    updateRiderProfile,
    driverActivation,
    driverActivationRemote,
    documentAnalysisState,
    driverCanGoOnline,
    refreshDriverActivationRemote,
    submitDriverActivationDocument,
    submitDriverBackgroundCheckConsent
  } = usePrototypeRideRuntime();

  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [fieldStates, setFieldStates] = useState({});
  const [busyFieldKey, setBusyFieldKey] = useState('');
  const lastInitialRefreshUidRef = useRef('');
  const activation = driverActivation || {};
  const stages = activation?.stages || EMPTY_ACTIVATION_STAGES;
  const canonicalLivenessGate = useMemo(
    () => resolveCanonicalLivenessGate(driverActivationRemote),
    [driverActivationRemote],
  );

  useEffect(() => {
    const hideStatusBar = () => StatusBar.setHidden(true, 'fade');
    const showStatusBar = () => StatusBar.setHidden(false, 'fade');
    const handleFocus = () => {
      hideStatusBar();
      if (!String(profile?.uid || '').trim()) {
        return;
      }
      refreshDriverActivationRemote().catch(error => {
        Logger.warn('⚠️ [DriverActivationScreen] Sync remoto no foco falhou:', error?.message || error);
      });
    };

    hideStatusBar();
    const removeFocusListener = navigation?.addListener?.('focus', handleFocus);
    const removeBlurListener = navigation?.addListener?.('blur', showStatusBar);

    return () => {
      removeFocusListener?.();
      removeBlurListener?.();
      showStatusBar();
    };
  }, [navigation, profile?.uid, refreshDriverActivationRemote]);

  const stageKeys = useMemo(
    () => [
      DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA,
      DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA,
      DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION
    ],
    []
  );

  useEffect(() => {
    const uid = String(profile?.uid || '').trim();
    if (!uid) {
      return;
    }
    if (lastInitialRefreshUidRef.current === uid) {
      return;
    }
    lastInitialRefreshUidRef.current = uid;
    refreshDriverActivationRemote().catch(error => {
      Logger.warn('⚠️ [DriverActivationScreen] Sync remoto inicial falhou:', error?.message || error);
    });
  }, [profile?.uid, refreshDriverActivationRemote]);

  useEffect(() => {
    const cnhData = driverActivationRemote?.documents?.cnh?.data || null;
    const extractedName = String(cnhData?.nome || '').trim();
    if (extractedName) {
      updateRiderProfile({ name: extractedName });
    }
  }, [driverActivationRemote?.documents?.cnh?.data, updateRiderProfile]);

  const completedStages = stageKeys.filter(stageKey => stages?.[stageKey]?.status === 'approved').length;
  const progressLabel = `${completedStages}/${stageKeys.length} etapas concluídas`;
  const visibleStageKeys = useMemo(
    () =>
      stageKeys.filter(stageKey => {
        if (stageKey === DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA) {
          return true;
        }
        if (stageKey === DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION) {
          return canonicalLivenessGate.visible;
        }
        return stages?.[stageKey]?.status && stages?.[stageKey]?.status !== 'locked';
      }),
    [canonicalLivenessGate.visible, stageKeys, stages]
  );
  const hiddenLockedStageCount = Math.max(0, stageKeys.length - visibleStageKeys.length);
  const activationVehicleLabel = useMemo(
    () =>
      resolveActivationVehicleLabel({
        driverActivationRemote,
        documentAnalysisState,
      }),
    [documentAnalysisState, driverActivationRemote],
  );
  const canonicalVehicleFieldState = useMemo(
    () => resolveCanonicalVehicleFieldState(driverActivationRemote),
    [driverActivationRemote],
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-activation',
    occludedBottom: cardHeight || windowHeight
  });

  useEffect(() => {
    setFieldStates(previous => {
      const next = { ...previous };
      let changed = false;

      stageKeys.forEach(stageKey => {
        const stage = stages?.[stageKey] || { checklist: {} };
        const fields = STAGE_META?.[stageKey]?.fields || [];

        fields.forEach(field => {
          const stateKey = toFieldKey(stageKey, field.key);
          const approved = Boolean(stage?.checklist?.[field.key]);
          const existing = next[stateKey];
          const remoteDocumentType = resolveDocumentTypeByField(field);
          const remoteDocState = remoteDocumentType
            ? documentAnalysisState?.byType?.[remoteDocumentType] || driverActivationRemote?.documents?.[remoteDocumentType]
            : null;
          const remoteStatus = remoteDocState ? mapRemoteStatusToFieldStatus(remoteDocState?.status) : null;
          const nextStatus =
            remoteStatus ||
            (approved ? FIELD_STATUS.APPROVED : FIELD_STATUS.PENDING);
          const nextReason = String(remoteDocState?.reason || existing?.reason || '');
          const nextSummaryRows =
            nextStatus === FIELD_STATUS.APPROVED && field.kind === 'document'
              ? toSummaryRows(field, remoteDocState?.data || {})
              : existing?.summaryRows || [];
          const nextFileName = String(remoteDocState?.fileName || existing?.fileName || '');

          if (!existing) {
            next[stateKey] = {
              status: nextStatus,
              reason: nextReason,
              fileName: nextFileName,
              summaryRows: nextSummaryRows
            };
            changed = true;
            return;
          }

          const hasSameSummaryRows =
            JSON.stringify(existing.summaryRows || []) === JSON.stringify(nextSummaryRows || []);
          if (
            existing.status === nextStatus &&
            existing.reason === nextReason &&
            existing.fileName === nextFileName &&
            hasSameSummaryRows
          ) {
            return;
          }

          next[stateKey] = {
            ...existing,
            status: nextStatus,
            reason: nextReason,
            fileName: nextFileName,
            summaryRows: nextSummaryRows
          };
          changed = true;
        });
      });

      return changed ? next : previous;
    });
  }, [documentAnalysisState?.byType, driverActivationRemote?.documents, stageKeys, stages]);

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('RobotaxiPrototypeProfile');
  };

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const upsertFieldState = useCallback((stageKey, fieldKey, patch) => {
    const stateKey = toFieldKey(stageKey, fieldKey);
    setFieldStates(previous => ({
      ...previous,
      [stateKey]: {
        status: FIELD_STATUS.PENDING,
        reason: '',
        fileName: '',
        ...(previous?.[stateKey] || {}),
        ...(patch || {})
      }
    }));
  }, []);

  const getFieldState = useCallback(
    (stageKey, fieldKey) => {
      const stateKey = toFieldKey(stageKey, fieldKey);
      const current = fieldStates?.[stateKey];
      if (current) {
        return current;
      }

      const approved = Boolean(stages?.[stageKey]?.checklist?.[fieldKey]);
      return {
        status: approved ? FIELD_STATUS.APPROVED : FIELD_STATUS.PENDING,
        reason: '',
        fileName: ''
      };
    },
    [fieldStates, stages]
  );

  const pickPdfAsset = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false
    });

    if (picked.canceled || !picked.assets?.[0]) {
      return null;
    }

    return picked.assets[0];
  }, []);

  const handleFieldAction = useCallback(
    async (stageKey, field) => {
      const currentFieldState = getFieldState(stageKey, field.key);
      const stateKey = toFieldKey(stageKey, field.key);

      if (currentFieldState.status === FIELD_STATUS.IN_REVIEW) {
        Alert.alert('Em análise', `Seu documento está em análise. Prazo: ${DOC_ANALYSIS_SLA_TEXT}.`);
        return;
      }

      if (currentFieldState.status === FIELD_STATUS.APPROVED) {
        Alert.alert('Documento aprovado', 'Este item já foi aprovado pela plataforma.');
        return;
      }

      if (field.kind === 'readonly') {
        Alert.alert(
          'Validação do veículo',
          'A liberação é confirmada pela plataforma após validar o cadastro do veículo e o CRLV.',
        );
        return;
      }

      if (field.kind === 'consent') {
        Alert.alert(
          'Autorização obrigatória',
          'Você autoriza a Leaf a realizar a pesquisa de antecedentes criminais e validações regulatórias necessárias para operação na plataforma.',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Aceitar termos',
              onPress: async () => {
                try {
                  setBusyFieldKey(stateKey);
                  await submitDriverBackgroundCheckConsent(true);
                  await refreshDriverActivationRemote();
                } catch (error) {
                  upsertFieldState(stageKey, field.key, {
                    status: FIELD_STATUS.FAILED,
                    reason: error?.message || 'Não foi possível registrar o aceite agora.'
                  });
                } finally {
                  setBusyFieldKey('');
                }
              }
            }
          ]
        );
        return;
      }

      if (field.kind === 'task') {
        if (!canonicalLivenessGate.canStart) {
          Alert.alert(
            'Validação facial indisponível',
            'Conclua primeiro a validação do veículo para liberar esta etapa.',
          );
          return;
        }
        navigation.navigate('RobotaxiPrototype', {
          notificationType: 'kyc_activation_required',
          requirement: 'LIVENESS_REQUIRED',
          reason: 'Conclua a validação facial para finalizar sua ativação.',
          source: 'driver_activation'
        });
        return;
      }

      if (field.kind !== 'document') {
        return;
      }

      try {
        const pdfAsset = await pickPdfAsset();
        if (!pdfAsset) {
          return;
        }

        setBusyFieldKey(stateKey);
        upsertFieldState(stageKey, field.key, {
          status: FIELD_STATUS.IN_REVIEW,
          reason: '',
          fileName: String(pdfAsset?.name || ''),
          summaryRows: []
        });

        Alert.alert('Documento enviado', `Status: Em análise. Prazo da análise: ${DOC_ANALYSIS_SLA_TEXT}.`);

        const assetForValidation = {
          uri: pdfAsset.uri,
          mimeType: pdfAsset.mimeType || 'application/pdf',
          type: pdfAsset.mimeType || 'application/pdf',
          name: pdfAsset.name || `${field.key}-${Date.now()}.pdf`,
          size: Number(pdfAsset.size || 0)
        };
        await submitDriverActivationDocument(field.key, assetForValidation);
        await refreshDriverActivationRemote();
      } catch (error) {
        upsertFieldState(stageKey, field.key, {
          status: FIELD_STATUS.FAILED,
          reason: error?.message || 'Não foi possível enviar o documento.',
          summaryRows: []
        });
      } finally {
        setBusyFieldKey('');
      }
    },
    [
      getFieldState,
      canonicalLivenessGate.canStart,
      navigation,
      pickPdfAsset,
      refreshDriverActivationRemote,
      submitDriverActivationDocument,
      submitDriverBackgroundCheckConsent,
      upsertFieldState
    ]
  );

  const activationRows = useMemo(() => {
    return visibleStageKeys.flatMap(stageKey => {
      const meta = STAGE_META[stageKey];
      const stage = stages?.[stageKey] || { status: 'locked', checklist: {} };
      const isLocked = stage.status === 'locked';

      return (meta?.fields || []).map(field => {
        const fieldState = field.kind === 'readonly'
          ? canonicalVehicleFieldState
          : getFieldState(stageKey, field.key);
        const fieldStatus = fieldState?.status || FIELD_STATUS.PENDING;
        const isReadonly = field.kind === 'readonly';
        const stageBlocked = isLocked && !isReadonly;
        const stateKey = toFieldKey(stageKey, field.key);
        const actionLabel =
          stageBlocked
            ? 'Bloqueado'
            : fieldStatus === FIELD_STATUS.APPROVED
              ? 'OK'
              : fieldStatus === FIELD_STATUS.IN_REVIEW
                ? 'Em análise'
                : fieldStatus === FIELD_STATUS.FAILED
                  ? isReadonly
                    ? 'Atenção'
                    : 'Reenviar'
                  : isReadonly
                    ? 'Pendente'
                    : field.actionLabel || 'Enviar';

        return {
          field,
          fieldState,
          stageKey,
          stateKey,
          stageBlocked,
          isReadonly,
          title: resolveActivationRowTitle(field),
          subtitle: resolveActivationRowSubtitle(field, fieldState, activationVehicleLabel),
          actionLabel,
        };
      });
    });
  }, [activationVehicleLabel, canonicalVehicleFieldState, getFieldState, stages, visibleStageKeys]);

  const firstActionableRow = activationRows.find(row => {
    const status = row.fieldState?.status || FIELD_STATUS.PENDING;
    return !row.stageBlocked && !row.isReadonly && status !== FIELD_STATUS.APPROVED && status !== FIELD_STATUS.IN_REVIEW;
  });

  const handleContinueUpload = useCallback(() => {
    if (firstActionableRow) {
      handleFieldAction(firstActionableRow.stageKey, firstActionableRow.field);
      return;
    }

    if (driverCanGoOnline) {
      Alert.alert('Ativação concluída', 'Você já pode ficar online para receber corridas.');
      return;
    }

    Alert.alert('Em análise', `Suas informações estão em análise. Prazo: ${DOC_ANALYSIS_SLA_TEXT}.`);
  }, [driverCanGoOnline, firstActionableRow, handleFieldAction]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor="transparent"
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <View
            onLayout={handleCardLayout}
            style={[
              styles.activationSurface,
              {
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              },
            ]}
          >
            <View style={styles.activationHeaderRow}>
              <View style={styles.activationHeaderCopy}>
                <Text style={styles.activationTitle}>Ativação do motorista</Text>
                <Text style={styles.activationSubtitle}>
                  Envie o essencial para ficar online.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.activationCloseButton}
                onPress={handleDismiss}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel="Fechar ativação"
              >
                <Ionicons name="close" size={18} color={ACTIVATION_COLOR.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.activationScrollContent}
            >
              {activationRows.map((row, index) => {
                const isBusy = busyFieldKey === row.stateKey;
                const isDisabled = isBusy || row.isReadonly || row.stageBlocked;
                return (
                  <TouchableOpacity
                    key={`${row.stageKey}:${row.field.key}`}
                    activeOpacity={0.78}
                    disabled={isDisabled}
                    onPress={() => handleFieldAction(row.stageKey, row.field)}
                    style={[
                      styles.activationRow,
                      index === activationRows.length - 1 && styles.activationRowLast,
                    ]}
                  >
                    <View style={styles.activationIconSlot}>
                      <Ionicons
                        name={resolveActivationRowIcon(row.field)}
                        size={17}
                        color={ACTIVATION_COLOR.icon}
                      />
                    </View>
                    <View style={styles.activationRowCopy}>
                      <Text style={styles.activationRowTitle}>{row.title}</Text>
                      <Text style={styles.activationRowSubtitle} numberOfLines={1}>
                        {row.subtitle}
                      </Text>
                      {row.fieldState?.status === FIELD_STATUS.FAILED && row.fieldState?.reason ? (
                        <Text style={styles.activationRowError} numberOfLines={1}>
                          {row.fieldState.reason}
                        </Text>
                      ) : null}
                    </View>
                    {isBusy ? (
                      <ActivityIndicator size="small" color={ACTIVATION_COLOR.leaf} />
                    ) : (
                      <Text style={styles.activationRowAction}>{row.actionLabel}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {hiddenLockedStageCount > 0 ? (
                <Text style={styles.activationHint}>
                  Próximas etapas liberam após aprovação dos documentos.
                </Text>
              ) : null}
            </ScrollView>

            <TouchableOpacity
              testID="driver-activation-continue-button"
              activeOpacity={0.88}
              style={styles.activationButton}
              onPress={handleContinueUpload}
              accessibilityRole="button"
              accessibilityLabel="Continuar envio"
            >
              <Text style={styles.activationButtonText}>Continuar envio</Text>
            </TouchableOpacity>
          </View>
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
  activationSurface: {
    flex: 1,
    backgroundColor: ACTIVATION_COLOR.bg,
    paddingHorizontal: 24,
  },
  activationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  activationHeaderCopy: {
    flex: 1,
    paddingRight: 4,
  },
  activationCloseButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: ACTIVATION_COLOR.line,
  },
  activationTitle: {
    color: ACTIVATION_COLOR.title,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  activationSubtitle: {
    marginTop: 8,
    color: ACTIVATION_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  activationScrollContent: {
    paddingTop: 18,
    paddingBottom: 118,
  },
  activationRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ACTIVATION_COLOR.line,
  },
  activationRowLast: {
    borderBottomWidth: 0,
  },
  activationIconSlot: {
    width: 28,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  activationRowCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  activationRowTitle: {
    color: ACTIVATION_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  activationRowSubtitle: {
    marginTop: 3,
    color: ACTIVATION_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  activationRowError: {
    marginTop: 3,
    color: '#9F2424',
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  activationRowAction: {
    width: 84,
    color: ACTIVATION_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'right',
  },
  activationHint: {
    marginTop: 16,
    color: ACTIVATION_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  activationButton: {
    position: 'absolute',
    left: 31,
    right: 31,
    bottom: 72,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACTIVATION_COLOR.leaf,
  },
  activationButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 12,
  },
  progressHint: {
    marginBottom: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(42,77,29,0.10)',
    backgroundColor: 'rgba(237,243,233,0.84)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  progressHintText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  sectionStack: {
    gap: 6,
  },
  nextStepsHintWrap: {
    paddingTop: 4,
  },
  nextStepsHintText: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: 12,
  },
  stageSummaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  stageSummaryRowLocked: {
    opacity: 0.72,
  },
  statusBadge: {
    marginTop: 1,
    borderRadius: 999,
    minHeight: 26,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(78,90,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadgeApproved: {
    backgroundColor: 'rgba(26,51,14,0.15)',
  },
  statusBadgeAlert: {
    backgroundColor: 'rgba(138,42,42,0.14)',
  },
  statusBadgeText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  stageDescription: {
    flex: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  fieldRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
    gap: 12,
  },
  fieldRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 6,
  },
  fieldCopyWrap: {
    flex: 1,
    paddingRight: 8,
  },
  fieldTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  fieldLabel: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  inlineStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 8,
    minHeight: 22,
    justifyContent: 'center',
  },
  inlineStatusBadgeText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  fieldHelper: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  fieldMeta: {
    marginTop: 6,
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  fieldActionButton: {
    minWidth: 108,
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: color.accent.strong,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    alignSelf: 'center',
  },
  fieldActionButtonApproved: {
    backgroundColor: '#3F7A35',
  },
  fieldActionButtonFailed: {
    backgroundColor: '#9F3737',
  },
  fieldActionButtonDisabled: {
    opacity: 0.86,
  },
  fieldActionButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  moreInfoButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  moreInfoText: {
    color: color.accent.strong,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textDecorationLine: 'underline',
  },
});
