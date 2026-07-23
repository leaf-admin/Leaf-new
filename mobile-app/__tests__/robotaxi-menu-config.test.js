import { CURRENT_SURFACE_STATUS } from '../src/screens/prototype/currentSurfaceStatus';
import {
  getMenuSectionsByRole,
  resolveMenuTargetRoute,
} from '../src/screens/prototype/robotaxiMenuConfig';

describe('robotaxiMenuConfig', () => {
  test('keeps privacy entry visible in support section for driver', () => {
    const sections = getMenuSectionsByRole('driver');
    const supportSection = sections.find(section => section.key === 'support');

    expect(supportSection).toBeTruthy();
    expect(supportSection.items[0]).toEqual(
      expect.objectContaining({
        key: 'privacy-account-deletion',
        status: CURRENT_SURFACE_STATUS.CURRENT,
        title: 'Privacidade',
        route: 'PrivacyPolicy',
      })
    );
  });

  test('keeps privacy entry visible in support section for passenger', () => {
    const sections = getMenuSectionsByRole('customer');
    const supportSection = sections.find(section => section.key === 'support');

    expect(supportSection).toBeTruthy();
    expect(supportSection.items[0]).toEqual(
      expect.objectContaining({
        key: 'privacy-account-deletion',
        status: CURRENT_SURFACE_STATUS.CURRENT,
        title: 'Privacidade',
        route: 'PrivacyPolicy',
      })
    );
  });

  test('classifies passenger invites as out of pilot without removing its compatibility route', () => {
    const sections = getMenuSectionsByRole('customer', { referralProgramsEnabled: false });
    const item = sections
      .flatMap(section => section.items)
      .find(entry => entry.key === 'passenger-invites');

    expect(item).toEqual(expect.objectContaining({
      status: CURRENT_SURFACE_STATUS.OUT_OF_PILOT,
      route: 'RobotaxiPrototypeInvites',
    }));
    expect(resolveMenuTargetRoute(item)).toBe('RobotaxiPrototypeInvites');
  });

  test('keeps driver waitlist without invite copy when referral programs are disabled', () => {
    const sections = getMenuSectionsByRole('driver', { referralProgramsEnabled: false });
    const item = sections
      .flatMap(section => section.items)
      .find(entry => entry.key === 'driver-waitlist-invites');

    expect(item).toEqual(expect.objectContaining({
      status: CURRENT_SURFACE_STATUS.CURRENT,
      title: 'Waitlist',
      subtitle: 'Fila de ativação da cidade',
    }));
  });

  test('keeps invite entries available when referral programs are enabled', () => {
    const passengerItems = getMenuSectionsByRole('customer', { referralProgramsEnabled: true })
      .flatMap(section => section.items);
    const driverItems = getMenuSectionsByRole('driver', { referralProgramsEnabled: true })
      .flatMap(section => section.items);

    expect(passengerItems.find(item => item.key === 'passenger-invites')).toEqual(
      expect.objectContaining({ status: CURRENT_SURFACE_STATUS.CURRENT })
    );
    expect(driverItems.find(item => item.key === 'driver-waitlist-invites')).toEqual(
      expect.objectContaining({
        status: CURRENT_SURFACE_STATUS.CURRENT,
        title: 'Waitlist e convites',
      })
    );
  });

  test.each([
    ['customer', true],
    ['customer', false],
    ['driver', true],
    ['driver', false],
  ])('assigns one canonical status to every %s item (referrals=%s)', (role, referralProgramsEnabled) => {
    const allowedStatuses = Object.values(CURRENT_SURFACE_STATUS);
    const items = getMenuSectionsByRole(role, { referralProgramsEnabled })
      .flatMap(section => section.items);

    expect(items.length).toBeGreaterThan(0);
    items.forEach(item => expect(allowedStatuses).toContain(item.status));
  });
});
