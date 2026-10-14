import React from 'react';
import { render, act } from '@testing-library/react-native';
import HomeRouteRedirectScreen from '../src/navigation/HomeRouteRedirectScreen';

function renderWith(routes) {
  const navigation = {
    getState: () => ({ index: routes.length - 1, routes }),
    navigate: jest.fn(),
    replace: jest.fn(),
  };
  jest.useFakeTimers();
  render(<HomeRouteRedirectScreen navigation={navigation} route={{ params: { from: 'onboarding' } }} />);
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  return navigation;
}

describe('HomeRouteRedirectScreen ("Map" legacy alias)', () => {
  it('goes back to the home already in the stack instead of creating a second one', () => {
    const navigation = renderWith([
      { name: 'RobotaxiPrototype', key: 'home-1' },
      { name: 'Map', key: 'map-1' },
    ]);
    expect(navigation.navigate).toHaveBeenCalledWith({
      name: 'RobotaxiPrototype',
      key: 'home-1',
      params: { from: 'onboarding' },
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('replaces itself with the home when there is none', () => {
    const navigation = renderWith([{ name: 'Map', key: 'map-1' }]);
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype', { from: 'onboarding' });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
