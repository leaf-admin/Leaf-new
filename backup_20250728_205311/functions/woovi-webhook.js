const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Inicializar Firebase Admin se não estiver inicializado
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Webhook do Woovi para receber confirmações de pagamento
 * Endpoint: https://leaf-app-91dfdce0.cloudfunctions.net/woovi-webhook
 */
exports.wooviWebhook = functions.https.onRequest(async (req, res) => {
  try {
    // Verificar método HTTP
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verificar se há dados no body
    if (!req.body) {
      return res.status(400).json({ error: 'No data received' });
    }

    const { event, charge } = req.body;

    console.log('Webhook Woovi recebido:', {
      event,
      chargeId: charge?.identifier,
      correlationID: charge?.correlationID,
      status: charge?.status
    });

    // PROCESSAR EVENTOS E SÓ DEPOIS RETORNAR 200
    let processingError = null;

    try {
      // Eventos de cobrança
      if (event === 'charge.confirmed') {
        await handlePaymentConfirmation(charge);
      }

      if (event === 'charge.expired') {
        await handlePaymentExpiration(charge);
      }

      if (event === 'charge.created') {
        await handleChargeCreated(charge);
      }

      if (event === 'charge.received') {
        await handleChargeReceived(charge);
      }

      // Eventos de reembolso
      if (event === 'refund.received') {
        await handleRefundReceived(charge);
      }

      // Eventos especiais
      if (event === 'notthesame') {
        await handlePaymentByAnotherPerson(charge);
      }

      // SÓ RETORNA 200 SE TUDO PROCESSOU COM SUCESSO
      res.status(200).json({ 
        success: true, 
        message: 'Webhook processed successfully' 
      });

    } catch (error) {
      console.error('Erro ao processar webhook:', error);
      processingError = error;
      
      // RETORNA 500 SE HOUVE ERRO NO PROCESSAMENTO
      res.status(500).json({ 
        success: false,
        error: 'Processing error',
        message: error.message 
      });
    }

  } catch (error) {
    console.error('Erro geral no webhook Woovi:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error.message 
    });
  }
});

/**
 * Processar confirmação de pagamento
 * @param {Object} charge - Dados da cobrança
 */
