export const robotaxiPrototypeTokens = {
  color: {
    bg: {
      app: '#F8F6F1',
      map: '#F2F4EF',
      panel: 'rgba(255,255,255,0.96)',
      panelSoft: 'rgba(255,255,255,0.92)',
      panelSolid: '#FFFFFF'
    },
    surface: {
      primary: '#FFFFFF',
      secondary: '#F8F6F1',
      tertiary: '#F2F4EF',
      activeSoft: '#F1F5EE',
      activeStrong: '#E7EFE1'
    },
    text: {
      primary: '#171412',
      secondary: '#756F68',
      muted: '#827B73',
      dark: '#171412'
    },
    accent: {
      primary: '#1A330E',
      strong: '#2A4D1D',
      soft: '#56764A',
      contrast: '#FFFFFF'
    },
    feedback: {
      success: '#1A330E',
      warning: '#7A6337',
      danger: '#D7153A'
    },
    border: {
      subtle: '#E9E2D8',
      strong: '#E2DAD0',
      separator: '#E9E2D8'
    },
    shadow: {
      base: '#171412',
      accent: '#1A330E'
    }
  },
  radius: {
    sm: 12,
    md: 18,
    lg: 24,
    xl: 32,
    pill: 999
  },
  spacing: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32
  },
  typography: {
    display: { size: 28, lineHeight: 34 },
    title: { size: 22, lineHeight: 28 },
    subtitle: { size: 18, lineHeight: 24 },
    body: { size: 15, lineHeight: 22 },
    caption: { size: 13, lineHeight: 18 },
    micro: { size: 11, lineHeight: 14 }
  },
  touch: {
    min: 44,
    comfortable: 52,
    large: 64
  },
  elevation: {
    soft: {
      shadowOffset: { width: 0, height: 9 },
      shadowOpacity: 0.14,
      shadowRadius: 20,
      elevation: 8
    },
    panel: {
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.24,
      shadowRadius: 30,
      elevation: 15
    }
  },
  motion: {
    timing: {
      quick: 140,
      standard: 220,
      slow: 320,
      map: 2000
    },
    spring: {
      sheet: {
        damping: 20,
        stiffness: 290,
        mass: 0.9,
        restDisplacementThreshold: 0.3,
        restSpeedThreshold: 0.3
      },
      sheetClose: {
        damping: 24,
        stiffness: 360,
        mass: 0.92,
        overshootClamping: true,
        restDisplacementThreshold: 0.3,
        restSpeedThreshold: 0.3
      }
    },
    bezier: {
      snappy: [0.22, 1, 0.36, 1],
      smoothOut: [0.32, 0.72, 0, 1],
      smoothIn: [0.4, 0, 1, 1]
    }
  }
};

export default robotaxiPrototypeTokens;
