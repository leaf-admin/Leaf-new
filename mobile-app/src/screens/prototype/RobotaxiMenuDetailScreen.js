import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import { getMenuItemByRoute } from './robotaxiMenuConfig';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const FALLBACK_CARD_HEIGHT = 356;

export default function RobotaxiMenuDetailScreen({ navigation, route }) {
  const { riderProfile, updateRiderProfile } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPreference, setDraftPreference] = useState('');

  const targetRoute = route?.name;
  const item = getMenuItemByRoute(targetRoute);

  const title = item?.title || 'Detalhes';
  const subtitle = item?.subtitle || 'Informações da seção';
  const sections = item?.sections || [];
  const isEditProfile = targetRoute === 'RobotaxiMenuEditProfile' || item?.key === 'edit-profile';

  useEffect(() => {
    setDraftName(riderProfile?.name || '');
    setDraftPhone(riderProfile?.phone || '');
    setDraftEmail(riderProfile?.email || '');
    setDraftPreference(riderProfile?.preference || '');
  }, [riderProfile?.email, riderProfile?.name, riderProfile?.phone, riderProfile?.preference]);

  const centeredTop = Math.max(insets.top + 24, height * 0.2);
  const occludedBottom = Math.max(0, height - centeredTop);
  const sheetMaxHeight = Math.max(280, height - centeredTop - Math.max(insets.bottom, 12));

  const profileRows = useMemo(
    () => [
      { key: 'name', label: 'Nome', value: draftName, setter: setDraftName, keyboardType: 'default' },
      { key: 'phone', label: 'Telefone', value: draftPhone, setter: setDraftPhone, keyboardType: 'phone-pad' },
      { key: 'email', label: 'Email', value: draftEmail, setter: setDraftEmail, keyboardType: 'email-address' },
      { key: 'preference', label: 'Preferência', value: draftPreference, setter: setDraftPreference, keyboardType: 'default' }
    ],
    [draftEmail, draftName, draftPhone, draftPreference]
  );

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototypeMenu');
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-menu-detail',
    occludedTop: centeredTop,
    occludedBottom: Math.max(occludedBottom, cardHeight)
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleSaveProfile = useCallback(() => {
    updateRiderProfile({
      name: draftName,
      phone: draftPhone,
      email: draftEmail,
      preference: draftPreference
    });
    Alert.alert('Perfil atualizado', 'As informações foram salvas no protótipo.');
  }, [draftEmail, draftName, draftPhone, draftPreference, updateRiderProfile]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.centerWrap, { top: centeredTop }]}>
          <PrototypeCard onLayout={handleCardLayout} style={[styles.detailCard, { maxHeight: sheetMaxHeight }]}>
            <CardHandle />
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {isEditProfile ? (
                <View style={styles.formWrap}>
                  {profileRows.map((field, index) => (
                    <View key={field.key} style={[styles.fieldRow, index === profileRows.length - 1 && styles.fieldRowLast]}>
                      <Text style={styles.fieldLabel}>{field.label}</Text>
                      <TextInput
                        value={field.value}
                        onChangeText={field.setter}
                        style={styles.fieldInput}
                        placeholder={field.label}
                        placeholderTextColor={color.text.muted}
                        autoCapitalize={field.key === 'email' ? 'none' : 'words'}
                        keyboardType={field.keyboardType}
                      />
                    </View>
                  ))}

                  <PrototypePrimaryButton
                    label="Salvar alterações"
                    icon="checkmark-outline"
                    onPress={handleSaveProfile}
                    style={styles.saveButton}
                  />
                </View>
              ) : sections.length > 0 ? (
                <View style={styles.listWrap}>
                  {sections.map((section, index) => (
                    <View key={`${section.label}-${index}`} style={[styles.rowItem, index === sections.length - 1 && styles.rowItemLast]}>
                      <View style={styles.rowIconWrap}>
                        <Ionicons name="ellipse" size={8} color={color.accent.strong} />
                      </View>
                      <View style={styles.rowTextWrap}>
                        <Text style={styles.rowLabel}>{section.label}</Text>
                        <Text style={styles.rowValue}>{section.value}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.listWrap}>
                  <View style={styles.rowItem}>
                    <View style={styles.rowIconWrap}>
                      <Ionicons name="information-circle-outline" size={16} color={color.text.dark} />
                    </View>
                    <View style={styles.rowTextWrap}>
                      <Text style={styles.rowValue}>Essa seção usa a tela dedicada de configurações.</Text>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity style={styles.backButton} activeOpacity={0.86} onPress={handleDismiss}>
              <Ionicons name="arrow-back" size={16} color={color.text.primary} />
              <Text style={styles.backButtonText}>Voltar</Text>
            </TouchableOpacity>
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
  centerWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  detailCard: {
    zIndex: 22,
    backgroundColor: color.surface.primary,
    borderColor: color.border.strong,
    shadowColor: '#0F1723',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 11,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    color: color.text.dark,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  subtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  scroll: {
    marginTop: 10
  },
  scrollContent: {
    paddingBottom: 8
  },
  formWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator
  },
  fieldRow: {
    minHeight: 60,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  fieldRowLast: {
    borderBottomWidth: 0
  },
  fieldLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  fieldInput: {
    marginTop: 4,
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    color: color.text.dark,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  saveButton: {
    marginTop: 10
  },
  listWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator
  },
  rowItem: {
    minHeight: 54,
    paddingHorizontal: 4,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  rowItemLast: {
    borderBottomWidth: 0
  },
  rowIconWrap: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowTextWrap: {
    flex: 1,
    marginLeft: 8
  },
  rowLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  rowValue: {
    marginTop: 1,
    color: color.text.dark,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  backButton: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6
  },
  backButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
