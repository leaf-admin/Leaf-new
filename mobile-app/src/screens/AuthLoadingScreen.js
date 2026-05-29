import React from 'react';
import {
  StyleSheet,
  View,
  Dimensions,
  ActivityIndicator,
  Text,
} from 'react-native';
import { fonts } from '../theme/runtimeTokens';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, spacing, radius } = onboardingTheme;
const { width, height } = Dimensions.get('window');

export default function AuthLoadingScreen(props) {
  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.backgroundCanvas}>
        <View style={[styles.routeLine, styles.routeLineTop]} />
        <View style={[styles.routeLine, styles.routeLineBottom]} />
      </View>

      <View style={styles.loadingCard}>
        <View style={styles.brandMark}>
          <View style={styles.brandLeaf} />
        </View>
        <Text style={styles.title}>Preparando sua experiência</Text>
        <Text style={styles.subtitle}>Só um instante enquanto deixamos tudo pronto.</Text>
        <ActivityIndicator style={styles.spinner} color={color.accent} size="small" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  backgroundCanvas: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  routeLine: {
    position: 'absolute',
    height: 2,
    borderRadius: 2,
    backgroundColor: color.mapLine,
  },
  routeLineTop: {
    width: width * 0.9,
    top: height * 0.22,
    right: -width * 0.22,
    transform: [{ rotate: '-18deg' }],
  },
  routeLineBottom: {
    width: width * 0.98,
    bottom: height * 0.24,
    left: -width * 0.26,
    backgroundColor: color.skyLine,
    transform: [{ rotate: '16deg' }],
  },
  loadingCard: {
    width: '100%',
    maxWidth: 340,
    minHeight: 210,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.08,
    shadowRadius: 34,
    elevation: 8,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  brandLeaf: {
    width: 16,
    height: 22,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    backgroundColor: color.accent,
    transform: [{ rotate: '38deg' }],
  },
  title: {
    color: color.textPrimary,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.sm,
    color: color.textSecondary,
    fontFamily: fonts.Regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  spinner: {
    marginTop: spacing.lg,
  },
});
