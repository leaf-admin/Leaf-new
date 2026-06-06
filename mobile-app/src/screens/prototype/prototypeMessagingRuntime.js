export const CHAT_MESSAGE_LIMIT = 80;
export const NOTIFICATION_LIMIT = 24;

function sanitizeText(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value).trim();
  return text || fallback;
}

function resolveTimestamp(value, fallbackNow = () => new Date().toISOString()) {
  const timestampValue = value || fallbackNow();
  const timestampDate = new Date(timestampValue);
  return Number.isNaN(timestampDate.getTime())
    ? fallbackNow()
    : timestampDate.toISOString();
}

function createId(prefix, now = Date.now, random = Math.random) {
  return `${prefix}-${now()}-${random().toString(16).slice(2, 8)}`;
}

export function createRuntimeNotification(
  {
    title,
    message,
    kind = "system",
    scope = "both",
    read = false,
  } = {},
  options = {},
) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const random =
    typeof options.random === "function" ? options.random : Math.random;
  const createdAt =
    options.createdAt || new Date(Number(now()) || Date.now()).toISOString();

  return {
    id: options.id || createId("notif", now, random),
    title: String(title || "Atualização"),
    message: String(message || ""),
    kind,
    scope,
    read: Boolean(read),
    createdAt,
  };
}

export function appendRuntimeNotificationState(
  previousNotifications = [],
  entry = null,
  limit = NOTIFICATION_LIMIT,
) {
  if (!entry || typeof entry !== "object") {
    return Array.isArray(previousNotifications) ? previousNotifications : [];
  }

  const safePrevious = Array.isArray(previousNotifications)
    ? previousNotifications
    : [];
  return [entry, ...safePrevious].slice(0, Math.max(0, Number(limit) || 0));
}

export function markRuntimeNotificationReadState(
  previousNotifications = [],
  notificationId = "",
) {
  const safePrevious = Array.isArray(previousNotifications)
    ? previousNotifications
    : [];
  if (!notificationId) {
    return safePrevious;
  }

  return safePrevious.map((item) =>
    item?.id === notificationId && !item.read
      ? {
          ...item,
          read: true,
        }
      : item,
  );
}

export function markAllRuntimeNotificationsReadState(
  previousNotifications = [],
) {
  const safePrevious = Array.isArray(previousNotifications)
    ? previousNotifications
    : [];
  return safePrevious.map((item) =>
    item?.read
      ? item
      : {
          ...item,
          read: true,
        },
  );
}

export function normalizeChatMessage(
  message,
  { profileUid = "", fallbackNow = () => new Date().toISOString() } = {},
) {
  const senderId =
    message?.senderId || message?.userId || message?.fromUserId || "";
  const messageText = sanitizeText(message?.message || message?.text, "");
  const timestamp = resolveTimestamp(
    message?.timestamp || message?.createdAt || message?.sentAt,
    fallbackNow,
  );
  const messageId =
    message?.messageId ||
    message?.id ||
    `msg-${timestamp}-${Math.random().toString(16).slice(2, 9)}`;
  const normalizedProfileUid = String(profileUid || "").trim();
  const isYou =
    normalizedProfileUid && senderId && senderId === normalizedProfileUid;

  return {
    id: String(messageId),
    text: messageText,
    senderId: senderId || null,
    author: isYou ? "you" : "driver",
    timestamp,
  };
}

export function mergeChatMessages(
  existing = [],
  incoming = [],
  { profileUid = "", limit = CHAT_MESSAGE_LIMIT } = {},
) {
  const map = new Map();

  [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ].forEach((raw) => {
    const item = normalizeChatMessage(raw, { profileUid });
    if (!item.text) {
      return;
    }

    map.set(String(item.id), item);
  });

  return Array.from(map.values())
    .sort((left, right) => {
      const leftTime = new Date(left.timestamp).getTime();
      const rightTime = new Date(right.timestamp).getTime();
      return leftTime - rightTime;
    })
    .slice(-Math.max(0, Number(limit) || 0));
}

export function buildOptimisticChatMessage(
  text,
  {
    senderId = null,
    now = Date.now,
    random = Math.random,
    timestamp = null,
  } = {},
) {
  const messageText = sanitizeText(text, "");
  if (!messageText) {
    return null;
  }

  const createdAt =
    timestamp || new Date(Number(now()) || Date.now()).toISOString();

  return {
    id: createId("local", now, random),
    text: messageText,
    senderId: senderId || null,
    author: "you",
    timestamp: createdAt,
  };
}

export function buildSupportTicketRecord(
  response = {},
  { type = "support", priority = "N3", description = "", now = Date.now } = {},
) {
  const createdAt = new Date(Number(now()) || Date.now()).toISOString();
  const id = response?.ticketId || response?.id || createId("ticket", now);
  return {
    id,
    type: sanitizeText(type, "support"),
    priority: sanitizeText(priority, "N3"),
    description: sanitizeText(description, ""),
    createdAt,
  };
}

export function buildSupportIncidentRecord(
  response = {},
  { type = "incident", description = "", now = Date.now } = {},
) {
  const createdAt = new Date(Number(now()) || Date.now()).toISOString();
  const id = response?.incidentId || response?.id || createId("incident", now);
  return {
    id,
    type: sanitizeText(type, "incident"),
    description: sanitizeText(description, ""),
    createdAt,
  };
}
