import robotaxiPrototypeTokens from '../../design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, typography, elevation } = robotaxiPrototypeTokens;

export const onboardingTheme = {
  color: {
    background: '#ECEFF2',
    surface: '#FFFFFF',
    surfaceMuted: 'rgba(255,255,255,0.78)',
    panel: 'rgba(255,255,255,0.76)',
    panelSoft: 'rgba(255,255,255,0.64)',
    border: 'rgba(15,23,34,0.10)',
    borderStrong: 'rgba(15,23,34,0.18)',
    glassStroke: 'rgba(255,255,255,0.86)',
    glassStrokeSoft: 'rgba(255,255,255,0.66)',
    textPrimary: '#0F1722',
    textSecondary: '#4D5868',
    textMuted: '#8D99A8',
    accent: '#0F1722',
    accentSoft: '#E7ECF1',
    accentText: '#FFFFFF',
    error: '#B53A3A'
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
    soft: elevation.soft,
    panel: elevation.panel
  }
};

export default onboardingTheme;
