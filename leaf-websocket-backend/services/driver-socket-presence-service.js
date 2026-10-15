'use strict';

const DEFAULT_TTL_SECONDS = Math.max(
  30,
  Number.parseInt(process.env.DRIVER_SOCKET_PRESENCE_TTL_SECONDS || '90', 10) || 90
);

// Location updates and heartbeats refresh the presence every 1-2 s, but readers
// only need it fresher than the TTL (+5 s), and the stale-driver cleanup only
// acts after >= 30 s. An unchanged presence (same socket, rooms, worker,
// source) written less than REFRESH_MS ago is not rewritten; any change writes
// at once, and a disconnect forgets the cache entry.
const REFRESH_MS = Math.max(
  0,
  Number.parseInt(process.env.DRIVER_SOCKET_PRESENCE_REFRESH_MS || '15000', 10) || 0
);
const lastPresenceWrites = new Map(); // driverId -> { signature, at }

function getPresenceKey(driverId) {
  return `driver_socket_presence:${driverId}`;
}

function getSocketRooms(socket, fallbackRooms = []) {
  const rooms = Array.from(socket?.rooms || []);
  return rooms.length > 0 ? rooms : fallbackRooms;
}

function isDriverDispatchRoom(driverId, rooms = []) {
  return rooms.includes('drivers_room') || rooms.includes(`driver_${driverId}`);
}

function resolveWorkerId(socket) {
  return (
    socket?.workerId ||
    process.env.HOSTNAME ||
    process.env.CONTAINER_NAME ||
    `pid-${process.pid}`
  );
}

async function upsertDriverSocketPresence(redis, {
  driverId,
  socket,
  source = 'unknown',
  ttlSeconds = DEFAULT_TTL_SECONDS,
  nowMs = Date.now(),
  fallbackRooms = []
} = {}) {
  const normalizedDriverId = String(driverId || socket?.userId || '').trim();
  const socketId = String(socket?.id || '').trim();
  const userType = String(socket?.userType || '').trim().toLowerCase();

  if (!redis || !normalizedDriverId || !socketId || userType !== 'driver') {
    return {
      success: false,
      code: 'INVALID_DRIVER_SOCKET_PRESENCE_INPUT'
    };
  }

  const rooms = getSocketRooms(socket, fallbackRooms);
  const inDriverRoom = isDriverDispatchRoom(normalizedDriverId, rooms);
  const ttl = Math.max(30, Number.parseInt(ttlSeconds, 10) || DEFAULT_TTL_SECONDS);
  const updatedAt = new Date(nowMs).toISOString();
  const workerId = resolveWorkerId(socket);
  const connected = socket.connected === false ? 'false' : 'true';
  const signature = [socketId, connected, inDriverRoom, JSON.stringify(rooms), workerId, source, ttl].join('|');
  const lastWrite = lastPresenceWrites.get(normalizedDriverId);
  if (REFRESH_MS > 0 && lastWrite && lastWrite.signature === signature && nowMs - lastWrite.at >= 0 && nowMs - lastWrite.at < REFRESH_MS) {
    return {
      success: true,
      code: 'DRIVER_SOCKET_PRESENCE_RECORDED',
      key: getPresenceKey(normalizedDriverId),
      ttlSeconds: ttl,
      inDriverRoom,
      rooms,
      skipped: true
    };
  }

  const fields = {
    driverId: normalizedDriverId,
    socketId,
    userType: 'driver',
    connected,
    inDriverRoom: inDriverRoom ? 'true' : 'false',
    rooms: JSON.stringify(rooms),
    workerId,
    source,
    updatedAt,
    updatedAtMs: String(nowMs)
  };
  if (typeof redis.pipeline === 'function') {
    await redis.pipeline()
      .hset(getPresenceKey(normalizedDriverId), fields)
      .expire(getPresenceKey(normalizedDriverId), ttl)
      .exec();
  } else {
    await redis.hset(getPresenceKey(normalizedDriverId), fields);
    await redis.expire(getPresenceKey(normalizedDriverId), ttl);
  }
  if (lastPresenceWrites.size >= 50000) lastPresenceWrites.clear();
  lastPresenceWrites.set(normalizedDriverId, { signature, at: nowMs });

  return {
    success: true,
    code: 'DRIVER_SOCKET_PRESENCE_RECORDED',
    key: getPresenceKey(normalizedDriverId),
    ttlSeconds: ttl,
    inDriverRoom,
    rooms
  };
}

