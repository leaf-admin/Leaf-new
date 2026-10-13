import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { LeafNativeTabBarProvider, useLeafNativeTabBar } from '../src/components/prototype/LeafNativeTabBar';

function Owner() {
  const native = useLeafNativeTabBar({ active: 'home', focused: true });
  return <View testID={native ? 'native-owner' : 'fallback-owner'} />;
}

it('retains the JS presentation when the platform or binary lacks native tabs', () => {
  const screen = render(<LeafNativeTabBarProvider><Owner /></LeafNativeTabBarProvider>);
  expect(screen.getByTestId('fallback-owner')).toBeTruthy();
  expect(screen.queryByTestId('leaf-native-root-tabs')).toBeNull();
});
