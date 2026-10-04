const mockCurrentUser = jest.fn();
const mockProfile = jest.fn();
const mockHistory = jest.fn();
const mockRatings = jest.fn();
jest.mock('../src/services/AuthService', () => ({ getCurrentUser: mockCurrentUser }));
jest.mock('../src/services/MobileProfileService', () => ({ getCurrentProfileOrThrow: mockProfile }));
jest.mock('../src/services/BookingHistoryService', () => ({ getBookingHistory: mockHistory }));
jest.mock('../src/services/WebSocketManager', () => ({ getInstance: () => ({ getUserRatings: mockRatings }) }));

describe('canonical account summary', () => {
  let service;
  beforeEach(() => {
    jest.resetModules(); jest.clearAllMocks();
    mockCurrentUser.mockResolvedValue({ uid: 'u1' });
    mockProfile.mockResolvedValue({ uid: 'u1', firstName: 'Ana', totalTrips: 30, averageRating: 4.8 });
    mockHistory.mockResolvedValue({ success: true, totalCount: 12, totalCountKnown: true });
    mockRatings.mockResolvedValue({ success: true, targetUserId: 'u1', totalRatings: 2, averageRating: 4.5 });
    service = require('../src/services/AccountSummaryService');
  });
  afterEach(() => jest.restoreAllMocks());
  it('uses the backend total and actual ratings, and warms the activity page', async () => {
    expect(await service.loadAccountSummary('u1', 'customer')).toEqual(expect.objectContaining({ incomplete: false, profile: expect.objectContaining({ totalTrips: 12, averageRating: 4.5 }) }));
    expect(mockHistory).toHaveBeenCalledWith('u1', 'CUSTOMER', { first: 10, after: null });
  });
  it('never counts a page as the lifetime total', async () => {
    mockHistory.mockResolvedValue({ success: true, totalCount: 10, totalCountKnown: false });
    expect((await service.loadAccountSummary('u1', 'customer')).profile.totalTrips).toBe(30);
    mockProfile.mockResolvedValue({ uid: 'u1' });
    expect((await service.loadAccountSummary('u1', 'customer', 'new')).profile.totalTrips).toBeNull();
  });
  it('represents zero rides and no rating honestly', async () => {
    mockHistory.mockResolvedValue({ success: true, totalCount: 0, totalCountKnown: true });
    mockRatings.mockResolvedValue({ success: true, totalRatings: 0, averageRating: 0 });
    expect((await service.loadAccountSummary('u1', 'driver')).profile).toEqual(expect.objectContaining({ totalTrips: 0, averageRating: null }));
  });
  it('does not expose cached data after switching the authenticated user', async () => {
    await service.loadAccountSummary('u1', 'customer');
    mockCurrentUser.mockResolvedValue({ uid: 'u2' });
    await expect(service.loadAccountSummary('u1', 'customer')).rejects.toThrow('sessão mudou');
    expect(mockProfile).toHaveBeenCalledTimes(1);
  });
  it('rejects a switched session, a foreign profile and foreign ratings', async () => {
    mockCurrentUser.mockResolvedValueOnce({ uid: 'u1' }).mockResolvedValueOnce({ uid: 'u1' }).mockResolvedValueOnce({ uid: 'u2' });
    await expect(service.loadAccountSummary('u1', 'customer')).rejects.toThrow('sessão mudou');
    mockCurrentUser.mockResolvedValue({ uid: 'u1' });
    mockProfile.mockResolvedValue({ uid: 'u2' });
    await expect(service.loadAccountSummary('u1', 'customer')).rejects.toThrow('perfil recebido');
    mockProfile.mockResolvedValue({ uid: 'u1' });
    mockRatings.mockResolvedValue({ success: true, targetUserId: 'u2' });
    await expect(service.loadAccountSummary('u1', 'customer')).rejects.toThrow('avaliações recebidas');
  });
  it('deduplicates concurrent requests and isolates role, receipt revision and refresh', async () => {
    await Promise.all([service.loadAccountSummary('u1', 'customer'), service.loadAccountSummary('u1', 'customer')]);
    expect(mockHistory).toHaveBeenCalledTimes(1);
    await service.loadAccountSummary('u1', 'customer');
    await service.loadAccountSummary('u1', 'driver');
    await service.loadAccountSummary('u1', 'customer', 'receipt-2');
    await service.loadAccountSummary('u1', 'customer', undefined, { forceRefresh: true });
    expect(mockHistory).toHaveBeenCalledTimes(4);
  });
  it('retains valid partial data, reports failure and permits retry', async () => {
    mockRatings.mockRejectedValueOnce(new Error('offline'));
    const partial = await service.loadAccountSummary('u1', 'customer');
    expect(partial.incomplete).toBe(true);
    expect(partial.profile.averageRating).toBe(4.8);
    expect(service.getCachedAccountSummary('u1', 'customer')).toBeNull();
    expect((await service.loadAccountSummary('u1', 'customer')).incomplete).toBe(false);
  });
  it('expires a cached summary after 30 seconds', async () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.loadAccountSummary('u1', 'customer');
    now += 30000;
    await service.loadAccountSummary('u1', 'customer');
    expect(mockHistory).toHaveBeenCalledTimes(2);
  });
});
