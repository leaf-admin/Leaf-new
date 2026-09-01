import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme } from '../../common-local/theme';

// Dark mode is opt-in via runtime flag until every surface adopts the
// dark token set (issue #203 phase 2). With the flag off the app renders
// exactly as before regardless of the system scheme.
const DARK_MODE_ENABLED =
  String(process.env.EXPO_PUBLIC_DARK_MODE_ENABLED || '') === 'true';

export function useThemeScheme() {
  const systemScheme = useColorScheme();
  const scheme = systemScheme === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    isDark: scheme === 'dark',
    darkModeEnabled: DARK_MODE_ENABLED,
  };
}

export function useAppTheme() {
  const { scheme } = useThemeScheme();
  if (!DARK_MODE_ENABLED) {
    return lightTheme;
  }
  return scheme === 'dark' ? darkTheme : lightTheme;
}

export default useAppTheme;
