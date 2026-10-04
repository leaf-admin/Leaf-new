import { Platform } from 'react-native';

// The approved iOS canvas uses SF Pro. Android retains the installed Inter
// family with the same sizes, hierarchy and weights, without a new font asset.
const weights = { regular: '400', light: '300', medium: '500', semiBold: '600', bold: '700' };
const android = { regular: 'Inter-Regular', light: 'Inter-Light', medium: 'Inter-Medium', semiBold: 'Inter-SemiBold', bold: 'Inter-Bold' };
const leafTypography = Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key,
  Platform.OS === 'ios' ? { fontFamily: 'System', fontWeight: weight } : { fontFamily: android[key] },
]));

export default leafTypography;
