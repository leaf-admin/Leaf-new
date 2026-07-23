const {
  DASHBOARD_NAMESPACE,
  DASHBOARD_AUTHENTICATED_ROOM,
  publishSupportEvent,
  resolveSupportOwnerRooms
} = require('../../../services/support-realtime-publisher');

function createIoMock() {
  const dashboardEmit = jest.fn();
  const ownerEmit = jest.fn();
  const dashboardTo = jest.fn(() => ({ emit: dashboardEmit }));
  const rootTo = jest.fn(() => ({ emit: ownerEmit }));
  return {
    io: {
      emit: jest.fn(),
      of: jest.fn(() => ({ to: dashboardTo })),
      to: rootTo
    },
    dashboardEmit,
    ownerEmit,
    dashboardTo,
    rootTo
  };
}

describe('support realtime publisher', () => {
  it('publishes only to the authenticated dashboard room and exact owner room', () => {
    const mock = createIoMock();
    const payload = { ticketId: 'ticket-1' };

    const result = publishSupportEvent(mock.io, {
      dashboardEvent: 'support:message:new',
      ownerEvent: 'support:message:new',
      dashboardPayload: payload,
      ownerPayload: payload,
      userId: 'passenger-1',
      userType: 'passenger'
    });

    expect(mock.io.emit).not.toHaveBeenCalled();
    expect(mock.io.of).toHaveBeenCalledWith(DASHBOARD_NAMESPACE);
    expect(mock.dashboardTo).toHaveBeenCalledWith(DASHBOARD_AUTHENTICATED_ROOM);
    expect(mock.dashboardEmit).toHaveBeenCalledWith('support:message:new', payload);
    expect(mock.rootTo).toHaveBeenCalledTimes(1);
    expect(mock.rootTo).toHaveBeenCalledWith('customer_passenger-1');
    expect(mock.ownerEmit).toHaveBeenCalledWith('support:message:new', payload);
    expect(result).toEqual({
      dashboardEmitted: true,
      ownerRooms: ['customer_passenger-1']
    });
  });

  it('never falls back to a namespace-wide emit when owner identity is absent', () => {
    const mock = createIoMock();

    const result = publishSupportEvent(mock.io, {
      dashboardEvent: 'support:ticket:new',
      ownerEvent: 'support:ticket:new',
      dashboardPayload: { ticket: { id: 'ticket-1' } },
      userId: ''
    });

    expect(mock.io.emit).not.toHaveBeenCalled();
    expect(mock.rootTo).not.toHaveBeenCalled();
    expect(result.ownerRooms).toEqual([]);
    expect(mock.dashboardEmit).toHaveBeenCalledTimes(1);
  });

  it('uses the authenticated socket room conventions for both product roles', () => {
    expect(resolveSupportOwnerRooms('driver-1', 'driver')).toEqual(['driver_driver-1']);
    expect(resolveSupportOwnerRooms('passenger-1', 'customer')).toEqual(['customer_passenger-1']);
    expect(resolveSupportOwnerRooms('owner-1')).toEqual([
      'customer_owner-1',
      'driver_owner-1'
    ]);
  });
});
