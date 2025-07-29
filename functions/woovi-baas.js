const admin = require('firebase-admin');
const axios = require('axios');

// Configuração do BaaS
const LEAF_BAAS_CONFIG = {
  main_account: {
    id: process.env.WOOVI_BAAS_MAIN_ACCOUNT_ID || 'leaf_principal_account',
    name: 'Leaf App - Conta Principal',
    type: 'business',
    auto_split: true
  },
  
  driver_accounts: {
    auto_create: true,
    split_percentage: 100, // 100% para motorista
    transfer_delay: 'instant', // Transferência imediata
    fee_structure: {
      platform_fee: 0, // 0% por corrida
      processing_fee: 0, // 0% por corrida
      driver_net: 100, // 100% para motorista
      // Nova estrutura de cobrança operacional
      operational_fee: {
        small_rides: 0.79,    // Corridas < R$ 10,00
        medium_rides: 0.99,   // Corridas R$ 10,00 - R$ 20,00
        large_rides: 1.49     // Corridas > R$ 20,00
      }
    }
  },

  // Nova configuração de cobrança semanal
  weekly_billing: {
    enabled: true, // Pode ser ativado/desativado
    day_of_week: 'friday', // Cobrança toda sexta-feira
    time: '00:00', // Horário da cobrança
    auto_deduct_from_balance: true, // Deduz do saldo automaticamente
    free_trial_days: 90, // 90 dias grátis
    max_free_trial_drivers: 500, // Primeiros 500 motoristas
    referral_system: {
      enabled: true,
      invites_per_driver: 3, // Limite de 3 convites por motorista
      required_rides_per_invitee: 10, // 10 corridas mínimas
      free_months_per_invite: 1, // 1 mês grátis por convite
      max_free_months: 12 // Máximo de 12 meses grátis
    }
  },

  // Sistema de saldo da conta do parceiro
  partner_balance: {
    enabled: true,
    minimum_balance: 49.90, // Saldo mínimo para ficar online
    qr_code_amount: 49.90, // Valor do QR Code para regularização
    auto_suspend: true, // Suspender automaticamente se saldo insuficiente
    notification_threshold: 10.00, // Notificar quando saldo < R$ 10,00
    online_status: {
      enabled: true,
      require_balance: true, // Requer saldo para ficar online
      disable_button: true, // Desabilitar botão se saldo insuficiente
      show_qr_code: true // Mostrar QR Code para regularização
    }
  }
};

// Configuração da API Woovi
const WOOVI_CONFIG = {
  apiKey: process.env.WOOVI_API_KEY,
  appId: process.env.WOOVI_APP_ID,
  baseURL: 'https://api.openpix.com.br',
  webhookURL: process.env.WOOVI_BAAS_WEBHOOK_URL || 'https://us-central1-leaf-reactnative.cloudfunctions.net/baas_webhook'
};

/**
 * Calcular taxa operacional baseada no valor da corrida
 * @param {number} rideValue - Valor da corrida
 * @returns {number} Taxa operacional
 */
function calculateOperationalFee(rideValue) {
  if (rideValue < 10.00) {
    return LEAF_BAAS_CONFIG.driver_accounts.fee_structure.operational_fee.small_rides;
  } else if (rideValue <= 20.00) {
    return LEAF_BAAS_CONFIG.driver_accounts.fee_structure.operational_fee.medium_rides;
  } else {
    return LEAF_BAAS_CONFIG.driver_accounts.fee_structure.operational_fee.large_rides;
  }
}

/**
 * Verificar se motorista pode ficar online baseado no saldo
 * @param {string} driverId - ID do motorista
 * @returns {Object} Status do motorista
 */
async function checkDriverOnlineStatus(driverId) {
  try {
    console.log('Verificando status online do motorista:', driverId);
    
    // Obter dados do motorista
    const driverDoc = await admin.firestore().collection('users').doc(driverId).get();
    const driverData = driverDoc.data();
    
    if (!driverData) {
      throw new Error('Motorista não encontrado');
    }
    
    // Verificar se tem conta Leaf
    if (!driverData.leaf_account_id) {
      return {
        canGoOnline: false,
        reason: 'no_leaf_account',
        message: 'Conta Leaf não configurada',
        qrCodeRequired: true,
        qrCodeAmount: LEAF_BAAS_CONFIG.partner_balance.qr_code_amount
      };
    }
    
    // Verificar saldo da conta Leaf
    const balanceResponse = await getLeafAccountBalance(driverData.leaf_account_id);
    const currentBalance = balanceResponse.balance || 0;
    
    // Verificar se está em período grátis
    const now = new Date();
    const freeTrialEnd = driverData.free_trial_end ? new Date(driverData.free_trial_end) : null;
    const isInFreeTrial = freeTrialEnd && now < freeTrialEnd;
    
    if (isInFreeTrial) {
      return {
        canGoOnline: true,
        reason: 'free_trial',
        message: 'Período grátis ativo',
        balance: currentBalance,
        freeTrialEnd: freeTrialEnd
      };
    }
    
    // Verificar saldo mínimo
    const minimumBalance = LEAF_BAAS_CONFIG.partner_balance.minimum_balance;
    
    if (currentBalance >= minimumBalance) {
      return {
        canGoOnline: true,
        reason: 'sufficient_balance',
        message: 'Saldo suficiente',
        balance: currentBalance,
        minimumBalance: minimumBalance
      };
    } else {
      return {
        canGoOnline: false,
        reason: 'insufficient_balance',
        message: 'Saldo insuficiente para ficar online',
        balance: currentBalance,
        minimumBalance: minimumBalance,
        qrCodeRequired: true,
        qrCodeAmount: LEAF_BAAS_CONFIG.partner_balance.qr_code_amount,
        requiredAmount: minimumBalance - currentBalance
      };
    }
    
  } catch (error) {
    console.error('Erro ao verificar status online:', error);
    throw new Error('Falha ao verificar status do motorista');
  }
}

