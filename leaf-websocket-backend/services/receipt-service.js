/**
 * 🧾 RECEIPT SERVICE - GERAÇÃO DE RECIBOS DE CORRIDA
 * 
 * Este serviço gera recibos completos com:
 * - Informações detalhadas da viagem
 * - Cálculos de valores e taxas
 * - Imagem estática do trajeto
 * - Dados para conformidade legal
 * - Hash único de identificação
 */

const { logger } = require('../utils/logger');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const PaymentService = require('./payment-service');

class ReceiptFinancialSnapshotIncompleteError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ReceiptFinancialSnapshotIncompleteError';
        this.code = 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE';
        this.statusCode = 409;
        this.details = details;
    }
}

class ReceiptService {
    constructor() {
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GEO_KEY;
        this.paymentService = new PaymentService();
    }

    /**
     * Gera hash único de identificação para o recibo
     * @param {string} rideId - ID da corrida
     * @param {Object} rideData - Dados da corrida
     * @returns {string} - Hash SHA256 único
     */
    generateReceiptHash(rideId, rideData) {
        const timestamp = new Date().toISOString();
        const dataString = `${rideId}-${rideData.customer || ''}-${rideData.driver || ''}-${timestamp}-${rideData.finalPrice || rideData.estimate || 0}`;
        return crypto.createHash('sha256').update(dataString).digest('hex').substring(0, 32).toUpperCase();
    }

