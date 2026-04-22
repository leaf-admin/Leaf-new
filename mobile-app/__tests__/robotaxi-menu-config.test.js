import {
  getMenuItemsByRole,
  getMenuSectionsByRole,
  resolveMenuTargetRoute,
} from '../src/screens/prototype/robotaxiMenuConfig';

describe('robotaxiMenuConfig', () => {
  it('does not expose the deprecated driver panel item in the driver menu', () => {
    const items = getMenuItemsByRole('driver');

    expect(items.some((item) => item.key === 'driver-panel')).toBe(false);
    expect(items.some((item) => item.title === 'Perfil do motorista')).toBe(true);
  });

  it('routes direct menu items to the real module screens', () => {
    const items = getMenuItemsByRole('driver');
    const profileItem = items.find((item) => item.key === 'edit-profile');
    const settingsItem = items.find((item) => item.key === 'settings');
    const historyItem = items.find((item) => item.key === 'driver-history');

    expect(resolveMenuTargetRoute(profileItem)).toBe('RobotaxiPrototypeProfile');
    expect(resolveMenuTargetRoute(settingsItem)).toBe('RobotaxiPrototypeSettings');
    expect(resolveMenuTargetRoute(historyItem)).toBe('RobotaxiMenuTripHistory');
  });

  it('groups driver items into operations, account and support sections', () => {
    const sections = getMenuSectionsByRole('driver');

    expect(sections.map((section) => section.key)).toEqual([
      'operations',
      'account',
      'support',
    ]);
  });
});
