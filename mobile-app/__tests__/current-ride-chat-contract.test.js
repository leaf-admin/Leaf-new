import { getMenuItemsByRole } from '../src/screens/prototype/robotaxiMenuConfig';

describe('current ride chat contract', () => {
  it.each(['customer', 'driver'])(
    'does not expose a context-free Messages menu item for %s',
    (role) => {
      const menuItems = getMenuItemsByRole(role);

      expect(menuItems.some(item => item.key === 'messages')).toBe(false);
      expect(
        menuItems.some(item => item.route === 'RobotaxiPrototypeChat'),
      ).toBe(false);
    },
  );
});
