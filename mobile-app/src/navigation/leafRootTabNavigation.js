import { CommonActions, StackActions } from '@react-navigation/native';

// Root tabs (Início / Atividade / Conta) live in one stack navigator. Plain
// `navigate` (React Navigation 6) jumps *back* to a matching route lower in
// the stack, so switching tabs popped the home off the stack and pushed a new
// one on return: the map was destroyed and recreated on every switch (camera
// flash to state level, home state lost). These rules keep a single home at
// the bottom with at most one other tab above it.
const HOME_ROUTE_NAMES = new Set(['RobotaxiPrototype', 'Map']);
const TAB_ROUTE_NAMES = Object.freeze({
  home: 'RobotaxiPrototype',
  activity: 'RobotaxiMenuTripHistory',
  account: 'RobotaxiPrototypeMenu',
});
const NON_HOME_TAB_ROUTE_NAMES = new Set([TAB_ROUTE_NAMES.activity, TAB_ROUTE_NAMES.account]);

export function navigateLeafRootTab(navigation, tab, params) {
  const target = TAB_ROUTE_NAMES[tab];
  if (!navigation || !target) return;

  const state = navigation.getState?.();
  const routes = Array.isArray(state?.routes) ? state.routes : null;
  if (!routes || typeof navigation.dispatch !== 'function') {
    navigation.navigate?.(target, params);
    return;
  }
  const currentIndex = Number.isInteger(state.index) ? state.index : routes.length - 1;
  const current = routes[currentIndex];

  if (tab === 'home') {
    // Return to the existing home instance (keeps its map alive).
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      if (HOME_ROUTE_NAMES.has(routes[index].name)) {
        if (index !== currentIndex) {
          navigation.navigate({ name: routes[index].name, key: routes[index].key });
        }
        return;
      }
    }
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: target, params }] }));
    return;
  }

  if (current?.name === target) return;
  if (current && NON_HOME_TAB_ROUTE_NAMES.has(current.name)) {
    // Tab to tab: swap the top screen instead of stacking tabs.
    navigation.dispatch(StackActions.replace(target, params));
    return;
  }
  // From the home (or a detail screen): open on top, never jump back below it.
  navigation.dispatch(StackActions.push(target, params));
}
