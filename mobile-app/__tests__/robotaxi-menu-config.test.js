import { getMenuSectionsByRole } from '../src/screens/prototype/robotaxiMenuConfig';

describe('robotaxiMenuConfig', () => {
  test('keeps privacy entry visible in support section for driver', () => {
    const sections = getMenuSectionsByRole('driver');
    const supportSection = sections.find(section => section.key === 'support');

    expect(supportSection).toBeTruthy();
    expect(supportSection.items[0]).toEqual(
      expect.objectContaining({
        key: 'privacy-account-deletion',
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
        title: 'Privacidade',
        route: 'PrivacyPolicy',
      })
    );
  });
});