/**
 * Gerar QR Code para regularização de saldo
 * @param {string} driverId - ID do motorista
 * @param {number} amount - Valor para regularização
 * @returns {Object} Dados do QR Code
 */
async function generateBalanceQRCode(driverId, amount = null) {
  try {
    console.log('Gerando QR Code para regularização:', driverId);
    
    const qrAmount = amount || LEAF_BAAS_CONFIG.partner_balance.qr_code_amount;
    
    // Obter dados do motorista
    const driverDoc = await admin.firestore().collection('users').doc(driverId).get();
    const driverData = driverDoc.data();
    
    if (!driverData) {
      throw new Error('Motorista não encontrado');
    }
    
    // Criar cobrança PIX para regularização
    const chargeResponse = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/charge`, {
      value: qrAmount * 100, // Converter para centavos
      correlationID: `balance_regularization_${driverId}_${Date.now()}`,
      comment: `Regularização de saldo - Motorista ${driverData.firstName} ${driverData.lastName}`,
      expiresIn: 3600, // 1 hora
      additionalInfo: [
        {
          key: 'driver_id',
          value: driverId
        },
        {
          key: 'type',
          value: 'balance_regularization'
        }
      ]
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('QR Code gerado com sucesso:', chargeResponse.data);
    
    // Salvar no Firestore
    await admin.firestore().collection('balance_regularizations').doc(chargeResponse.data.correlationID).set({
      driver_id: driverId,
      amount: qrAmount,
      correlation_id: chargeResponse.data.correlationID,
      pix_code: chargeResponse.data.pixCode,
      qr_code: chargeResponse.data.qrCode,
      status: 'pending',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      expires_at: new Date(Date.now() + 3600 * 1000) // 1 hora
    });
    
    return {
      success: true,
      correlation_id: chargeResponse.data.correlationID,
      pix_code: chargeResponse.data.pixCode,
      qr_code: chargeResponse.data.qrCode,
      amount: qrAmount,
      expires_in: 3600
    };
    
  } catch (error) {
    console.error('Erro ao gerar QR Code:', error);
    throw new Error('Falha ao gerar QR Code de regularização');
  }
}

/**
 * Processar pagamento de regularização de saldo
 * @param {Object} paymentData - Dados do pagamento
 * @returns {Object} Resultado do processamento
 */
async function processBalanceRegularization(paymentData) {
  try {
    console.log('Processando regularização de saldo:', paymentData.correlationID);
    
    const { correlationID, amount, driver_id } = paymentData;
    
    // Verificar se a regularização existe
    const regularizationDoc = await admin.firestore().collection('balance_regularizations').doc(correlationID).get();
    
    if (!regularizationDoc.exists) {
      throw new Error('Regularização não encontrada');
    }
    
    const regularizationData = regularizationDoc.data();
    
    // Verificar se já foi processada
    if (regularizationData.status === 'completed') {
      return {
        success: true,
        already_processed: true,
        message: 'Regularização já foi processada'
      };
    }
    
    // Obter dados do motorista
    const driverDoc = await admin.firestore().collection('users').doc(driver_id).get();
    const driverData = driverDoc.data();
    
    if (!driverData || !driverData.leaf_account_id) {
      throw new Error('Motorista ou conta Leaf não encontrada');
    }
    
    // Adicionar saldo à conta Leaf
    const addBalanceResponse = await addToLeafBalance(driverData.leaf_account_id, amount);
    
    // Atualizar status da regularização
    await admin.firestore().collection('balance_regularizations').doc(correlationID).update({
      status: 'completed',
      processed_at: admin.firestore.FieldValue.serverTimestamp(),
      balance_added: amount
    });
    
    // Log da transação
    await logTransaction({
      type: 'BALANCE_REGULARIZATION',
      driver_id: driver_id,
      amount: amount,
      correlation_id: correlationID,
      balance_before: addBalanceResponse.balance_before,
      balance_after: addBalanceResponse.balance_after,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Notificar motorista
    await sendDriverNotification(driver_id, {
      type: 'balance_regularized',
      amount: amount,
      message: `Saldo regularizado: R$ ${amount.toFixed(2)}. Você pode ficar online agora!`
    });
    
    return {
      success: true,
      amount_added: amount,
      balance_before: addBalanceResponse.balance_before,
      balance_after: addBalanceResponse.balance_after,
      message: 'Saldo regularizado com sucesso'
    };
    
  } catch (error) {
    console.error('Erro ao processar regularização:', error);
    throw new Error('Falha ao processar regularização de saldo');
  }
}

/**
 * Criar conta Leaf para motorista
 * @param {Object} driverData - Dados do motorista
 * @returns {Object} Dados da conta criada
 */
async function createDriverLeafAccount(driverData) {
  try {
    console.log('Criando conta Leaf para motorista:', driverData.id);
    
    // Verificar se é um dos primeiros 500 motoristas
    const driverCount = await getDriverCount();
    const isFirst500 = driverCount < LEAF_BAAS_CONFIG.weekly_billing.max_free_trial_drivers;
    
    const response = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/subaccount`, {
      name: `Leaf Driver - ${driverData.firstName} ${driverData.lastName}`,
      document: driverData.cpf,
      email: driverData.email,
      phone: driverData.mobile,
      split_percentage: 100,
      auto_transfer: true,
      transfer_delay: 0, // Transferência imediata
      account_type: 'driver',
      metadata: {
        driver_id: driverData.id,
        plan_type: driverData.plan_type || 'plus',
        created_at: new Date().toISOString(),
        is_first_500: isFirst500,
        free_trial_start: isFirst500 ? new Date().toISOString() : null,
        free_trial_end: isFirst500 ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() : null
      }
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Conta Leaf criada com sucesso:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao criar conta Leaf:', error.response?.data || error.message);
    throw new Error('Falha ao criar conta do motorista');
  }
}

/**
 * Obter contagem de motoristas
 * @returns {number} Número de motoristas cadastrados
 */
async function getDriverCount() {
  try {
    const snapshot = await admin.firestore().collection('users')
      .where('userType', '==', 'driver')
      .count()
      .get();
    
    return snapshot.data().count;
  } catch (error) {
    console.error('Erro ao contar motoristas:', error);
    return 0;
  }
}

/**
 * Processar split automático - 100% para motorista
 * @param {Object} paymentData - Dados do pagamento
 * @returns {Object} Resultado do split
 */
async function processAutomaticSplit(paymentData) {
  try {
    console.log('Processando split automático para pagamento:', paymentData.charge_id);
    
    const splitData = {
      main_charge_id: paymentData.charge_id,
      splits: [
        {
          account_id: paymentData.driver.leaf_account_id,
          percentage: 100, // 100% para motorista
          amount: paymentData.value, // Valor total
          description: `Corrida ${paymentData.trip_id} - 100% para motorista`
        }
        // Sem split para Leaf - taxa é semanal
      ]
    };
    
    const response = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/split`, splitData, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Split automático processado com sucesso:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro no split automático:', error.response?.data || error.message);
    throw new Error('Falha no processamento do split');
  }
}

/**
 * Cobrança semanal automática do saldo
 * @param {Object} billingData - Dados da cobrança
 * @returns {Object} Resultado da cobrança
 */
async function processWeeklyBilling(billingData) {
  try {
    console.log('Processando cobrança semanal para motorista:', billingData.driver_id);
    
    const { driver_id, plan_type, amount } = billingData;
    
    // Verificar se o motorista está em período grátis
    const driverDoc = await admin.firestore().collection('users').doc(driver_id).get();
    const driverData = driverDoc.data();
    
    if (!driverData) {
      throw new Error('Motorista não encontrado');
    }
    
    // Verificar se está em período grátis
    const now = new Date();
    const freeTrialEnd = driverData.free_trial_end ? new Date(driverData.free_trial_end) : null;
    const isInFreeTrial = freeTrialEnd && now < freeTrialEnd;
    
    if (isInFreeTrial) {
      console.log(`Motorista ${driver_id} está em período grátis até ${freeTrialEnd}`);
      
      // Log da cobrança grátis
      await logTransaction({
        type: 'WEEKLY_BILLING_FREE',
        driver_id,
        plan_type,
        amount,
        free_trial_end: freeTrialEnd,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        success: true,
        billed: false,
        reason: 'free_trial',
        free_trial_end: freeTrialEnd
      };
    }
    
    // Verificar saldo da conta Leaf
    const balanceResponse = await getLeafAccountBalance(driverData.leaf_account_id);
    const currentBalance = balanceResponse.balance || 0;
    
    if (currentBalance >= amount) {
      // Deduzir do saldo
      const deductionResponse = await deductFromLeafBalance(driverData.leaf_account_id, amount);
      
      // Log da cobrança
      await logTransaction({
        type: 'WEEKLY_BILLING_PAID',
        driver_id,
        plan_type,
        amount,
        balance_before: currentBalance,
        balance_after: currentBalance - amount,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Notificar motorista
      await sendDriverNotification(driver_id, {
        type: 'weekly_billing_paid',
        amount,
        plan_type,
        message: `Cobrança semanal do plano ${plan_type} debitada: R$ ${amount.toFixed(2)}`
      });
      
      return {
        success: true,
        billed: true,
        amount_deducted: amount,
        balance_before: currentBalance,
        balance_after: currentBalance - amount
      };
    } else {
      // Saldo insuficiente - suspender motorista
      await admin.firestore().collection('users').doc(driver_id).update({
        billing_status: 'suspended',
        suspension_reason: 'insufficient_balance',
        suspension_date: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Log da suspensão
      await logTransaction({
        type: 'WEEKLY_BILLING_SUSPENDED',
        driver_id,
        plan_type,
        amount,
        balance: currentBalance,
        reason: 'insufficient_balance',
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Notificar motorista
      await sendDriverNotification(driver_id, {
        type: 'weekly_billing_suspended',
        amount,
        plan_type,
        message: `Conta suspensa por saldo insuficiente. Adicione R$ ${amount.toFixed(2)} para continuar.`
      });
      
      return {
        success: true,
        billed: false,
        suspended: true,
        reason: 'insufficient_balance',
        balance: currentBalance,
        required_amount: amount
      };
    }
    
  } catch (error) {
    console.error('Erro na cobrança semanal:', error);
    throw new Error('Falha no processamento da cobrança semanal');
  }
}

/**
 * Deduzir valor do saldo da conta Leaf
 * @param {string} accountId - ID da conta
 * @param {number} amount - Valor a deduzir
 * @returns {Object} Resultado da dedução
 */
async function deductFromLeafBalance(accountId, amount) {
  try {
    const response = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/account/${accountId}/withdraw`, {
      amount: amount,
      description: 'Cobrança semanal Leaf App',
      metadata: {
        type: 'weekly_billing',
        created_at: new Date().toISOString()
      }
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao deduzir do saldo:', error.response?.data || error.message);
    throw new Error('Falha ao deduzir do saldo');
  }
}

/**
 * Sistema de convites
 * @param {Object} inviteData - Dados do convite
 * @returns {Object} Resultado do convite
 */
async function processDriverInvite(inviteData) {
  try {
    const { inviter_id, invitee_id, invite_code } = inviteData;
    
    console.log('Processando convite:', { inviter_id, invitee_id, invite_code });
    
    // Verificar se o convite é válido
    const inviteDoc = await admin.firestore().collection('driver_invites')
      .where('invite_code', '==', invite_code)
      .where('inviter_id', '==', inviter_id)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    
    if (inviteDoc.empty) {
      throw new Error('Convite inválido ou já utilizado');
    }
    
    const invite = inviteDoc.docs[0].data();
    
    // Verificar se o convidador ainda tem convites disponíveis
    const inviterDoc = await admin.firestore().collection('users').doc(inviter_id).get();
    const inviterData = inviterDoc.data();
    
    const usedInvites = inviterData.used_invites || 0;
    const maxInvites = LEAF_BAAS_CONFIG.weekly_billing.referral_system.invites_per_driver;
    
    if (usedInvites >= maxInvites) {
      throw new Error('Limite de convites atingido');
    }
    
    // Atualizar status do convite
    await inviteDoc.docs[0].ref.update({
      status: 'accepted',
      accepted_at: admin.firestore.FieldValue.serverTimestamp(),
      invitee_id: invitee_id
    });
    
    // Atualizar dados do convidador
    await admin.firestore().collection('users').doc(inviter_id).update({
      used_invites: usedInvites + 1,
      total_invites: (inviterData.total_invites || 0) + 1
    });
    
    // Adicionar meses grátis para ambos
    const freeMonths = LEAF_BAAS_CONFIG.weekly_billing.referral_system.free_months_per_invite;
    
    // Para o convidador
    await addFreeMonths(inviter_id, freeMonths);
    
    // Para o convidado
    await addFreeMonths(invitee_id, freeMonths);
    
    // Log da transação
    await logTransaction({
      type: 'DRIVER_INVITE_ACCEPTED',
      inviter_id,
      invitee_id,
      invite_code,
      free_months: freeMonths,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Notificar ambos
    await sendDriverNotification(inviter_id, {
      type: 'invite_accepted',
      invitee_id,
      free_months: freeMonths,
      message: `Convite aceito! Você ganhou ${freeMonths} mês(es) grátis.`
    });
    
    await sendDriverNotification(invitee_id, {
      type: 'invite_accepted',
      inviter_id,
      free_months: freeMonths,
      message: `Você aceitou um convite! Ganhou ${freeMonths} mês(es) grátis.`
    });
    
    return {
      success: true,
      inviter_id,
      invitee_id,
      free_months: freeMonths
    };
    
  } catch (error) {
    console.error('Erro ao processar convite:', error);
    throw new Error('Falha ao processar convite');
  }
}

/**
 * Adicionar meses grátis para motorista
 * @param {string} driverId - ID do motorista
 * @param {number} months - Número de meses grátis
 */
async function addFreeMonths(driverId, months) {
  try {
    const driverDoc = await admin.firestore().collection('users').doc(driverId).get();
    const driverData = driverDoc.data();
    
    const currentFreeMonths = driverData.free_months || 0;
    const maxFreeMonths = LEAF_BAAS_CONFIG.weekly_billing.referral_system.max_free_months;
    const newFreeMonths = Math.min(currentFreeMonths + months, maxFreeMonths);
    
    // Calcular nova data de fim do período grátis
    const now = new Date();
    const currentFreeTrialEnd = driverData.free_trial_end ? new Date(driverData.free_trial_end) : now;
    const newFreeTrialEnd = new Date(Math.max(now.getTime(), currentFreeTrialEnd.getTime()) + (newFreeMonths * 30 * 24 * 60 * 60 * 1000));
    
    await admin.firestore().collection('users').doc(driverId).update({
      free_months: newFreeMonths,
      free_trial_end: newFreeTrialEnd,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`Adicionados ${months} meses grátis para motorista ${driverId}`);
    
  } catch (error) {
    console.error('Erro ao adicionar meses grátis:', error);
    throw new Error('Falha ao adicionar meses grátis');
  }
}

/**
 * Criar convite para motorista
 * @param {Object} inviteData - Dados do convite
 * @returns {Object} Dados do convite criado
 */
async function createDriverInvite(inviteData) {
  try {
    const { inviter_id, invitee_email, invitee_phone } = inviteData;
    
    // Gerar código único do convite
    const inviteCode = generateInviteCode();
    
    // Verificar se o convidador ainda tem convites disponíveis
    const inviterDoc = await admin.firestore().collection('users').doc(inviter_id).get();
    const inviterData = inviterDoc.data();
    
    const usedInvites = inviterData.used_invites || 0;
    const maxInvites = LEAF_BAAS_CONFIG.weekly_billing.referral_system.invites_per_driver;
    
    if (usedInvites >= maxInvites) {
      throw new Error('Limite de convites atingido');
    }
    
    // Criar convite no Firestore
    const inviteRef = await admin.firestore().collection('driver_invites').add({
      inviter_id,
      invitee_email,
      invitee_phone,
      invite_code: inviteCode,
      status: 'pending',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dias
    });
    
    // Log da transação
    await logTransaction({
      type: 'DRIVER_INVITE_CREATED',
      inviter_id,
      invitee_email,
      invite_code: inviteCode,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return {
      success: true,
      invite_id: inviteRef.id,
      invite_code: inviteCode,
      inviter_id,
      invitee_email,
      invitee_phone
    };
    
  } catch (error) {
    console.error('Erro ao criar convite:', error);
    throw new Error('Falha ao criar convite');
  }
}

/**
 * Gerar código único do convite
 * @returns {string} Código do convite
 */
function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Obter saldo da conta Leaf
 * @param {string} accountId - ID da conta
 * @returns {Object} Dados do saldo
 */
async function getLeafAccountBalance(accountId) {
  try {
    const response = await axios.get(`${WOOVI_CONFIG.baseURL}/api/v1/account/${accountId}/balance`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao obter saldo da conta:', error.response?.data || error.message);
    throw new Error('Falha ao obter saldo da conta');
  }
}

/**
 * Obter transações da conta Leaf
 * @param {string} accountId - ID da conta
 * @param {Object} filters - Filtros opcionais
 * @returns {Object} Lista de transações
 */
async function getLeafAccountTransactions(accountId, filters = {}) {
  try {
    const params = new URLSearchParams({
      account_id: accountId,
      ...filters
    });
    
    const response = await axios.get(`${WOOVI_CONFIG.baseURL}/api/v1/transactions?${params}`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao obter transações:', error.response?.data || error.message);
    throw new Error('Falha ao obter transações da conta');
  }
}

/**
 * Enviar notificação para motorista
 * @param {string} driverId - ID do motorista
 * @param {Object} notificationData - Dados da notificação
 */
async function sendDriverNotification(driverId, notificationData) {
  try {
    // Buscar dados do motorista
    const driverDoc = await admin.firestore().collection('users').doc(driverId).get();
    const driverData = driverDoc.data();
    
    if (!driverData || !driverData.pushToken) {
      console.log('Motorista não encontrado ou sem push token:', driverId);
      return;
    }
    
    // Enviar notificação push
    const message = {
      token: driverData.pushToken,
      notification: {
        title: 'Leaf App',
        body: notificationData.message || 'Você recebeu uma notificação!'
      },
      data: {
        type: notificationData.type,
        amount: notificationData.amount?.toString(),
        trip_id: notificationData.trip_id || '',
        screen: 'DriverDashboard'
      }
    };
    
    await admin.messaging().send(message);
    console.log('Notificação enviada para motorista:', driverId);
  } catch (error) {
    console.error('Erro ao enviar notificação:', error);
  }
}

/**
 * Log de transação
 * @param {Object} transactionData - Dados da transação
 */
async function logTransaction(transactionData) {
  try {
    await admin.firestore().collection('baas_transactions').add({
      ...transactionData,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Erro ao logar transação:', error);
  }
}

/**
 * Adicionar saldo à conta Leaf
 * @param {string} accountId - ID da conta
 * @param {number} amount - Valor a adicionar
 * @returns {Object} Resultado da adição
 */
async function addToLeafBalance(accountId, amount) {
  try {
    const response = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/account/${accountId}/deposit`, {
      amount: amount,
      description: 'Acréscimo de saldo Leaf App',
      metadata: {
        type: 'partner_balance',
        created_at: new Date().toISOString()
      }
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao adicionar saldo:', error.response?.data || error.message);
    throw new Error('Falha ao adicionar saldo');
  }
}

/**
 * Transferir valor para conta Leaf do motorista
 * @param {string} accountId - ID da conta do motorista
 * @param {number} amount - Valor a transferir
 * @returns {Object} Resultado da transferência
 */
async function transferToLeafAccount(accountId, amount) {
  try {
    const response = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/account/${accountId}/transfer`, {
      amount: amount,
      correlationID: `transfer_to_leaf_${accountId}_${Date.now()}`,
      comment: `Transferência para conta Leaf - Motorista`,
      expiresIn: 3600, // 1 hora
      additionalInfo: [
        {
          key: 'type',
          value: 'partner_balance_transfer'
        }
      ]
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao transferir saldo:', error.response?.data || error.message);
    throw new Error('Falha ao transferir saldo');
  }
}

// Firebase Functions

/**
 * Criar conta Leaf para motorista
 */
exports.createLeafAccount = admin.https.onCall(async (data, context) => {
  try {
    const { driverData } = data;
    
    // Validar dados do motorista
    if (!driverData.cpf || !driverData.email) {
      throw new Error('Dados obrigatórios não fornecidos');
    }
    
    // Criar conta Leaf via Woovi BaaS
    const leafAccount = await createDriverLeafAccount(driverData);
    
    // Verificar se é um dos primeiros 500
    const driverCount = await getDriverCount();
    const isFirst500 = driverCount < LEAF_BAAS_CONFIG.weekly_billing.max_free_trial_drivers;
    
    // Salvar no Firestore
    await admin.firestore().collection('users').doc(driverData.id).update({
      leaf_account_id: leafAccount.id,
      leaf_account_status: 'active',
      leaf_account_created_at: admin.firestore.FieldValue.serverTimestamp(),
      plan_type: driverData.plan_type || 'plus',
      is_first_500: isFirst500,
      free_trial_start: isFirst500 ? admin.firestore.FieldValue.serverTimestamp() : null,
      free_trial_end: isFirst500 ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
      free_months: isFirst500 ? 3 : 0, // 90 dias = 3 meses
      billing_status: 'active'
    });
    
    // Log da transação
    await logTransaction({
      type: 'LEAF_ACCOUNT_CREATED',
      driver_id: driverData.id,
      account_id: leafAccount.id,
      plan_type: driverData.plan_type || 'plus',
      is_first_500: isFirst500,
      free_trial_days: isFirst500 ? 90 : 0
    });
    
    return { 
      success: true, 
      account_id: leafAccount.id,
      is_first_500: isFirst500,
      free_trial_days: isFirst500 ? 90 : 0,
      message: 'Conta Leaf criada com sucesso'
    };
  } catch (error) {
    console.error('Erro ao criar conta Leaf:', error);
    throw new Error('Falha na criação da conta');
  }
});

/**
 * Processar split automático de pagamento
 */
exports.processPaymentSplit = admin.https.onRequest(async (req, res) => {
  try {
    const { paymentData } = req.body;
    
    // Processar split automático
    const splitResult = await processPaymentSplit(paymentData);
    
    // Atualizar dados da corrida
    await admin.firestore().collection('trips').doc(paymentData.trip_id).update({
      split_processed: true,
      split_result: splitResult,
      driver_amount: paymentData.value,
      split_processed_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Notificar motorista
    await sendDriverNotification(paymentData.driver_id, {
      type: 'payment_received',
      amount: paymentData.value,
      trip_id: paymentData.trip_id,
      message: `Você recebeu R$ ${paymentData.value.toFixed(2)} pela corrida!`
    });
    
    // Log da transação
    await logTransaction({
      type: 'PAYMENT_SPLIT_PROCESSED',
      trip_id: paymentData.trip_id,
      driver_id: paymentData.driver_id,
      amount: paymentData.value,
      split_result: splitResult
    });
    
    res.status(200).json({ 
      success: true, 
      split: splitResult,
      message: 'Split processado com sucesso'
    });
  } catch (error) {
    console.error('Erro no split:', error);
    res.status(500).json({ 
      error: 'Falha no processamento',
      message: error.message 
    });
  }
});

/**
 * Cobrança semanal automática
 */
exports.processWeeklyBilling = admin.https.onCall(async (data, context) => {
  try {
    const { billingData } = data;
    
    // Verificar se a cobrança semanal está habilitada
    if (!LEAF_BAAS_CONFIG.weekly_billing.enabled) {
      return {
        success: true,
        billed: false,
        reason: 'billing_disabled'
      };
    }
    
    // Processar cobrança semanal
    const result = await processWeeklyBilling(billingData);
    
    return { 
      success: true, 
      result,
      message: 'Cobrança semanal processada'
    };
  } catch (error) {
    console.error('Erro na cobrança semanal:', error);
    throw new Error('Falha no processamento da cobrança semanal');
  }
});

/**
 * Cobrança semanal automática (scheduled function)
 */
exports.weeklyBillingScheduler = admin.pubsub.schedule('0 0 * * 5').onRun(async (context) => {
  try {
    console.log('Iniciando cobrança semanal automática');
    
    // Verificar se a cobrança semanal está habilitada
    if (!LEAF_BAAS_CONFIG.weekly_billing.enabled) {
      console.log('Cobrança semanal desabilitada');
      return;
    }
    
    // Buscar todos os motoristas ativos
    const driversSnapshot = await admin.firestore().collection('users')
      .where('userType', '==', 'driver')
      .where('billing_status', '==', 'active')
      .get();
    
    let processedCount = 0;
    let billedCount = 0;
    let suspendedCount = 0;
    let freeCount = 0;
    
    for (const driverDoc of driversSnapshot.docs) {
      const driverData = driverDoc.data();
      
      if (!driverData.leaf_account_id || !driverData.plan_type) {
        console.log('Motorista sem conta Leaf ou plano:', driverDoc.id);
        continue;
      }
      
      try {
        const planAmount = driverData.plan_type === 'elite' ? 99.90 : 49.90;
        
        const result = await processWeeklyBilling({
          driver_id: driverDoc.id,
          plan_type: driverData.plan_type,
          amount: planAmount
        });
        
        processedCount++;
        
        if (result.billed) {
          billedCount++;
        } else if (result.suspended) {
          suspendedCount++;
        } else if (result.reason === 'free_trial') {
          freeCount++;
        }
        
        console.log(`Cobrança processada para motorista ${driverDoc.id}: ${result.reason || 'billed'}`);
      } catch (error) {
        console.error(`Erro na cobrança de ${driverDoc.id}:`, error);
      }
    }
    
    console.log(`Cobrança semanal concluída: ${processedCount} motoristas processados`);
    console.log(`- Cobrados: ${billedCount}`);
    console.log(`- Suspensos: ${suspendedCount}`);
    console.log(`- Grátis: ${freeCount}`);
    
    // Log da transação
    await logTransaction({
      type: 'WEEKLY_BILLING_COMPLETED',
      processed_count: processedCount,
      billed_count: billedCount,
      suspended_count: suspendedCount,
      free_count: freeCount,
      total_drivers: driversSnapshot.size
    });
    
  } catch (error) {
    console.error('Erro na cobrança semanal:', error);
  }
});

/**
 * Criar convite para motorista
 */
exports.createDriverInvite = admin.https.onCall(async (data, context) => {
  try {
    const { inviteData } = data;
    
    // Validar dados do convite
    if (!inviteData.inviter_id || (!inviteData.invitee_email && !inviteData.invitee_phone)) {
      throw new Error('Dados obrigatórios não fornecidos');
    }
    
    // Criar convite
    const result = await createDriverInvite(inviteData);
    
    return { 
      success: true, 
      invite: result,
      message: 'Convite criado com sucesso'
    };
  } catch (error) {
    console.error('Erro ao criar convite:', error);
    throw new Error('Falha ao criar convite');
  }
});

/**
 * Processar convite de motorista
 */
exports.processDriverInvite = admin.https.onCall(async (data, context) => {
  try {
    const { inviteData } = data;
    
    // Validar dados do convite
    if (!inviteData.inviter_id || !inviteData.invitee_id || !inviteData.invite_code) {
      throw new Error('Dados obrigatórios não fornecidos');
    }
    
    // Processar convite
    const result = await processDriverInvite(inviteData);
    
    return { 
      success: true, 
      result,
      message: 'Convite processado com sucesso'
    };
  } catch (error) {
    console.error('Erro ao processar convite:', error);
    throw new Error('Falha ao processar convite');
  }
});

/**
 * Ativar/desativar cobrança semanal
 */
exports.toggleWeeklyBilling = admin.https.onCall(async (data, context) => {
  try {
    const { enabled } = data;
    
    // Atualizar configuração
    LEAF_BAAS_CONFIG.weekly_billing.enabled = enabled;
    
    // Salvar no Firestore para persistência
    await admin.firestore().collection('system_config').doc('baas_settings').set({
      weekly_billing_enabled: enabled,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Log da transação
    await logTransaction({
      type: 'WEEKLY_BILLING_TOGGLED',
      enabled,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { 
      success: true, 
      enabled,
      message: `Cobrança semanal ${enabled ? 'ativada' : 'desativada'}`
    };
  } catch (error) {
    console.error('Erro ao alterar cobrança semanal:', error);
    throw new Error('Falha ao alterar configuração');
  }
});

/**
 * Obter dados da conta Leaf
 */
exports.getLeafAccountData = admin.https.onCall(async (data, context) => {
  try {
    const { accountId } = data;
    
    // Obter saldo
    const balance = await getLeafAccountBalance(accountId);
    
    // Obter transações recentes
    const transactions = await getLeafAccountTransactions(accountId, {
      limit: 10,
      order: 'desc'
    });
    
    return {
      success: true,
      balance,
      transactions: transactions.data || []
    };
  } catch (error) {
    console.error('Erro ao obter dados da conta:', error);
    throw new Error('Falha ao obter dados da conta');
  }
});

/**
 * Webhook para eventos BaaS
 */
exports.baasWebhook = admin.https.onRequest(async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log('Webhook BaaS recebido:', event, data);
    
    switch (event) {
      case 'charge.completed':
        // Pagamento de plano semanal confirmado
        await handleWeeklyPaymentConfirmation(data);
        break;
        
      case 'split.completed':
        // Split automático concluído
        await handleSplitCompletion(data);
        break;
        
      case 'account.created':
        // Conta Leaf criada
        await handleAccountCreation(data);
        break;
        
      default:
        console.log('Evento BaaS não tratado:', event);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro no webhook BaaS:', error);
    res.status(500).json({ error: 'Falha no processamento' });
  }
});

/**
 * Tratar confirmação de pagamento semanal
 */
async function handleWeeklyPaymentConfirmation(data) {
  try {
    const { charge_id, correlationID, value } = data;
    
    // Buscar cobrança no Firestore
    const chargeQuery = await admin.firestore().collection('weekly_charges')
      .where('charge_id', '==', charge_id)
      .limit(1)
      .get();
    
    if (!chargeQuery.empty) {
      const chargeDoc = chargeQuery.docs[0];
      const chargeData = chargeDoc.data();
      
      // Atualizar status da cobrança
      await chargeDoc.ref.update({
        status: 'paid',
        paid_at: admin.firestore.FieldValue.serverTimestamp(),
        payment_value: value
      });
      
      // Notificar motorista
      await sendDriverNotification(chargeData.driver_id, {
        type: 'weekly_payment_confirmed',
        amount: value,
        plan_type: chargeData.plan_type,
        message: `Pagamento semanal confirmado: R$ ${value.toFixed(2)}`
      });
      
      console.log('Pagamento semanal confirmado:', charge_id);
    }
  } catch (error) {
    console.error('Erro ao processar confirmação de pagamento semanal:', error);
  }
}

/**
 * Tratar conclusão de split
 */
async function handleSplitCompletion(data) {
  try {
    const { split_id, driver_amount, trip_id } = data;
    
    // Atualizar dados da corrida
    await admin.firestore().collection('trips').doc(trip_id).update({
      split_completed: true,
      split_completed_at: admin.firestore.FieldValue.serverTimestamp(),
      driver_amount_transferred: driver_amount
    });
    
    console.log('Split concluído:', split_id);
  } catch (error) {
    console.error('Erro ao processar conclusão de split:', error);
  }
}

/**
 * Tratar criação de conta
 */
async function handleAccountCreation(data) {
  try {
    const { account_id, driver_id } = data;
    
    // Atualizar dados do motorista
    await admin.firestore().collection('users').doc(driver_id).update({
      leaf_account_created: true,
      leaf_account_created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Conta Leaf criada:', account_id);
  } catch (error) {
    console.error('Erro ao processar criação de conta:', error);
  }
}

/**
 * Verificar status online do motorista
 */
exports.checkDriverOnlineStatus = admin.https.onCall(async (data, context) => {
  try {
    const { driverId } = data;
    
    if (!driverId) {
      throw new Error('ID do motorista não fornecido');
    }
    
    const status = await checkDriverOnlineStatus(driverId);
    
    return {
      success: true,
      ...status
    };
  } catch (error) {
    console.error('Erro ao verificar status online:', error);
    throw new Error('Falha ao verificar status do motorista');
  }
});

/**
 * Gerar QR Code para regularização de saldo
 */
exports.generateBalanceQRCode = admin.https.onCall(async (data, context) => {
  try {
    const { driverId, amount } = data;
    
    if (!driverId) {
      throw new Error('ID do motorista não fornecido');
    }
    
    const qrCodeData = await generateBalanceQRCode(driverId, amount);
    
    return {
      success: true,
      ...qrCodeData
    };
  } catch (error) {
    console.error('Erro ao gerar QR Code:', error);
    throw new Error('Falha ao gerar QR Code de regularização');
  }
});

/**
 * Processar regularização de saldo via webhook
 */
exports.processBalanceRegularization = admin.https.onCall(async (data, context) => {
  try {
    const { paymentData } = data;
    
    if (!paymentData || !paymentData.correlationID) {
      throw new Error('Dados do pagamento não fornecidos');
    }
    
    const result = await processBalanceRegularization(paymentData);
    
    return {
      success: true,
      ...result
    };
  } catch (error) {
    console.error('Erro ao processar regularização:', error);
    throw new Error('Falha ao processar regularização de saldo');
  }
});

module.exports = {
  createDriverLeafAccount,
  processAutomaticSplit,
  processWeeklyBilling,
  createDriverInvite,
  processDriverInvite,
  getLeafAccountBalance,
  getLeafAccountTransactions,
  sendDriverNotification,
  logTransaction,
  LEAF_BAAS_CONFIG,
  WOOVI_CONFIG
}; 