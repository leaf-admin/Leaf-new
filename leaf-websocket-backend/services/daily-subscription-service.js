/**
 * DAILY SUBSCRIPTION SERVICE
 * 
 * Serviço para cobrança diária de assinatura do saldo do motorista
 * Divide R$ 49,90 semanal por 7 dias = R$ 7,13/dia
 * Divide R$ 99,90 semanal por 7 dias = R$ 14,27/dia
 */

const { logger } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const admin = require('firebase-admin');

class DailySubscriptionService {
    constructor() {
        // Valores diários calculados
        this.DAILY_FEE_PLUS = 49.90 / 7;  // R$ 7,13/dia
        this.DAILY_FEE_ELITE = 99.90 / 7; // R$ 14,27/dia
        
        // Arredondar para 2 casas decimais
        this.DAILY_FEE_PLUS = Math.round(this.DAILY_FEE_PLUS * 100) / 100;
        this.DAILY_FEE_ELITE = Math.round(this.DAILY_FEE_ELITE * 100) / 100;
        
        logger.info('✅ DailySubscriptionService inicializado', {
            dailyFeePlus: this.DAILY_FEE_PLUS,
            dailyFeeElite: this.DAILY_FEE_ELITE
        });
    }

    /**
     * Verificar se motorista está em período grátis (trial ou meses grátis)
     * @param {Object} driverData - Dados do motorista
     * @returns {boolean} true se está em período grátis
     */
    isInFreePeriod(driverData) {
        const now = new Date();
        
        // Verificar trial dos primeiros 500
        if (driverData.is_first_500 === true) {
            const freeTrialEnd = driverData.free_trial_end ? new Date(driverData.free_trial_end) : null;
            if (freeTrialEnd && now < freeTrialEnd) {
                return true; // Está em trial
            }
        }
        
        // Verificar meses grátis por convites
        const freeMonthsRemaining = driverData.free_months || 0;
        if (freeMonthsRemaining > 0) {
            const freeMonthsEnd = driverData.free_months_end ? new Date(driverData.free_months_end) : null;
            if (freeMonthsEnd && now < freeMonthsEnd) {
                return true; // Está em meses grátis
            }
        }
        
        return false; // Não está em período grátis
    }

    /**
     * Obter valor diário baseado no plano
     * @param {string} planType - 'plus' ou 'elite'
     * @returns {number} Valor diário em reais
     */
    getDailyFee(planType) {
        if (planType === 'elite') {
            return this.DAILY_FEE_ELITE;
        }
        return this.DAILY_FEE_PLUS; // Padrão: plus
    }

    /**
     * Debitar valor diário do saldo do motorista
     * @param {string} driverId - ID do motorista
     * @param {number} amount - Valor em reais a debitar
     * @returns {Promise<Object>} Resultado do débito
     */
    async debitDriverBalance(driverId, amount) {
        try {
            const firestore = firebaseConfig.getFirestore();
            
            if (!firestore) {
                return {
                    success: false,
                    error: 'Firestore não disponível'
                };
            }

            const balanceRef = firestore.collection('driver_balances').doc(driverId);

            // Usar transação para garantir consistência
            const result = await firestore.runTransaction(async (transaction) => {
                const balanceDoc = await transaction.get(balanceRef);
                
                let currentBalance = 0;
                
                if (balanceDoc.exists) {
                    const data = balanceDoc.data();
                    currentBalance = data.balance || 0;
                }

                const newBalance = currentBalance - amount;

                // Verificar se saldo é suficiente
                if (newBalance < 0) {
                    return {
                        success: false,
                        error: 'Saldo insuficiente',
                        currentBalance: currentBalance,
                        requiredAmount: amount,
                        shortfall: Math.abs(newBalance)
                    };
                }

                // Atualizar saldo
                transaction.set(balanceRef, {
                    driverId: driverId,
                    balance: newBalance,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                    lastDebitAmount: amount,
                    lastDebitType: 'daily_subscription'
                }, { merge: true });

                return {
                    success: true,
                    previousBalance: currentBalance,
                    newBalance: newBalance,
                    debitAmount: amount,
                    balanceId: driverId
                };
            });

            // Salvar histórico da transação
            if (result.success) {
                const historyRef = firestore
                    .collection('driver_balances')
                    .doc(driverId)
                    .collection('transactions')
                    .doc();

                await historyRef.set({
                    type: 'debit',
                    amount: -amount, // Negativo para débito
                    description: 'Cobrança diária de assinatura',
                    subscriptionType: 'daily',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    previousBalance: result.previousBalance,
                    newBalance: result.newBalance
                });

                logger.info(`✅ Cobrança diária debitada: R$ ${amount.toFixed(2)} do motorista ${driverId}`, {
                    previousBalance: result.previousBalance,
                    newBalance: result.newBalance
                });
            } else {
                logger.warn(`⚠️ Saldo insuficiente para cobrança diária: motorista ${driverId}`, {
                    currentBalance: result.currentBalance,
                    requiredAmount: amount,
                    shortfall: result.shortfall
                });
            }

            return result;

        } catch (error) {
            logger.error(`❌ Erro ao debitar saldo do motorista ${driverId}:`, error);
            return {
                success: false,
                error: 'Erro interno do servidor',
                details: error.message
            };
        }
    }

