const cron = require('node-cron');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');
const admin = require('firebase-admin');

// 1 Semana de anuidade
const SUBSCRIPTION_FEE_REAIS = 49.90;
const SUBSCRIPTION_FEE_CENTS = 4990;

async function processSubscriptions() {
    logStructured('info', 'Iniciando processamento do Cron Job Semanal de Assinaturas (R$ 49,90) - Domingo 00:00', { service: 'cron-subscription' });

    try {
        const firestore = firebaseConfig.getFirestore();
        if (!firestore) throw new Error('Firestore indisponível!');

        // 1. Obter todos os usuários que são motoristas
        const usersRef = firestore.collection('users');
        const driversSnapshot = await usersRef.where('isApproved', '==', true).get();
        // Em um sistema real, faríamos em lotes se fossem 10.000+ drivers.

        let processedCount = 0;
        let successfulDeductions = 0;
        let gracePeriodApplied = 0;

        for (const doc of driversSnapshot.docs) {
            const driverId = doc.id;
            const driverData = doc.data();

            // Pular se não for motorista na nova modelagem
            if (driverData.roles && !driverData.roles.includes('driver')) {
                continue;
            }

            processedCount++;
            const balanceRef = firestore.collection('driver_balances').doc(driverId);
            const userRef = usersRef.doc(driverId);

            await firestore.runTransaction(async (transaction) => {
                const balanceDoc = await transaction.get(balanceRef);
                const currentBalance = balanceDoc.exists ? (balanceDoc.data().balance || 0) : 0;

                const driverProfile = driverData.driverProfile || {};

                if (currentBalance >= SUBSCRIPTION_FEE_REAIS) {
                    // Cenário A: Tem saldo (>= 49.90)
                    const newBalance = currentBalance - SUBSCRIPTION_FEE_REAIS;

                    // Deduz do Saldo Virtual
                    transaction.set(balanceRef, {
                        balance: newBalance,
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    // Reseta status de dívida
                    driverProfile.subscriptionStatus = 'ACTIVE';
                    driverProfile.pendingFee = 0;

                    // Registra o Histórico
                    const historyRef = balanceRef.collection('transactions').doc();
                    transaction.set(historyRef, {
                        type: 'debit',
                        amount: SUBSCRIPTION_FEE_REAIS,
                        amountInCents: SUBSCRIPTION_FEE_CENTS,
                        previousBalance: currentBalance,
                        newBalance: newBalance,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        description: `Cobrança de Assinatura Semanal Leaf App`
                    });

                    // Atualiza o perfil nativo
                    transaction.set(userRef, { driverProfile }, { merge: true });

                    // TODO: Fazer a chamada de Cashout na Woovi (Subaccount -> Master)
                    logStructured('info', `Assinatura debitada com sucesso para ${driverId}`, { service: 'cron-subscription', driverId, previousBalance: currentBalance, newBalance });
                    successfulDeductions++;
                } else {
                    // Cenário B: Não tem saldo
                    driverProfile.subscriptionStatus = 'GRACE_PERIOD';
                    // Se ele já devia e não pagou, a dívida acumula ou permanece? Vamos assumir que acumula ou renova.
                    driverProfile.pendingFee = (driverProfile.pendingFee || 0) + SUBSCRIPTION_FEE_REAIS;

                    // Salva status de carência
                    transaction.set(userRef, { driverProfile }, { merge: true });
                    logStructured('info', `Motorista ${driverId} entrou em Período de Graça`, { service: 'cron-subscription', driverId, currentBalance, pendingFee: driverProfile.pendingFee });
                    gracePeriodApplied++;
                }
            });
        }

        logStructured('info', 'Processamento do Cron Job Semanal Local concluído', {
            service: 'cron-subscription',
            processedCount,
            successfulDeductions,
            gracePeriodApplied
        });

    } catch (error) {
        logError(error, 'Falha catastrófica no Cron Job de Assinaturas', { service: 'cron-subscription' });
    }
}

// Age aos Domingos às 00:00 (Para testes locais, você pode mudar o cron)
const SCHEDULE = '0 0 * * 0';

cron.schedule(SCHEDULE, () => {
    processSubscriptions();
});

logStructured('info', `Worker do CronJob registrado. Padrão: ${SCHEDULE}`, { service: 'cron-subscription' });

// Se executado diretamente via terminal, a gente roda 1x para teste:
if (require.main === module) {
    processSubscriptions().then(() => {
        console.log('Finalizando mock test script local.');
        process.exit(0);
    });
}

module.exports = {
    processSubscriptions
};
