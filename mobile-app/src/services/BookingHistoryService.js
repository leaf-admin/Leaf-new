import Logger from '../utils/Logger';
import { createAxiosInstance, setupAxiosInterceptor } from '../utils/axiosInterceptor';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

function normalizeStatus(status) {
    const raw = String(status || '').trim().toUpperCase();
    if (!raw) return 'UNKNOWN';
    if (raw === 'COMPLETED') return 'COMPLETE';
    if (raw === 'CANCELED') return 'CANCELLED';
    return raw;
}

function mapReceiptToBooking(receipt) {
    const status = normalizeStatus(receipt?.status || receipt?.bookingStatus || 'COMPLETE');
    const totalAmount = Number.parseFloat(
        receipt?.grossAmount ??
        receipt?.totalAmountValue ??
        receipt?.totalAmountRaw ??
        receipt?.totalAmount
    );
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
        grossAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
        driverNetAmount: Number.parseFloat(receipt?.driverNetAmount) || 0,
        operationalFee: Number.parseFloat(receipt?.operationalFee) || 0,
        paymentIntermediationFee: Number.parseFloat(receipt?.paymentIntermediationFee) || 0,
        totalFees: Number.parseFloat(receipt?.totalFees) || 0,
        tollAmount: Number.parseFloat(receipt?.tollAmount) || 0,
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
                totalCount: Number(response?.data?.total || filteredBookings.length)
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