    /**
     * Processar cobrança diária para um motorista
     * @param {string} driverId - ID do motorista
     * @param {Object} driverData - Dados do motorista
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processDailyCharge(driverId, driverData) {
        try {
            // Verificar se está em período grátis
            if (this.isInFreePeriod(driverData)) {
                logger.info(`ℹ️ Motorista ${driverId} está em período grátis, pulando cobrança`);
                return {
                    success: true,
                    skipped: true,
                    reason: 'free_period',
                    message: 'Motorista está em período grátis (trial ou meses grátis)'
                };
            }

            // Verificar se motorista está aprovado e ativo
            if (driverData.approved !== true) {
                logger.info(`ℹ️ Motorista ${driverId} não está aprovado, pulando cobrança`);
                return {
                    success: true,
                    skipped: true,
                    reason: 'not_approved',
                    message: 'Motorista não está aprovado'
                };
            }

            // Obter plano do motorista
            const planType = driverData.planType || driverData.subscription?.planType || 'plus';
            const dailyFee = this.getDailyFee(planType);

            // Debitar do saldo
            const debitResult = await this.debitDriverBalance(driverId, dailyFee);

            if (!debitResult.success) {
                // Saldo insuficiente - marcar como overdue
                if (debitResult.error === 'Saldo insuficiente') {
                    await this.markSubscriptionOverdue(driverId, debitResult.shortfall);
                }

                return {
                    success: false,
                    error: debitResult.error,
                    details: debitResult
                };
            }

            // Registrar cobrança bem-sucedida
            await this.recordDailyCharge(driverId, dailyFee, planType, debitResult);

            return {
                success: true,
                dailyFee: dailyFee,
                planType: planType,
                previousBalance: debitResult.previousBalance,
                newBalance: debitResult.newBalance,
                message: `Cobrança diária de R$ ${dailyFee.toFixed(2)} processada com sucesso`
            };

        } catch (error) {
            logger.error(`❌ Erro ao processar cobrança diária para motorista ${driverId}:`, error);
            return {
                success: false,
                error: 'Erro interno do servidor',
                details: error.message
            };
        }
    }

    /**
     * Processar cobrança diária para todos os motoristas ativos
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processAllDailyCharges() {
        try {
            logger.info('🔄 Iniciando processamento de cobranças diárias...');

            const firestore = firebaseConfig.getFirestore();
            if (!firestore) {
                return {
                    success: false,
                    error: 'Firestore não disponível'
                };
            }

            // Buscar todos os motoristas
            const usersRef = firebaseConfig.getRealtimeDB().ref('users');
            const usersSnapshot = await usersRef.once('value');
            const users = usersSnapshot.val() || {};

            const results = {
                total: 0,
                processed: 0,
                skipped: 0,
                failed: 0,
                details: []
            };

            // Processar cada motorista
            for (const [driverId, driverData] of Object.entries(users)) {
                if (driverData.usertype !== 'driver') {
                    continue; // Pular se não for motorista
                }

                results.total++;

                const chargeResult = await this.processDailyCharge(driverId, driverData);

                if (chargeResult.success) {
                    if (chargeResult.skipped) {
                        results.skipped++;
                    } else {
                        results.processed++;
                    }
                } else {
                    results.failed++;
                }

                results.details.push({
                    driverId,
                    result: chargeResult
                });
            }

            logger.info('✅ Processamento de cobranças diárias concluído', results);

            return {
                success: true,
                ...results
            };

        } catch (error) {
            logger.error('❌ Erro ao processar cobranças diárias:', error);
            return {
                success: false,
                error: 'Erro interno do servidor',
                details: error.message
            };
        }
    }

    /**
     * Marcar assinatura como overdue (em atraso)
     * @param {string} driverId - ID do motorista
     * @param {number} shortfall - Valor em falta
     */
    async markSubscriptionOverdue(driverId, shortfall) {
        try {
            const db = firebaseConfig.getRealtimeDB();
            const subscriptionRef = db.ref(`subscriptions/${driverId}`);
            
            await subscriptionRef.update({
                status: 'overdue',
                overdueAmount: shortfall,
                lastOverdueDate: new Date().toISOString()
            });

            logger.warn(`⚠️ Assinatura do motorista ${driverId} marcada como overdue`, {
                shortfall: shortfall
            });
        } catch (error) {
            logger.error(`❌ Erro ao marcar assinatura como overdue para ${driverId}:`, error);
        }
    }

    /**
     * Registrar cobrança diária no histórico
     * @param {string} driverId - ID do motorista
     * @param {number} amount - Valor cobrado
     * @param {string} planType - Tipo de plano
     * @param {Object} debitResult - Resultado do débito
     */
    async recordDailyCharge(driverId, amount, planType, debitResult) {
        try {
            const db = firebaseConfig.getRealtimeDB();
            const chargeId = `daily_${Date.now()}_${driverId}`;
            
            await db.ref(`subscription_charges/${chargeId}`).set({
                driverId,
                type: 'daily',
                amount,
                planType,
                previousBalance: debitResult.previousBalance,
                newBalance: debitResult.newBalance,
                timestamp: new Date().toISOString(),
                status: 'paid'
            });
        } catch (error) {
            logger.error(`❌ Erro ao registrar cobrança diária para ${driverId}:`, error);
        }
    }
}

// Exportar instância singleton
const dailySubscriptionService = new DailySubscriptionService();
module.exports = dailySubscriptionService;

