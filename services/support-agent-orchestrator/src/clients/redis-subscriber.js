const Redis = require("ioredis");
const logger = require("../utils/logger");

class RedisSubscriber {
  constructor({ url, channel }) {
    this.url = url;
    this.channel = channel;
    this.client = null;
  }

  async start(onMessage) {
    if (!this.url || !this.channel) return;
    this.client = new Redis(this.url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.client.on("error", (error) => {
      logger.warn("Redis subscriber error", { error: error.message });
    });
    await this.client.connect();
    await this.client.subscribe(this.channel);
    this.client.on("message", (channel, raw) => {
      if (channel !== this.channel) return;
      try {
        const payload = JSON.parse(raw);
        onMessage(payload);
      } catch (error) {
        logger.warn("Invalid Redis support chat payload", { error: error.message });
      }
    });
    logger.info("Redis subscriber started", { channel: this.channel });
  }

  async stop() {
    if (!this.client) return;
    await this.client.quit().catch(() => {});
    this.client = null;
  }
}

module.exports = RedisSubscriber;
