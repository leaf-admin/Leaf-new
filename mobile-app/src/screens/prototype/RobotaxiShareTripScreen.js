import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import LeafTouchable from '../../components/design-system/LeafTouchable';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { requestTripShareLink } from '../../services/tripShareLinkService';
import {
  MAX_TRUSTED_CONTACTS,
  addTrustedContact,
  buildTrustedContactMessage,
  buildWhatsAppUrl,
  formatBrazilPhone,
  loadTrustedContacts,
  removeTrustedContact,
} from '../../services/trustedContactsStore';

const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
// Só a corrida em andamento tem link: o backend recusa corrida encerrada.
function resolveBookingId(route, runtime) {
  return (
    route?.params?.bookingId ||
    route?.params?.tripId ||
    runtime.activeBookingId ||
    runtime.activeBooking?.bookingId ||
    runtime.activeBooking?.id ||
    ''
  );
}

const SHARE_LINK_ERRORS = {
  NO_ACTIVE_RIDE: 'O link fica disponível durante uma corrida.',
  BOOKING_ENDED: 'Esta corrida já terminou. O link só funciona durante a viagem.',
};

function resolveDriver(runtime, route) {
  const driver = runtime.driverInfo || {};
  const booking = runtime.activeBooking || {};
  return {
    name: route?.params?.driverName || driver.name || booking.driverName || 'Motorista Leaf',
    vehicle:
      route?.params?.vehicleModel ||
      driver.vehicleModel ||
      booking.vehicleModel ||
      runtime.selectedVehicle ||
      'Leaf Plus',
    plate:
      route?.params?.vehiclePlate ||
      driver.vehiclePlate ||
      booking.vehiclePlate ||
      booking.plate ||
      '',
  };
}

