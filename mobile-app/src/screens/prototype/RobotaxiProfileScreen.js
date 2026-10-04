import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { LeafAccountCard, LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useAccountDeletionFlow } from '../../hooks/useAccountDeletionFlow';
import { useAccountSessionReset } from '../../hooks/useAccountSessionReset';
import Logger from '../../utils/Logger';
import { LeafButton, LeafEmptyState } from '../../components/prototype/LeafRideUI';
import MobileProfileService from '../../services/MobileProfileService';
import {
  resolvePrototypeProfileEmail,
  resolvePrototypeProfileName,
  resolvePrototypeProfilePhone,
} from './prototypeProfileIdentity';

const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const PROFILE_COLOR = {
  bg: '#FFFFFF',
  text: '#222222',
  title: '#222222',
  secondary: '#6A6A6A',
  muted: '#767676',
  line: '#E5E5E5',
  leaf: '#1A330E',
  dot: '#1A330E',
  avatar: '#F1F5EE',
  danger: '#9F2424',
  icon: '#514B45',
  chevron: '#767676',
};

const PASSENGER_ACTIONS = Object.freeze([
  { id: 'history', label: 'Histórico de viagens', icon: 'time-outline', route: 'RobotaxiMenuTripHistory' },
  { id: 'support', label: 'Segurança e suporte', icon: 'shield-checkmark-outline', route: 'RobotaxiPrototypeSupport' },
]);

const DRIVER_ACTIONS = Object.freeze([
  { id: 'history', label: 'Corridas concluídas', icon: 'time-outline', route: 'RobotaxiMenuTripHistory' },
  { id: 'earnings', label: 'Ganhos', icon: 'wallet-outline', route: 'EarningsReport' },
  { id: 'activation', label: 'Ativação do motorista', icon: 'shield-checkmark-outline', route: 'RobotaxiPrototypeDriverActivation' },
  { id: 'documents', label: 'Documentos', icon: 'document-text-outline', route: 'RobotaxiPrototypeDriverDocuments' },
  { id: 'vehicles', label: 'Veículos', icon: 'car-outline', route: 'RobotaxiPrototypeVehicles' },
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
  icon,
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
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={subtitle}
    >
      <View style={styles.rowIconSlot}>
        <LeafObjectIcon symbol={icon || 'person-outline'} size={40} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, tone === 'danger' && styles.rowTitleDanger]}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={15}
        color={tone === 'danger' ? PROFILE_COLOR.danger : PROFILE_COLOR.chevron}
      />
    </TouchableOpacity>
  );
}

