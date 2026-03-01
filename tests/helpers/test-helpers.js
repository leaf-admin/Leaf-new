/**
 * HELPERS E UTILITÁRIOS PARA TESTES
 */

const PARAMS = require('../config/test-parameters');

class TestHelpers {
    /**
     * Aguarda X segundos
     */
    static async sleep(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    /**
     * Aguarda até condição ser verdadeira ou timeout
     */
    static async waitFor(condition, timeout = 30, interval = 500) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout * 1000) {
            if (await condition()) {
                return true;
            }
            await this.sleep(interval / 1000);
        }
        throw new Error(`Timeout aguardando condição após ${timeout}s`);
    }

    /**
     * Calcula tarifa baseada em distância e tempo
     */
    static calculateFare(vehicleType, distanceKm, timeMinutes) {
        const vehicle = PARAMS.VEHICLE_TYPES[vehicleType];
        if (!vehicle) {
            throw new Error(`Tipo de veículo não encontrado: ${vehicleType}`);
        }

        const timeHours = timeMinutes / 60;
        const baseFare = vehicle.base_fare;
        const distanceFare = distanceKm * vehicle.rate_per_km;
        const timeFare = timeHours * vehicle.rate_per_hour;

        const calculatedFare = baseFare + distanceFare + timeFare;
        return Math.max(calculatedFare, vehicle.min_fare);
    }

    /**
     * Calcula distância entre duas coordenadas (fórmula Haversine simplificada)
     */
    static calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Raio da Terra em km
        const dLat = this.toRad(lat2 - lat1);
        const dLng = this.toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Converte graus para radianos
     */
    static toRad(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Valida se valor está dentro do threshold de divergência (zero tolerância)
     */
    static validateFareDivergence(estimated, final) {
        return Math.abs(estimated - final) <= PARAMS.FARES.FARE_DIVERGENCE_THRESHOLD;
    }

    /**
     * Cria payload de booking para teste
     */
    static createBookingPayload(pickup, destination, vehicleType = 'Leaf Plus') {
        const distance = this.calculateDistance(
            pickup.lat, pickup.lng,
            destination.lat, destination.lng
        );
        const estimatedTime = distance * 2; // ~2 minutos por km
        const estimatedFare = this.calculateFare(vehicleType, distance, estimatedTime);

        return {
            pickupLocation: {
                lat: pickup.lat,
                lng: pickup.lng,
                address: pickup.address,
            },
            destinationLocation: {
                lat: destination.lat,
                lng: destination.lng,
                address: destination.address,
            },
            vehicleType: vehicleType,
            estimatedFare: estimatedFare,
            estimatedDistance: distance,
            estimatedTime: estimatedTime,
            paymentMethod: 'pix',
        };
    }

    /**
     * Valida estrutura de dados normalizada
     */
    static validateNormalizedBooking(data) {
        const required = ['bookingId', 'pickup', 'drop', 'estimate'];
        const missing = required.filter(field => !data[field]);
        
        if (missing.length > 0) {
            throw new Error(`Campos obrigatórios faltando: ${missing.join(', ')}`);
        }

        if (!data.pickup.add || !data.drop.add) {
            throw new Error('Pickup ou drop sem endereço (add)');
        }

        return true;
    }

    /**
     * Simula perda de conexão
     */
    static async simulateConnectionLoss(socket, duration = 5) {
        if (socket && socket.disconnect) {
            socket.disconnect();
            await this.sleep(duration);
            // Reconexão deve ser automática via WebSocketManager
        }
    }

    /**
     * Verifica se coordenada está dentro do raio
     */
    static isWithinRadius(centerLat, centerLng, targetLat, targetLng, radiusKm) {
        const distance = this.calculateDistance(centerLat, centerLng, targetLat, targetLng);
        return distance <= radiusKm;
    }

    /**
     * Cria timestamp ISO
     */
    static getTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Formata moeda
     */
    static formatCurrency(value) {
        return `R$ ${value.toFixed(2)}`;
    }

    /**
     * Gera ID único para testes
     */
    static generateTestId(prefix = 'test') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Valida se evento foi recebido dentro do timeout
     */
    static async waitForEvent(socket, eventName, timeout = 30) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                socket.off(eventName, handler);
                reject(new Error(`Timeout aguardando evento ${eventName} após ${timeout}s`));
            }, timeout * 1000);

            const handler = (data) => {
                clearTimeout(timer);
                socket.off(eventName, handler);
                resolve(data);
            };

            socket.on(eventName, handler);
        });
    }

    /**
     * Valida regra de cancelamento do customer
     */
    static calculateCancelFeeCustomer(acceptedAt, canceledAt, distanceKm, timeMinutes, vehicleType) {
        const elapsedSeconds = (new Date(canceledAt) - new Date(acceptedAt)) / 1000;
        
        if (elapsedSeconds <= PARAMS.FARES.CANCEL_FEE_CUSTOMER_WINDOW) {
            return 0; // Sem taxa até 2 minutos
        }

        const vehicle = PARAMS.VEHICLE_TYPES[vehicleType];
        const distanceFee = distanceKm * vehicle.rate_per_km;
        const timeFee = (timeMinutes / 60) * vehicle.rate_per_hour;
        
        return distanceFee + timeFee + PARAMS.FARES.CANCEL_FEE_CUSTOMER_AFTER;
    }

    /**
     * Calcula estorno parcial
     */
    static calculatePartialRefund(paidAmount, distanceKm, timeMinutes, vehicleType) {
        const vehicle = PARAMS.VEHICLE_TYPES[vehicleType];
        const distanceFee = distanceKm * vehicle.rate_per_km;
        const timeFee = (timeMinutes / 60) * vehicle.rate_per_hour;
        
        return paidAmount - (distanceFee + timeFee);
    }
}

module.exports = TestHelpers;



