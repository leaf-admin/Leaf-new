import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
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

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

const PASSENGER_ACTIONS = Object.freeze([
  { id: 'history', label: 'Historico de viagens', icon: 'time-outline', route: 'RobotaxiMenuTripHistory' },
  { id: 'payment', label: 'Pagamento via PIX', icon: 'card-outline', route: 'RobotaxiPrototypePayment' },
  { id: 'support', label: 'Seguranca e suporte', icon: 'shield-checkmark-outline', route: 'RobotaxiPrototypeSupport' },
]);

const DRIVER_ACTIONS = Object.freeze([
  { id: 'history', label: 'Corridas concluidas', icon: 'time-outline', route: 'RobotaxiMenuTripHistory' },
  { id: 'earnings', label: 'Ganhos', icon: 'wallet-outline', route: 'EarningsReport' },
  { id: 'activation', label: 'Ativacao do motorista', icon: 'shield-checkmark-outline', route: 'RobotaxiPrototypeDriverActivation' },
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
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow={isDriverRole ? 'Perfil do motorista' : 'Perfil do passageiro'}
            title="Perfil"
            subtitle={isDriverRole ? 'Seus dados, status da conta e atalhos operacionais.' : 'Seus dados, preferencias e atalhos principais.'}
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={<PrototypeMenuCloseButton onPress={handleDismiss} />}
          >
            <View style={styles.identityRow}>
              <View style={styles.avatarWrap}>
                <Text style={styles.avatarLetter}>{profileInitial}</Text>
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.identityName}>{profileName}</Text>
                <Text style={styles.identityMeta}>
                  {isDriverRole ? accountStatus : preferenceLabel}
                </Text>
              </View>
            </View>

            <PrototypeMenuSection title="Conta">
              {infoRows.map((row) => (
                <PrototypeMenuInfoRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  last={false}
                />
              ))}
              <PrototypeMenuRow
                icon={ACCOUNT_LOGOUT_ACTION.icon}
                title={ACCOUNT_LOGOUT_ACTION.label}
                onPress={() => handleActionPress(ACCOUNT_LOGOUT_ACTION)}
                testID="profile-logout-shortcut"
                accessibilityLabel="Sair da conta"
              />
              <PrototypeMenuRow
                icon={ACCOUNT_DELETION_ACTION.icon}
                title={ACCOUNT_DELETION_ACTION.label}
                last
                onPress={() => handleActionPress(ACCOUNT_DELETION_ACTION)}
                testID="profile-account-deletion-shortcut"
                accessibilityLabel="Excluir conta"
              />
            </PrototypeMenuSection>

            <PrototypeMenuSection title="Acessos rapidos" style={styles.shortcutsSection}>
              {actions.map((item, index) => (
                <PrototypeMenuRow
                  key={item.id}
                  icon={item.icon}
                  title={item.label}
                  last={index === actions.length - 1}
                  onPress={() => handleActionPress(item)}
                />
              ))}
            </PrototypeMenuSection>
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
  avatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(230,237,244,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
  },
  avatarLetter: {
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 18,
  },
  identityCopy: {
    flex: 1,
  },
  identityName: {
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: typography.title.size,
    lineHeight: typography.title.lineHeight,
  },
  identityMeta: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  shortcutsSection: {
    marginTop: 4,
  },
});
