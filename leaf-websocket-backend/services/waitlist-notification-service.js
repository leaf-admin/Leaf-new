const crypto = require('crypto');
const admin = require('firebase-admin');
const FCMService = require('./fcm-service');
const redisPool = require('../utils/redis-pool');
const { logger, logStructured } = require('../utils/logger');

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (_error) {}

const DEFAULT_WAITLIST_ROUTE = 'RobotaxiPrototypeDriverWaitlistStatus';
const WAITLIST_NOTIFICATION_TYPE = 'driver_waitlist_update';

const WAITLIST_EVENTS = {
  JOINED: 'joined',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  POSITION_UPDATED: 'position_updated',
};

const WAITLIST_TEMPLATES = {
  [WAITLIST_EVENTS.JOINED]: {
    title: 'Voce entrou na lista da Leaf',
    body: ({ cityLabel, position }) => {
      const cityText = cityLabel ? ` em ${cityLabel}` : '';
      const positionText = position ? ` Sua posicao atual e #${position}.` : '';
      return `Recebemos seu interesse para dirigir${cityText}.${positionText}`;
    },
  },
  [WAITLIST_EVENTS.APPROVED]: {
    title: 'Voce foi liberado para dirigir',
    body: ({ cityLabel }) => {
      const cityText = cityLabel ? ` em ${cityLabel}` : '';
      return `Seu cadastro foi aprovado para operar${cityText}. Abra o app para ficar online quando quiser.`;
    },
  },
  [WAITLIST_EVENTS.REJECTED]: {
    title: 'Precisamos revisar sua entrada',
    body: ({ reason }) => (
      reason
        ? `Sua solicitacao precisa de revisao: ${reason}`
        : 'Sua solicitacao precisa de revisao. Abra o app para acompanhar os proximos passos.'
    ),
  },
  [WAITLIST_EVENTS.POSITION_UPDATED]: {
    title: 'Sua posicao na lista mudou',
    body: ({ position, cityLabel }) => {
      const positionText = position ? `Agora voce esta na posicao #${position}.` : 'Sua posicao foi atualizada.';
      const cityText = cityLabel ? ` Cidade: ${cityLabel}.` : '';
      return `${positionText}${cityText}`;
    },
  },
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEvent(event) {
  const value = normalizeText(event).toLowerCase();
  if (Object.values(WAITLIST_EVENTS).includes(value)) return value;
  return WAITLIST_EVENTS.POSITION_UPDATED;
}

function toDataValue(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function buildWaitlistNotification(driverId, event, context = {}) {
  const waitlistEvent = normalizeEvent(event);
  const template = WAITLIST_TEMPLATES[waitlistEvent] || WAITLIST_TEMPLATES[WAITLIST_EVENTS.POSITION_UPDATED];
  const cityLabel = normalizeText(context.cityLabel || context.city?.cityLabel || context.city?.cityKey);
  const cityKey = normalizeText(context.cityKey || context.city?.cityKey);
  const status = normalizeText(context.status || context.waitListStatus || waitlistEvent);
  const position = Number.isFinite(Number(context.position)) && Number(context.position) > 0
    ? Number(context.position)
    : null;
  const previousPosition =
    Number.isFinite(Number(context.previousPosition)) && Number(context.previousPosition) > 0
      ? Number(context.previousPosition)
      : null;
  const reason = normalizeText(context.reason || context.notes);
  const notificationId = createWaitlistNotificationId(driverId, waitlistEvent, {
    status,
    cityKey,
    position,
    previousPosition,
  });

  const body = template.body({ ...context, cityLabel, cityKey, position, previousPosition, reason });
  const data = {
    type: WAITLIST_NOTIFICATION_TYPE,
    notificationType: WAITLIST_NOTIFICATION_TYPE,
    waitlistEvent,
    status,
    driverId: normalizeText(driverId),
    userType: 'driver',
    role: 'driver',
    screen: DEFAULT_WAITLIST_ROUTE,
    routeName: DEFAULT_WAITLIST_ROUTE,
    cityKey,
    cityLabel,
    position: position ? String(position) : '',
    previousPosition: previousPosition ? String(previousPosition) : '',
    reason,
  };

  return {
    id: notificationId,
    title: template.title,
    body,
    message: body,
    priority: 'high',
    channelId: 'driver_waitlist',
    badge: 1,
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, toDataValue(value)])
    ),
  };
}

function createWaitlistNotificationId(driverId, event, context = {}) {
  const signature = [
    'waitlist',
    normalizeText(driverId),
    normalizeEvent(event),
    normalizeText(context.status),
    normalizeText(context.cityKey),
    normalizeText(context.position),
    normalizeText(context.previousPosition),
  ].join(':');
  const digest = crypto.createHash('sha1').update(signature).digest('hex').slice(0, 16);
  return `waitlist_${digest}`;
}

class WaitlistNotificationService {
  constructor(options = {}) {
    this.admin = options.adminModule || admin;
    this.fcmService = options.fcmService || new FCMService(options.redis || null);
    this.firestore = options.firestore || null;
    this.realtimeDB = options.realtimeDB || null;
    this.now = options.now || (() => new Date());
    this.logger = options.logger || logger;
    this.initialized = Boolean(options.fcmService);
  }

