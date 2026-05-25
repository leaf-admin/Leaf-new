import robotaxiPrototypeTokens from '../../design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, typography, elevation } = robotaxiPrototypeTokens;

export const onboardingTheme = {
  color: {
    background: '#F0F3EF',
    surface: '#FFFFFF',
    surfaceMuted: 'rgba(255,255,255,0.90)',
    panel: 'rgba(255,255,255,0.74)',
    panelSoft: 'rgba(255,255,255,0.84)',
    border: 'rgba(17,23,25,0.08)',
    borderStrong: 'rgba(23,58,34,0.18)',
    glassStroke: 'rgba(255,255,255,0.88)',
    glassStrokeSoft: 'rgba(255,255,255,0.72)',
    textPrimary: '#111719',
    textSecondary: '#64706A',
    textMuted: '#9AA39D',
    accent: '#173A22',
    accentSoft: '#E8EFE7',
    accentText: '#FFFFFF',
    success: '#173A22',
    mapLine: 'rgba(126,161,107,0.20)',
    skyLine: 'rgba(220,235,240,0.70)',
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