    /**
     * Parse resiliente de timestamp ISO/epoch/date-object.
     * Retorna fallback quando o valor não é válido.
     */
    parseDateValue(value, fallback = null) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(value.getTime());
        }

        const rawText = String(value).trim();
        if (!rawText) {
            return fallback;
        }

        const asNumber = Number(rawText);
        if (Number.isFinite(asNumber)) {
            // Heurística: segundos vs milissegundos
            const millis = asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
            const parsedFromNumber = new Date(millis);
            if (!Number.isNaN(parsedFromNumber.getTime())) {
                return parsedFromNumber;
            }
        }

        const parsedFromText = new Date(rawText);
        if (!Number.isNaN(parsedFromText.getTime())) {
            return parsedFromText;
        }

        return fallback;
    }

    /**
     * Formata data e horário para exibição
     * @param {string} dateString - Data em ISO string
     * @returns {Object} - Objeto com data e horário formatados
     */
    formatDateTime(dateString) {
        if (!dateString) return { date: 'N/A', time: 'N/A' };

        const date = this.parseDateValue(dateString);
        if (!date) return { date: 'N/A', time: 'N/A' };

        const dateFormatted = date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const timeFormatted = date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        return { date: dateFormatted, time: timeFormatted };
    }

    parseMoneyValue(value, fallback = null) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        if (typeof value === 'string') {
            const sanitized = value
                .replace(/[^\d,.-]/g, '')
                .trim();
            if (!sanitized) {
                return fallback;
            }
            const normalized = sanitized.includes(',')
                ? sanitized.replace(/\./g, '').replace(',', '.')
                : sanitized;
            const parsed = Number(normalized);
            return Number.isFinite(parsed) ? parsed : fallback;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    firstPresentMoney(...values) {
        for (const value of values) {
            const parsed = this.parseMoneyValue(value, null);
            if (parsed !== null) {
                return parsed;
            }
        }
        return null;
    }

    firstFiniteNumber(...values) {
        for (const value of values) {
            if (value === null || value === undefined || value === '') {
                continue;
            }
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return null;
    }

    normalizeDistanceKm(value, unit = '') {
        const parsed = this.firstFiniteNumber(value);
        if (parsed === null || parsed < 0) {
            return null;
        }

        const normalizedUnit = String(unit || '').trim().toLowerCase();
        if (normalizedUnit === 'm' || normalizedUnit === 'meter' || normalizedUnit === 'meters' || normalizedUnit === 'metros') {
            return parsed / 1000;
        }

        return parsed > 1000 ? parsed / 1000 : parsed;
    }

    resolveReceiptDistanceKm(rideData = {}) {
        return this.normalizeDistanceKm(
            this.firstFiniteNumber(
                rideData.distanceKm,
                rideData.tripDistanceKm,
                rideData.estimatedTripDistanceKm,
                rideData.routeDistanceKm,
                rideData.distance,
                rideData.estimateDistance
            ),
            rideData.distanceUnit || rideData.distance_unit
        ) || 0;
    }

    isTruthyFlag(value) {
        if (value === true) {
            return true;
        }
        const normalized = String(value || '').trim().toLowerCase();
        return ['1', 'true', 'yes', 'sim'].includes(normalized);
    }

    resolveFinalReceiptFinancialSnapshot(rideId, rideData = {}) {
        const fareBreakdown = rideData.fareBreakdown || {};
        const paymentBreakdown = rideData.paymentBreakdown || {};
        const financialBreakdown = rideData.financialBreakdown || {};
        const nestedFinancial = rideData.financial || {};
        const calculationBreakdown =
            rideData.calculation?.breakdown ||
            fareBreakdown.calculation?.breakdown ||
            paymentBreakdown.calculation?.breakdown ||
            {};
        const snapshotSource = String(
            rideData.financialSnapshotSource ||
            fareBreakdown.financialSnapshotSource ||
            paymentBreakdown.financialSnapshotSource ||
            financialBreakdown.financialSnapshotSource ||
            ''
        ).trim();
        const authoritativeSnapshot =
            this.isTruthyFlag(rideData.authoritativeSnapshot) ||
            this.isTruthyFlag(fareBreakdown.authoritativeSnapshot) ||
            this.isTruthyFlag(paymentBreakdown.authoritativeSnapshot) ||
            this.isTruthyFlag(financialBreakdown.authoritativeSnapshot);

        const grossAmount = this.firstPresentMoney(
            rideData.finalPrice,
            rideData.finalFare,
            rideData.grossAmount,
            rideData.grossFare,
            rideData.totalPaid,
            rideData.totalAmount,
            rideData.customer_paid,
            rideData.customerPaid,
            rideData.paymentAmount,
            nestedFinancial.totalPaid?.amount,
            fareBreakdown.finalFare,
            fareBreakdown.grossAmount,
            paymentBreakdown.finalFare,
            paymentBreakdown.grossAmount,
            financialBreakdown.finalFare,
            financialBreakdown.grossAmount
        );
        const operationalFee = this.firstPresentMoney(
            rideData.operationalFee,
            fareBreakdown.operationalFee,
            paymentBreakdown.operationalFee,
            financialBreakdown.operationalFee,
            calculationBreakdown.operationalFee
        );
        const paymentIntermediationFee = this.firstPresentMoney(
            rideData.paymentIntermediationFee,
            rideData.wooviFee,
            fareBreakdown.paymentIntermediationFee,
            fareBreakdown.wooviFee,
            paymentBreakdown.paymentIntermediationFee,
            paymentBreakdown.wooviFee,
            financialBreakdown.paymentIntermediationFee,
            financialBreakdown.wooviFee,
            calculationBreakdown.paymentIntermediationFee,
            calculationBreakdown.wooviFee
        );
        const driverNetAmount = this.firstPresentMoney(
            rideData.driverNetAmount,
            rideData.netAmount,
            fareBreakdown.driverNetAmount,
            fareBreakdown.netAmount,
            paymentBreakdown.driverNetAmount,
            paymentBreakdown.netAmount,
            financialBreakdown.driverNetAmount,
            financialBreakdown.netAmount
        );
        const tollFee = this.firstPresentMoney(
            rideData.tollFee,
            rideData.toll_fee,
            rideData.pedagio,
            fareBreakdown.tollFee,
            fareBreakdown.toll_fee,
            fareBreakdown.driverTollPassThrough,
            paymentBreakdown.tollFee,
            paymentBreakdown.toll_fee,
            paymentBreakdown.driverTollPassThrough,
            financialBreakdown.tollFee,
            financialBreakdown.toll_fee,
            financialBreakdown.driverTollPassThrough
        ) ?? 0;
        const totalFees = this.firstPresentMoney(
            rideData.totalFees,
            rideData.retainedFees,
            fareBreakdown.totalFees,
            fareBreakdown.retainedFees,
            paymentBreakdown.totalFees,
            paymentBreakdown.retainedFees,
            financialBreakdown.totalFees,
            financialBreakdown.retainedFees
        );
        const missing = [];
        if (!authoritativeSnapshot) missing.push('authoritativeSnapshot');
        if (snapshotSource !== 'backend_final') missing.push('financialSnapshotSource=backend_final');
        if (!(grossAmount > 0)) missing.push('finalGrossAmount');
        if (!(operationalFee >= 0)) missing.push('operationalFee');
        if (!(paymentIntermediationFee >= 0)) missing.push('paymentIntermediationFee');
        if (!(driverNetAmount >= 0)) missing.push('driverNetAmount');
        if (!(totalFees >= 0)) {
            missing.push('totalFees');
        }
        if (grossAmount !== null && totalFees !== null && driverNetAmount !== null) {
            const grossAmountCents = Math.round(grossAmount * 100);
            const allocatedAmountCents = Math.round((driverNetAmount + totalFees) * 100);
            if (allocatedAmountCents !== grossAmountCents) {
                missing.push('driverNetAmount+totalFees=grossAmount');
            }
        }

        if (missing.length > 0) {
            throw new ReceiptFinancialSnapshotIncompleteError(
                `Recibo ${rideId} sem snapshot financeiro final completo`,
                {
                    rideId,
                    missing,
                    financialSnapshotSource: snapshotSource || null,
                    authoritativeSnapshot,
                    grossAmount,
                    operationalFee,
                    paymentIntermediationFee,
                    driverNetAmount,
                    totalFees
                }
            );
        }

        return {
            finalPrice: grossAmount,
            finalFare: grossAmount,
            grossAmount,
            tollFee,
            driverTollPassThrough: tollFee,
            operationalFee,
            paymentIntermediationFee,
            driverNetAmount,
            ...(totalFees !== null ? { totalFees } : {}),
            authoritativeSnapshot: true,
            financialSnapshotSource: 'backend_final'
        };
    }

    /**
     * Gera recibo completo da corrida
     * @param {string} rideId - ID da corrida
     * @param {Object} rideData - Dados completos da corrida
     * @returns {Promise<Object>} - Recibo formatado
     */
    async generateReceipt(rideId, rideData) {
        try {
            logger.info(`📋 Gerando recibo para corrida: ${rideId}`);
            const finalFinancialSnapshot = this.resolveFinalReceiptFinancialSnapshot(rideId, rideData);
            const receiptRideData = {
                ...rideData,
                ...finalFinancialSnapshot,
                fareBreakdown: {
                    ...(rideData.fareBreakdown || {}),
                    ...finalFinancialSnapshot
                }
            };

            // 1. Calcular valores financeiros
            const financialBreakdown = this.calculateFinancialBreakdown(receiptRideData);

            // 2. Calcular métricas da viagem
            const tripMetrics = this.calculateTripMetrics(receiptRideData);
            const actualDistanceKm = this.resolveReceiptDistanceKm(receiptRideData);
            const estimatedDistanceKm =
                this.normalizeDistanceKm(
                    this.firstFiniteNumber(
                        receiptRideData.estimateDistance,
                        receiptRideData.estimatedTripDistanceKm,
                        receiptRideData.routeDistanceKm,
                        actualDistanceKm
                    ),
                    receiptRideData.distanceUnit || receiptRideData.distance_unit
                ) || actualDistanceKm;

            // 3. Gerar URL da imagem estática do mapa
            const mapImageUrl = this.generateStaticMapImage(receiptRideData);

            // 4. Gerar hash único de identificação
            const receiptHash = this.generateReceiptHash(rideId, receiptRideData);

            // 5. Formatar data e horário
            const tripDate =
                this.parseDateValue(
                    receiptRideData.endTime ||
                    receiptRideData.completedAt ||
                    receiptRideData.tripStartTime ||
                    receiptRideData.startedAt ||
                    receiptRideData.bookingDate ||
                    receiptRideData.createdAt,
                    new Date()
                )?.toISOString() || new Date().toISOString();
            const { date: tripDateFormatted, time: tripTimeFormatted } = this.formatDateTime(tripDate);

            // 6. Obter destino para título
            const destination = receiptRideData.drop?.add || 'destino';

            // 7. Formatar dados do recibo conforme estrutura solicitada
            const receipt = {
                // === IDENTIFICAÇÃO E HASH ===
                receiptId: `LEAF-${rideId}`,
                rideId: rideId,
                reference: receiptRideData.reference || rideId.substring(0, 6).toUpperCase(),
                hash: receiptHash, // Hash único para validação
                issueDate: new Date().toISOString(),
                issueTimestamp: Date.now(),

                // === TÍTULO DO RECIBO ===
                title: `Sua corrida para ${destination}, em ${tripDateFormatted} ${tripTimeFormatted}`,

                // === DADOS DA VIAGEM ===
                trip: {
                    // Data e horário formatados
                    date: tripDateFormatted,
                    time: tripTimeFormatted,
                    dateTime: tripDate,

                    // Local de partida
                        pickup: {
                            address: receiptRideData.pickup?.add || 'Endereço de origem',
                            coordinates: {
                                lat: receiptRideData.pickup?.lat || 0,
                                lng: receiptRideData.pickup?.lng || 0
                            },
                            timestamp: this.parseDateValue(receiptRideData.tripStartTime || receiptRideData.startedAt || receiptRideData.startTime)?.toISOString() || null
                        },

                    // Local de destino
                        dropoff: {
                            address: receiptRideData.drop?.add || 'Endereço de destino',
                            coordinates: {
                                lat: receiptRideData.drop?.lat || 0,
                                lng: receiptRideData.drop?.lng || 0
                            },
                            timestamp: this.parseDateValue(receiptRideData.endTime || receiptRideData.completedAt || receiptRideData.endDate)?.toISOString() || null
                        },

                    // Tempo de viagem e distância
                    duration: tripMetrics.duration, // em minutos
                    durationFormatted: tripMetrics.durationFormatted,
                    distance: {
                        estimated: estimatedDistanceKm,
                        actual: actualDistanceKm,
                        unit: 'km',
                        formatted: `${actualDistanceKm.toFixed(2)} km`
                    },

                    // Mapa do trajeto
                    mapImage: {
                        url: mapImageUrl,
                        width: 800,
                        height: 400
                    }
                },

                // === DADOS DO PASSAGEIRO ===
                customer: {
                    name: receiptRideData.customer_name || receiptRideData.passengerName || 'Passageiro',
                    email: receiptRideData.customer_email || receiptRideData.passengerEmail || '',
                    phone: receiptRideData.customer_contact || receiptRideData.passengerPhone || '',
                    id: receiptRideData.customer || receiptRideData.customerId || receiptRideData.passengerId || receiptRideData.userId || ''
                },

                // === DADOS DO MOTORISTA ===
                driver: {
                    name: receiptRideData.driver_name || receiptRideData.driverName || 'Motorista Parceiro',
                    fullName: receiptRideData.driver_name || receiptRideData.driverName || 'Motorista Parceiro', // Nome completo
                    id: receiptRideData.driver || receiptRideData.driverId || '',
                    vehicle: {
                        type: receiptRideData.carType || 'Veículo',
                        plate: receiptRideData.vehicle_plate || receiptRideData.vehiclePlate || receiptRideData.carPlate || 'N/A',
                        brand: receiptRideData.vehicleMake || '',
                        model: receiptRideData.vehicleModel || receiptRideData.carModel || '',
                        brandModel: `${receiptRideData.vehicleMake || ''} ${receiptRideData.vehicleModel || receiptRideData.carModel || ''}`.trim() || 'Veículo'
                    }
                },

                // === VALORES FINANCEIROS ===
                financial: financialBreakdown,

                // === FORMA DE PAGAMENTO ===
                payment: {
                    method: this.getPaymentMethodName(receiptRideData.payment_mode),
                    status: receiptRideData.payment_status || 'completed',
                    transactionId: receiptRideData.txnId || '',
                    processedAt: receiptRideData.paymentDate || receiptRideData.completedAt
                },

                // === INFORMAÇÕES LEGAIS ===
                legal: {
                    companyName: 'LEAF - Freedom Tecnologia e Serviços LTDA',
                    cnpj: '54.027.374/0001-20',
                    note: 'Este documento não é uma nota fiscal. Para solicitar nota fiscal, entre em contato conosco.',
                    privacyPolicy: 'https://www.leaf.app.br/privacidade'
                },

                // === METADADOS ===
                metadata: {
                    version: '2.0',
                    generatedBy: 'Leaf Receipt Service',
                    status: receiptRideData.status || 'COMPLETED',
                    authoritativeSnapshot: finalFinancialSnapshot.authoritativeSnapshot,
                    financialSnapshotSource: finalFinancialSnapshot.financialSnapshotSource
                }
            };

            logger.info(`✅ Recibo gerado com sucesso para corrida: ${rideId}`);
            return receipt;

        } catch (error) {
            logger.error(`❌ Erro ao gerar recibo para corrida ${rideId}:`, error);
            if (error?.code === 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE') {
                throw error;
            }
            throw new Error(`Falha ao gerar recibo: ${error.message}`);
        }
    }

    /**
     * Calcula breakdown financeiro detalhado
     */
    calculateFinancialBreakdown(rideData) {
        const totalFare = this.firstPresentMoney(
            rideData.finalPrice,
            rideData.finalFare,
            rideData.grossAmount,
            rideData.grossFare,
            rideData.totalPaid,
            rideData.totalAmount,
            rideData.customer_paid,
            rideData.customerPaid,
            rideData.paymentAmount,
            rideData.financial?.totalPaid?.amount,
            rideData.fareBreakdown?.finalFare,
            rideData.fareBreakdown?.grossAmount,
            rideData.paymentBreakdown?.finalFare,
            rideData.paymentBreakdown?.grossAmount,
            rideData.financialBreakdown?.finalFare,
            rideData.financialBreakdown?.grossAmount
        ) ?? 0;
        const tollFee = this.firstPresentMoney(
            rideData.tollFee,
            rideData.toll_fee,
            rideData.pedagio,
            rideData.driverTollPassThrough,
            rideData.fareBreakdown?.tollFee,
            rideData.fareBreakdown?.toll_fee,
            rideData.fareBreakdown?.driverTollPassThrough,
            rideData.paymentBreakdown?.tollFee,
            rideData.paymentBreakdown?.toll_fee,
            rideData.paymentBreakdown?.driverTollPassThrough,
            rideData.financialBreakdown?.tollFee,
            rideData.financialBreakdown?.toll_fee,
            rideData.financialBreakdown?.driverTollPassThrough
        ) ?? 0;
        const breakdown = this.paymentService.calculateFareBreakdownFromReais(totalFare, tollFee);
        const explicitBreakdown = rideData.fareBreakdown || rideData.paymentBreakdown || {};
        const firstFinite = (...values) => {
            for (const value of values) {
                const numeric = this.parseMoneyValue(value, null);
                if (numeric !== null) return numeric;
            }
            return null;
        };
        const operationalFee = firstFinite(
            rideData.operationalFee,
            explicitBreakdown.operationalFee,
            breakdown?.operationalFee,
            0
        );
        const wooviFee = firstFinite(
            rideData.paymentIntermediationFee,
            explicitBreakdown.paymentIntermediationFee,
            breakdown?.paymentIntermediationFee,
            0
        );
        const totalFees = firstFinite(
            rideData.totalFees,
            explicitBreakdown.totalFees,
            Number(operationalFee || 0) + Number(wooviFee || 0)
        );
        const driverAmount = firstFinite(
            rideData.driverNetAmount,
            explicitBreakdown.driverNetAmount,
            totalFees !== null ? Math.max(0, totalFare - totalFees) : null,
            breakdown?.driverNetAmount,
            Math.max(0, totalFare - operationalFee - wooviFee)
        );

        return {
            // Valor pago pelo passageiro
            totalPaid: {
                amount: totalFare,
                formatted: `R$ ${totalFare.toFixed(2).replace('.', ',')}`
            },

            // Breakdown de custos
            breakdown: {
                tripFare: {
                    amount: totalFare,
                    formatted: `R$ ${totalFare.toFixed(2).replace('.', ',')}`
                },

                operationalCost: {
                    amount: operationalFee,
                    formatted: `R$ ${operationalFee.toFixed(2).replace('.', ',')}`
                },

                wooviFee: {
                    amount: wooviFee,
                    formatted: `R$ ${wooviFee.toFixed(2).replace('.', ',')}`
                },

                tollPassThrough: {
                    amount: tollFee,
                    formatted: `R$ ${tollFee.toFixed(2).replace('.', ',')}`,
                    passThrough: true
                },

                driverTollPassThrough: {
                    amount: tollFee,
                    formatted: `R$ ${tollFee.toFixed(2).replace('.', ',')}`,
                    passThrough: true
                },

                driverAmount: {
                    amount: driverAmount,
                    formatted: `R$ ${driverAmount.toFixed(2).replace('.', ',')}`
                }
            },

            // Totais
            totals: {
                customerPaid: totalFare,
                driverReceived: driverAmount,
                leafOperational: operationalFee,
                wooviFee: wooviFee,
                tollPassThrough: tollFee,
                driverTollPassThrough: tollFee,
                retainedFees: totalFees
            }
        };
    }

    /**
     * Calcula métricas da viagem
     */
    calculateTripMetrics(rideData) {
        const now = new Date();
        const endTime = this.parseDateValue(
            rideData.endTime || rideData.completedAt || rideData.endDate,
            now
        );

        const startTime = this.parseDateValue(
            rideData.tripStartTime ||
            rideData.startedAt ||
            rideData.startTime ||
            rideData.bookingDate ||
            rideData.createdAt,
            endTime
        );
        const normalizedStartTime = startTime.getTime() > endTime.getTime()
            ? new Date(endTime.getTime())
            : startTime;

        let durationMinutes;

        // Prioridade para duração explícita quando disponível
        const explicitSeconds = Number(rideData.durationSeconds || rideData.routeDurationSecs || rideData.tripDurationSecs);
        const explicitMinutes = Number(rideData.durationMinutes || rideData.tripDurationMinutes);
        const fallbackDuration = Number(rideData.duration);

        if (Number.isFinite(explicitSeconds) && explicitSeconds >= 0) {
            durationMinutes = Math.round(explicitSeconds / 60);
        } else if (Number.isFinite(explicitMinutes) && explicitMinutes >= 0) {
            durationMinutes = Math.round(explicitMinutes);
        } else if (Number.isFinite(fallbackDuration) && fallbackDuration >= 0) {
            // No fluxo principal, `duration` costuma vir em segundos.
            durationMinutes = Math.round(fallbackDuration / 60);
        } else {
            const durationMs = Math.max(0, endTime.getTime() - normalizedStartTime.getTime());
            durationMinutes = Math.round(durationMs / (1000 * 60));
        }

        if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
            durationMinutes = 0;
        }

        // Formatar duração
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        const durationFormatted = hours > 0
            ? `${hours}h ${minutes}min`
            : `${minutes}min`;

        return {
            duration: durationMinutes,
            durationFormatted,
            startTime: normalizedStartTime.toISOString(),
            endTime: endTime.toISOString()
        };
    }

    /**
     * Gera URL para imagem estática do Google Maps com o trajeto
     */
    generateStaticMapImage(rideData) {
        if (!this.GOOGLE_MAPS_API_KEY) {
            logger.warn('⚠️ Google Maps API Key não configurada');
            return null;
        }

        const pickup = rideData.pickup;
        const dropoff = rideData.drop;

        if (!pickup || !dropoff) {
            logger.warn('⚠️ Dados de pickup/dropoff não encontrados');
            return null;
        }

        const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap';
        const params = new URLSearchParams({
            size: '800x400',
            maptype: 'roadmap',
            format: 'png',
            language: 'pt-BR',
            region: 'BR',
            key: this.GOOGLE_MAPS_API_KEY
        });

        // Adicionar marcadores
        params.append('markers', `color:green|label:A|${pickup.lat},${pickup.lng}`);
        params.append('markers', `color:red|label:B|${dropoff.lat},${dropoff.lng}`);

        // Adicionar rota se houver coordenadas da viagem
        if (rideData.coords && Array.isArray(rideData.coords) && rideData.coords.length > 2) {
            const pathPoints = rideData.coords.map(coord => `${coord.latitude},${coord.longitude}`).join('|');
            params.append('path', `color:0x0000ff|weight:3|${pathPoints}`);
        } else {
            // Rota simples entre origem e destino
            params.append('path', `color:0x0000ff|weight:3|${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}`);
        }

        const mapUrl = `${baseUrl}?${params.toString()}`;

        logger.info(`🗺️ URL da imagem do mapa gerada: ${mapUrl.substring(0, 100)}...`);
        return mapUrl;
    }

    /**
     * Converte código de pagamento para nome legível
     */
    getPaymentMethodName(paymentMode) {
        const paymentMethods = {
            'cash': 'Dinheiro',
            'card': 'Cartão',
            'wallet': 'Carteira Digital',
            'pix': 'PIX',
            'credit_card': 'Cartão de Crédito',
            'debit_card': 'Cartão de Débito',
            'digital_wallet': 'Carteira Digital'
        };

        return paymentMethods[paymentMode] || 'Não informado';
    }

    /**
     * Busca e gera recibo para uma corrida específica
     */
    async getReceiptByRideId(rideId, redis, firebaseDb) {
        try {
            logger.info(`🔍 Buscando dados da corrida: ${rideId}`);

            const storedReceipt = await this.getReceiptFromFirestore(rideId, firebaseDb);
            if (storedReceipt) {
                return storedReceipt;
            }

            // Tentar buscar do Redis primeiro
            let rideData = null;
            if (redis) {
                const redisData = await redis.hget('bookings:active', rideId);
                if (redisData) {
                    rideData = JSON.parse(redisData);
                }
            }

            // Se não encontrou no Redis, buscar no Firebase
            if (!rideData && firebaseDb) {
                const snapshot = await firebaseDb.ref(`bookings/${rideId}`).once('value');
                rideData = snapshot.val();
            }

            if (!rideData) {
                return null;
            }

            // Gerar recibo
            return await this.generateReceipt(rideId, rideData);

        } catch (error) {
            logger.error(`❌ Erro ao buscar dados da corrida ${rideId}:`, error);
            throw error;
        }
    }

    /**
     * Salva recibo no Firestore
     * @param {Object} receipt - Recibo gerado
     * @param {Object} firebaseDb - Instância do Firebase Database
     * @returns {Promise<boolean>} - true se salvo com sucesso
     */
    async saveReceiptToFirestore(receipt, firebaseDb) {
        try {
            if (!firebaseDb) {
                logger.warn('⚠️ Firebase Database não disponível para salvar recibo');
                return false;
            }

            const receiptData = {
                ...receipt,
                savedAt: new Date().toISOString(),
                savedTimestamp: Date.now()
            };

            // Salvar na coleção receipts
            await firebaseDb.ref(`receipts/${receipt.rideId}`).set(receiptData);

            // Também salvar referência na corrida para fácil acesso
            await firebaseDb.ref(`bookings/${receipt.rideId}/receipt`).set({
                receiptId: receipt.receiptId,
                hash: receipt.hash,
                savedAt: receiptData.savedAt
            });

            logger.info(`✅ Recibo salvo no Firestore: ${receipt.receiptId}`);
            return true;

        } catch (error) {
            logger.error(`❌ Erro ao salvar recibo no Firestore:`, error);
            return false;
        }
    }

    /**
     * Busca recibo do Firestore
     * @param {string} rideId - ID da corrida
     * @param {Object} firebaseDb - Instância do Firebase Database
     * @returns {Promise<Object|null>} - Recibo encontrado ou null
     */
    async getReceiptFromFirestore(rideId, firebaseDb) {
        try {
            if (!firebaseDb) {
                return null;
            }

            const snapshot = await firebaseDb.ref(`receipts/${rideId}`).once('value');
            return snapshot.val();

        } catch (error) {
            logger.error(`❌ Erro ao buscar recibo do Firestore:`, error);
            return null;
        }
    }

    /**
     * Gera e salva recibo completo
     * @param {string} rideId - ID da corrida
     * @param {Object} rideData - Dados da corrida
     * @param {Object} firebaseDb - Instância do Firebase Database (opcional)
     * @returns {Promise<Object>} - Recibo gerado
     */
    async generateAndSaveReceipt(rideId, rideData, firebaseDb = null) {
        try {
            // Gerar recibo
            const receipt = await this.generateReceipt(rideId, rideData);
            let receiptTelemetry = {
                firebase: {
                    reads: 0,
                    writes: 0
                }
            };

            // Salvar no Firestore se disponível
            if (firebaseDb) {
                const saved = await this.saveReceiptToFirestore(receipt, firebaseDb);
                if (saved) {
                    receiptTelemetry = {
                        firebase: {
                            reads: 0,
                            writes: 2
                        }
                    };
                }
            }

            Object.defineProperty(receipt, '__telemetry', {
                value: receiptTelemetry,
                enumerable: false,
                configurable: false,
                writable: false
            });

            return receipt;

        } catch (error) {
            logger.error(`❌ Erro ao gerar e salvar recibo:`, error);
            throw error;
        }
    }

    /**
     * Gera recibo em formato PDF em buffer de memória
     * @param {Object} receipt - Objeto gerado por generateReceipt
     * @returns {Promise<Buffer>} - Buffer do arquivo PDF
     */
    async generatePDFReceipt(receipt) {
        return new Promise((resolve, reject) => {
            try {
                logger.info(`📄 Gerando PDF para recibo: ${receipt.receiptId}`);

                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                const buffers = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfData = Buffer.concat(buffers);
                    logger.info(`✅ PDF gerado com sucesso [${pdfData.length} bytes]`);
                    resolve(pdfData);
                });

                // --- CABEÇALHO ---
                doc.fontSize(22).font('Helvetica-Bold').text('LEAF', { align: 'center' });
                doc.fontSize(14).font('Helvetica').text('Comprovante de Viagem', { align: 'center' });
                doc.moveDown(0.5);

                // Dados da empresa
                doc.fontSize(9).fillColor('#666666').text(receipt.legal.companyName, { align: 'center' });
                doc.text(`CNPJ: ${receipt.legal.cnpj}`, { align: 'center' });
                doc.moveDown(2);

                // --- DETALHES GERAIS ---
                doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text('Detalhes da Viagem');
                doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#dddddd').stroke();
                doc.moveDown(0.5);

                doc.fontSize(10).font('Helvetica');
                doc.text(`Data: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.trip.date} às ${receipt.trip.time}`);
                doc.font('Helvetica').text(`Passageiro: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.customer.name}`);
                doc.font('Helvetica').text(`Motorista: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.driver.name}`);
                doc.font('Helvetica').text(`Veículo: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.driver.vehicle.brandModel} (${receipt.driver.vehicle.plate})`);
                doc.moveDown(1.5);

                // --- TRAJETO ---
                doc.fontSize(14).font('Helvetica-Bold').text('Trajeto');
                doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#dddddd').stroke();
                doc.moveDown(0.5);

                doc.fontSize(10).font('Helvetica');
                doc.text(`Origem: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.trip.pickup.address}`);
                doc.font('Helvetica').text(`Destino: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.trip.dropoff.address}`);
                doc.moveDown(0.5);
                doc.font('Helvetica').text(`Distância: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.trip.distance.formatted}`, { continued: true })
                    .font('Helvetica').text(`  |  Duração: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.trip.durationFormatted}`);
                doc.moveDown(1.5);

                // --- RESUMO FINANCEIRO ---
                doc.fontSize(14).font('Helvetica-Bold').text('Resumo Financeiro');
                doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#dddddd').stroke();
                doc.moveDown(0.5);

                doc.fontSize(16).font('Helvetica-Bold').text(`Total Pago: ${receipt.financial.totalPaid.formatted}`);
                doc.moveDown(0.2);
                doc.fontSize(10).font('Helvetica').text(`Forma de Pagamento: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.payment.method}`);
                doc.font('Helvetica').text(`Status: `, { continued: true }).font('Helvetica-Bold').text(`${receipt.payment.status === 'completed' || receipt.payment.status === 'PAID' ? 'Pago' : receipt.payment.status}`);
                doc.moveDown(2);

                // --- RODAPÉ & AVISOS LEGAIS ---
                // Empurra o rodapé para o fim se for possível, mas aqui usaremos posição simples
                doc.moveDown(3);
                doc.fontSize(8).fillColor('#999999').font('Helvetica');

                doc.text(receipt.legal.note, { align: 'center', width: 500 });
                doc.text(receipt.legal.privacyPolicy, { align: 'center', link: receipt.legal.privacyPolicy, underline: true });
                doc.moveDown(0.5);
                doc.text(`Recibo gerado em: ${new Date(receipt.issueDate).toLocaleString('pt-BR')}`, { align: 'center' });
                doc.text(`Dúvidas? Entre em contato com o suporte na plataforma LEAF.`, { align: 'center' });
                doc.moveDown(0.5);

                // Hash e IDs pequenos
                doc.fontSize(6).fillColor('#bbbbbb').text(`ID: ${receipt.receiptId} | REF: ${receipt.reference}`, { align: 'center' });
                doc.text(`HASH: ${receipt.hash}`, { align: 'center' });

                doc.end();
            } catch (error) {
                logger.error(`❌ Erro ao gerar PDF: ${error.message}`);
                reject(error);
            }
        });
    }
}

module.exports = ReceiptService;