  async ensureFcmInitialized() {
    if (this.initialized) return;

    if (!this.fcmService.redis && redisPool?.getConnection) {
      try {
        this.fcmService.setRedis(redisPool.getConnection());
      } catch (error) {
        logStructured('warn', 'Nao foi possivel vincular Redis ao push da waitlist', {
          service: 'waitlist-notification',
          error: error.message,
        });
      }
    }

    if (typeof this.fcmService.initialize === 'function') {
      await this.fcmService.initialize();
    }
    this.initialized = true;
  }

  getFirestore() {
    if (this.firestore) return this.firestore;
    if (this.admin?.apps?.length > 0 && typeof this.admin.firestore === 'function') {
      this.firestore = this.admin.firestore();
      return this.firestore;
    }
    return null;
  }

  getRealtimeDB() {
    if (this.realtimeDB) return this.realtimeDB;
    if (firebaseConfig?.getRealtimeDB) {
      this.realtimeDB = firebaseConfig.getRealtimeDB();
      return this.realtimeDB;
    }
    if (this.admin?.apps?.length > 0 && typeof this.admin.database === 'function') {
      this.realtimeDB = this.admin.database();
      return this.realtimeDB;
    }
    return null;
  }

  serverTimestamp() {
    return this.admin?.firestore?.FieldValue?.serverTimestamp?.() || this.now().toISOString();
  }

  async persistNotification(driverId, notification, delivery = {}) {
    const createdAt = this.now().toISOString();
    const baseRecord = {
      id: notification.id,
      userId: driverId,
      driverId,
      userType: 'driver',
      type: 'waitlist',
      notificationType: WAITLIST_NOTIFICATION_TYPE,
      waitlistEvent: notification.data.waitlistEvent,
      title: notification.title,
      body: notification.body,
      message: notification.body,
      priority: notification.priority,
      channelId: notification.channelId,
      data: notification.data,
      read: false,
      createdAt,
      deliveryStatus: delivery.status || 'queued',
      delivery,
    };

    const result = {
      firestore: false,
      realtimeDB: false,
      notificationId: notification.id,
    };

    const firestore = this.getFirestore();
    if (firestore) {
      await firestore.collection('notificationHistory').doc(notification.id).set({
        ...baseRecord,
        timestamp: this.serverTimestamp(),
        updatedAt: this.serverTimestamp(),
      }, { merge: true });
      result.firestore = true;
    }

    const realtimeDB = this.getRealtimeDB();
    if (realtimeDB) {
      await realtimeDB.ref(`notifications/${driverId}/${notification.id}`).set({
        ...baseRecord,
        createdAt,
      });
      result.realtimeDB = true;
    }

    return result;
  }

  async updateDeliveryStatus(driverId, notification, pushResult = {}) {
    const deliveryStatus = pushResult.success ? 'sent' : 'failed';
    const delivery = {
      status: deliveryStatus,
      success: pushResult.success === true,
      error: pushResult.error || null,
      summary: pushResult.summary || null,
      updatedAt: this.now().toISOString(),
    };

    const firestore = this.getFirestore();
    if (firestore) {
      await firestore.collection('notificationHistory').doc(notification.id).set({
        deliveryStatus,
        delivery,
        sentAt: pushResult.success ? this.serverTimestamp() : null,
        updatedAt: this.serverTimestamp(),
      }, { merge: true });
    }

    const realtimeDB = this.getRealtimeDB();
    if (realtimeDB) {
      await realtimeDB.ref(`notifications/${driverId}/${notification.id}/delivery`).set(delivery);
    }

    return delivery;
  }

  async dispatch(driverId, event, context = {}) {
    const normalizedDriverId = normalizeText(driverId);
    if (!normalizedDriverId) {
      return {
        success: false,
        push: { success: false, error: 'driverId obrigatorio' },
        persisted: { firestore: false, realtimeDB: false },
      };
    }

    const notification = buildWaitlistNotification(normalizedDriverId, event, context);
    const persisted = await this.persistNotification(normalizedDriverId, notification, {
      status: 'queued',
    });

    let push = { success: false, error: 'push_not_attempted' };
    try {
      await this.ensureFcmInitialized();
      push = await this.fcmService.sendNotificationToUser(normalizedDriverId, notification);
    } catch (error) {
      push = { success: false, error: error.message };
    }

    const delivery = await this.updateDeliveryStatus(normalizedDriverId, notification, push);

    logStructured(push.success ? 'info' : 'warn', 'Automacao de waitlist executada', {
      service: 'waitlist-notification',
      driverId: normalizedDriverId,
      waitlistEvent: notification.data.waitlistEvent,
      notificationId: notification.id,
      pushSuccess: push.success === true,
      persisted,
    });

    return {
      success: push.success === true || persisted.firestore || persisted.realtimeDB,
      notification,
      persisted,
      push,
      delivery,
    };
  }
}

const waitlistNotificationService = new WaitlistNotificationService();

module.exports = waitlistNotificationService;
module.exports.WaitlistNotificationService = WaitlistNotificationService;
module.exports.WAITLIST_EVENTS = WAITLIST_EVENTS;
module.exports.WAITLIST_NOTIFICATION_TYPE = WAITLIST_NOTIFICATION_TYPE;
module.exports.buildWaitlistNotification = buildWaitlistNotification;
