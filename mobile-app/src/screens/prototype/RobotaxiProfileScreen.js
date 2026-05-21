import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useAccountDeletionFlow } from '../../hooks/useAccountDeletionFlow';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import Logger from '../../utils/Logger';
import {
  resolvePrototypeProfileEmail,
  resolvePrototypeProfileName,
  resolvePrototypeProfilePhone,
} from './prototypeProfileIdentity';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const PROFILE_COLOR = {
  bg: '#F6FAF6',
  text: '#101C14',
  title: '#102018',
  secondary: '#66756B',
  muted: '#5F6B62',
  line: '#DFE8E1',
  leaf: '#0F3B16',
  dot: '#26A66A',
  avatar: '#EAF6EE',
  danger: '#9F2424',
};

const PASSENGER_ACTIONS = Object.freeze([
  { id: 'history', label: 'Historico de viagens', icon: 'time-outline', route: 'RobotaxiMenuTripHistory' },
  { id: 'payment', label: 'Métodos de pagamento', icon: 'card-outline', route: 'RobotaxiPrototypePaymentMethods' },
  { id: 'support', label: 'Seguranca e suporte', icon: 'shield-checkmark-outline', route: 'RobotaxiPrototypeSupport' },
]);

const DRIVER_ACTIONS = Object.freeze([
  { id: 'history', label: 'Corridas concluidas', icon: 'time-outline', route: 'RobotaxiMenuTripHistory' },
  { id: 'earnings', label: 'Ganhos', icon: 'wallet-outline', route: 'EarningsReport' },
  { id: 'activation', label: 'Ativacao do motorista', icon: 'shield-checkmark-outline', route: 'RobotaxiPrototypeDriverActivation' },
  { id: 'documents', label: 'Documentos', icon: 'document-text-outline', route: 'RobotaxiPrototypeDriverDocuments' },
  { id: 'vehicles', label: 'Veiculos', icon: 'car-outline', route: 'RobotaxiPrototypeVehicles' },
]);

const ACCOUNT_DELETION_ACTION = Object.freeze({
  id: 'delete-account',
  label: 'Excluir conta',
  icon: 'trash-outline',
});

const ACCOUNT_LOGOUT_ACTION = Object.freeze({
  id: 'logout',
  label: 'Sair da conta',
  icon: 'log-out-outline',
});

function ProfileRow({
  title,
  subtitle,
  onPress,
  testID,
  accessibilityLabel,
  tone = 'default',
  last = false,
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.profileRow, last && styles.profileRowLast]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.rowDot, tone === 'danger' && styles.rowDotDanger]} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, tone === 'danger' && styles.rowTitleDanger]}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Text style={[styles.rowChevron, tone === 'danger' && styles.rowTitleDanger]}>
        ›
      </Text>
    </TouchableOpacity>
  );
}

