import robotaxiPrototypeTokens from '../../design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, typography, elevation } = robotaxiPrototypeTokens;

export const onboardingTheme = {
  color: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#FCFBF9',
    panel: '#FFFFFF',
    panelSoft: '#FFFFFF',
    border: '#E9E2D8',
    borderStrong: '#1A330E',
    glassStroke: '#E9E2D8',
    glassStrokeSoft: '#F1ECE5',
    textPrimary: '#171412',
    textSecondary: '#756F68',
    textMuted: '#9AA39D',
    accent: '#1A330E',
    accentSoft: '#EEF3EC',
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
