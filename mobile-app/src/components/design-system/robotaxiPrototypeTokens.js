export const robotaxiPrototypeTokens = {
  color: {
    bg: {
      app: '#F8F6F1',
      map: '#F2F4EF',
      panel: 'rgba(255,255,255,0.96)',
      panelSoft: 'rgba(255,255,255,0.92)',
      panelSolid: '#FFFFFF',
      scrim: 'rgba(23,20,18,0.8)'
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
      dark: '#102307',
      contrast: '#FFFFFF'
    },
    brand: {
      lime: '#D4E84A'
    },
    feedback: {
      success: '#1A330E',
      warning: '#7A6337',
      danger: '#D7153A',
      dangerSoft: '#FFF1F2',
      dangerBorder: '#F3CDD4',
      indicator: '#007AFF'
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
  // "Leaf Ambient" dark surface — green-black base (not pure black), four
  // elevation levels, warm off-white text. Depth comes from tonal surfaces
  // and borders, not shadows. Accent green stays; lime pops on dark.
  colorDark: {
    bg: {
      app: '#0E1409',
      map: '#0C1208',
      panel: 'rgba(22,29,16,0.96)',
      panelSoft: 'rgba(22,29,16,0.92)',
      panelSolid: '#161D10',
      scrim: 'rgba(5,8,3,0.82)'
    },
    surface: {
      primary: '#161D10',
      secondary: '#0E1409',
      tertiary: '#1F2815',
      activeSoft: '#24301B',
      activeStrong: '#2C3A20'
    },
    text: {
      primary: '#F2F1EC',
      secondary: '#B8B2A8',
      muted: '#8F887C',
      dark: '#F2F1EC'
    },
    accent: {
      primary: '#D4E84A',
      strong: '#E9F5B5',
      soft: '#4A6136',
      dark: '#1A330E',
      contrast: '#0E1409'
    },
    brand: {
      lime: '#D4E84A'
    },
    feedback: {
      success: '#D4E84A',
      warning: '#E3C273',
      danger: '#F0637E',
      dangerSoft: '#2E141B',
      dangerBorder: '#5A2230',
      indicator: '#409CFF'
    },
    border: {
      subtle: '#252E1B',
      strong: '#333F23',
      separator: '#252E1B'
    },
    shadow: {
      base: '#000000',
      accent: '#0E1409'
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
