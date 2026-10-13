import { CommonActions, StackActions } from '@react-navigation/native';
import { navigateLeafRootTab } from '../src/navigation/leafRootTabNavigation';

function buildNavigation(routes, index = routes.length - 1) {
  return {
    getState: () => ({ index, routes }),
    dispatch: jest.fn(),
    navigate: jest.fn(),
  };
}

describe('navigateLeafRootTab', () => {
  it('opens another tab on top of the home instead of jumping back to an old copy below it', () => {
    const navigation = buildNavigation([
      { name: 'Map', key: 'map-1' },
      { name: 'RobotaxiMenuTripHistory', key: 'history-old' },
      { name: 'RobotaxiPrototype', key: 'home-1' },
    ]);

    navigateLeafRootTab(navigation, 'activity', { rootTab: true });

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(navigation.dispatch).toHaveBeenCalledWith(
      StackActions.push('RobotaxiMenuTripHistory', { rootTab: true }),
    );
  });

  it('returns to the existing home instance (same key) so its map stays mounted', () => {
    const navigation = buildNavigation([
      { name: 'Map', key: 'map-1' },
      { name: 'RobotaxiPrototype', key: 'home-1' },
      { name: 'RobotaxiMenuTripHistory', key: 'history-1' },
    ]);

    navigateLeafRootTab(navigation, 'home');

    expect(navigation.navigate).toHaveBeenCalledWith({ name: 'RobotaxiPrototype', key: 'home-1' });
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  it('swaps tab for tab instead of stacking them', () => {
    const navigation = buildNavigation([
      { name: 'RobotaxiPrototype', key: 'home-1' },
      { name: 'RobotaxiMenuTripHistory', key: 'history-1' },
    ]);

    navigateLeafRootTab(navigation, 'account');

    expect(navigation.dispatch).toHaveBeenCalledWith(StackActions.replace('RobotaxiPrototypeMenu', undefined));
  });

  it('resets to a single home when none is in the stack', () => {
    const navigation = buildNavigation([{ name: 'RobotaxiMenuTripHistory', key: 'history-1' }]);

    navigateLeafRootTab(navigation, 'home');

    expect(navigation.dispatch).toHaveBeenCalledWith(
      CommonActions.reset({ index: 0, routes: [{ name: 'RobotaxiPrototype', params: undefined }] }),
    );
  });

  it('falls back to navigate when the navigator exposes no state', () => {
    const navigation = { navigate: jest.fn() };

    navigateLeafRootTab(navigation, 'activity', { rootTab: true });

    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiMenuTripHistory', { rootTab: true });
  });
});
