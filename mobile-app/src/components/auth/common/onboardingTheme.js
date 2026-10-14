import robotaxiPrototypeTokens from '../../design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, typography, elevation } = robotaxiPrototypeTokens;

export const onboardingTheme = {
  color: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#F4F6F2',
    panel: '#FFFFFF',
    panelSoft: '#FFFFFF',
    border: 'rgba(17,33,12,0.10)',
    borderStrong: '#11210C',
    glassStroke: '#E5E5E5',
    glassStrokeSoft: '#F1F2F1',
    textPrimary: '#11210C',
    textSecondary: 'rgba(17,33,12,0.62)',
    textMuted: 'rgba(17,33,12,0.42)',
    accent: '#191B18',
    accentSoft: '#F4F6F2',
    accentText: '#FFFFFF',
    success: '#11210C',
    mapLine: 'rgba(26,51,14,0.10)',
    skyLine: 'rgba(233,226,216,0.65)',
    error: '#B4232F'
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
