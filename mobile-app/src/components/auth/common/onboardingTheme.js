import robotaxiPrototypeTokens from '../../design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, typography, elevation } = robotaxiPrototypeTokens;

export const onboardingTheme = {
  color: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#F5F5F5',
    panel: '#FFFFFF',
    panelSoft: '#FFFFFF',
    border: '#E5E5E5',
    borderStrong: '#1A330E',
    glassStroke: '#E5E5E5',
    glassStrokeSoft: '#F1F2F1',
    textPrimary: '#222222',
    textSecondary: '#6A6A6A',
    textMuted: '#9AA39D',
    accent: '#252525',
    accentSoft: '#F5F5F5',
    accentText: '#FFFFFF',
    success: '#1A330E',
    mapLine: 'rgba(26,51,14,0.10)',
    skyLine: 'rgba(233,226,216,0.65)',
    error: '#9A3B35'
  },
  radius: {
    sm: radius.sm,
    md: radius.md,
    lg: radius.lg,
    xl: radius.xl,
    pill: radius.pill
  },
  spacing: {
    xs: spacing.xs,
    sm: spacing.sm,
    md: spacing.md,
    lg: spacing.lg,
    xl: spacing.xl,
    xxl: spacing.xxl
  },
  typography: {
    title: typography.title,
    subtitle: typography.subtitle,
    body: typography.body,
    caption: typography.caption
  },
  elevation: {
    soft: {
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.10,
      shadowRadius: 28,
      elevation: 7
    },
    panel: {
      shadowOffset: { width: 0, height: 24 },
      shadowOpacity: 0.12,
      shadowRadius: 44,
      elevation: 12
    }
  }
};

export default onboardingTheme;
