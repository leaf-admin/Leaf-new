const { randomUUID } = require('crypto');

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const ASSERT_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return 1
end
return 0
`;

class RedisLeaderLease {
    constructor(redis, options = {}) {
        if (!redis) {
            throw new Error('RedisLeaderLease requer uma conexao Redis');
        }

        this.redis = redis;
        this.key = String(options.key || '').trim();
        if (!this.key) {
            throw new Error('RedisLeaderLease requer uma chave');
        }

        this.ttlMs = Math.max(3000, Number.parseInt(options.ttlMs, 10) || 15000);
        this.renewIntervalMs = Math.max(
            500,
            Math.min(
                Number.parseInt(options.renewIntervalMs, 10) || Math.floor(this.ttlMs / 3),
                Math.floor(this.ttlMs / 2)
            )
        );
        this.ownerId = String(options.ownerId || 'worker').trim() || 'worker';
        this.token = `${this.ownerId}:${randomUUID()}`;
        this.logger = options.logger || null;
        this.held = false;
        this.renewTimer = null;
        this.renewInFlight = false;
    }

    isHeld() {
        return this.held;
    }

    async acquire() {
        if (this.held) {
            return this.assertHeld();
        }

        const result = await this.redis.set(
            this.key,
            this.token,
            'PX',
            this.ttlMs,
            'NX'
        );

        if (result !== 'OK') {
            return false;
        }

        this.held = true;
        this.startRenewal();
        return true;
    }

    async assertHeld() {
        if (!this.held) {
            return false;
        }

        try {
            const result = await this.redis.eval(ASSERT_SCRIPT, 1, this.key, this.token);
            if (Number(result) === 1) {
                return true;
            }
        } catch (error) {
            this.logWarn('Falha ao validar lease de lideranca; execucao interrompida', error);
        }

        this.markLost();
        return false;
    }

    async renew() {
        if (!this.held || this.renewInFlight) {
            return false;
        }

        this.renewInFlight = true;
        try {
            const result = await this.redis.eval(
                RENEW_SCRIPT,
                1,
                this.key,
                this.token,
                String(this.ttlMs)
            );

            if (Number(result) === 1) {
                return true;
            }

            this.markLost();
            return false;
        } catch (error) {
            this.logWarn('Falha ao renovar lease de lideranca; execucao interrompida', error);
            this.markLost();
            return false;
        } finally {
            this.renewInFlight = false;
        }
    }

    async release() {
        const token = this.token;
        const wasHeld = this.held;
        this.markLost();

        if (!wasHeld) {
            return false;
        }

        try {
            const result = await this.redis.eval(RELEASE_SCRIPT, 1, this.key, token);
            return Number(result) === 1;
        } catch (error) {
            this.logWarn('Falha ao liberar lease de lideranca; TTL fara a recuperacao', error);
            return false;
        }
    }

    startRenewal() {
        this.stopRenewal();
        this.renewTimer = setInterval(() => {
            this.renew().catch((error) => {
                this.logWarn('Erro inesperado na renovacao do lease de lideranca', error);
                this.markLost();
            });
        }, this.renewIntervalMs);
        if (typeof this.renewTimer.unref === 'function') {
            this.renewTimer.unref();
        }
    }

    stopRenewal() {
        if (this.renewTimer) {
            clearInterval(this.renewTimer);
            this.renewTimer = null;
        }
    }

    markLost() {
        this.held = false;
        this.stopRenewal();
    }

    logWarn(message, error) {
        if (this.logger && typeof this.logger.warn === 'function') {
            this.logger.warn(`[RedisLeaderLease] ${message}`, {
                key: this.key,
                error: error?.message || String(error || '')
            });
        }
    }
}

module.exports = RedisLeaderLease;
module.exports.ASSERT_SCRIPT = ASSERT_SCRIPT;
module.exports.RELEASE_SCRIPT = RELEASE_SCRIPT;
module.exports.RENEW_SCRIPT = RENEW_SCRIPT;
