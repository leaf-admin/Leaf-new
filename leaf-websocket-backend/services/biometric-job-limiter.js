const { logStructured } = require('../utils/logger');

function parsePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

class BiometricJobLimiter {
  constructor(options = {}) {
    this.maxConcurrency = parsePositiveInteger(
      options.maxConcurrency || process.env.BIOMETRIC_SERVER_SIDE_MAX_CONCURRENCY,
      4
    );
    this.maxQueue = parsePositiveInteger(
      options.maxQueue || process.env.BIOMETRIC_SERVER_SIDE_MAX_QUEUE,
      250
    );
    this.activeCount = 0;
    this.queue = [];
    this.completedCount = 0;
    this.rejectedCount = 0;
  }

  getStats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency,
      maxQueue: this.maxQueue,
      completed: this.completedCount,
      rejected: this.rejectedCount
    };
  }

  async run(type, task) {
    if (typeof task !== 'function') {
      throw new Error('biometric job task deve ser uma função');
    }

    const enqueuedAt = Date.now();
    await this.#acquire(type, enqueuedAt);
    const waitMs = Date.now() - enqueuedAt;

    try {
      const result = await task({
        waitMs,
        limiter: this.getStats()
      });
      this.completedCount += 1;
      return {
        result,
        waitMs,
        limiter: this.getStats()
      };
    } finally {
      this.#release();
    }
  }

  #acquire(type, enqueuedAt) {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    if (this.queue.length >= this.maxQueue) {
      this.rejectedCount += 1;
      const error = new Error('Fila biométrica cheia. Tente novamente em instantes.');
      error.code = 'BIOMETRIC_QUEUE_OVERLOADED';
      error.stats = this.getStats();
      throw error;
    }

    return new Promise((resolve) => {
      this.queue.push({
        type,
        enqueuedAt,
        resolve
      });

      logStructured('warn', 'Job biometrico aguardando vaga no limitador', {
        service: 'biometric-job-limiter',
        type,
        active: this.activeCount,
        queued: this.queue.length,
        maxConcurrency: this.maxConcurrency
      });
    });
  }

  #release() {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
      return;
    }

    this.activeCount = Math.max(0, this.activeCount - 1);
  }
}

module.exports = new BiometricJobLimiter();
module.exports.BiometricJobLimiter = BiometricJobLimiter;
