import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Feather } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
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

// "+5521102938475" -> "+55 21 10293-8475"; other shapes are returned as-is.
export function formatBrazilPhoneLabel(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('55') && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : '';
  if (!local) return raw;
  const area = local.slice(0, 2);
  const number = local.slice(2);
  const split = number.length - 4;
  return `+55 ${area} ${number.slice(0, split)}-${number.slice(split)}`;
}

export default function RobotaxiProfileScreen({ navigation, route }) {
  const authProfile = useSelector(state => state?.auth?.profile);
  const { riderProfile, updateRiderProfile } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [remoteProfile, setRemoteProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: '', email: '' });
  const initialEditorOpened = useRef(false);
  const profileName =
    resolvePrototypeProfileName(remoteProfile) ||
    resolvePrototypeProfileName(authProfile) ||
    resolvePrototypeProfileName(riderProfile) ||
    'Sua conta';
  const phoneLabel = formatBrazilPhoneLabel(
    resolvePrototypeProfilePhone(remoteProfile) ||
    resolvePrototypeProfilePhone(authProfile) ||
    resolvePrototypeProfilePhone(riderProfile),
  ) || 'Telefone não informado';
  const emailLabel =
    resolvePrototypeProfileEmail(remoteProfile) ||
    resolvePrototypeProfileEmail(authProfile) ||
    resolvePrototypeProfileEmail(riderProfile) ||
    'Email não informado';
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

  // A tela é só o editor de Dados pessoais (2026-10-28): a lista que repetia a
  // Conta saiu; Sair e Excluir conta ficam na Conta e em Configurações.
  useEffect(() => {
    if (!loadingProfile && !profileError && !initialEditorOpened.current) {
      initialEditorOpened.current = true;
      startProfileEdit();
    }
  }, [loadingProfile, profileError, startProfileEdit]);

  // Leaving the editor returns to wherever it was opened from, or to Conta.
  const exitEditor = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototypeMenu');
  }, [navigation]);

  const saveProfile = useCallback(async () => {
    try {
      setSavingProfile(true);
      const saved = await MobileProfileService.upsertCurrentProfileOrThrow(profileDraft);
      setRemoteProfile(saved || profileDraft);
      updateRiderProfile(profileDraft);
      exitEditor();
    } catch (error) {
      Alert.alert('Dados pessoais', error?.message || 'Não foi possível salvar seus dados.');
    } finally {
      setSavingProfile(false);
    }
  }, [exitEditor, profileDraft, updateRiderProfile]);

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

  const handleDismiss = exitEditor;

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

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
                <Feather name="arrow-left" size={20} color={PROFILE_COLOR.text} />
              </TouchableOpacity>
              <View style={styles.headerCopy}>
                <Text style={styles.screenTitle}>Dados pessoais</Text>
              </View>
            </View>

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
                    ['email', 'E-mail', 'voce@email.com'],
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
                    onPress={exitEditor}
                    style={styles.secondaryAction}
                  >
                    <Text style={styles.secondaryActionText}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
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
});
