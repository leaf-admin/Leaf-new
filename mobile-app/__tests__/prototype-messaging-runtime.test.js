import {
  appendRuntimeNotificationState,
  buildOptimisticChatMessage,
  buildSupportIncidentRecord,
  buildSupportTicketRecord,
  createRuntimeNotification,
  markAllRuntimeNotificationsReadState,
  markRuntimeNotificationReadState,
  mergeChatMessages,
  normalizeChatMessage,
} from '../src/screens/prototype/prototypeMessagingRuntime';

describe('prototype messaging runtime helpers', () => {
  const fixedNow = () => Date.parse('2026-05-30T12:00:00.000Z');
  const fixedRandom = () => 0.123456;

  it('creates, appends and marks runtime notifications without mutating unrelated entries', () => {
    const notification = createRuntimeNotification({
      title: 'Corrida atualizada',
      message: 'Motorista chegou.',
      kind: 'trip',
      scope: 'passenger',
    }, {
      now: fixedNow,
      random: fixedRandom,
    });

    expect(notification).toEqual({
      id: 'notif-1780142400000-1f9acf',
      title: 'Corrida atualizada',
      message: 'Motorista chegou.',
      kind: 'trip',
      scope: 'passenger',
      read: false,
      createdAt: '2026-05-30T12:00:00.000Z',
    });

    const appended = appendRuntimeNotificationState([
      { id: 'old-1', read: false },
      { id: 'old-2', read: true },
    ], notification, 2);

    expect(appended).toEqual([
      notification,
      { id: 'old-1', read: false },
    ]);

    expect(markRuntimeNotificationReadState(appended, notification.id)).toEqual([
      { ...notification, read: true },
      { id: 'old-1', read: false },
    ]);

    expect(markAllRuntimeNotificationsReadState(appended)).toEqual([
      { ...notification, read: true },
      { id: 'old-1', read: true },
    ]);
  });

  it('normalizes and merges chat messages by id, timestamp and current profile', () => {
    expect(normalizeChatMessage({
      id: 'm1',
      senderId: 'user_1',
      text: 'Oi',
      timestamp: 'invalid',
    }, {
      profileUid: 'user_1',
      fallbackNow: () => '2026-05-30T12:02:00.000Z',
    })).toEqual({
      id: 'm1',
      text: 'Oi',
      senderId: 'user_1',
      author: 'you',
      timestamp: '2026-05-30T12:02:00.000Z',
    });

    const merged = mergeChatMessages([
      {
        id: 'm2',
        senderId: 'driver_1',
        text: 'Cheguei',
        timestamp: '2026-05-30T12:03:00.000Z',
      },
      {
        id: 'empty',
        senderId: 'driver_1',
        text: '   ',
        timestamp: '2026-05-30T12:04:00.000Z',
      },
    ], [
      {
        id: 'm1',
        senderId: 'user_1',
        message: 'Estou indo',
        timestamp: '2026-05-30T12:01:00.000Z',
      },
      {
        id: 'm2',
        senderId: 'driver_1',
        message: 'Te espero aqui',
        timestamp: '2026-05-30T12:05:00.000Z',
      },
    ], {
      profileUid: 'user_1',
    });

    expect(merged).toEqual([
      {
        id: 'm1',
        text: 'Estou indo',
        senderId: 'user_1',
        author: 'you',
        timestamp: '2026-05-30T12:01:00.000Z',
      },
      {
        id: 'm2',
        text: 'Te espero aqui',
        senderId: 'driver_1',
        author: 'driver',
        timestamp: '2026-05-30T12:05:00.000Z',
      },
    ]);
  });

  it('builds optimistic chat and support records with stable ids for tests', () => {
    expect(buildOptimisticChatMessage('  Tudo certo  ', {
      senderId: 'user_1',
      now: fixedNow,
      random: fixedRandom,
    })).toEqual({
      id: 'local-1780142400000-1f9acf',
      text: 'Tudo certo',
      senderId: 'user_1',
      author: 'you',
      timestamp: '2026-05-30T12:00:00.000Z',
    });

    expect(buildOptimisticChatMessage('   ')).toBeNull();

    expect(buildSupportTicketRecord({
      ticketId: 'ticket_1',
    }, {
      type: 'payment',
      priority: 'N2',
      description: 'Pix pendente',
      now: fixedNow,
    })).toEqual({
      id: 'ticket_1',
      type: 'payment',
      priority: 'N2',
      description: 'Pix pendente',
      createdAt: '2026-05-30T12:00:00.000Z',
    });

    expect(buildSupportIncidentRecord({
      incidentId: 'incident_1',
    }, {
      type: 'safety',
      description: 'Preciso de ajuda',
      now: fixedNow,
    })).toEqual({
      id: 'incident_1',
      type: 'safety',
      description: 'Preciso de ajuda',
      createdAt: '2026-05-30T12:00:00.000Z',
    });
  });
});
