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

class ReceiptService {
    constructor() {
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GEO_KEY;
        this.OPERATIONAL_FEES = {
            low: 0.79,    // Corridas até R$ 10,00
            medium: 0.99, // Corridas acima de R$ 10,00 e abaixo de R$ 25,00
            high: 1.49    // Corridas acima de R$ 25,00
        };
        this.WOOVI_FEE_PERCENTAGE = 0.008; // 0,8% da transação
        this.WOOVI_FEE_MINIMUM = 0.50; // R$ 0,50 mínimo
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
     * Formata data e horário para exibição
     * @param {string} dateString - Data em ISO string
     * @returns {Object} - Objeto com data e horário formatados
     */
    formatDateTime(dateString) {
        if (!dateString) return { date: 'N/A', time: 'N/A' };

        const date = new Date(dateString);
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

            // 4. Gerar hash único de identificação
            const receiptHash = this.generateReceiptHash(rideId, rideData);

            // 5. Formatar data e horário
            const tripDate = rideData.endTime || rideData.completedAt || rideData.tripStartTime || rideData.bookingDate;
            const { date: tripDateFormatted, time: tripTimeFormatted } = this.formatDateTime(tripDate);

            // 6. Obter destino para título
            const destination = rideData.drop?.add || 'destino';

            // 7. Formatar dados do recibo conforme estrutura solicitada
            const receipt = {
                // === IDENTIFICAÇÃO E HASH ===
                receiptId: `LEAF-${rideId}`,
                rideId: rideId,
                reference: rideData.reference || rideId.substring(0, 6).toUpperCase(),
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
                        address: rideData.pickup?.add || 'Endereço de origem',
                        coordinates: {
                            lat: rideData.pickup?.lat || 0,
                            lng: rideData.pickup?.lng || 0
                        },
                        timestamp: rideData.tripStartTime
                    },

                    // Local de destino
                    dropoff: {
                        address: rideData.drop?.add || 'Endereço de destino',
                        coordinates: {
                            lat: rideData.drop?.lat || 0,
                            lng: rideData.drop?.lng || 0
                        },
                        timestamp: rideData.endTime
                    },

                    // Tempo de viagem e distância
                    duration: tripMetrics.duration, // em minutos
                    durationFormatted: tripMetrics.durationFormatted,
                    distance: {
                        estimated: parseFloat(rideData.estimateDistance || 0),
                        actual: parseFloat(rideData.distance || rideData.estimateDistance || 0),
                        unit: 'km',
                        formatted: `${(parseFloat(rideData.distance || rideData.estimateDistance || 0) / 1000).toFixed(2)} km`
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
                    name: rideData.customer_name || 'Passageiro',
                    email: rideData.customer_email || '',
                    phone: rideData.customer_contact || '',
                    id: rideData.customer || ''
                },

                // === DADOS DO MOTORISTA ===
                driver: {
                    name: rideData.driver_name || 'Motorista Parceiro',
                    fullName: rideData.driver_name || 'Motorista Parceiro', // Nome completo
                    id: rideData.driver || '',
                    vehicle: {
                        type: rideData.carType || 'Veículo',
                        plate: rideData.vehicle_plate || 'N/A',
                        brand: rideData.vehicleMake || '',
                        model: rideData.vehicleModel || '',
                        brandModel: `${rideData.vehicleMake || ''} ${rideData.vehicleModel || ''}`.trim() || 'Veículo'
                    }
                },

                // === VALORES FINANCEIROS ===
                financial: financialBreakdown,

                // === FORMA DE PAGAMENTO ===
                payment: {
                    method: this.getPaymentMethodName(rideData.payment_mode),
                    status: rideData.payment_status || 'completed',
                    transactionId: rideData.txnId || '',
                    processedAt: rideData.paymentDate || rideData.completedAt
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

        // Calcular taxa operacional baseada no valor (3 faixas)
        let operationalFee;
        if (totalFare <= 10.00) {
            // Até R$ 10,00
            operationalFee = this.OPERATIONAL_FEES.low;
        } else if (totalFare <= 25.00) {
            // Acima de R$ 10,00 e abaixo de R$ 25,00
            operationalFee = this.OPERATIONAL_FEES.medium;
        } else {
            // Acima de R$ 25,00
            operationalFee = this.OPERATIONAL_FEES.high;
        }

        // Taxa Woovi: 0,8% com mínimo de R$ 0,50
        const wooviFee = Math.max(totalFare * this.WOOVI_FEE_PERCENTAGE, this.WOOVI_FEE_MINIMUM);

        // Calcular valor líquido para o motorista
        const driverAmount = Math.max(0, totalFare - operationalFee - wooviFee);

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
                wooviFee: wooviFee
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

            // Salvar no Firestore se disponível
            if (firebaseDb) {
                await this.saveReceiptToFirestore(receipt, firebaseDb);
            }

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




