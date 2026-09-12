import { robotaxiPrototypeTokens } from '../components/design-system/robotaxiPrototypeTokens';

const tokenColor = robotaxiPrototypeTokens.color;
const tokenColorDark = robotaxiPrototypeTokens.colorDark;

// Canonical semantic palette — single source: robotaxiPrototypeTokens.
export const colors = {
  primary: tokenColor.accent.primary,
  background: tokenColor.bg.panelSolid,
  surface: tokenColor.surface.secondary,

  text: {
    primary: tokenColor.text.primary,
    secondary: tokenColor.text.muted,
    disabled: tokenColor.border.strong,
  },

  border: tokenColor.border.subtle,
  transparent: 'transparent',

  // Feedback
  error: tokenColor.feedback.danger,
  success: tokenColor.accent.strong,
  warning: tokenColor.feedback.warning,

  // Brand moment (shared with landing page)
  accentLime: tokenColor.brand.lime,

  // Deprecated legacy aliases — mapped to canonical tokens above.
  // Kept only where still referenced; do not use in new code.
  DULL_RED: tokenColor.feedback.danger,
  BACKGROUND_PRIMARY: tokenColor.bg.app,
  DRIVER_TRIPS_TEXT: tokenColor.text.muted,
  RIDELIST_TEXT: tokenColor.text.muted,
  MAP_TEXT: tokenColor.text.secondary,
  BORDER_TEXT: tokenColor.surface.tertiary,
  ONLINE_CHAT_BACKGROUND: tokenColor.surface.tertiary,
  BUTTON: tokenColor.text.primary,
  BACKGROUND: tokenColor.bg.scrim,
  BORDER_BACKGROUND: tokenColor.border.subtle,
  WALLET_PRIMARY: tokenColor.text.muted,
  PROMO: tokenColor.text.muted,
  GREEN_DOT: tokenColor.feedback.success,
  BALANCE_GREEN: tokenColor.accent.strong,
  BUTTON_YELLOW: tokenColor.accent.primary,
  BUTTON_ORANGE: tokenColor.feedback.warning,
  BOX_BG: tokenColor.brand.lime,
  BUTTON_LOADING: tokenColor.feedback.indicator,
  INDICATOR_BLUE: tokenColor.feedback.indicator,
  RE_GREEN: tokenColor.accent.primary,
  new: tokenColor.surface.tertiary,
  PLACEHOLDER_COLOR: tokenColor.text.muted,
  INPUT_FOCUS: tokenColor.feedback.indicator,
  TAXIPRIMARY: tokenColor.accent.primary,
  TAXISECONDORY: tokenColor.border.subtle,
  TRANSPARENT: 'transparent',
  WHITE: tokenColor.bg.panelSolid,
  BLACK: tokenColor.text.primary,
  RED: tokenColor.feedback.danger,
  GREEN: tokenColor.accent.strong,
  FOOTERTOP: tokenColor.text.muted,
};

export const lightTheme = {
  background: tokenColor.bg.panelSolid,
  card: tokenColor.bg.panelSolid,
  text: '#000000',
  textSecondary: '#666666',
  border: '#E0E0E0',
  icon: '#000000',
  divider: '#E0E0E0',
  inputBg: '#F5F5F5',
  inputBorder: '#E0E0E0',
  placeholder: '#999999',
  dropdown: tokenColor.bg.panelSolid,
  leafGreen: '#41D274'
};

export const darkTheme = {
  // "Leaf Ambient" dark values derived from robotaxiPrototypeTokens.colorDark.
  // Consumed only when the dark-mode opt-in flag is on (see useThemeScheme).
  background: tokenColorDark.bg.app,
  card: tokenColorDark.bg.panelSolid,
  text: tokenColorDark.text.primary,
  textSecondary: tokenColorDark.text.secondary,
  border: tokenColorDark.border.subtle,
  icon: tokenColorDark.text.primary,
  divider: tokenColorDark.border.subtle,
  inputBg: tokenColorDark.surface.tertiary,
  inputBorder: tokenColorDark.border.strong,
  placeholder: tokenColorDark.text.muted,
  dropdown: tokenColorDark.bg.panelSolid,
  leafGreen: tokenColorDark.brand.lime
};

// Hook para usar o tema
export const useTheme = () => {
  // Por enquanto, retorna o tema claro como padrão
  // TODO: Implementar lógica de tema dinâmico baseada no estado do app
  return lightTheme;
};
