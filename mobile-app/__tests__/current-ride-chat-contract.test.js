import { getMenuItemsByRole } from '../src/screens/prototype/robotaxiMenuConfig';
const fs = require('fs');
const path = require('path');

const chatFlow = fs.readFileSync(
  path.join(__dirname, '../.maestro/flows/rides/02-chat-during-ride.yaml'),
  'utf8',
);

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

  it('Maestro chat flow targets current passenger and driver surfaces', () => {
    expect(chatFlow).toContain('@qa-roles: passenger, driver');
    expect(chatFlow).toContain('passenger-trip-message-button');
    expect(chatFlow).toContain('driver-live-ride-overlay-wrap');
    expect(chatFlow).toContain('driver-live-trip-chat-button');
    expect(chatFlow).toContain('robotaxi-chat-screen');
    expect(chatFlow).toContain('prototype-chat-message-input');
    expect(chatFlow).toContain('prototype-chat-send-button');
    expect(chatFlow).not.toContain('active-ride-container');
    expect(chatFlow).not.toContain('id: "chat-button"');
    expect(chatFlow).not.toContain('id: "message-input"');
    expect(chatFlow).not.toContain('id: "send-button"');
  });
});
