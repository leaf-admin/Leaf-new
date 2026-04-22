import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSection,
  PrototypeMenuStatRow,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { DRIVER_ONBOARDING_STAGE_KEYS } from '../../services/DriverOnboardingService';
import Logger from '../../utils/Logger';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const FALLBACK_CARD_HEIGHT = 330;
const DOC_ANALYSIS_SLA_TEXT = 'Até 48 horas';

const FIELD_STATUS = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  FAILED: 'failed'
};

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
        key: 'inssOrMei',
        label: 'INSS / MEI',
        helper: 'Anexe o comprovante MEI ativo em PDF.',
        actionLabel: 'Enviar',
        kind: 'document',
        validator: 'mei'
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
    description: 'Atualizado automaticamente após o envio do CRLV.',
    fields: [
      {
        key: 'crlv',
        label: 'CRLV validado pela plataforma',
        helper: 'Após envio, o documento entra em análise automatizada com IA.',
        actionLabel: 'Aguardando envio',
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

function waitMs(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

function resolveDocumentTypeByField(field) {
  if (field?.validator === 'cnh') return 'cnh';
  if (field?.validator === 'crlv') return 'crlv';
  if (field?.validator === 'mei') return 'mei';
  return null;
}

function mapRemoteStatusToFieldStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') return FIELD_STATUS.APPROVED;
  if (normalized === 'failed') return FIELD_STATUS.FAILED;
  if (normalized === 'in_review') return FIELD_STATUS.IN_REVIEW;
  return FIELD_STATUS.PENDING;
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

  if (field?.validator === 'mei') {
    const rows = [
      ['Situação', 'Ativo'],
      ['Comprovante', 'Recebido em PDF']
    ];
    return rows;
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
    updateDriverActivationChecklist,
    completeDriverActivationStage,
    refreshDriverActivationRemote,
    submitDriverActivationDocument,
    submitDriverBackgroundCheckConsent
  } = usePrototypeRideRuntime();

  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [fieldStates, setFieldStates] = useState({});
  const [busyFieldKey, setBusyFieldKey] = useState('');
  const lastInitialRefreshUidRef = useRef('');
  const activation = driverActivation || {};
  const stages = activation?.stages || {};

  const stageKeys = useMemo(
    () => [
      DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA,
      DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION,
      DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA
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
        return stages?.[stageKey]?.status && stages?.[stageKey]?.status !== 'locked';
      }),
    [stageKeys, stages]
  );
  const hiddenLockedStageCount = Math.max(0, stageKeys.length - visibleStageKeys.length);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-activation',
    occludedBottom: cardHeight || windowHeight
  });

  useEffect(() => {
    setFieldStates(previous => {
      const next = { ...previous };

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
            return;
          }

          next[stateKey] = {
            ...existing,
            status: nextStatus,
            reason: nextReason,
            fileName: nextFileName,
            summaryRows: nextSummaryRows
          };
        });
      });

      return next;
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

  const markChecklistAndMaybeComplete = useCallback(
    async (stageKey, fieldKey, value) => {
      const nextState = await updateDriverActivationChecklist(stageKey, fieldKey, value);
      const stage = nextState?.stages?.[stageKey];
      const checklist = stage?.checklist || {};
      const keys = Object.keys(checklist);
      const allChecked = keys.length === 0 || keys.every(key => Boolean(checklist[key]));
      if (allChecked) {
        await completeDriverActivationStage(stageKey);
      }
      return nextState;
    },
    [completeDriverActivationStage, updateDriverActivationChecklist]
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
        Alert.alert('Validação do veículo', 'O status será atualizado automaticamente após o envio do CRLV.');
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
                  upsertFieldState(stageKey, field.key, {
                    status: FIELD_STATUS.APPROVED,
                    reason: ''
                  });
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
        try {
          setBusyFieldKey(stateKey);
          upsertFieldState(stageKey, field.key, {
            status: FIELD_STATUS.IN_REVIEW,
            reason: ''
          });
          await waitMs(1000);
          await markChecklistAndMaybeComplete(stageKey, field.key, true);
          upsertFieldState(stageKey, field.key, {
            status: FIELD_STATUS.APPROVED,
            reason: ''
          });
        } catch (error) {
          upsertFieldState(stageKey, field.key, {
            status: FIELD_STATUS.FAILED,
            reason: error?.message || 'Não foi possível concluir a validação facial.'
          });
        } finally {
          setBusyFieldKey('');
        }
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
      markChecklistAndMaybeComplete,
      pickPdfAsset,
      refreshDriverActivationRemote,
      submitDriverActivationDocument,
      submitDriverBackgroundCheckConsent,
      upsertFieldState
    ]
  );

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
          <PrototypeMenuSurface
            onLayout={handleCardLayout}
            eyebrow="Ativação do motorista"
            title="Ativação"
            subtitle="Checklist objetivo para liberar o online, com leitura clara por etapa."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            bodyStyle={styles.body}
            headerAccessory={<PrototypeMenuCloseButton onPress={handleDismiss} />}
          >
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <PrototypeMenuStatRow
                items={[
                  { key: 'progress', label: 'Etapas', value: progressLabel },
                  {
                    key: 'status',
                    label: 'Status',
                    value: driverCanGoOnline ? 'Liberado' : 'Em análise',
                  },
                ]}
              />

              <View style={styles.progressHint}>
                <Text style={styles.progressHintText}>
                  {driverCanGoOnline
                    ? 'Online liberado para operação.'
                    : `Pendências em análise (${DOC_ANALYSIS_SLA_TEXT}).`}
                </Text>
              </View>

              <View style={styles.sectionStack}>
                {visibleStageKeys.map(stageKey => {
                  const meta = STAGE_META[stageKey];
                  const stage = stages?.[stageKey] || { status: 'locked', checklist: {} };
                  const isLocked = stage.status === 'locked';
                  const isApproved = stage.status === 'approved';

                  return (
                    <PrototypeMenuSection key={stageKey} title={meta.title}>
                      <View style={[styles.stageSummaryRow, isLocked && styles.stageSummaryRowLocked]}>
                        <Text style={styles.stageDescription}>{meta.description}</Text>
                        <View
                          style={[
                            styles.statusBadge,
                            isApproved && styles.statusBadgeApproved,
                            stage.status === 'needs_attention' && styles.statusBadgeAlert,
                          ]}
                        >
                          <Text style={styles.statusBadgeText}>{mapStatusLabel(stage.status)}</Text>
                        </View>
                      </View>

                      {meta.fields.map((field, index) => {
                        const fieldState = getFieldState(stageKey, field.key);
                        const fieldStatus = fieldState?.status || FIELD_STATUS.PENDING;
                        const stateKey = toFieldKey(stageKey, field.key);
                        const isBusy = busyFieldKey === stateKey;
                        const isReadonly = field.kind === 'readonly';
                        const stageBlocked = isLocked && !isReadonly;
                        const actionLabel =
                          stageBlocked
                            ? 'Bloqueado'
                            : fieldStatus === FIELD_STATUS.APPROVED
                              ? 'Aprovado'
                              : fieldStatus === FIELD_STATUS.IN_REVIEW
                                ? 'Em análise'
                                : fieldStatus === FIELD_STATUS.FAILED
                                  ? 'Reenviar'
                                  : isReadonly
                                    ? 'Automático'
                                    : field.actionLabel || 'Enviar';

                        return (
                          <View
                            key={field.key}
                            style={[
                              styles.fieldRow,
                              index === meta.fields.length - 1 && styles.fieldRowLast,
                            ]}
                          >
                            <View style={styles.fieldCopyWrap}>
                              <View style={styles.fieldTitleRow}>
                                <Text style={styles.fieldLabel}>{field.label}</Text>
                                <View style={styles.inlineStatusBadge}>
                                  <Text style={styles.inlineStatusBadgeText}>
                                    {stageBlocked ? 'Bloqueado' : mapFieldStatusLabel(fieldStatus)}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.fieldHelper}>{field.helper}</Text>
                              {fieldState?.fileName ? (
                                <Text style={styles.fieldMeta}>{fieldState.fileName}</Text>
                              ) : null}
                              {fieldStatus === FIELD_STATUS.FAILED && fieldState?.reason ? (
                                <TouchableOpacity
                                  activeOpacity={0.85}
                                  style={styles.moreInfoButton}
                                  onPress={() => Alert.alert('Motivo da rejeição', fieldState.reason)}
                                >
                                  <Text style={styles.moreInfoText}>Saiba mais</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>

                            <TouchableOpacity
                              activeOpacity={0.86}
                              style={[
                                styles.fieldActionButton,
                                fieldStatus === FIELD_STATUS.APPROVED && styles.fieldActionButtonApproved,
                                fieldStatus === FIELD_STATUS.FAILED && styles.fieldActionButtonFailed,
                                (isBusy || isReadonly || stageBlocked) && styles.fieldActionButtonDisabled,
                              ]}
                              disabled={isBusy || isReadonly || stageBlocked}
                              onPress={() => handleFieldAction(stageKey, field)}
                            >
                              {isBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                              <Text style={styles.fieldActionButtonText}>{actionLabel}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </PrototypeMenuSection>
                  );
                })}

                {hiddenLockedStageCount > 0 ? (
                  <View style={styles.nextStepsHintWrap}>
                    <Text style={styles.nextStepsHintText}>Próximas etapas liberam após aprovação dos documentos.</Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </PrototypeMenuSurface>
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
