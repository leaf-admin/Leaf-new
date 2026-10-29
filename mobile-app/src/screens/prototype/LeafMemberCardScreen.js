import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import LeafTouchable from '../../components/design-system/LeafTouchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { LeafAccountCard } from '../../components/prototype/LeafVisualElements';
import { PrototypeMenuGroup, PrototypeMenuGroupRow } from '../../components/prototype/PrototypeMenuSurface';
import useAccountSummary from '../../hooks/useAccountSummary';
import { formatLeafMemberNumber, resolveLeafMemberNumber } from '../../utils/leafMemberNumber';
import { resolvePrototypeProfileName } from './prototypeProfileIdentity';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

function formatMemberSince(createdAt) {
  const raw = createdAt?.toDate ? createdAt.toDate()
    : typeof createdAt === 'number' ? new Date(createdAt < 100000000000 ? createdAt * 1000 : createdAt)
      : typeof createdAt === 'string' ? new Date(createdAt)
        : createdAt?.seconds ? new Date(createdAt.seconds * 1000) : null;
  if (!raw || Number.isNaN(raw.getTime())) return '';
  const label = raw.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Cartão de membro em tela cheia, aberto pelo cabeçalho da Conta. O número é só
// exibição por enquanto (ver utils/leafMemberNumber).
export default function LeafMemberCardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { activeRole, riderProfile, profileUid, lastReceipt } = usePrototypeRideRuntime();
  const authProfile = useSelector(state => state?.auth?.profile);
  const uid = profileUid || authProfile?.uid;
  const accountSummary = useAccountSummary({ uid, role: activeRole, revision: lastReceipt?.receiptId || lastReceipt?.id || null, focused });
  const visibleAuthProfile = authProfile?.uid === uid ? authProfile : null;
  const visibleRiderProfile = riderProfile?.uid === uid ? riderProfile : null;
  const cardProfile = { ...(visibleRiderProfile || {}), ...(visibleAuthProfile || {}), ...(accountSummary.summary?.profile || {}) };
  const name = resolvePrototypeProfileName(visibleAuthProfile) || resolvePrototypeProfileName(visibleRiderProfile);
  const memberNumber = formatLeafMemberNumber(resolveLeafMemberNumber(uid));
  const memberSince = formatMemberSince(cardProfile.createdAt);
  const [copied, setCopied] = useState(false);

  const back = useCallback(() => (navigation.canGoBack?.() ? navigation.goBack() : navigation.navigate('RobotaxiPrototypeMenu')), [navigation]);
  const copyNumber = useCallback(async () => {
    if (!memberNumber) return;
    await Clipboard.setStringAsync(memberNumber.replace(/\s/g, ''));
    setCopied(true);
  }, [memberNumber]);

  return (
    <View style={[styles.page, { paddingTop: insets.top + 12 }]} testID="leaf-member-card-screen">
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <View style={styles.header}>
        <LeafTouchable onPress={back} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar" testID="leaf-member-card-back">
          <Feather name="arrow-left" size={20} color="#222222" />
        </LeafTouchable>
        <Text style={styles.title} accessibilityRole="header">Cartão de membro</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <LeafAccountCard name={name} role={activeRole} profile={cardProfile} memberNumber={memberNumber}
          motionEnabled={focused} loadingMetrics={accountSummary.loading && !accountSummary.summary} />
        <PrototypeMenuGroup>
          <PrototypeMenuGroupRow icon="id-card-outline" title="Nº de membro" value={memberNumber || '—'}
            trailing={memberNumber ? <Feather name={copied ? 'check' : 'copy'} size={17} color="#767676" /> : null}
            onPress={memberNumber ? copyNumber : undefined}
            accessibilityHint={copied ? 'Número copiado' : 'Copia o número'} testID="leaf-member-card-copy" />
          {memberSince ? <PrototypeMenuGroupRow icon="calendar-outline" title="Membro desde" value={memberSince} /> : null}
          <PrototypeMenuGroupRow icon="person-outline" title="Conta" value={activeRole === 'driver' ? 'Motorista' : 'Passageiro'} />
        </PrototypeMenuGroup>
        <PrototypeMenuGroup>
          <PrototypeMenuGroupRow icon="person-outline" title="Editar dados pessoais"
            onPress={() => navigation.navigate('RobotaxiPrototypeProfile', { returnToAccount: true, editProfile: true })}
            testID="leaf-member-card-edit-profile" />
        </PrototypeMenuGroup>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 20, marginBottom: 20 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F4F2' },
  title: { ...leafTypography.semiBold, fontSize: 22, lineHeight: 28, color: '#222222', flex: 1 },
  content: { paddingHorizontal: 20, gap: 24 },
});
