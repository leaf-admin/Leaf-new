import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ONB } from '../../components/onboarding/onboardingKit';
import {
  NAVIGATION_APP_LABELS,
  choosePreferredNavigationApp,
  getPreferredNavigationApp,
} from '../../services/driverNavigationPreference';
import {
  getRideOverlayStatus,
  isRideOverlayAvailable,
  openRideOverlaySettings,
} from '../../services/LeafRideOverlay';

// Ajustes do aparelho que o motorista faz uma vez no cadastro: o app de navegação (a rota
// abre direto nele quando a corrida começa) e, no Android, o card de corrida por cima de
// outros apps (como Uber e 99). Ficam no aparelho; não passam pela análise da Leaf.
export default function DriverAppSetupSection() {
  const [navApp, setNavApp] = useState(null);
  const [overlay, setOverlay] = useState(null);

  const refresh = useCallback(async () => {
    setNavApp(await getPreferredNavigationApp());
    if (isRideOverlayAvailable()) {
      const status = await getRideOverlayStatus();
      setOverlay(status.overlaySupported ? Boolean(status.canDrawOverlays) : null);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    // Volta das configurações do Android: atualiza o "Ativado".
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [refresh]);

  const chooseNavApp = useCallback(async () => {
    const chosen = await choosePreferredNavigationApp();
    if (chosen !== undefined) setNavApp(chosen);
  }, []);

  const rows = [
    {
      key: 'navigation',
      title: 'App de navegação',
      subtitle: navApp
        ? `${NAVIGATION_APP_LABELS[navApp]}. A rota abre nele quando a corrida começa.`
        : 'Escolha Waze ou Google Maps. A rota abre direto nele.',
      done: Boolean(navApp),
      actionLabel: navApp ? 'Trocar' : 'Escolher',
      onPress: chooseNavApp,
    },
    ...(Platform.OS === 'android' && overlay !== null ? [{
      key: 'overlay',
      title: 'Corridas por cima de outros apps',
      subtitle: overlay
        ? 'Ativado. Novas corridas aparecem mesmo com o Waze ou o Maps aberto.'
        : 'Ative "Sobrepor a outros apps" para ver novas corridas enquanto navega.',
      done: overlay,
      actionLabel: overlay ? 'Ativado' : 'Ativar',
      onPress: overlay ? null : () => openRideOverlaySettings(),
    }] : []),
  ];

  return (
    <View style={styles.section} testID="driver-app-setup">
      <Text style={styles.heading}>Prepare o app</Text>
      {rows.map((row) => (
        <TouchableOpacity
          key={row.key}
          activeOpacity={0.78}
          disabled={!row.onPress}
          onPress={row.onPress || undefined}
          style={styles.row}
          accessibilityRole={row.onPress ? 'button' : 'text'}
          accessibilityLabel={`${row.title}. ${row.subtitle}`}
          testID={`driver-app-setup-${row.key}`}
        >
          <View style={[styles.node, row.done && styles.nodeDone]}>
            <Ionicons name={row.done ? 'checkmark' : 'ellipse-outline'} size={13} color={row.done ? '#FFFFFF' : ONB.inkMuted} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>{row.title}</Text>
            <Text style={styles.subtitle}>{row.subtitle}</Text>
          </View>
          {row.onPress ? (
            <View style={[styles.pill, row.done && styles.pillSoft]}>
              <Text style={[styles.pillText, row.done && styles.pillTextSoft]}>{row.actionLabel}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24 },
  heading: { ...leafTypography.semiBold, fontSize: 14, color: ONB.inkSoft, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  node: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: ONB.inkMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDone: { backgroundColor: ONB.ink, borderColor: ONB.ink },
  copy: { flex: 1 },
  title: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: ONB.ink },
  subtitle: { ...leafTypography.regular, fontSize: 13.5, lineHeight: 19, color: ONB.inkSoft, marginTop: 2 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: ONB.action },
  pillSoft: { backgroundColor: '#EEF4EA' },
  pillText: { ...leafTypography.semiBold, fontSize: 13, color: '#FFFFFF' },
  pillTextSoft: { color: ONB.ink },
});
