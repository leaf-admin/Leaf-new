import React from 'react';
import { Platform, UIManager, requireNativeComponent } from 'react-native';
import LeafGlassSurface, { isLeafGlassAvailable } from '../design-system/LeafGlassSurface';

// Older installed binaries keep the same readable static presentation until
// rebuilt. No native capability is assumed just because the JS was updated.
const available = Platform.OS === 'ios' && UIManager.getViewManagerConfig('LeafMaterialView');
const NativeMaterial = available ? requireNativeComponent('LeafMaterialView') : null;

export default function LeafMaterialSurface({ children, style, ...props }) {
  if (NativeMaterial && !isLeafGlassAvailable()) {
    return <NativeMaterial style={style} testID="leaf-material-native" {...props}>{children}</NativeMaterial>;
  }
  // iOS 26 Liquid Glass / Android blur; solid only where neither exists.
  return <LeafGlassSurface interactive style={style} testID="leaf-material-fallback" {...props}>{children}</LeafGlassSurface>;
}