export default function RobotaxiProfileScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const { riderProfile, activeRole, driverCanGoOnline, updateRiderProfile } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [remoteProfile, setRemoteProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: '', email: '' });
  const initialEditorOpened = useRef(false);
  const isDriverRole = activeRole === 'driver';
  const profileName =
    resolvePrototypeProfileName(remoteProfile) ||
    resolvePrototypeProfileName(authProfile) ||
    resolvePrototypeProfileName(riderProfile) ||
    'Sua conta';
  const profileInitial = String(profileName).trim().charAt(0).toUpperCase() || 'L';
  const actions = isDriverRole ? DRIVER_ACTIONS : PASSENGER_ACTIONS;
  const phoneLabel =
    resolvePrototypeProfilePhone(remoteProfile) ||
    resolvePrototypeProfilePhone(authProfile) ||
    resolvePrototypeProfilePhone(riderProfile) ||
    'Telefone não informado';
  const emailLabel =
    resolvePrototypeProfileEmail(remoteProfile) ||
    resolvePrototypeProfileEmail(authProfile) ||
    resolvePrototypeProfileEmail(riderProfile) ||
    'Email não informado';
  const preferenceLabel = String(riderProfile?.preference || '').trim() || (isDriverRole ? 'Conta operacional pronta para atender' : 'Sem preferência cadastrada');
  const accountStatus = isDriverRole ? (driverCanGoOnline ? 'Motorista habilitado' : 'Ativação pendente') : 'Conta de passageiro';
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

  const loadProfile = useCallback(async () => {
    try {
      setLoadingProfile(true);
      setProfileError('');
      const profile = await MobileProfileService.getCurrentProfileOrThrow();
      setRemoteProfile(profile);
    } catch (error) {
      if (error?.status === 404) {
        // A conta autenticada pode existir antes do primeiro espelho de perfil.
        // Nesse caso, mantenha os dados locais visíveis e permita o primeiro PUT.
        setRemoteProfile(null);
        setProfileError('');
        return;
      }
      setProfileError(error?.message || 'Não foi possível carregar os dados da conta.');
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    const removeFocus = navigation?.addListener?.('focus', loadProfile);
    return () => removeFocus?.();
  }, [loadProfile, navigation]);

  const startProfileEdit = useCallback(() => {
    setProfileDraft({
      name: profileName === 'Sua conta' ? '' : profileName,
      email: emailLabel === 'Email não informado' ? '' : emailLabel,
    });
    setEditingProfile(true);
  }, [emailLabel, profileName]);

  useEffect(() => {
    if (route?.params?.editProfile && !loadingProfile && !profileError && !initialEditorOpened.current) {
      initialEditorOpened.current = true;
      startProfileEdit();
    }
  }, [loadingProfile, profileError, route?.params?.editProfile, startProfileEdit]);

  const saveProfile = useCallback(async () => {
    try {
      setSavingProfile(true);
      const saved = await MobileProfileService.upsertCurrentProfileOrThrow(profileDraft);
      setRemoteProfile(saved || profileDraft);
      updateRiderProfile(profileDraft);
      setEditingProfile(false);
    } catch (error) {
      Alert.alert('Dados pessoais', error?.message || 'Não foi possível salvar seus dados.');
    } finally {
      setSavingProfile(false);
    }
  }, [profileDraft, updateRiderProfile]);

  useEffect(() => {
    const showStatusBar = () => StatusBar.setHidden(false, 'fade');

    showStatusBar();
    const removeFocusListener = navigation?.addListener?.('focus', showStatusBar);
    const removeBlurListener = navigation?.addListener?.('blur', showStatusBar);

    return () => {
      removeFocusListener?.();
      removeBlurListener?.();
      showStatusBar();
    };
  }, [navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-profile',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    if (route?.params?.returnToAccount && navigation.canGoBack()) { navigation.goBack(); return; }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation, route?.params?.returnToAccount]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

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
        icon: 'person-circle-outline',
        title: 'Dados pessoais',
        subtitle: 'Nome, email e telefone',
        onPress: startProfileEdit,
      },
      ...actions.map((item) => ({
        id: item.id,
        icon: item.icon,
        title: item.label,
        subtitle:
          item.id === 'history'
            ? 'Recibos e detalhes'
            : item.id === 'support'
                ? 'Ajuda e chamados'
                : item.id === 'earnings'
                  ? 'Saldo e relatório'
                  : item.id === 'vehicles'
                    ? 'Carro autorizado'
                    : 'Documentos e liberação',
        onPress: () => handleActionPress(item),
      })),
      {
        id: 'settings',
        icon: 'settings-outline',
        title: 'Configurações',
        subtitle: 'Conta e privacidade',
        onPress: () => navigation.replace('RobotaxiPrototypeSettings'),
      },
      {
        id: ACCOUNT_LOGOUT_ACTION.id,
        icon: ACCOUNT_LOGOUT_ACTION.icon,
        title: ACCOUNT_LOGOUT_ACTION.label,
        subtitle: 'Voltar para entrada por telefone',
        onPress: () => handleActionPress(ACCOUNT_LOGOUT_ACTION),
        testID: 'profile-logout-shortcut',
        accessibilityLabel: 'Sair da conta',
      },
      {
        id: ACCOUNT_DELETION_ACTION.id,
        icon: ACCOUNT_DELETION_ACTION.icon,
        title: ACCOUNT_DELETION_ACTION.label,
        subtitle: 'Remover sua conta e dados associados',
        onPress: () => handleActionPress(ACCOUNT_DELETION_ACTION),
        testID: 'profile-account-deletion-shortcut',
        accessibilityLabel: 'Excluir conta',
        tone: 'danger',
      },
    ];

    return rows;
  }, [actions, handleActionPress, navigation, startProfileEdit]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-profile-screen">
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
            <View style={styles.headerRow}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleDismiss}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel="Voltar à conta"
              >
                <Ionicons name="arrow-back" size={20} color={PROFILE_COLOR.text} />
              </TouchableOpacity>
              <View style={styles.headerCopy}>
                <Text style={styles.screenTitle}>
                  {editingProfile ? 'Dados pessoais' : isDriverRole ? 'Perfil do motorista' : 'Perfil'}
                </Text>
              </View>
            </View>

            {!editingProfile ? <LeafAccountCard name={profileName} role={activeRole}
              profile={{ ...(riderProfile || {}), ...(authProfile || {}), ...(remoteProfile || {}) }}
              detail={isDriverRole ? accountStatus : String(riderProfile?.preference || '').trim() || undefined} motionEnabled={focused} /> : null}

            {!editingProfile ? <View style={styles.divider} /> : null}

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              {loadingProfile ? (
                <View style={styles.centerState} testID="robotaxi-profile-loading">
                  <ActivityIndicator color={PROFILE_COLOR.leaf} />
                </View>
              ) : profileError ? (
                <LeafEmptyState
                  icon="cloud-offline-outline"
                  title="Perfil indisponível"
                  message={profileError}
                  actionLabel="Tentar novamente"
                  onAction={loadProfile}
                  testID="robotaxi-profile-error"
                />
              ) : editingProfile ? (
                <View style={styles.editor} testID="robotaxi-profile-editor">
                  {[
                    ['name', 'Nome', 'Seu nome'],
                    ['email', 'Email', 'voce@email.com'],
                  ].map(([key, label, placeholder]) => (
                    <View key={key} style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <TextInput
                        value={profileDraft[key]}
                        onChangeText={value => setProfileDraft(previous => ({ ...previous, [key]: value }))}
                        placeholder={placeholder}
                        autoCapitalize={key === 'name' ? 'words' : 'none'}
                        keyboardType={key === 'email' ? 'email-address' : 'default'}
                        style={styles.fieldInput}
                        testID={`robotaxi-profile-input-${key}`}
                      />
                    </View>
                  ))}
                  <View style={styles.fieldWrap} testID="robotaxi-profile-phone-readonly">
                    <Text style={styles.fieldLabel}>Telefone</Text>
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyValue}>{phoneLabel}</Text>
                      <Text style={styles.readOnlyHint}>
                        Para alterar o telefone, será necessária uma nova validação de segurança. Em breve.
                      </Text>
                    </View>
                  </View>
                  <LeafButton
                    label={savingProfile ? 'Salvando...' : 'Salvar dados'}
                    tone="primary"
                    disabled={savingProfile || !profileDraft.name.trim()}
                    onPress={saveProfile}
                  />
                  <TouchableOpacity
                    disabled={savingProfile}
                    onPress={() => setEditingProfile(false)}
                    style={styles.secondaryAction}
                  >
                    <Text style={styles.secondaryActionText}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                profileRows.map((item, index) => (
                  <ProfileRow
                    key={item.id}
                    icon={item.icon}
                    title={item.title}
                    subtitle={item.subtitle}
                    onPress={item.onPress}
                    testID={item.testID}
                    accessibilityLabel={item.accessibilityLabel}
                    tone={item.tone}
                    last={index === profileRows.length - 1}
                  />
                ))
              )}
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
    paddingHorizontal: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    marginBottom: 20,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 4,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
  },
  screenTitle: {
    color: PROFILE_COLOR.title,
    ...leafTypography.semiBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  screenSubtitle: {
    marginTop: 8,
    color: PROFILE_COLOR.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
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
    ...leafTypography.semiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 18,
  },
  identityName: {
    color: PROFILE_COLOR.text,
    ...leafTypography.semiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  identityMeta: {
    marginTop: 2,
    color: PROFILE_COLOR.muted,
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 17,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: PROFILE_COLOR.line,
    marginTop: 24,
  },
  rowsContent: {
    paddingTop: 12,
    paddingBottom: 28,
  },
  centerState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editor: {
    paddingTop: 8,
    gap: 16,
  },
  fieldWrap: {
    gap: 7,
  },
  fieldLabel: {
    color: PROFILE_COLOR.secondary,
    ...leafTypography.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  fieldInput: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PROFILE_COLOR.line,
    backgroundColor: '#FFFFFF',
    color: PROFILE_COLOR.text,
    ...leafTypography.regular,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  readOnlyField: {
    minHeight: 76,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PROFILE_COLOR.line,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  readOnlyValue: {
    color: PROFILE_COLOR.text,
    ...leafTypography.regular,
    fontSize: 15,
    lineHeight: 20,
  },
  readOnlyHint: {
    marginTop: 5,
    color: PROFILE_COLOR.muted,
    ...leafTypography.regular,
    fontSize: 11,
    lineHeight: 15,
  },
  secondaryAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: PROFILE_COLOR.secondary,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  profileRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PROFILE_COLOR.line,
  },
  profileRowLast: {
    borderBottomWidth: 0,
  },
  rowIconSlot: {
    width: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  rowTitle: {
    color: PROFILE_COLOR.text,
    ...leafTypography.medium,
    fontSize: 16,
    lineHeight: 21,
  },
  rowTitleDanger: {
    color: PROFILE_COLOR.danger,
  },
  rowSubtitle: {
    marginTop: 3,
    color: PROFILE_COLOR.muted,
    ...leafTypography.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
