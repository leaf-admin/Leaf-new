import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../common-local/font';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { DRIVER_ONBOARDING_STAGE_KEYS } from '../../services/DriverOnboardingService';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 410;

const STAGE_META = {
  [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
    title: 'Ativação dos dados do motorista',
    description: 'CNH com EAR, certidão de antecedentes e INSS/MEI.',
    fields: [
      { key: 'cnhEar', label: 'CNH com EAR validada' },
      { key: 'criminalRecord', label: 'Certidão de antecedentes enviada' },
      { key: 'inssOrMei', label: 'INSS/MEI confirmado' }
    ]
  },
  [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: {
    title: 'Validação facial',
    description: 'Confirmação de identidade do motorista.',
    fields: [{ key: 'facialValidation', label: 'Validação facial concluída' }]
  },
  [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
    title: 'Ativação dos documentos do carro',
    description: 'Análise documental do veículo é separada do cadastro do motorista.',
    fields: [
      { key: 'crlv', label: 'CRLV enviado' },
      { key: 'vehicleInsurance', label: 'Comprovante do seguro anexado' },
      { key: 'vehiclePhoto', label: 'Fotos do veículo aprovadas' }
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

export default function RobotaxiDriverActivationScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const {
    driverActivation,
    driverCanGoOnline,
    updateDriverActivationChecklist,
    completeDriverActivationStage
  } = usePrototypeRideRuntime();

  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
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

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-activation',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('RobotaxiPrototypeDriverPanel');
  };

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleToggleChecklist = useCallback(
    (stageKey, fieldKey, value) => {
      updateDriverActivationChecklist(stageKey, fieldKey, value).catch(() => {});
    },
    [updateDriverActivationChecklist]
  );

  const handleCompleteStage = useCallback(
    stageKey => {
      completeDriverActivationStage(stageKey).catch(() => {});
    },
    [completeDriverActivationStage]
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <View style={styles.header}>
              <Text style={styles.title}>Ativação do motorista</Text>
              <Text style={styles.subtitle}>Conclua cada etapa para liberar o modo online.</Text>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {stageKeys.map(stageKey => {
                const meta = STAGE_META[stageKey];
                const stage = stages?.[stageKey] || { status: 'locked', checklist: {} };
                const isLocked = stage.status === 'locked';
                const isApproved = stage.status === 'approved';
                const checklistEntries = Object.entries(stage.checklist || {});
                const allChecked = checklistEntries.length > 0 && checklistEntries.every(([, checked]) => Boolean(checked));

                return (
                  <View key={stageKey} style={[styles.stageCard, isLocked && styles.stageCardLocked]}>
                    <View style={styles.stageHeader}>
                      <View style={styles.stageTitleWrap}>
                        <Text style={styles.stageTitle}>{meta.title}</Text>
                        <Text style={styles.stageDescription}>{meta.description}</Text>
                      </View>
                      <View style={[styles.statusBadge, isApproved && styles.statusBadgeApproved, stage.status === 'needs_attention' && styles.statusBadgeAlert]}>
                        <Text style={styles.statusBadgeText}>{mapStatusLabel(stage.status)}</Text>
                      </View>
                    </View>

                    {isLocked ? (
                      <Text style={styles.lockedText}>Conclua a etapa anterior para liberar esta etapa.</Text>
                    ) : (
                      <>
                        {meta.fields.map(field => {
                          const checked = Boolean(stage.checklist?.[field.key]);
                          return (
                            <View key={field.key} style={styles.fieldRow}>
                              <Text style={styles.fieldLabel}>{field.label}</Text>
                              <Switch
                                value={checked}
                                onValueChange={value => handleToggleChecklist(stageKey, field.key, value)}
                                trackColor={{ false: '#CCD4DD', true: '#2A4D1D' }}
                                thumbColor={checked ? '#1A330E' : '#F7F9FC'}
                              />
                            </View>
                          );
                        })}

                        <PrototypePrimaryButton
                          label={isApproved ? 'Etapa concluída' : 'Concluir etapa'}
                          icon={isApproved ? 'checkmark-outline' : 'arrow-forward-outline'}
                          onPress={isApproved ? undefined : () => handleCompleteStage(stageKey)}
                          style={[styles.stageButton, isApproved && styles.stageButtonApproved, !allChecked && !isApproved && styles.stageButtonDisabled]}
                        />
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.footerBlock}>
              <Ionicons
                name={driverCanGoOnline ? 'checkmark-circle' : 'time-outline'}
                size={18}
                color={driverCanGoOnline ? color.feedback.success : color.text.secondary}
              />
              <Text style={styles.footerText}>
                {driverCanGoOnline
                  ? 'Tudo certo. Motorista liberado para ficar online.'
                  : 'Cadastro em progresso. Você pode sair e continuar depois de onde parou.'}
              </Text>
            </View>
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
  header: {
    marginBottom: 8
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  subtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  scroll: {
    maxHeight: 360
  },
  scrollContent: {
    gap: 8,
    paddingBottom: 4
  },
  stageCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  stageCardLocked: {
    opacity: 0.75
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  stageTitleWrap: {
    flex: 1,
    marginRight: 10
  },
  stageTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  stageDescription: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    minHeight: 24,
    backgroundColor: 'rgba(78,90,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  statusBadgeApproved: {
    backgroundColor: 'rgba(26,51,14,0.15)'
  },
  statusBadgeAlert: {
    backgroundColor: 'rgba(138,42,42,0.14)'
  },
  statusBadgeText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  lockedText: {
    marginTop: 8,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  fieldRow: {
    marginTop: 8,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center'
  },
  fieldLabel: {
    flex: 1,
    marginRight: 8,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  stageButton: {
    marginTop: 8,
    minHeight: 42
  },
  stageButtonApproved: {
    opacity: 0.82
  },
  stageButtonDisabled: {
    opacity: 0.62
  },
  footerBlock: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    minHeight: 48,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  footerText: {
    flex: 1,
    marginLeft: 8,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
