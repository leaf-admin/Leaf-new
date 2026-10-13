import { StackActions } from '@react-navigation/native';

export const PROTOTYPE_HOME_ROUTE = 'RobotaxiPrototype';

/**
 * Leaves a ride screen (receipt, rating, cancellation, no drivers, failed
 * payment) for the home.
 *
 * The home is normally still below these screens. Replacing the screen with a
 * new home stacked one more home, with its own map, every time, and the new
 * map opened blank before settling. This goes back to the home already in the
 * stack and hands it the params; a new home is created only when there is none.
 */
export function returnToPrototypeHome(navigation, params) {
  if (!navigation) {
    return false;
  }

  const state = typeof navigation.getState === 'function' ? navigation.getState() : null;
  const routes = Array.isArray(state?.routes) ? state.routes : [];
  const currentIndex = Number.isInteger(state?.index) ? state.index : routes.length - 1;
  let homeBelow = null;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (routes[index]?.name === PROTOTYPE_HOME_ROUTE) {
      homeBelow = routes[index];
      break;
    }
  }

  if (homeBelow && typeof navigation.navigate === 'function') {
    navigation.navigate({
      name: PROTOTYPE_HOME_ROUTE,
      key: homeBelow.key,
      ...(params === undefined ? {} : { params, merge: true }),
    });
    return true;
  }

  if (typeof navigation.replace === 'function') {
    if (params === undefined) {
      navigation.replace(PROTOTYPE_HOME_ROUTE);
    } else {
      navigation.replace(PROTOTYPE_HOME_ROUTE, params);
    }
    return true;
  }

  if (typeof navigation.dispatch === 'function') {
    navigation.dispatch(StackActions.replace(PROTOTYPE_HOME_ROUTE, params));
    return true;
  }

  if (typeof navigation.navigate === 'function') {
    if (params === undefined) {
      navigation.navigate(PROTOTYPE_HOME_ROUTE);
    } else {
      navigation.navigate(PROTOTYPE_HOME_ROUTE, params);
    }
    return true;
  }

  return false;
}

export default returnToPrototypeHome;