export default function RobotaxiShareTripScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [copied, setCopied] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const runtime = usePrototypeRideRuntime();

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-share-trip',
    occludedBottom: panelHeight,
  });

  const bookingId = useMemo(() => resolveBookingId(route, runtime), [route, runtime]);
  const [publicLink, setPublicLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const [contacts, setContacts] = useState([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [contactError, setContactError] = useState('');
  const [showContactForm, setShowContactForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPublicLink('');
    setLinkError('');
    requestTripShareLink(bookingId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPublicLink(result.url);
      } else {
        setLinkError(SHARE_LINK_ERRORS[result.code] || 'Não foi possível gerar o link agora. Tente de novo em instantes.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  useEffect(() => {
    let cancelled = false;
    loadTrustedContacts().then((list) => {
      if (!cancelled) setContacts(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const driver = useMemo(() => resolveDriver(runtime, route), [route, runtime]);
  const destination =
    route?.params?.destination ||
    runtime.selectedDestination?.name ||
    runtime.selectedDestination?.address ||
    'Destino da viagem';
  const shareMessage = useMemo(
    () =>
      `Acompanhe minha viagem Leaf em tempo real: ${publicLink}\nDestino: ${destination}`,
    [destination, publicLink],
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

  const handleCopy = useCallback(async () => {
    if (!publicLink) return;
    await Clipboard.setStringAsync(publicLink);
    setCopied(true);
  }, [publicLink]);

  const handleNativeShare = useCallback(async () => {
    try {
      await Share.share({ message: shareMessage, url: publicLink });
    } catch (error) {
      Alert.alert('Não foi possível compartilhar', error?.message || 'Tente novamente em instantes.');
    }
  }, [publicLink, shareMessage]);

  const handleWhatsApp = useCallback(async () => {
    const encoded = encodeURIComponent(shareMessage);
    const whatsappUrl = `whatsapp://send?text=${encoded}`;
    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
        return;
      }
      await Share.share({ message: shareMessage, url: publicLink });
    } catch (error) {
      Alert.alert('Não foi possível abrir o WhatsApp', error?.message || 'Use copiar link por enquanto.');
    }
  }, [publicLink, shareMessage]);

  // Abre a mesma página que a pessoa vai ver.
  const handlePreview = useCallback(() => {
    if (!publicLink) return;
    Linking.openURL(publicLink).catch(() => null);
  }, [publicLink]);

  const handleSendToContact = useCallback(async (contact) => {
    if (!publicLink) return;
    const message = buildTrustedContactMessage({ contactName: contact.name, shareUrl: publicLink, destination });
    try {
      await Linking.openURL(buildWhatsAppUrl({ phone: contact.phone, message }));
    } catch (error) {
      await Share.share({ message }).catch(() => null);
    }
  }, [destination, publicLink]);

  const handleAddContact = useCallback(async () => {
    const result = await addTrustedContact({ name: newContactName, phone: newContactPhone });
    if (!result.ok) {
      setContactError(result.error);
      return;
    }
    setContacts(result.contacts);
    setNewContactName('');
    setNewContactPhone('');
    setContactError('');
    setShowContactForm(false);
  }, [newContactName, newContactPhone]);

  const handleRemoveContact = useCallback((contact) => {
    Alert.alert('Remover contato?', `${contact.name} sai da sua lista de contatos de confiança.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => setContacts(await removeTrustedContact(contact.phone)),
      },
    ]);
  }, []);

  return (
    <PrototypeScreenTransition direction="up">
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-share-trip-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Compartilhar"
            title="Acompanhar viagem"
            subtitle="Quem recebe o link vê o carro, a placa e a posição até o fim da viagem, sem precisar do app."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-share-trip-close-button"
                accessibilityLabel="Fechar compartilhamento da viagem"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <View style={styles.linkCard}>
                <Text style={styles.linkLabel}>Link da viagem</Text>
                <Text style={styles.linkText} numberOfLines={2}>
                  {publicLink || linkError || 'Gerando link…'}
                </Text>
              </View>

              <View style={styles.primaryActionBlock}>
                <LeafButton
                  label={copied ? 'Copiado' : 'Copiar link'}
                  icon={copied ? 'checkmark-outline' : 'copy-outline'}
                  tone="primary"
                  onPress={handleCopy}
                  disabled={!publicLink}
                  style={styles.primaryActionButton}
                  testID="robotaxi-share-copy-link"
                  accessibilityLabel={copied ? 'Link da viagem copiado' : 'Copiar link da viagem'}
                />
                <LeafButton
                  label={showMoreActions ? 'Ocultar opções' : 'Mais opções'}
                  icon={showMoreActions ? 'chevron-up-outline' : 'ellipsis-horizontal'}
                  tone="ghost"
                  onPress={() => setShowMoreActions(value => !value)}
                  style={styles.moreActionsButton}
                  testID="robotaxi-share-more-actions"
                  accessibilityLabel={showMoreActions ? 'Ocultar opções de compartilhamento' : 'Mais opções de compartilhamento'}
                />
              </View>

              {showMoreActions ? (
                <View
                  style={styles.actionGrid}
                  testID="robotaxi-share-secondary-actions"
                >
                <LeafButton
                  label="WhatsApp"
                  icon="logo-whatsapp"
                  tone="leaf"
                  onPress={handleWhatsApp}
                  style={styles.actionButton}
                  testID="robotaxi-share-whatsapp"
                  accessibilityLabel="Compartilhar link pelo WhatsApp"
                />
                <LeafButton
                  label="Enviar"
                  icon="share-outline"
                  tone="ghost"
                  onPress={handleNativeShare}
                  style={styles.actionButton}
                  testID="robotaxi-share-native"
                  accessibilityLabel="Compartilhar link da viagem"
                />
                <LeafButton
                  label="Prévia"
                  icon="eye-outline"
                  tone="ghost"
                  onPress={handlePreview}
                  style={styles.actionButton}
                  testID="robotaxi-share-preview"
                  accessibilityLabel="Visualizar prévia do link da viagem"
                />
                </View>
              ) : null}

              <PrototypeMenuSection title="Contatos de confiança">
                {contacts.length === 0 ? (
                  <Text style={styles.contactHint}>
                    Salve até {MAX_TRUSTED_CONTACTS} pessoas para mandar o link com um toque. Os números ficam só neste celular.
                  </Text>
                ) : null}
                {contacts.map((contact) => (
                  <View key={contact.phone} style={styles.contactRow}>
                    <View style={styles.contactInfo}>
                      <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
                      <Text style={styles.contactPhone}>{formatBrazilPhone(contact.phone)}</Text>
                    </View>
                    <LeafButton
                      label="Enviar"
                      icon="logo-whatsapp"
                      tone="leaf"
                      onPress={() => handleSendToContact(contact)}
                      disabled={!publicLink}
                      style={styles.contactSendButton}
                      testID={`robotaxi-share-contact-send-${contact.phone}`}
                      accessibilityLabel={`Enviar o link da viagem para ${contact.name} pelo WhatsApp`}
                    />
                    <LeafButton
                      label=""
                      icon="close-outline"
                      tone="ghost"
                      onPress={() => handleRemoveContact(contact)}
                      style={styles.contactRemoveButton}
                      accessibilityLabel={`Remover ${contact.name} dos contatos de confiança`}
                    />
                  </View>
                ))}
                {showContactForm ? (
                  <View style={styles.contactForm}>
                    <TextInput
                      value={newContactName}
                      onChangeText={setNewContactName}
                      placeholder="Nome"
                      placeholderTextColor={leafRideColors.secondary}
                      style={styles.contactInput}
                      maxLength={40}
                      autoCapitalize="words"
                      testID="robotaxi-share-contact-name"
                    />
                    <TextInput
                      value={newContactPhone}
                      onChangeText={setNewContactPhone}
                      placeholder="Celular com DDD"
                      placeholderTextColor={leafRideColors.secondary}
                      style={styles.contactInput}
                      keyboardType="phone-pad"
                      maxLength={20}
                      testID="robotaxi-share-contact-phone"
                    />
                    {contactError ? <Text style={styles.contactError}>{contactError}</Text> : null}
                    <LeafButton
                      label="Salvar contato"
                      icon="checkmark-outline"
                      tone="primary"
                      onPress={handleAddContact}
                      style={styles.primaryActionButton}
                      testID="robotaxi-share-contact-save"
                    />
                  </View>
                ) : contacts.length < MAX_TRUSTED_CONTACTS ? (
                  <LeafButton
                    label="Adicionar contato"
                    icon="person-add-outline"
                    tone="ghost"
                    onPress={() => setShowContactForm(true)}
                    style={styles.primaryActionButton}
                    testID="robotaxi-share-contact-add"
                  />
                ) : null}
              </PrototypeMenuSection>

              <PrototypeMenuSection title="O que aparece para a pessoa">
                <PrototypeMenuInfoRow label="Destino" value={destination} />
                <PrototypeMenuInfoRow label="Motorista" value={String(driver.name || '').split(' ')[0]} />
                <PrototypeMenuInfoRow label="Veículo" value={driver.plate ? `${driver.vehicle} · ${driver.plate}` : driver.vehicle} last />
              </PrototypeMenuSection>

              <Text style={styles.contactHint}>
                O link mostra a posição do carro e expira quando a viagem termina. Não mostra o seu endereço de embarque.
              </Text>
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
  linkCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 0,
    paddingVertical: 16,
  },
  linkLabel: {
    color: leafRideColors.secondary,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  linkText: {
    marginTop: 6,
    color: leafRideColors.text,
    ...leafTypography.semiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  primaryActionBlock: {
    gap: 10,
  },
  primaryActionButton: {
    width: '100%',
  },
  moreActionsButton: {
    width: '100%',
  },
  actionGrid: {
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    width: '48%',
    minWidth: 142,
  },
  contactHint: {
    color: leafRideColors.secondary,
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
  },
  contactInfo: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    color: leafRideColors.text,
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  contactPhone: {
    color: leafRideColors.secondary,
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  contactSendButton: {
    minWidth: 104,
  },
  contactRemoveButton: {
    width: 44,
    minWidth: 44,
  },
  contactForm: {
    gap: 10,
    paddingTop: 6,
  },
  contactInput: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9D9D9',
    paddingHorizontal: 14,
    color: leafRideColors.text,
    ...leafTypography.medium,
    fontSize: 15,
  },
  contactError: {
    color: '#B42318',
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
  },
});
