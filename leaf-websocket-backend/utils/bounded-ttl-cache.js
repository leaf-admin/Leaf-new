'use strict';

// FIFO with a fixed TTL: expiry order follows insertion order. No timer or
// growing tombstone list, and neither the entry count nor retained bytes grow
// with the number of distinct requests served over the process lifetime.
class BoundedTtlCache {
  constructor({ maxEntries = 256, maxBytes = 8 * 1024 * 1024, ttlMs = 10000, now = Date.now } = {}) {
    for (const value of [maxEntries, maxBytes, ttlMs]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid cache budget');
    }
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.bytes = 0;
  }

  get size() { return this.entries.size; }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    return this.entries.delete(key);
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) break;
      this.delete(key);
    }
  }

  get(key) {
    this.prune();
    return this.entries.get(key)?.value ?? null;
  }

  set(key, value) {
    const bytes = Buffer.byteLength(String(key)) + Buffer.byteLength(JSON.stringify(value));
    this.prune();
    this.delete(key);
    if (bytes > this.maxBytes) return false;
    while (this.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, { value, bytes, expiresAt: this.now() + this.ttlMs });
    this.bytes += bytes;
    return true;
  }
}

module.exports = BoundedTtlCache;