export default function RobotaxiProfileScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const { riderProfile, activeRole, driverCanGoOnline } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const isDriverRole = activeRole === 'driver';
  const profileName =
    resolvePrototypeProfileName(authProfile) ||
    resolvePrototypeProfileName(riderProfile) ||
    'Sua conta';
  const parsedRating = Number(authProfile?.driverRating ?? authProfile?.rating);
  const profileRating = Number.isFinite(parsedRating) ? parsedRating : null;
  const profileInitial = String(profileName).trim().charAt(0).toUpperCase() || 'L';
  const actions = isDriverRole ? DRIVER_ACTIONS : PASSENGER_ACTIONS;
  const phoneLabel =
    resolvePrototypeProfilePhone(authProfile) ||
    resolvePrototypeProfilePhone(riderProfile) ||
    'Telefone nao informado';
  const emailLabel =
    resolvePrototypeProfileEmail(authProfile) ||
    resolvePrototypeProfileEmail(riderProfile) ||
    'Email nao informado';
  const preferenceLabel = String(riderProfile?.preference || '').trim() || (isDriverRole ? 'Conta operacional pronta para atender' : 'Sem preferencia cadastrada');
  const accountStatus = isDriverRole ? (driverCanGoOnline ? 'Motorista habilitado' : 'Ativacao pendente') : 'Conta de passageiro';
  const deletionProfile = authProfile || riderProfile;
  const { promptAccountDeletion } = useAccountDeletionFlow({
    navigation,
    profile: deletionProfile,
    source: 'mobile-app-profile-screen',
    additionalInfo: 'Solicitação enviada pela tela de perfil do app',
  });
  const { resetSessionToStart } = useAccountSessionReset({
    navigation,
    profile: deletionProfile,
  });

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-profile',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const infoRows = useMemo(() => {
    const baseRows = [
      { label: 'Nome', value: profileName },
      { label: 'Telefone', value: phoneLabel },
      { label: 'Email', value: emailLabel },
      { label: isDriverRole ? 'Status da conta' : 'Preferencia', value: isDriverRole ? accountStatus : preferenceLabel },
    ];

    if (profileRating != null) {
      baseRows.push({ label: 'Avaliacao', value: profileRating.toFixed(1) });
    }

    return baseRows;
  }, [accountStatus, emailLabel, isDriverRole, phoneLabel, preferenceLabel, profileName, profileRating]);

  const promptLogout = useCallback(() => {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja sair da sua conta Leaf?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: () => {
            resetSessionToStart().catch((error) => {
              Logger.error('Erro ao sair da conta pelo perfil:', error);
              Alert.alert('Não foi possível sair', 'Tente novamente em alguns instantes.');
            });
          },
        },
      ],
    );
  }, [resetSessionToStart]);

  const handleActionPress = useCallback(
    item => {
      if (item?.id === ACCOUNT_LOGOUT_ACTION.id) {
        promptLogout();
        return;
      }

      if (item?.id === ACCOUNT_DELETION_ACTION.id) {
        promptAccountDeletion();
        return;
      }

      if (!item?.route) {
        return;
      }

      if (item.route === 'EarningsReport') {
        navigation.navigate(item.route, {
          source: 'driver-profile',
          defaultRangeDays: 1,
          maxRangeDays: 30,
        });
        return;
      }

      navigation.replace(item.route, item.params);
    },
    [navigation, promptAccountDeletion, promptLogout]
  );

  const profileRows = useMemo(() => {
    const rows = [
      {
        id: 'personal-data',
        title: 'Dados pessoais',
        subtitle: 'Nome, email e telefone',
        onPress: () => {
          Alert.alert(
            'Dados pessoais',
            infoRows
              .map((row) => `${row.label}: ${row.value}`)
              .join('\n'),
          );
        },
      },
      ...actions.map((item) => ({
        id: item.id,
        title: item.label,
        subtitle:
          item.id === 'history'
            ? 'Recibos e detalhes'
            : item.id === 'payment'
              ? 'Metodo principal'
              : item.id === 'support'
                ? 'Ajuda e chamados'
                : item.id === 'earnings'
                  ? 'Saldo e relatorio'
                  : item.id === 'vehicles'
                    ? 'Carro autorizado'
                    : 'Documentos e liberacao',
        onPress: () => handleActionPress(item),
      })),
      {
        id: 'settings',
        title: 'Configuracoes',
        subtitle: 'Conta e privacidade',
        onPress: () => navigation.replace('RobotaxiPrototypeSettings'),
      },
      {
        id: ACCOUNT_LOGOUT_ACTION.id,
        title: ACCOUNT_LOGOUT_ACTION.label,
        subtitle: 'Voltar para entrada por telefone',
        onPress: () => handleActionPress(ACCOUNT_LOGOUT_ACTION),
        testID: 'profile-logout-shortcut',
        accessibilityLabel: 'Sair da conta',
      },
      {
        id: ACCOUNT_DELETION_ACTION.id,
        title: ACCOUNT_DELETION_ACTION.label,
        subtitle: 'Remover sua conta e dados associados',
        onPress: () => handleActionPress(ACCOUNT_DELETION_ACTION),
        testID: 'profile-account-deletion-shortcut',
        accessibilityLabel: 'Excluir conta',
        tone: 'danger',
      },
    ];

    return rows;
  }, [actions, handleActionPress, infoRows, navigation]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <View
            onLayout={handlePanelLayout}
            style={[
              styles.surface,
              {
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              },
            ]}
          >
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>9:41</Text>
              <Text style={styles.statusText}>100%</Text>
            </View>

            <TouchableOpacity
              style={styles.closeHit}
              onPress={handleDismiss}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel="Fechar perfil"
            />

            <Text style={styles.screenTitle}>Perfil</Text>
            <Text style={styles.screenSubtitle}>
              Gerencie seus dados, atalhos e segurança.
            </Text>

            <View style={styles.identityRow}>
              <View style={styles.avatarWrap}>
                <Text style={styles.avatarLetter}>{profileInitial}</Text>
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.identityName} numberOfLines={1}>
                  {profileName}
                </Text>
                <Text style={styles.identityMeta} numberOfLines={1}>
                  {isDriverRole ? accountStatus : preferenceLabel}
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              {profileRows.map((item, index) => (
                <ProfileRow
                  key={item.id}
                  title={item.title}
                  subtitle={item.subtitle}
                  onPress={item.onPress}
                  testID={item.testID}
                  accessibilityLabel={item.accessibilityLabel}
                  tone={item.tone}
                  last={index === profileRows.length - 1}
                />
              ))}
            </ScrollView>
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
  surface: {
    flex: 1,
    backgroundColor: PROFILE_COLOR.bg,
    paddingHorizontal: 31,
  },
  statusRow: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusText: {
    color: PROFILE_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  closeHit: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 72,
    height: 88,
  },
  screenTitle: {
    marginTop: 28,
    color: PROFILE_COLOR.title,
    fontFamily: fonts.Medium,
    fontSize: 19,
    lineHeight: 25,
  },
  screenSubtitle: {
    marginTop: 8,
    color: PROFILE_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PROFILE_COLOR.avatar,
  },
  avatarLetter: {
    color: PROFILE_COLOR.leaf,
    fontFamily: fonts.Medium,
    fontSize: 22,
    lineHeight: 29,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 38,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 18,
  },
  identityName: {
    color: PROFILE_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 22,
    lineHeight: 29,
  },
  identityMeta: {
    marginTop: 2,
    color: PROFILE_COLOR.muted,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: PROFILE_COLOR.line,
    marginTop: 28,
  },
  rowsContent: {
    paddingTop: 18,
    paddingBottom: 28,
  },
  profileRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PROFILE_COLOR.line,
  },
  profileRowLast: {
    borderBottomWidth: 0,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PROFILE_COLOR.dot,
    marginRight: 12,
  },
  rowDotDanger: {
    backgroundColor: PROFILE_COLOR.danger,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  rowTitle: {
    color: PROFILE_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  rowTitleDanger: {
    color: PROFILE_COLOR.danger,
  },
  rowSubtitle: {
    marginTop: 3,
    color: PROFILE_COLOR.muted,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  rowChevron: {
    width: 18,
    color: PROFILE_COLOR.text,
    fontFamily: fonts.Medium,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'right',
  },
});
