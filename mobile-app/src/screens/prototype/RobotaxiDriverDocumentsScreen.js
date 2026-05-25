import React, { useCallback, useMemo, useState } from 'react';
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
import { fonts } from '../../theme/runtimeTokens';
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

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

const DRIVER_DOCS = [
  { id: 'cnh', title: 'CNH com EAR', subtitle: 'Documento obrigatório para dirigir' },
  { id: 'crlv', title: 'CRLV do veículo', subtitle: 'Valida placa, modelo e ano' },
];

function formatStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') return 'aprovado';
  if (normalized === 'in_review') return 'em análise';
  if (normalized === 'failed') return 'revisar';
  return 'pendente';
}

function resolveDocStatus(documents, analysisByType, docId) {
  return formatStatus(documents?.[docId]?.status || analysisByType?.[docId]?.status);
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
            subtitle="Acompanhe a análise que libera o modo online."
            badgeLabel={driverCanGoOnline ? 'liberado' : `${approvedCount}/${DRIVER_DOCS.length}`}
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-driver-documents-close-button"
                accessibilityLabel="robotaxi-driver-documents-close-button"
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
                      badge={status}
                      active={status === 'aprovado'}
                      last={index === DRIVER_DOCS.length - 1}
                      onPress={() => navigation.navigate('RobotaxiPrototypeDriverActivation')}
                    />
                  );
                })}
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Resumo">
                <PrototypeMenuInfoRow label="Status online" value={driverCanGoOnline ? 'Liberado' : 'Pendente'} />
                <PrototypeMenuInfoRow label="Prazo de análise" value="Até 48 horas" />
                <PrototypeMenuInfoRow label="Última sync" value={lastSyncedAt ? 'Atualizada' : 'Sem sync'} last />
              </PrototypeMenuSection>

              {approvedCount === 0 ? (
                <LeafEmptyState
                  icon="cloud-upload-outline"
                  title="Envie seus documentos na ativação"
                  message="CNH e CRLV ficam no mesmo fluxo para evitar cadastro duplicado."
                  testID="robotaxi-driver-documents-empty-state"
                />
              ) : null}

              <View style={styles.actionsRow}>
                <LeafButton
                  label={refreshing ? 'Atualizando...' : 'Atualizar status'}
                  icon="refresh-outline"
                  tone="ghost"
                  disabled={refreshing}
                  onPress={handleRefresh}
                  style={styles.actionButton}
                />
                <LeafButton
                  label="Abrir ativação"
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
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
