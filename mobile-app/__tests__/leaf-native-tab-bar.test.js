import React from 'react';
import { View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { LeafNativeTabBarProvider, useLeafNativeTabBar } from '../src/components/prototype/LeafNativeTabBar';

jest.mock('react-native', () => {
  const React = require('react');
  const actual = jest.requireActual('react-native');
  return Object.defineProperties(Object.create(actual), {
    Platform: { value: { ...actual.Platform, OS: 'ios' } },
    UIManager: { value: { getViewManagerConfig: () => ({}) } },
    requireNativeComponent: { value: () => React.forwardRef((props, ref) => <actual.View {...props} ref={ref} />) },
  });
});

function Owner({ active = 'home', focused = true, home, activity, account, settings }) {
  const native = useLeafNativeTabBar({ active, focused, onPressHome: home, onPressActivity: activity, onPressProfile: account, onPressSettings: settings });
  return <View testID={native ? 'native-owner' : 'fallback-owner'} />;
}
function Surface({ visible = true, ...props }) {
  return <LeafNativeTabBarProvider>{visible ? <Owner {...props} /> : null}</LeafNativeTabBarProvider>;
}

describe('Leaf native root tabs', () => {
  it('keeps the same native instance while selection follows RN routes', () => {
    const screen = render(<Surface />);
    const native = screen.getByTestId('leaf-native-root-tabs');
    expect(native.props.tabsVisible).toBe(true);
    expect(native.props.selectedTab).toBe(0);
    screen.rerender(<Surface active="activity" />);
    expect(screen.getByTestId('leaf-native-root-tabs')).toBe(native);
    expect(native.props.selectedTab).toBe(1);
    screen.rerender(<Surface active="account" />);
    expect(native.props.selectedTab).toBe(2);
  });

  it('dispatches each native selection to the existing RN callback', () => {
    const home = jest.fn(), activity = jest.fn(), account = jest.fn();
    const screen = render(<Surface home={home} activity={activity} account={account} />);
    const native = screen.getByTestId('leaf-native-root-tabs');
    [0, 1, 2].forEach(selectedTab => fireEvent(native, 'tabPress', { nativeEvent: { selectedTab } }));
    expect(home).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledTimes(1);
    expect(account).toHaveBeenCalledTimes(1);
  });

  it('uses refreshed callbacks without rebuilding the native tab bar', () => {
    const previous = jest.fn(), next = jest.fn();
    const screen = render(<Surface account={previous} />);
    screen.rerender(<Surface account={next} />);
    fireEvent(screen.getByTestId('leaf-native-root-tabs'), 'tabPress', { nativeEvent: { selectedTab: 2 } });
    expect(previous).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('hides the retained bar and ignores events outside a root surface', () => {
    const home = jest.fn();
    const screen = render(<Surface home={home} />);
    const native = screen.getByTestId('leaf-native-root-tabs');
    screen.rerender(<Surface visible={false} />);
    expect(screen.getByTestId('leaf-native-root-tabs')).toBe(native);
    expect(native.props.tabsVisible).toBe(false);
    fireEvent(native, 'tabPress', { nativeEvent: { selectedTab: 0 } });
    expect(home).not.toHaveBeenCalled();
  });

  it('does not let cleanup of an old screen hide the current root owner', () => {
    const screen = render(<LeafNativeTabBarProvider><Owner key="old" /><Owner key="new" active="account" /></LeafNativeTabBarProvider>);
    screen.rerender(<LeafNativeTabBarProvider><Owner key="new" active="account" /></LeafNativeTabBarProvider>);
    expect(screen.getByTestId('leaf-native-root-tabs').props.tabsVisible).toBe(true);
    expect(screen.getByTestId('leaf-native-root-tabs').props.selectedTab).toBe(2);
  });

  it('keeps the activity fallback callback and rejects invalid native indexes', () => {
    const settings = jest.fn();
    const screen = render(<Surface settings={settings} focused={false} />);
    expect(screen.getByTestId('leaf-native-root-tabs').props.tabsVisible).toBe(false);
    screen.rerender(<Surface settings={settings} />);
    const native = screen.getByTestId('leaf-native-root-tabs');
    [-1, 3, undefined].forEach(selectedTab => fireEvent(native, 'tabPress', { nativeEvent: { selectedTab } }));
    expect(settings).not.toHaveBeenCalled();
    fireEvent(native, 'tabPress', { nativeEvent: { selectedTab: 1 } });
    expect(settings).toHaveBeenCalledTimes(1);
  });
});
