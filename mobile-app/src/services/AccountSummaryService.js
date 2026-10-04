import authService from './AuthService';
import MobileProfileService from './MobileProfileService';
import BookingHistoryService from './BookingHistoryService';
import WebSocketManager from './WebSocketManager';

const TTL = 30000;
const cache = new Map();
const pending = new Map();
const ownerKey = (uid, role, revision) => JSON.stringify([uid, role === 'driver' ? 'DRIVER' : 'CUSTOMER', revision || null]);
const count = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const rating = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= 5 ? Number(value) : null;

export function getCachedAccountSummary(uid, role, revision) {
  const snapshot = cache.get(ownerKey(uid, role, revision));
  return snapshot && Date.now() - snapshot.updatedAt < TTL ? snapshot : null;
}

export async function loadAccountSummary(uid, role, revision, { forceRefresh = false } = {}) {
  if (!uid) throw new Error('Entre na sua conta para consultar seu perfil.');
  if ((await authService.getCurrentUser())?.uid !== uid) throw new Error('A sessão mudou. Abra novamente sua conta.');
  const key = ownerKey(uid, role, revision);
  const cached = getCachedAccountSummary(uid, role, revision);
  if (cached && !forceRefresh) return cached;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    const actor = await authService.getCurrentUser();
    if (actor?.uid !== uid) throw new Error('A sessão mudou. Abra novamente sua conta.');
    const websocket = WebSocketManager.getInstance();
    const results = await Promise.allSettled([
      MobileProfileService.getCurrentProfileOrThrow(),
      BookingHistoryService.getBookingHistory(uid, role === 'driver' ? 'DRIVER' : 'CUSTOMER', {
        first: 10, after: null, ...(revision ? { revision } : {}), ...(forceRefresh ? { forceRefresh: true } : {}),
      }),
      websocket.getUserRatings(uid, role === 'driver' ? 'driver' : 'customer'),
    ]);
    if ((await authService.getCurrentUser())?.uid !== uid) throw new Error('A sessão mudou. Abra novamente sua conta.');
    const profile = results[0].status === 'fulfilled' ? results[0].value : null;
    if (profile?.uid && profile.uid !== uid) throw new Error('O perfil recebido não pertence à sessão atual.');
    const history = results[1].status === 'fulfilled' && results[1].value?.success ? results[1].value : null;
    const reviews = results[2].status === 'fulfilled' && results[2].value?.success ? results[2].value : null;
    if (reviews?.targetUserId && reviews.targetUserId !== uid) throw new Error('As avaliações recebidas não pertencem à sessão atual.');
    const summary = {
      profile: {
        ...(profile || {}),
        // The backend's total is for the whole receipt read model, never the page length.
        totalTrips: history?.totalCountKnown ? count(history.totalCount) : count(profile?.totalTrips ?? profile?.totalRides ?? profile?.tripsCompleted),
        averageRating: reviews ? (count(reviews.totalRatings) > 0 ? rating(reviews.averageRating) : null) : rating(profile?.averageRating ?? profile?.rating ?? profile?.driverRating),
        rating: undefined,
      },
      incomplete: !profile || !history || !reviews,
      updatedAt: Date.now(),
    };
    if (!summary.incomplete) {
      cache.set(key, summary);
      if (cache.size > 20) cache.delete(cache.keys().next().value);
    }
    return summary;
  })();
  pending.set(key, request);
  try { return await request; }
  finally { if (pending.get(key) === request) pending.delete(key); }
}