function parsePresenceRooms(rawRooms) {
  if (!rawRooms) return [];
  if (Array.isArray(rawRooms)) return rawRooms;
  try {
    const parsed = JSON.parse(rawRooms);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function readDriverSocketPresence(redis, driverId, {
  maxAgeMs = DEFAULT_TTL_SECONDS * 1000 + 5000,
  nowMs = Date.now()
} = {}) {
  const normalizedDriverId = String(driverId || '').trim();
  if (!redis || !normalizedDriverId) {
    return {
      reachable: false,
      code: 'DRIVER_SOCKET_PRESENCE_INPUT_MISSING'
    };
  }

  const presence = await redis.hgetall(getPresenceKey(normalizedDriverId));
  if (!presence || Object.keys(presence).length === 0) {
    return {
      reachable: false,
      code: 'DRIVER_SOCKET_PRESENCE_MISSING'
    };
  }

  const socketId = String(presence.socketId || '').trim();
  const presenceDriverId = String(presence.driverId || '').trim();
  const userType = String(presence.userType || '').trim().toLowerCase();
  const connected = String(presence.connected || '').trim().toLowerCase() === 'true';
  const updatedAtMs = Number.parseInt(presence.updatedAtMs || '0', 10);
  const ageMs = Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? nowMs - updatedAtMs : Infinity;
  const rooms = parsePresenceRooms(presence.rooms);
  const inDriverRoom =
    String(presence.inDriverRoom || '').trim().toLowerCase() === 'true' ||
    isDriverDispatchRoom(normalizedDriverId, rooms);

  if (presenceDriverId !== normalizedDriverId || userType !== 'driver' || !socketId || !connected) {
    return {
      reachable: false,
      code: 'DRIVER_SOCKET_PRESENCE_INVALID',
      presence: {
        socketId: socketId || null,
        rooms,
        workerId: presence.workerId || null,
        updatedAt: presence.updatedAt || null
      }
    };
  }

  if (!inDriverRoom) {
    return {
      reachable: false,
      code: 'DRIVER_SOCKET_PRESENCE_NOT_IN_DISPATCH_ROOM',
      presence: {
        socketId,
        rooms,
        workerId: presence.workerId || null,
        updatedAt: presence.updatedAt || null
      }
    };
  }

  if (ageMs > maxAgeMs) {
    return {
      reachable: false,
      code: 'DRIVER_SOCKET_PRESENCE_STALE',
      presence: {
        socketId,
        rooms,
        workerId: presence.workerId || null,
        updatedAt: presence.updatedAt || null,
        ageMs
      }
    };
  }

  return {
    reachable: true,
    code: 'DISTRIBUTED_SOCKET_PRESENCE',
    socketId,
    rooms,
    workerId: presence.workerId || null,
    updatedAt: presence.updatedAt || null,
    ageMs
  };
}

async function clearDriverSocketPresence(redis, {
  driverId,
  socketId,
  source = 'disconnect'
} = {}) {
  const normalizedDriverId = String(driverId || '').trim();
  const normalizedSocketId = String(socketId || '').trim();
  if (!redis || !normalizedDriverId) {
    return {
      success: false,
      code: 'DRIVER_SOCKET_PRESENCE_INPUT_MISSING'
    };
  }

  const key = getPresenceKey(normalizedDriverId);
  lastPresenceWrites.delete(normalizedDriverId);
  if (normalizedSocketId) {
    const presence = await redis.hgetall(key);
    const storedSocketId = String(presence?.socketId || '').trim();
    if (storedSocketId && storedSocketId !== normalizedSocketId) {
      return {
        success: false,
        code: 'DRIVER_SOCKET_PRESENCE_SOCKET_MISMATCH',
        storedSocketId,
        source
      };
    }
  }

  await redis.del(key);
  return {
    success: true,
    code: 'DRIVER_SOCKET_PRESENCE_CLEARED',
    source
  };
}

function resetPresenceCacheForTests() {
  lastPresenceWrites.clear();
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  resetPresenceCacheForTests,
  getPresenceKey,
  upsertDriverSocketPresence,
  readDriverSocketPresence,
  clearDriverSocketPresence
};
