import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

// A still copy of the native splash (same green, same 288 dp logo, same
// position). Launch passes through native splash -> auth -> home loading;
// keeping every stage pixel-identical makes them read as one screen. No pulse
// and no greeting text: either one restarting is what looked like the splash
// showing three times. The greeting stays as the screen-reader label.
export const LEAF_SPLASH_GREEN = '#003002';
const LOGO = require('../../../assets/images/splash_android_icon.png');

export default function LeafBootSplash({ title, testID, accessibilityLabel, style }) {
  return (
    <View
      style={[styles.container, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel || title || 'Carregando'}
    >
      <Image source={LOGO} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: LEAF_SPLASH_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 288,
    height: 288,
  },
});