async function handlePaymentConfirmation(charge) {
  try {
    const { identifier, correlationID, value, status } = charge;

    console.log('Processando confirmação de pagamento:', {
      chargeId: identifier,
      correlationID,
      value,
      status
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];
    const tripData = tripDoc.data();

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'PAYMENT_CONFIRMED',
      paymentConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      chargeId: identifier,
      paymentValue: value
    });

    console.log('Status da corrida atualizado para PAYMENT_CONFIRMED');

    // Iniciar busca de motoristas
    await startDriverSearch(tripDoc.id, tripData);

    // Notificar cliente
    await notifyClient(tripDoc.id, 'PAYMENT_CONFIRMED');

    // Log da transação
    await logTransaction({
      type: 'PAYMENT_CONFIRMED',
      tripId: tripDoc.id,
      chargeId: identifier,
      value,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Erro ao processar confirmação de pagamento:', error);
    throw error;
  }
}

/**
 * Processar expiração de pagamento
 * @param {Object} charge - Dados da cobrança
 */
async function handlePaymentExpiration(charge) {
  try {
    const { identifier, correlationID } = charge;

    console.log('Processando expiração de pagamento:', {
      chargeId: identifier,
      correlationID
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'PAYMENT_EXPIRED',
      paymentExpiredAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Notificar cliente
    await notifyClient(tripDoc.id, 'PAYMENT_EXPIRED');

    console.log('Status da corrida atualizado para PAYMENT_EXPIRED');

  } catch (error) {
    console.error('Erro ao processar expiração de pagamento:', error);
    throw error;
  }
}

/**
 * Processar reembolso
 * @param {Object} charge - Dados da cobrança
 */
async function handlePaymentRefund(charge) {
  try {
    const { identifier, correlationID, refundAmount } = charge;

    console.log('Processando reembolso:', {
      chargeId: identifier,
      correlationID,
      refundAmount
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'CANCELLED',
      refundProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      refundAmount: refundAmount
    });

    // Notificar cliente
    await notifyClient(tripDoc.id, 'REFUND_PROCESSED', { refundAmount });

    console.log('Reembolso processado com sucesso');

  } catch (error) {
    console.error('Erro ao processar reembolso:', error);
    throw error;
  }
}

/**
 * Processar cobrança criada
 * @param {Object} charge - Dados da cobrança
 */
async function handleChargeCreated(charge) {
  try {
    const { identifier, correlationID, value, comment } = charge;

    console.log('Processando cobrança criada:', {
      chargeId: identifier,
      correlationID,
      value
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'PIX_GENERATED',
      pixGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      chargeId: identifier,
      paymentValue: value
    });

    // Notificar cliente
    await notifyClient(tripDoc.id, 'PIX_GENERATED');

    console.log('Cobrança criada processada');

  } catch (error) {
    console.error('Erro ao processar cobrança criada:', error);
    throw error;
  }
}

/**
 * Processar transação PIX recebida
 * @param {Object} charge - Dados da cobrança
 */
async function handleChargeReceived(charge) {
  try {
    const { identifier, correlationID, value } = charge;

    console.log('Processando transação PIX recebida:', {
      chargeId: identifier,
      correlationID,
      value
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'PIX_RECEIVED',
      pixReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentValue: value
    });

    // Notificar cliente
    await notifyClient(tripDoc.id, 'PIX_RECEIVED');

    console.log('Transação PIX recebida processada');

  } catch (error) {
    console.error('Erro ao processar transação PIX recebida:', error);
    throw error;
  }
}

/**
 * Processar reembolso recebido
 * @param {Object} charge - Dados da cobrança
 */
async function handleRefundReceived(charge) {
  try {
    const { identifier, correlationID, refundAmount } = charge;

    console.log('Processando reembolso recebido:', {
      chargeId: identifier,
      correlationID,
      refundAmount
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'REFUND_PROCESSED',
      refundProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      refundAmount: refundAmount
    });

    // Notificar cliente
    await notifyClient(tripDoc.id, 'REFUND_PROCESSED', { refundAmount });

    console.log('Reembolso recebido processado');

  } catch (error) {
    console.error('Erro ao processar reembolso recebido:', error);
    throw error;
  }
}

/**
 * Processar pagamento por outra pessoa
 * @param {Object} charge - Dados da cobrança
 */
async function handlePaymentByAnotherPerson(charge) {
  try {
    const { identifier, correlationID, value } = charge;

    console.log('Processando pagamento por outra pessoa:', {
      chargeId: identifier,
      correlationID,
      value
    });

    // Buscar corrida pelo correlationID
    const tripQuery = await db.collection('trips')
      .where('correlationID', '==', correlationID)
      .limit(1)
      .get();

    if (tripQuery.empty) {
      console.error('Corrida não encontrada para correlationID:', correlationID);
      return;
    }

    const tripDoc = tripQuery.docs[0];

    // Atualizar status da corrida
    await tripDoc.ref.update({
      status: 'PAYMENT_BY_ANOTHER',
      paymentByAnotherAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentValue: value
    });

    // Notificar cliente
    await notifyClient(tripDoc.id, 'PAYMENT_BY_ANOTHER');

    console.log('Pagamento por outra pessoa processado');

  } catch (error) {
    console.error('Erro ao processar pagamento por outra pessoa:', error);
    throw error;
  }
}

/**
 * Iniciar busca de motoristas
 * @param {string} tripId - ID da corrida
 * @param {Object} tripData - Dados da corrida
 */
async function startDriverSearch(tripId, tripData) {
  try {
    console.log('Iniciando busca de motoristas para corrida:', tripId);

    // Atualizar status para busca de motoristas
    await db.collection('trips').doc(tripId).update({
      status: 'DRIVER_SEARCH',
      driverSearchStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Enviar notificação para motoristas próximos
    await notifyNearbyDrivers(tripData);

    // Log da ação
    await logTransaction({
      type: 'DRIVER_SEARCH_STARTED',
      tripId,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Erro ao iniciar busca de motoristas:', error);
    throw error;
  }
}

/**
 * Notificar cliente sobre mudança de status
 * @param {string} tripId - ID da corrida
 * @param {string} status - Novo status
 * @param {Object} additionalData - Dados adicionais
 */
async function notifyClient(tripId, status, additionalData = {}) {
  try {
    // Buscar dados do cliente
    const tripDoc = await db.collection('trips').doc(tripId).get();
    const tripData = tripDoc.data();

    if (!tripData) {
      console.error('Dados da corrida não encontrados:', tripId);
      return;
    }

    // Enviar notificação push para o cliente
    const clientToken = tripData.clientToken; // Token FCM do cliente
    
    if (clientToken) {
      const message = {
        token: clientToken,
        notification: {
          title: getNotificationTitle(status),
          body: getNotificationBody(status, additionalData)
        },
        data: {
          tripId,
          status,
          ...additionalData
        }
      };

      // Enviar via Firebase Cloud Messaging
      const response = await admin.messaging().send(message);
      console.log('Notificação enviada para cliente:', response);
    }

  } catch (error) {
    console.error('Erro ao notificar cliente:', error);
  }
}

/**
 * Notificar motoristas próximos
 * @param {Object} tripData - Dados da corrida
 */
async function notifyNearbyDrivers(tripData) {
  try {
    const { origin_lat, origin_lng, value } = tripData;

    // Buscar motoristas próximos (implementar lógica de busca)
    const nearbyDrivers = await findNearbyDrivers(origin_lat, origin_lng);

    console.log(`Enviando notificação para ${nearbyDrivers.length} motoristas próximos`);

    // Enviar notificação para cada motorista
    for (const driver of nearbyDrivers) {
      await sendDriverNotification(driver, tripData);
    }

  } catch (error) {
    console.error('Erro ao notificar motoristas:', error);
  }
}

/**
 * Buscar motoristas próximos
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Array} Lista de motoristas
 */
async function findNearbyDrivers(lat, lng) {
  try {
    // Implementar lógica de busca de motoristas próximos
    // Por enquanto, retorna array vazio
    return [];
  } catch (error) {
    console.error('Erro ao buscar motoristas próximos:', error);
    return [];
  }
}

/**
 * Enviar notificação para motorista
 * @param {Object} driver - Dados do motorista
 * @param {Object} tripData - Dados da corrida
 */
async function sendDriverNotification(driver, tripData) {
  try {
    if (driver.fcmToken) {
      const message = {
        token: driver.fcmToken,
        notification: {
          title: 'Nova corrida disponível!',
          body: `R$ ${(tripData.value / 100).toFixed(2)} - ${tripData.origin} → ${tripData.destination}`
        },
        data: {
          tripId: tripData.id,
          type: 'NEW_TRIP_AVAILABLE',
          value: tripData.value.toString(),
          origin: tripData.origin,
          destination: tripData.destination
        }
      };

      await admin.messaging().send(message);
    }
  } catch (error) {
    console.error('Erro ao enviar notificação para motorista:', error);
  }
}

/**
 * Log de transação
 * @param {Object} transactionData - Dados da transação
 */
async function logTransaction(transactionData) {
  try {
    await db.collection('transactions').add({
      ...transactionData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Erro ao logar transação:', error);
  }
}

/**
 * Obter título da notificação
 * @param {string} status - Status da corrida
 * @returns {string} Título da notificação
 */
function getNotificationTitle(status) {
  const titles = {
    'PIX_GENERATED': 'PIX Gerado!',
    'PIX_RECEIVED': 'PIX Recebido!',
    'PAYMENT_CONFIRMED': 'Pagamento Confirmado!',
    'PAYMENT_EXPIRED': 'Pagamento Expirado',
    'REFUND_PROCESSED': 'Reembolso Processado',
    'PAYMENT_BY_ANOTHER': 'Pagamento por Outra Pessoa',
    'DRIVER_SEARCH_STARTED': 'Buscando Motorista...',
    'DRIVER_ACCEPTED': 'Motorista Encontrado!',
    'TRIP_STARTED': 'Viagem Iniciada',
    'TRIP_COMPLETED': 'Viagem Concluída'
  };

  return titles[status] || 'Atualização da Corrida';
}

/**
 * Obter corpo da notificação
 * @param {string} status - Status da corrida
 * @param {Object} additionalData - Dados adicionais
 * @returns {string} Corpo da notificação
 */
function getNotificationBody(status, additionalData = {}) {
  const bodies = {
    'PIX_GENERATED': 'Seu PIX foi gerado! Escaneie o QR Code para pagar.',
    'PIX_RECEIVED': 'PIX recebido! Estamos processando seu pagamento.',
    'PAYMENT_CONFIRMED': 'Seu pagamento foi confirmado! Estamos buscando um motorista para você.',
    'PAYMENT_EXPIRED': 'O tempo para pagamento expirou. Gere um novo PIX para continuar.',
    'REFUND_PROCESSED': `Reembolso de R$ ${(additionalData.refundAmount / 100).toFixed(2)} processado com sucesso.`,
    'PAYMENT_BY_ANOTHER': 'Pagamento realizado por outra pessoa. Entre em contato com o suporte.',
    'DRIVER_SEARCH_STARTED': 'Estamos encontrando o melhor motorista para sua viagem.',
    'DRIVER_ACCEPTED': 'Motorista aceitou sua corrida! Ele está a caminho.',
    'TRIP_STARTED': 'Sua viagem começou! Acompanhe em tempo real.',
    'TRIP_COMPLETED': 'Viagem concluída! Obrigado por escolher o Leaf.'
  };

  return bodies[status] || 'Status da sua corrida foi atualizado.';
}

module.exports = {
  wooviWebhook: exports.wooviWebhook
}; 