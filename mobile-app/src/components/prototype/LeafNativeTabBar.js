import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, UIManager, View, requireNativeComponent } from 'react-native';

// A tab nativa do iOS usava os ícones 3D. A mesma tab flutuante em JS vale para os dois
// sistemas agora (2026-10-14); a nativa fica desligada até ser redesenhada.
// `global.__LEAF_NATIVE_IOS_TABS__` só existe nos testes da versão nativa.
const USE_NATIVE_IOS_TABS = global.__LEAF_NATIVE_IOS_TABS__ === true;
const nativeAvailable = USE_NATIVE_IOS_TABS && Platform.OS === 'ios' && UIManager.getViewManagerConfig('LeafRootTabView');
const NativeTabs = nativeAvailable ? requireNativeComponent('LeafRootTabView') : null;
const TabBarContext = createContext(null);
const tabKeys = ['home', 'activity', 'account'];

// One native TabView survives root route changes. Each visible RN surface owns
// visibility and supplies its existing navigation callbacks; Swift owns chrome.
export function LeafNativeTabBarProvider({ children }) {
  const current = useRef(null);
  const [presentation, setPresentation] = useState({ active: 'home', visible: false });
  const register = useCallback((owner, active, handlers) => {
    current.current = { owner, handlers };
    setPresentation(previous => previous.visible && previous.active === active
      ? previous : { active, visible: true });
  }, []);
  const unregister = useCallback(owner => {
    if (current.current?.owner !== owner) return;
    current.current = null;
    setPresentation(previous => previous.visible ? { ...previous, visible: false } : previous);
  }, []);
  const context = useMemo(() => NativeTabs ? { register, unregister } : null, [register, unregister]);
  const handleTabPress = useCallback(event => {
    const key = tabKeys[event.nativeEvent?.selectedTab];
    if (!key || !current.current) return;
    current.current.handlers.current[key]?.();
  }, []);

  return (
    <TabBarContext.Provider value={context}>
      <View style={styles.root}>
        {children}
        {NativeTabs ? <NativeTabs style={styles.tabs} pointerEvents="box-none"
          selectedTab={Math.max(0, tabKeys.indexOf(presentation.active))}
          tabsVisible={presentation.visible} onTabPress={handleTabPress}
          testID="leaf-native-root-tabs" /> : null}
      </View>
    </TabBarContext.Provider>
  );
}

export function useLeafNativeTabBar({ active, focused, onPressHome, onPressActivity, onPressProfile, onPressSettings }) {
  const context = useContext(TabBarContext);
  const owner = useRef(Symbol('leaf-root-tab-owner'));
  const handlers = useRef({});
  useLayoutEffect(() => {
    handlers.current = { home: onPressHome, activity: onPressActivity || onPressSettings, account: onPressProfile };
  });
  useLayoutEffect(() => {
    if (!context || !focused) return undefined;
    context.register(owner.current, active, handlers);
    const registeredOwner = owner.current;
    return () => context.unregister(registeredOwner);
  }, [context, active, focused]);
  return Boolean(context);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { ...StyleSheet.absoluteFillObject, zIndex: 30 },
});
