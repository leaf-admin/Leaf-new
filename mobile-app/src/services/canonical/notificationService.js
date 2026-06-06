import database from '@react-native-firebase/database';
import Logger from '../../utils/Logger';

export const normalizeNotificationSnapshot = (snapshot) => {
  if (!snapshot?.exists?.()) {
    return [];
  }

  const notifications = [];
  snapshot.forEach((child) => {
    notifications.push({
      id: child.key,
      ...child.val(),
    });
  });

  return notifications.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};

export const getNotifications = async (uid) => {
  try {
    if (!uid) {
      Logger.warn('getNotifications: UID não fornecido');
      return [];
    }

    const snapshot = await database().ref(`notifications/${uid}`).once('value');
    return normalizeNotificationSnapshot(snapshot);
  } catch (error) {
    Logger.error('Erro ao buscar notificações:', error);
    return [];
  }
};
