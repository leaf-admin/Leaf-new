import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuSection,
  PrototypeMenuStatRow,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { isPilotFeatureEnabled } from '../../config/pilotLaunchProfile';
import {
  acceptReferralInvite,
  createReferralInvite,
  loadMyReferralInvites,
} from '../../services/runtime/referralProgramService';
import { joinDriverWaitlist, loadDriverWaitlistStatus } from '../../services/runtime/driverWaitlistService';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const DRIVER_INVITE_BASE_URL = 'https://leaf.app.br/motorista/convite';
const HISTORY_LIMIT = 5;

function buildDriverInviteLink(code) {
  const safeCode = String(code || '').trim();
  return `${DRIVER_INVITE_BASE_URL}/${encodeURIComponent(safeCode || 'leaf')}`;
}

function resolveInviteTarget(value) {
  const text = String(value || '').trim();
  if (!text) {
    return {};
  }
  if (text.includes('@')) {
    return { inviteeEmail: text };
  }
  return { inviteePhone: text.replace(/[^\d+]/g, '') || text };
}

function resolveWaitlistStatusLabel(status) {
  const safeStatus = String(status || '').toLowerCase();
  if (safeStatus === 'pending') return 'Na fila';
  if (safeStatus === 'approved') return 'Aprovado';
  if (safeStatus === 'rejected') return 'Revisar';
  return 'Disponível';
}

function formatInviteStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'accepted') return 'Aceito';
  if (normalized === 'qualified') return 'Qualificado';
  if (normalized === 'rewarded') return 'Recompensado';
  if (normalized === 'expired') return 'Expirado';
  return 'Pendente';
}

function formatCriteriaValue(value) {
  if (value === true) return 'ok';
  if (value === false) return 'pendente';
  return '--';
}

function formatDriverInviteReward(invite = {}) {
  const trips = Number(invite.requiredCompletedTrips || invite.qualification?.requiredCompletedTrips || 0);
  const months = Number(invite.rewardMonths || 0);
  if (trips > 0 && months > 0) {
    return `${trips} corridas / ${months} mês`;
  }
  if (trips > 0) {
    return `${trips} corridas`;
  }
  return 'Critério padrão';
}

