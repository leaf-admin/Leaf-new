import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { loadDriverWaitlistStatus } from '../../services/runtime/driverWaitlistService';
import {
  resolveCanonicalDriverActivationGates,
  resolveCanonicalLivenessGate,
} from './driverActivationCanonicalContract';

const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

export const DRIVER_DOCS = [
  { id: 'cnh', title: 'CNH com EAR', subtitle: 'Documento obrigatório para dirigir' },
  { id: 'crlv', title: 'CRLV do veículo', subtitle: 'Valida placa, modelo e ano' },
];

function formatStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') return 'aprovado';
  if (['in_review', 'analyzing', 'analysis', 'under_review', 'pending_review'].includes(normalized)) {
    return 'em análise';
  }
  if (['failed', 'rejected', 'needs_attention', 'requires_attention', 'review_required'].includes(normalized)) {
    return 'revisar';
  }
  return 'pendente';
}

export function resolveDocStatus(documents, analysisByType, docId) {
  return formatStatus(documents?.[docId]?.status || analysisByType?.[docId]?.status);
}

// Etapas que o backend exige para liberar o modo online, na ordem em que o motorista as faz.
// `entry` é o status da lista de espera: na entrada controlada, o cadastro completo ainda
// espera a liberação da Leaf antes de ficar online.
export function resolveDriverActivationSteps(remoteSnapshot = null, canGoOnline = false, entry = null) {
  const gates = resolveCanonicalDriverActivationGates(remoteSnapshot);
  const liveness = resolveCanonicalLivenessGate(remoteSnapshot);
  const steps = [
    { id: 'cnh', label: 'CNH aprovada', done: gates.cnhApproved },
    { id: 'vehicle', label: 'Veículo aprovado', done: gates.canonicalVehicleApproved || gates.crlvDocumentApproved },
    { id: 'consent', label: 'Aceites enviados', done: gates.consentApproved },
    { id: 'face', label: 'Verificação de rosto', done: liveness.completed || canGoOnline === true },
  ];
  const remaining = canGoOnline === true ? 0 : steps.filter(step => !step.done).length;
  const entryStatus = String(entry?.waitListStatus || '').toLowerCase();
  const heldByEntry = remaining === 0 && entry?.isApproved !== true && ['pending', 'rejected'].includes(entryStatus);
  if (heldByEntry) {
    const position = Number(entry?.position) > 0 ? Number(entry.position) : null;
    return {
      steps: [...steps, { id: 'release', label: 'Liberação da Leaf', done: false }],
      remaining: 1,
      waitlisted: entryStatus === 'pending',
      summary: entryStatus === 'rejected'
        ? 'Sua entrada precisa de revisão'
        : `Cadastro completo. Você está na fila${position ? `, posição ${position}` : ''}`,
    };
  }
  return {
    steps,
    remaining,
    waitlisted: false,
    summary: remaining === 0
      ? 'Tudo pronto para ficar online'
      : `Falta${remaining === 1 ? '' : 'm'} ${remaining} etapa${remaining === 1 ? '' : 's'} para ficar online`,
  };
}

export default function RobotaxiDriverDocumentsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [refreshing, setRefreshing] = useState(false);
  const {
    driverActivationRemote,
    documentAnalysisState,
    driverCanGoOnline,
    refreshDriverActivationRemote,
  } = usePrototypeRideRuntime();

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-documents',
    occludedBottom: panelHeight,
  });

  const documents = driverActivationRemote?.documents || {};
  const analysisByType = documentAnalysisState?.byType || {};
  const lastSyncedAt = documentAnalysisState?.lastSyncedAt || driverActivationRemote?.updatedAt || '';
  const approvedCount = useMemo(
    () => DRIVER_DOCS.filter(doc => resolveDocStatus(documents, analysisByType, doc.id) === 'aprovado').length,
    [analysisByType, documents],
  );
  const documentsComplete = approvedCount === DRIVER_DOCS.length;
  const [entryStatus, setEntryStatus] = useState(null);
  const loadEntryStatus = useCallback(async () => {
    if (!driverCanGoOnline) return;
    try {
      setEntryStatus(await loadDriverWaitlistStatus());
    } catch (_error) {
      setEntryStatus(null);
    }
  }, [driverCanGoOnline]);
  useEffect(() => {
    loadEntryStatus();
  }, [loadEntryStatus]);
  const activationSteps = useMemo(
    () => resolveDriverActivationSteps(driverActivationRemote, driverCanGoOnline, entryStatus),
    [driverActivationRemote, driverCanGoOnline, entryStatus],
  );
  const operationallyReleasedBeforeDocumentSync = driverCanGoOnline && !documentsComplete;

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshDriverActivationRemote();
      await loadEntryStatus();
    } finally {
      setRefreshing(false);
    }
  }, [refreshDriverActivationRemote]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-driver-documents-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Motorista"
            title="Documentos"
            subtitle={activationSteps.summary}
            badgeLabel={documentsComplete ? 'aprovados' : `${approvedCount}/${DRIVER_DOCS.length}`}
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-driver-documents-close-button"
                accessibilityLabel="Fechar documentos do motorista"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <PrototypeMenuSection title="Análise">
                {DRIVER_DOCS.map((doc, index) => {
                  const status = resolveDocStatus(documents, analysisByType, doc.id);
                  return (
                    <PrototypeMenuRow
                      key={doc.id}
                      icon="document-text-outline"
                      title={doc.title}
                      subtitle={doc.subtitle}
                      badge={status ? status.charAt(0).toUpperCase() + status.slice(1) : status}
                      badgeTone={
                        status === 'aprovado'
                          ? 'success'
                          : status === 'revisar'
                            ? 'danger'
                            : 'warning'
                      }
                      active={status === 'aprovado'}
                      last={index === DRIVER_DOCS.length - 1}
                      onPress={() => navigation.navigate('RobotaxiPrototypeDriverActivation')}
                    />
                  );
                })}
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Para ficar online">
                {activationSteps.steps.map((step, index) => (
                  <PrototypeMenuInfoRow
                    key={step.id}
                    label={step.label}
                    value={step.done ? 'Feito' : 'Falta'}
                    last={index === activationSteps.steps.length - 1 && !activationSteps.waitlisted}
                  />
                ))}
                {activationSteps.waitlisted ? (
                  <PrototypeMenuRow
                    icon="people-outline"
                    title="Lista de espera"
                    subtitle="Avisamos quando liberar sua entrada"
                    badge="Na fila"
                    badgeTone="warning"
                    last
                    onPress={() => navigation.navigate('RobotaxiPrototypeDriverWaitlistStatus')}
                    testID="robotaxi-driver-documents-waitlist-row"
                  />
                ) : null}
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Resumo">
                <PrototypeMenuInfoRow
                  label="Liberação para ficar online"
                  value={driverCanGoOnline ? 'Liberada' : 'Pendente'}
                />
                {/* The SLA only matters while something is still under review. */}
                {approvedCount < DRIVER_DOCS.length ? <PrototypeMenuInfoRow label="Prazo de análise" value="Até 48 horas" /> : null}
                <PrototypeMenuInfoRow label="Última atualização" value={lastSyncedAt ? 'Atualizada agora' : 'Ainda não consultada'} last />
              </PrototypeMenuSection>

              {operationallyReleasedBeforeDocumentSync ? (
                <LeafEmptyState
                  icon="sync-outline"
                  title="Documentos aguardando sincronização"
                  message="Sua conta já está liberada. Atualize para consultar o status de CNH e CRLV."
                  testID="robotaxi-driver-documents-sync-state"
                />
              ) : approvedCount === 0 ? (
                <LeafEmptyState
                  icon="cloud-upload-outline"
                  title="Envie seus documentos na ativação"
                  message="CNH e CRLV ficam no mesmo fluxo para evitar cadastro duplicado."
                  testID="robotaxi-driver-documents-empty-state"
                />
              ) : null}

              <View style={styles.actionsRow}>
                <LeafButton
                  label={refreshing ? 'Atualizando...' : 'Atualizar'}
                  icon="refresh-outline"
                  tone="ghost"
                  disabled={refreshing}
                  onPress={handleRefresh}
                  style={styles.actionButton}
                />
                <LeafButton
                  label="Ativação"
                  icon="arrow-forward-outline"
                  tone="primary"
                  onPress={() => navigation.navigate('RobotaxiPrototypeDriverActivation')}
                  style={styles.actionButton}
                />
              </View>
              {refreshing ? (
                <View style={styles.feedbackRow}>
                  <ActivityIndicator size="small" color={leafRideColors.leaf} />
                  <Text style={styles.feedbackText}>Consultando documentos...</Text>
                </View>
              ) : null}
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
  content: {
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
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
    fontSize: 12,
    lineHeight: 17,
  },
});
