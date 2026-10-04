import React from 'react';
import { Platform, UIManager, requireNativeComponent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// Older installed binaries keep the same readable static presentation until
// rebuilt. No native capability is assumed just because the JS was updated.
const available = Platform.OS === 'ios' && UIManager.getViewManagerConfig('LeafMaterialView');
const NativeMaterial = available ? requireNativeComponent('LeafMaterialView') : null;

export default function LeafMaterialSurface({ children, style, ...props }) {
  if (NativeMaterial) {
    return <NativeMaterial style={style} testID="leaf-material-native" {...props}>{children}</NativeMaterial>;
  }
  const colors = ['rgba(255,255,255,0.96)', 'rgba(240,243,240,0.94)'];
  return <LinearGradient colors={colors} start={{x:0,y:0}} end={{x:1,y:1}} style={style} testID="leaf-material-fallback" {...props}>{children}</LinearGradient>;
}
