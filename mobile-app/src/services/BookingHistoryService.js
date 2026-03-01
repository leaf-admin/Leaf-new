import Logger from '../utils/Logger';
import { createAxiosInstance, setupAxiosInterceptor } from '../utils/axiosInterceptor';
import { getSelfHostedApiUrl } from '../config/ApiConfig';


class BookingHistoryService {
    constructor() {
        this.baseUrl = getSelfHostedApiUrl('/api');
        this.axiosInstance = createAxiosInstance({ baseURL: this.baseUrl });
        setupAxiosInterceptor(this.axiosInstance);
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

            // Usar GraphQL para buscar histórico
            const query = `
                query GetBookingHistory($userId: ID!, $userType: UserType!, $first: Int, $after: String, $status: BookingStatus, $dateRange: DateRangeInput) {
                    bookingHistory(
                        userId: $userId
                        userType: $userType
                        first: $first
                        after: $after
                        status: $status
                        dateRange: $dateRange
                    ) {
                        edges {
                            node {
                                id
                                passenger {
                                    id
                                }
                                driver {
                                    id
                                }
                                pickup {
                                    latitude
                                    longitude
                                    address
                                }
                                destination {
                                    latitude
                                    longitude
                                    address
                                }
                                status
                                fare
                                distance
                                duration
                                createdAt
                                updatedAt
                            }
                            cursor
                        }
                        pageInfo {
                            hasNextPage
                            hasPreviousPage
                            startCursor
                            endCursor
                        }
                        totalCount
                    }
                }
            `;

            const variables = {
                userId,
                userType: userType.toUpperCase(),
                first,
                after,
                status,
                dateRange
            };

            const response = await this.axiosInstance.post('/graphql', {
                query,
                variables
            });

            if (response.data.errors) {
                throw new Error(response.data.errors[0].message);
            }

            const bookings = response.data.data.bookingHistory.edges.map(edge => ({
                id: edge.node.id,
                pickup: {
                    add: edge.node.pickup.address,
                    lat: edge.node.pickup.latitude,
                    lng: edge.node.pickup.longitude
                },
                drop: {
                    add: edge.node.destination.address,
                    lat: edge.node.destination.latitude,
                    lng: edge.node.destination.longitude
                },
                status: edge.node.status,
                trip_cost: edge.node.fare,
                estimate: edge.node.fare,
                distance: edge.node.distance,
                duration: edge.node.duration,
                startTime: edge.node.createdAt,
                tripdate: edge.node.createdAt
            }));

            return {
                success: true,
                bookings,
                pageInfo: response.data.data.bookingHistory.pageInfo,
                totalCount: response.data.data.bookingHistory.totalCount
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

            const bookings = response.data.data.activeBookings.map(booking => ({
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

export default new BookingHistoryService();

