import Logger from '../utils/Logger';
import { createAxiosInstance, setupAxiosInterceptor } from '../utils/axiosInterceptor';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

export const BOOKING_HISTORY_CACHE_TTL_MS = 30000;
const BOOKING_HISTORY_CACHE_MAX_AGE_MS = 5 * 60000;
const BOOKING_HISTORY_CACHE_MAX_ENTRIES = 20;

function historyRequestKey(userId, userType, options = {}) {
    return JSON.stringify([
        userId,
        String(userType || 'CUSTOMER').toUpperCase() === 'DRIVER' ? 'driver' : 'customer',
        options.first ?? 50, options.after ?? null,
        options.status ?? null, options.dateRange ?? null, options.revision ?? null,
    ]);
}

function normalizeStatus(status) {
    const raw = String(status || '').trim().toUpperCase();
    if (!raw) return 'UNKNOWN';
    if (raw === 'COMPLETED') return 'COMPLETE';
    if (raw === 'CANCELED') return 'CANCELLED';
    return raw;
}

function firstPresentValue(...values) {
    return values.find((value) =>
        value !== null && value !== undefined && String(value).trim() !== ''
    );
}

function parseOptionalMoney(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const sanitized = String(value).trim().replace(/[^\d,.-]/g, '');
    if (!sanitized) {
        return null;
    }
    const normalized = sanitized.includes(',') && sanitized.includes('.')
        ? sanitized.replace(/\./g, '').replace(',', '.')
        : sanitized.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function mapReceiptToBooking(receipt) {
    const status = normalizeStatus(receipt?.status || receipt?.bookingStatus || 'COMPLETE');
    const totalAmount = parseOptionalMoney(firstPresentValue(
        receipt?.grossAmount,
        receipt?.totalAmountValue,
        receipt?.totalAmountRaw,
        receipt?.totalAmount
    ));
    const distanceKm = Number.parseFloat(receipt?.distanceKm ?? receipt?.distance);
    const durationMinutes = Number.parseFloat(receipt?.durationMinutes ?? receipt?.duration);

    return {
        id: receipt?.rideId || receipt?.bookingId || receipt?.receiptId,
        rideId: receipt?.rideId || receipt?.bookingId || null,
        receiptId: receipt?.receiptId || null,
        pickup: {
            add: receipt?.pickup || receipt?.pickupAddress || 'Origem indisponivel',
            lat: receipt?.pickupLat ?? null,
            lng: receipt?.pickupLng ?? null
        },
        drop: {
            add: receipt?.dropoff || receipt?.destination || receipt?.destinationAddress || receipt?.dropoffAddress || 'Destino indisponivel',
            lat: receipt?.dropoffLat ?? null,
            lng: receipt?.dropoffLng ?? null
        },
        status,
        date: receipt?.completedAt || receipt?.date || receipt?.createdAt || null,
        trip_cost: Number.isFinite(totalAmount) ? totalAmount : receipt?.totalAmount,
        estimate: Number.isFinite(totalAmount) ? totalAmount : receipt?.totalAmount,
        grossAmount: Number.isFinite(totalAmount) ? totalAmount : null,
        driverNetAmount: parseOptionalMoney(firstPresentValue(
            receipt?.driverNetAmount,
            receipt?.netAmount
        )),
        operationalFee: parseOptionalMoney(receipt?.operationalFee),
        paymentIntermediationFee: parseOptionalMoney(receipt?.paymentIntermediationFee),
        totalFees: parseOptionalMoney(firstPresentValue(receipt?.totalFees, receipt?.feeAmount)),
        tollAmount: parseOptionalMoney(firstPresentValue(
            receipt?.tollAmount,
            receipt?.tollFee,
            receipt?.tollFeeReais
        )),
        distance: Number.isFinite(distanceKm) ? distanceKm : receipt?.distance,
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
        duration: Number.isFinite(durationMinutes) ? durationMinutes : receipt?.duration,
        durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 0,
        startTime: receipt?.date || receipt?.completedAt || receipt?.createdAt || null,
        tripdate: receipt?.date || receipt?.completedAt || receipt?.createdAt || null,
        driverId: receipt?.driverId || null,
        driverName: receipt?.driverName || null,
        passengerId: receipt?.passengerId || null,
        passengerName: receipt?.passengerName || null,
        vehicleLabel: receipt?.vehicleLabel || null,
        vehiclePlate: receipt?.vehiclePlate || null,
        authoritativeSnapshot: receipt?.authoritativeSnapshot === true,
        financialSnapshotSource: receipt?.financialSnapshotSource || null,
    };
}

class BookingHistoryService {
    constructor() {
        this.baseUrl = getSelfHostedApiUrl('/api');
        this.axiosInstance = createAxiosInstance({ baseURL: this.baseUrl });
        setupAxiosInterceptor(this.axiosInstance);
        this.historyCache = new Map();
        this.historyRequests = new Map();
    }

    getCachedBookingHistory(userId, userType, options = {}) {
        const key = historyRequestKey(userId, userType, options);
        const snapshot = this.historyCache.get(key);
        if (!snapshot) return null;
        const age = Date.now() - snapshot.updatedAt;
        if (age >= BOOKING_HISTORY_CACHE_MAX_AGE_MS) {
            this.historyCache.delete(key);
            return null;
        }
        return { ...snapshot, fresh: age < BOOKING_HISTORY_CACHE_TTL_MS };
    }

    applyClientFilters(bookings, { status = null, dateRange = null } = {}) {
        let filtered = Array.isArray(bookings) ? [...bookings] : [];

        if (status) {
            const expectedStatus = normalizeStatus(status);
            filtered = filtered.filter((booking) => normalizeStatus(booking?.status) === expectedStatus);
        }

        if (dateRange?.start || dateRange?.end) {
            const startMs = dateRange.start ? new Date(dateRange.start).getTime() : null;
            const endMs = dateRange.end ? new Date(dateRange.end).getTime() : null;

            filtered = filtered.filter((booking) => {
                const bookingMs = new Date(booking?.tripdate || booking?.startTime || 0).getTime();
                if (!Number.isFinite(bookingMs)) return false;
                if (Number.isFinite(startMs) && bookingMs < startMs) return false;
                if (Number.isFinite(endMs) && bookingMs > endMs) return false;
                return true;
            });
        }

        return filtered;
    }

    /**
     * Buscar histórico de corridas do usuário
     * @param {string} userId - ID do usuário
     * @param {string} userType - 'CUSTOMER' ou 'DRIVER'
     * @param {object} options - Opções de paginação e filtros
     * @returns {Promise<{success: boolean, bookings?: Array, error?: string}>}
     */
    async getBookingHistory(userId, userType, options = {}) {
        const key = historyRequestKey(userId, userType, options);
        const cached = this.getCachedBookingHistory(userId, userType, options);
        if (!options.forceRefresh && cached?.fresh) return cached.result;
        if (this.historyRequests.has(key)) return this.historyRequests.get(key);

        const request = this.fetchBookingHistory(userId, userType, options);
        this.historyRequests.set(key, request);
        try {
            const result = await request;
            if (result?.success) {
                this.historyCache.delete(key);
                this.historyCache.set(key, { result, updatedAt: Date.now() });
                if (this.historyCache.size > BOOKING_HISTORY_CACHE_MAX_ENTRIES) {
                    this.historyCache.delete(this.historyCache.keys().next().value);
                }
            }
            return result;
        } finally {
            if (this.historyRequests.get(key) === request) this.historyRequests.delete(key);
        }
    }

    async fetchBookingHistory(userId, userType, options = {}) {
        try {
            const {
                first = 50,
                after = null,
                status = null,
                dateRange = null
            } = options;

            const normalizedUserType = String(userType || 'CUSTOMER').toUpperCase();
            const role = normalizedUserType === 'DRIVER' ? 'driver' : 'customer';
            const offset = Number.isFinite(Number(after)) ? Number(after) : 0;

            const response = await this.axiosInstance.get(`/receipts/user/${encodeURIComponent(userId)}`, {
                params: {
                    role,
                    limit: first,
                    offset
                }
            });

            if (response?.data?.success === false) {
                return { success: false, error: response.data.error || 'Não foi possível carregar o histórico.' };
            }

            const receipts = Array.isArray(response?.data?.receipts) ? response.data.receipts : [];
            const mappedBookings = receipts.map(mapReceiptToBooking);
            const filteredBookings = this.applyClientFilters(mappedBookings, { status, dateRange });

            return {
                success: true,
                bookings: filteredBookings,
                pageInfo: {
                    hasNextPage: Boolean(response?.data?.hasMore),
                    hasPreviousPage: offset > 0,
                    startCursor: filteredBookings.length > 0 ? String(offset) : null,
                    endCursor: filteredBookings.length > 0
                        ? String(response?.data?.nextOffset ?? offset + receipts.length)
                        : null
                },
                totalCount: Number(response?.data?.total ?? filteredBookings.length),
                totalCountKnown: response?.data?.total !== null && response?.data?.total !== undefined && response?.data?.total !== '' && Number.isInteger(Number(response.data.total)) && Number(response.data.total) >= receipts.length
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar histórico de corridas:', error);
            if (error.response && error.response.data) {
                return { success: false, error: error.response.data.error || 'Erro desconhecido' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Buscar corridas ativas do usuário
     * @param {string} userId - ID do usuário
     * @param {string} userType - 'CUSTOMER' ou 'DRIVER'
     * @returns {Promise<{success: boolean, bookings?: Array, error?: string}>}
     */
    async getActiveBookings(userId, userType) {
        try {
            const query = `
                query GetActiveBookings($passengerId: ID, $driverId: ID) {
                    activeBookings(
                        ${userType === 'CUSTOMER' ? 'passengerId: $passengerId' : 'driverId: $driverId'}
                    ) {
                        id
                        passenger {
                            id
                        }
                        driver {
                            id
                        }
                        pickup {
                            address
                        }
                        destination {
                            address
                        }
                        status
                        fare
                    }
                }
            `;

            const variables = userType === 'CUSTOMER'
                ? { passengerId: userId }
                : { driverId: userId };

            const response = await this.axiosInstance.post('/graphql', {
                query,
                variables
            });

            if (response.data.errors) {
                throw new Error(response.data.errors[0].message);
            }

            const bookings = response.data.data.activeBookings.map((booking) => ({
                id: booking.id,
                pickup: { add: booking.pickup.address },
                drop: { add: booking.destination.address },
                status: booking.status,
                trip_cost: booking.fare,
                estimate: booking.fare
            }));

            return { success: true, bookings };
        } catch (error) {
            Logger.error('❌ Erro ao buscar corridas ativas:', error);
            return { success: false, error: error.message };
        }
    }
}

export { mapReceiptToBooking };
export default new BookingHistoryService();
