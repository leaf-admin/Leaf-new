/**
 * 🧾 RECEIPT SERVICE - GERAÇÃO DE RECIBOS DE CORRIDA
 * 
 * Este serviço gera recibos completos com:
 * - Informações detalhadas da viagem
 * - Cálculos de valores e taxas
 * - Imagem estática do trajeto
 * - Dados para conformidade legal
 */

const logger = require('../utils/logger');

class ReceiptService {
    constructor() {
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GEO_KEY;
        this.OPERATIONAL_FEES = {
            low: 0.79,    // Corridas < R$ 10,00
            medium: 0.99, // Corridas R$ 10,00 - R$ 20,00
            high: 1.49    // Corridas > R$ 20,00
        };
        // Taxa de pagamento PIX - Fixa R$ 0,50
        this.PAYMENT_PROCESSING_RATE = 0; // Sem percentual
        this.PAYMENT_FIXED_FEE = 0.50; // R$ 0,50 fixo para PIX
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

            // 1. Calcular valores financeiros
            const financialBreakdown = this.calculateFinancialBreakdown(rideData);

            // 2. Calcular métricas da viagem
            const tripMetrics = this.calculateTripMetrics(rideData);

            // 3. Gerar URL da imagem estática do mapa
            const mapImageUrl = this.generateStaticMapImage(rideData);

            // 4. Formatar dados do recibo
            const receipt = {
                // === IDENTIFICAÇÃO ===
                receiptId: `LEAF-${rideId}`,
                rideId: rideId,
                reference: rideData.reference || rideId.substring(0, 6).toUpperCase(),
                issueDate: new Date().toISOString(),
                issueTimestamp: Date.now(),

                // === DADOS DA VIAGEM ===
                trip: {
                    startTime: rideData.tripStartTime || rideData.bookingDate,
                    endTime: rideData.endTime || rideData.completedAt,
                    duration: tripMetrics.duration,
                    durationFormatted: tripMetrics.durationFormatted,
                    
                    pickup: {
                        address: rideData.pickup?.add || 'Endereço de origem',
                        coordinates: {
                            lat: rideData.pickup?.lat || 0,
                            lng: rideData.pickup?.lng || 0
                        },
                        timestamp: rideData.tripStartTime
                    },
                    
                    dropoff: {
                        address: rideData.drop?.add || 'Endereço de destino', 
                        coordinates: {
                            lat: rideData.drop?.lat || 0,
                            lng: rideData.drop?.lng || 0
                        },
                        timestamp: rideData.endTime
                    },
                    
                    distance: {
                        estimated: parseFloat(rideData.estimateDistance || 0),
                        actual: parseFloat(rideData.distance || rideData.estimateDistance || 0),
                        unit: 'km'
                    },
                    
                    mapImage: {
                        url: mapImageUrl,
                        width: 800,
                        height: 400
                    }
                },

                // === DADOS DO PASSAGEIRO ===
                customer: {
                    name: rideData.customer_name || 'Passageiro',
                    email: rideData.customer_email || '',
                    phone: rideData.customer_contact || '',
                    id: rideData.customer || ''
                },

                // === DADOS DO MOTORISTA ===
                driver: {
                    name: rideData.driver_name || 'Motorista Parceiro',
                    id: rideData.driver || '',
                    vehicle: {
                        type: rideData.carType || 'Veículo',
                        plate: rideData.vehicle_plate || 'N/A'
                    }
                },

                // === VALORES FINANCEIROS ===
                financial: financialBreakdown,

                // === FORMA DE PAGAMENTO ===
                payment: {
                    method: 'PIX', // Apenas PIX disponível no momento
                    status: rideData.payment_status || 'completed',
                    transactionId: rideData.txnId || '',
                    processedAt: rideData.paymentDate || rideData.completedAt,
                    processingFee: {
                        amount: this.PAYMENT_FIXED_FEE,
                        description: 'Taxa fixa PIX'
                    }
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
                    version: '1.0',
                    generatedBy: 'Leaf Receipt Service',
                    status: rideData.status || 'COMPLETED'
                }
            };

            logger.info(`✅ Recibo gerado com sucesso para corrida: ${rideId}`);
            return receipt;

        } catch (error) {
            logger.error(`❌ Erro ao gerar recibo para corrida ${rideId}:`, error);
            throw new Error(`Falha ao gerar recibo: ${error.message}`);
        }
    }

    /**
     * Calcula breakdown financeiro detalhado
     */
    calculateFinancialBreakdown(rideData) {
        const totalFare = parseFloat(rideData.finalPrice || rideData.customer_paid || rideData.estimate || 0);
        
        // Calcular taxa operacional baseada no valor
        let operationalFee = this.OPERATIONAL_FEES.high; // Default
        if (totalFare < 10.00) {
            operationalFee = this.OPERATIONAL_FEES.low;
        } else if (totalFare <= 20.00) {
            operationalFee = this.OPERATIONAL_FEES.medium;
        }

        // Taxa de processamento de pagamento PIX - R$ 0,50 fixo
        const paymentProcessingFee = this.PAYMENT_FIXED_FEE; // R$ 0,50 para PIX
        
        // Calcular valor líquido para o motorista
        const driverAmount = Math.max(0, totalFare - operationalFee - paymentProcessingFee);

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
                
                paymentProcessing: {
                    amount: paymentProcessingFee,
                    formatted: `R$ ${paymentProcessingFee.toFixed(2).replace('.', ',')}`
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
                paymentFees: paymentProcessingFee
            }
        };
    }

    /**
     * Calcula métricas da viagem
     */
    calculateTripMetrics(rideData) {
        const startTime = new Date(rideData.tripStartTime || rideData.bookingDate);
        const endTime = new Date(rideData.endTime || rideData.completedAt || Date.now());
        
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = Math.round(durationMs / (1000 * 60));
        
        // Formatar duração
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        const durationFormatted = hours > 0 
            ? `${hours}h ${minutes}min`
            : `${minutes}min`;

        return {
            duration: durationMinutes,
            durationFormatted,
            startTime: startTime.toISOString(),
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
                throw new Error(`Corrida ${rideId} não encontrada`);
            }

            // Gerar recibo
            return await this.generateReceipt(rideId, rideData);

        } catch (error) {
            logger.error(`❌ Erro ao buscar dados da corrida ${rideId}:`, error);
            throw error;
        }
    }

    /**
     * Gera recibo em formato PDF (placeholder para implementação futura)
     */
    async generatePDFReceipt(receipt) {
        // TODO: Implementar geração de PDF usando puppeteer ou similar
        logger.info('📄 Geração de PDF será implementada em versão futura');
        return null;
    }
}

module.exports = ReceiptService;
