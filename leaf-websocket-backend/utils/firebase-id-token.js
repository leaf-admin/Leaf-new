'use strict';

// Firebase ID tokens stay valid for up to 1 h after the account is disabled or
// its sessions are revoked. verifyFirebaseIdToken adds that check
// (what verifyIdToken(token, true) does) with the account status cached per
// uid for a short time, so a blocked user loses access within a minute
// without one Auth API call per request.

const STATUS_TTL_MS = 60 * 1000;
const STATUS_MAX_ENTRIES = 5000;
const statusCache = new Map();

function authError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function readAccountStatus(auth, uid, nowMs) {
  const cached = statusCache.get(uid);
  if (cached && nowMs - cached.at < STATUS_TTL_MS) return cached.status;
  let status = null;
  try {
    const user = typeof auth.getUser === 'function' ? await auth.getUser(uid) : null;
    if (user) {
      const validAfter = Date.parse(user.tokensValidAfterTime || '');
      status = { disabled: user.disabled === true, validAfterMs: Number.isFinite(validAfter) ? validAfter : null };
    }
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      status = { deleted: true };
    } else {
      // Auth API unavailable: keep serving on the signed token rather than
      // turning a Google outage into a Leaf outage.
      return null;
    }
  }
  if (status) {
    statusCache.delete(uid);
    statusCache.set(uid, { status, at: nowMs });
    if (statusCache.size > STATUS_MAX_ENTRIES) statusCache.delete(statusCache.keys().next().value);
  }
  return status;
}

async function verifyFirebaseIdToken(auth, token, { nowMs = Date.now() } = {}) {
  const decoded = await auth.verifyIdToken(token);
  if (!decoded?.uid) return decoded;
  const status = await readAccountStatus(auth, decoded.uid, nowMs);
  if (!status) return decoded;
  if (status.deleted) throw authError('auth/user-not-found', 'Conta não encontrada');
  if (status.disabled) throw authError('auth/user-disabled', 'Conta desativada');
  const issuedAtMs = Number(decoded.auth_time || decoded.iat) * 1000;
  if (status.validAfterMs !== null && Number.isFinite(issuedAtMs) && issuedAtMs < status.validAfterMs) {
    throw authError('auth/id-token-revoked', 'Sessão revogada');
  }
  return decoded;
}

// Lets the account-blocking flows apply a block on this process at once.
function forgetAccountStatus(uid) {
  if (uid) statusCache.delete(String(uid));
}

module.exports = { verifyFirebaseIdToken, forgetAccountStatus, STATUS_TTL_MS };
