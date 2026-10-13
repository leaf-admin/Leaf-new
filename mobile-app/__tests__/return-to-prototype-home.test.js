import { returnToPrototypeHome } from '../src/navigation/returnToPrototypeHome';

function createNavigation(routeNames, index = routeNames.length - 1) {
  return {
    getState: jest.fn(() => ({
      index,
      routes: routeNames.map((name, position) => ({ name, key: `${name}-${position}` })),
    })),
    navigate: jest.fn(),
    replace: jest.fn(),
    dispatch: jest.fn(),
  };
}

describe('returnToPrototypeHome', () => {
  it('goes back to the home already in the stack instead of creating another', () => {
    const navigation = createNavigation(['RobotaxiPrototype', 'RobotaxiPrototypeReceipt']);

    returnToPrototypeHome(navigation);

    expect(navigation.navigate).toHaveBeenCalledWith({ name: 'RobotaxiPrototype', key: 'RobotaxiPrototype-0' });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('hands params to the existing home', () => {
    const navigation = createNavigation(['RobotaxiPrototype', 'RobotaxiPrototypeRating']);
    const params = { resetPassengerHomeSearch: true };

    returnToPrototypeHome(navigation, params);

    expect(navigation.navigate).toHaveBeenCalledWith({
      name: 'RobotaxiPrototype',
      key: 'RobotaxiPrototype-0',
      params,
      merge: true,
    });
  });

  it('picks the nearest home when more than one is below', () => {
    const navigation = createNavigation(['RobotaxiPrototype', 'RobotaxiPrototype', 'RobotaxiPrototypeReceipt']);

    returnToPrototypeHome(navigation);

    expect(navigation.navigate).toHaveBeenCalledWith({ name: 'RobotaxiPrototype', key: 'RobotaxiPrototype-1' });
  });

  it('creates the home only when none is below', () => {
    const navigation = createNavigation(['RobotaxiPrototypeReceipt']);

    returnToPrototypeHome(navigation, { source: 'x' });

    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype', { source: 'x' });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
