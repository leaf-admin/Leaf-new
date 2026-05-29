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
import {
  acceptReferralInvite,
  createReferralInvite,
  loadMyReferralInvites,
} from '../../services/runtime/referralProgramService';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const INVITE_BASE_URL = 'https://leaf.app.br/convite';

function buildInviteLink(code) {
  const safeCode = String(code || '').trim();
  return `${INVITE_BASE_URL}/${encodeURIComponent(safeCode || 'leaf')}`;
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

function countByStatus(invites, status) {
  return invites.filter((invite) => String(invite.status || '').toLowerCase() === status).length;
}

export default function RobotaxiInvitesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [loading, setLoading] = useState(true);
  const [sentInvites, setSentInvites] = useState([]);
  const [receivedInvites, setReceivedInvites] = useState([]);
  const [inviteTarget, setInviteTarget] = useState('');
  const [acceptCode, setAcceptCode] = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-invites',
    occludedBottom: panelHeight,
  });

  const activeInvites = useMemo(
    () => sentInvites.filter((invite) => ['pending', 'accepted'].includes(String(invite.status || '').toLowerCase())),
    [sentInvites],
  );
  const acceptedCount = useMemo(() => countByStatus(sentInvites, 'accepted'), [sentInvites]);
  const latestInvite = createdInvite || sentInvites[0] || null;
  const latestCode = latestInvite?.code || '';
  const latestLink = useMemo(() => buildInviteLink(latestCode), [latestCode]);
  const shareMessage = useMemo(
    () =>
      `Vem pra Leaf comigo. Use meu convite ${latestCode || ''} e acompanhe pelo app: ${latestLink}`,
    [latestCode, latestLink],
  );

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadMyReferralInvites();
      setSentInvites(result.sent || []);
      setReceivedInvites(result.received || []);
    } catch (_error) {
      setSentInvites([]);
      setReceivedInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

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

  const handleCreateInvite = useCallback(async () => {
    const target = resolveInviteTarget(inviteTarget);
    if (!target.inviteeEmail && !target.inviteePhone) {
      Alert.alert('Convites', 'Informe telefone ou email da pessoa convidada.');
      return;
    }

    setBusy(true);
    try {
      const result = await createReferralInvite({
        type: 'passenger',
        ...target,
      });
      if (result.invite?.code) {
        setCreatedInvite(result.invite);
        setSentInvites((current) => [result.invite, ...current]);
        setInviteTarget('');
      }
    } catch (error) {
      Alert.alert('Convites', error?.message || 'Não foi possível criar o convite agora.');
    } finally {
      setBusy(false);
    }
  }, [inviteTarget]);

  const handleAcceptInvite = useCallback(async () => {
    const code = String(acceptCode || '').trim();
    if (!code) {
      Alert.alert('Convites', 'Digite o código recebido.');
      return;
    }

    setBusy(true);
    try {
      const result = await acceptReferralInvite(code);
      if (result.invite?.id || result.invite?.code) {
        setReceivedInvites((current) => [result.invite, ...current]);
        setAcceptCode('');
      }
    } catch (error) {
      Alert.alert('Convites', error?.message || 'Não foi possível aceitar esse convite.');
    } finally {
      setBusy(false);
    }
  }, [acceptCode]);

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
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-invites-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor="transparent"
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Convites"
            title="Convide passageiros"
            subtitle="Gere links e acompanhe quantas pessoas entraram pela sua indicação."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-invites-close-button"
                accessibilityLabel="robotaxi-invites-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <PrototypeMenuStatRow
                items={[
                  { key: 'sent', label: 'enviados', value: String(sentInvites.length) },
                  { key: 'active', label: 'ativos', value: String(activeInvites.length) },
                  { key: 'accepted', label: 'aceitos', value: String(acceptedCount) },
                ]}
              />

              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>Telefone ou email</Text>
                <TextInput
                  value={inviteTarget}
                  onChangeText={setInviteTarget}
                  placeholder="Ex: +5521999999999"
                  placeholderTextColor="rgba(93,106,99,0.55)"
                  style={styles.input}
                  autoCapitalize="none"
                  testID="robotaxi-invites-target-input"
                  accessibilityLabel="robotaxi-invites-target-input"
                />
                <LeafButton
                  label={busy ? 'Criando...' : 'Criar convite'}
                  icon="person-add-outline"
                  tone="primary"
                  onPress={handleCreateInvite}
                  disabled={busy}
                  style={styles.fullButton}
                />
              </View>

              {latestInvite ? (
                <PrototypeMenuSection title="Último convite">
                  <PrototypeMenuInfoRow label="Código" value={latestCode || 'Aguardando'} />
                  <PrototypeMenuInfoRow label="Link" value={latestLink} />
                  <PrototypeMenuInfoRow label="Status" value={latestInvite.status || 'pending'} last />
                  <View style={styles.actionGrid}>
                    <LeafButton
                      label={copied ? 'Copiado' : 'Copiar'}
                      icon={copied ? 'checkmark-outline' : 'copy-outline'}
                      tone="leaf"
                      onPress={handleCopy}
                      style={styles.actionButton}
                    />
                    <LeafButton
                      label="Compartilhar"
                      icon="share-outline"
                      tone="ghost"
                      onPress={handleShare}
                      style={styles.actionButton}
                    />
                  </View>
                </PrototypeMenuSection>
              ) : (
                <LeafEmptyState
                  icon="people-outline"
                  title={loading ? 'Carregando convites' : 'Nenhum convite criado'}
                  message={
                    loading
                      ? 'Sincronizando convites e aceites recentes.'
                      : 'Crie o primeiro convite para liberar acompanhamento de uso e aceite.'
                  }
                  loading={loading}
                  testID="robotaxi-invites-empty-state"
                />
              )}

              <View style={styles.inputBlock}>
                <Text style={styles.inputLabel}>Recebeu um código?</Text>
                <TextInput
                  value={acceptCode}
                  onChangeText={setAcceptCode}
                  placeholder="PSG-..."
                  placeholderTextColor="rgba(93,106,99,0.55)"
                  style={styles.input}
                  autoCapitalize="characters"
                  testID="robotaxi-invites-accept-input"
                  accessibilityLabel="robotaxi-invites-accept-input"
                />
                <LeafButton
                  label="Aceitar convite"
                  icon="checkmark-circle-outline"
                  tone="ghost"
                  onPress={handleAcceptInvite}
                  disabled={busy}
                  style={styles.fullButton}
                />
              </View>

              <PrototypeMenuSection title="Histórico">
                <PrototypeMenuInfoRow label="Recebidos" value={String(receivedInvites.length)} />
                <PrototypeMenuInfoRow label="Ativos" value={String(activeInvites.length)} last />
              </PrototypeMenuSection>
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
});