function DriverInviteHistory({ invites }) {
  const visibleInvites = invites.slice(1, HISTORY_LIMIT + 1);

  return (
    <PrototypeMenuSection title="Histórico de convites">
      {visibleInvites.length > 0 ? (
        visibleInvites.map((invite, index) => (
          <View
            key={invite.id || invite.code || `driver-invite-${index}`}
            style={[styles.historyRow, index === visibleInvites.length - 1 && styles.historyRowLast]}
            testID={`robotaxi-driver-invite-history-item-${index}`}
          >
            <View style={styles.historyCopy}>
              <Text style={styles.historyTitle} numberOfLines={1}>
                {invite.code || 'Convite'}
              </Text>
              <Text style={styles.historyMeta} numberOfLines={1}>
                {invite.inviteeEmail || invite.inviteePhone || 'Link compartilhável'}
              </Text>
            </View>
            <View style={styles.historySide}>
              <Text style={styles.historyStatus}>{formatInviteStatus(invite.status)}</Text>
              <Text style={styles.historyDate}>{formatDriverInviteReward(invite)}</Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyHistoryText}>Nenhum convite de motorista criado ainda.</Text>
      )}
    </PrototypeMenuSection>
  );
}

export default function RobotaxiDriverWaitlistScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [loading, setLoading] = useState(true);
  const [waitlistStatus, setWaitlistStatus] = useState(null);
  const [sentInvites, setSentInvites] = useState([]);
  const [inviteTarget, setInviteTarget] = useState('');
  const [acceptCode, setAcceptCode] = useState('');
  const [city, setCity] = useState('Rio de Janeiro');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const referralProgramsEnabled = isPilotFeatureEnabled('referralProgramsEnabled', true);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-waitlist',
    occludedBottom: panelHeight,
  });

  const driverInvites = useMemo(
    () => sentInvites.filter((invite) => String(invite.type || '').toLowerCase() === 'driver_referral'),
    [sentInvites],
  );
  const latestInvite = createdInvite || driverInvites[0] || null;
  const latestCode = latestInvite?.code || '';
  const latestLink = useMemo(() => buildDriverInviteLink(latestCode), [latestCode]);
  const statusLabel = resolveWaitlistStatusLabel(waitlistStatus?.waitListStatus);
  const positionLabel = waitlistStatus?.position ? `#${waitlistStatus.position}` : '--';
  const cityLabel =
    waitlistStatus?.city?.cityLabel ||
    waitlistStatus?.city?.cityKey ||
    city ||
    'Rio de Janeiro';
  const shareMessage = useMemo(
    () =>
      `Dirija comigo na Leaf. Use o convite ${latestCode || ''} para entrar na lista: ${latestLink}`,
    [latestCode, latestLink],
  );

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResult, invitesResult] = await Promise.all([
        loadDriverWaitlistStatus().catch(() => null),
        referralProgramsEnabled
          ? loadMyReferralInvites().catch(() => ({ sent: [] }))
          : Promise.resolve({ sent: [] }),
      ]);
      if (statusResult) {
        setWaitlistStatus(statusResult);
        setCity(statusResult?.city?.cityLabel || statusResult?.city?.cityKey || 'Rio de Janeiro');
      }
      setSentInvites(invitesResult?.sent || []);
    } finally {
      setLoading(false);
    }
  }, [referralProgramsEnabled]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const routeCode = String(route?.params?.inviteCode || route?.params?.code || '').trim();
    if (routeCode) {
      setAcceptCode(routeCode.toUpperCase());
    }
  }, [route?.params?.code, route?.params?.inviteCode]);

  const handlePanelLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleJoinWaitlist = useCallback(async () => {
    setBusy(true);
    try {
      const result = await joinDriverWaitlist({ city });
      setWaitlistStatus((current) => ({
        ...(current || {}),
        ...result,
        waitListStatus: 'pending',
        position: result.position || current?.position || null,
        estimatedWaitTime: result.estimatedWaitTime || current?.estimatedWaitTime || null,
        city: result.city || current?.city || { cityLabel: city },
      }));
    } catch (error) {
      Alert.alert('Waitlist', error?.message || 'Não foi possível entrar na fila agora.');
    } finally {
      setBusy(false);
    }
  }, [city]);

  const handleCreateDriverInvite = useCallback(async () => {
    const target = resolveInviteTarget(inviteTarget);
    if (!referralProgramsEnabled) {
      Alert.alert('Convites', 'Convites de motoristas ficam desativados durante o piloto controlado.');
      return;
    }
    if (!target.inviteeEmail && !target.inviteePhone) {
      Alert.alert('Convites', 'Informe telefone ou email do motorista convidado.');
      return;
    }

    setBusy(true);
    try {
      const result = await createReferralInvite({
        type: 'driver',
        ...target,
      });
      if (result.invite?.code) {
        const driverInvite = {
          ...result.invite,
          type: 'driver_referral',
        };
        setCreatedInvite(driverInvite);
        setSentInvites((current) => [driverInvite, ...current]);
        setInviteTarget('');
      }
    } catch (error) {
      Alert.alert('Convites', error?.message || 'Não foi possível criar o convite agora.');
    } finally {
      setBusy(false);
    }
  }, [inviteTarget, referralProgramsEnabled]);

  const handleAcceptDriverInvite = useCallback(async () => {
    const code = String(acceptCode || '').trim();
    if (!referralProgramsEnabled) {
      Alert.alert('Convites', 'Convites de motoristas ficam desativados durante o piloto controlado.');
      return;
    }
    if (!code) {
      Alert.alert('Convites', 'Digite o código recebido.');
      return;
    }

    setBusy(true);
    try {
      const result = await acceptReferralInvite(code);
      if (result.invite?.id || result.invite?.code) {
        setAcceptCode('');
        await loadData();
      }
    } catch (error) {
      Alert.alert('Convites', error?.message || 'Não foi possível aceitar esse convite.');
    } finally {
      setBusy(false);
    }
  }, [acceptCode, loadData, referralProgramsEnabled]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(latestLink);
    setCopied(true);
  }, [latestLink]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: shareMessage, url: latestLink });
    } catch (error) {
      Alert.alert('Convites', error?.message || 'Não foi possível compartilhar agora.');
    }
  }, [latestLink, shareMessage]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-driver-waitlist-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor="transparent"
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Motoristas"
            title="Waitlist e convites"
            subtitle="Acompanhe sua posição e convide motoristas para a próxima leva da Leaf."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-driver-waitlist-close-button"
                accessibilityLabel="robotaxi-driver-waitlist-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <PrototypeMenuStatRow
                items={[
                  { key: 'status', label: 'status', value: statusLabel, loading },
                  { key: 'position', label: 'posição', value: positionLabel, loading },
                  {
                    key: 'invites',
                    label: 'convites',
                    value: referralProgramsEnabled ? String(driverInvites.length) : 'off',
                    loading,
                  },
                ]}
              />

              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>Cidade de operação</Text>
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  placeholder="Rio de Janeiro"
                  placeholderTextColor="rgba(93,106,99,0.55)"
                  style={styles.input}
                  testID="robotaxi-driver-waitlist-city-input"
                  accessibilityLabel="robotaxi-driver-waitlist-city-input"
                />
                <LeafButton
                  label={busy ? 'Atualizando...' : 'Entrar na waitlist'}
                  icon="hourglass-outline"
                  tone="primary"
                  onPress={handleJoinWaitlist}
                  disabled={busy || waitlistStatus?.waitListStatus === 'pending'}
                  style={styles.fullButton}
                />
              </View>

              <PrototypeMenuSection title="Status da cidade">
                <PrototypeMenuInfoRow label="Cidade" value={cityLabel} />
                <PrototypeMenuInfoRow
                  label="Motoristas na fila"
                  value={String(waitlistStatus?.city?.pendingDrivers ?? '--')}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Ativos"
                  value={String(waitlistStatus?.city?.approvedDrivers ?? waitlistStatus?.currentActiveDrivers ?? '--')}
                  loading={loading}
                  last
                />
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Critérios de liberação">
                <PrototypeMenuInfoRow
                  label="Cidade ativa"
                  value={formatCriteriaValue(waitlistStatus?.criteria?.cityActive)}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Fila habilitada"
                  value={formatCriteriaValue(waitlistStatus?.criteria?.waitListEnabled)}
                  loading={loading}
                />
                <PrototypeMenuInfoRow
                  label="Documentos completos"
                  value={formatCriteriaValue(waitlistStatus?.criteria?.documentsComplete)}
                  loading={loading}
                  last
                />
              </PrototypeMenuSection>

              {referralProgramsEnabled ? (
                <View style={styles.inputBlock}>
                  <Text style={styles.inputLabel}>Convidar motorista</Text>
                  <TextInput
                    value={inviteTarget}
                    onChangeText={setInviteTarget}
                    placeholder="Telefone ou email"
                    placeholderTextColor="rgba(93,106,99,0.55)"
                    style={styles.input}
                    autoCapitalize="none"
                    testID="robotaxi-driver-invite-target-input"
                    accessibilityLabel="robotaxi-driver-invite-target-input"
                  />
                  <LeafButton
                    label={busy ? 'Criando...' : 'Criar convite'}
                    icon="person-add-outline"
                    tone="leaf"
                    onPress={handleCreateDriverInvite}
                    disabled={busy}
                    style={styles.fullButton}
                    testID="robotaxi-driver-invite-create-button"
                    accessibilityLabel="robotaxi-driver-invite-create-button"
                  />
                </View>
              ) : (
                <LeafEmptyState
                  icon="people-outline"
                  title="Convites fora do piloto"
                  message="A waitlist segue ativa, mas convites de motoristas ficam bloqueados neste perfil de lançamento."
                  testID="robotaxi-driver-invites-disabled-state"
                />
              )}

              {referralProgramsEnabled ? (
                <View style={styles.inputBlock}>
                  <Text style={styles.inputLabel}>Recebeu um convite?</Text>
                  <TextInput
                    value={acceptCode}
                    onChangeText={setAcceptCode}
                    placeholder="DRV-..."
                    placeholderTextColor="rgba(93,106,99,0.55)"
                    style={styles.input}
                    autoCapitalize="characters"
                    testID="robotaxi-driver-invite-accept-input"
                    accessibilityLabel="robotaxi-driver-invite-accept-input"
                  />
                  <LeafButton
                    label="Aceitar convite"
                    icon="checkmark-circle-outline"
                    tone="ghost"
                    onPress={handleAcceptDriverInvite}
                    disabled={busy}
                    style={styles.fullButton}
                    testID="robotaxi-driver-invite-accept-button"
                    accessibilityLabel="robotaxi-driver-invite-accept-button"
                  />
                </View>
              ) : null}

              {referralProgramsEnabled && latestInvite ? (
                <PrototypeMenuSection title="Último convite">
                  <PrototypeMenuInfoRow label="Código" value={latestCode || 'Aguardando'} />
                  <PrototypeMenuInfoRow label="Link" value={latestLink} />
                  <PrototypeMenuInfoRow label="Status" value={formatInviteStatus(latestInvite.status)} />
                  <PrototypeMenuInfoRow label="Critério" value={formatDriverInviteReward(latestInvite)} last />
                  <View style={styles.actionGrid}>
                    <LeafButton
                      label={copied ? 'Copiado' : 'Copiar'}
                      icon={copied ? 'checkmark-outline' : 'copy-outline'}
                      tone="ghost"
                      onPress={handleCopy}
                      style={styles.actionButton}
                      testID="robotaxi-driver-invite-copy-button"
                      accessibilityLabel="robotaxi-driver-invite-copy-button"
                    />
                    <LeafButton
                      label="Compartilhar"
                      icon="share-outline"
                      tone="ghost"
                      onPress={handleShare}
                      style={styles.actionButton}
                      testID="robotaxi-driver-invite-share-button"
                      accessibilityLabel="robotaxi-driver-invite-share-button"
                    />
                  </View>
                </PrototypeMenuSection>
              ) : referralProgramsEnabled ? (
                <LeafEmptyState
                  icon="car-outline"
                  title="Convites de motorista"
                  message="Crie convites para acompanhar quem entrou, quem qualificou e quando liberar recompensa."
                  testID="robotaxi-driver-invites-empty-state"
                />
              ) : null}

              {referralProgramsEnabled ? <DriverInviteHistory invites={driverInvites} /> : null}
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
    paddingBottom: 30,
    gap: 18,
  },
  inputBlock: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(221,232,225,0.85)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  inputLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  input: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9E2D8',
    paddingHorizontal: 13,
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 14,
  },
  fullButton: {
    marginTop: 12,
  },
  actionGrid: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(233,226,216,0.78)',
    gap: 12,
  },
  historyRowLast: {
    borderBottomWidth: 0,
  },
  historyCopy: {
    flex: 1,
    minWidth: 0,
  },
  historyTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 19,
  },
  historyMeta: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  historySide: {
    alignItems: 'flex-end',
  },
  historyStatus: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  historyDate: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
  },
  emptyHistoryText: {
    paddingVertical: 12,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
});
