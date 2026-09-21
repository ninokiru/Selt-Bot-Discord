import { sleep } from './utils.js';
import { isShuttingDown } from './shutdown.js';

export class Cooldown {
  constructor(ms, { jitterMs = 0, onWait = null, label = '' } = {}) {
    this.baseMs = Math.max(0, ms | 0);
    this.jitterMs = Math.max(0, jitterMs | 0);
    this.onWait = onWait;
    this.label = label;

    this.lastAt = 0;
    this.chain = Promise.resolve();
  }

  async wait() {
    const prev = this.chain;
    let resolveChain;
    this.chain = new Promise((r) => { resolveChain = r; });

    try {
      await prev;

      if (this.lastAt > 0) {
        const target = this.baseMs + (this.jitterMs ? Math.random() * this.jitterMs : 0);
        const elapsed = Date.now() - this.lastAt;
        const remain = target - elapsed;

        if (remain > 0) {
          if (this.onWait) {
            try { this.onWait(remain); } catch {}
          }

          const until = Date.now() + remain;
          while (Date.now() < until) {
            if (isShuttingDown()) return;
            const step = Math.min(1000, until - Date.now());
            await sleep(step);
          }
        }
      }

      this.lastAt = Date.now();
    } finally {
      resolveChain();
    }
  }

  reset() {
    this.lastAt = 0;
  }

  remaining() {
    if (!this.lastAt) return 0;
    const target = this.baseMs + (this.jitterMs ? Math.random() * this.jitterMs : 0);
    const elapsed = Date.now() - this.lastAt;
    return Math.max(0, target - elapsed);
  }
}

// Registry chia sẻ cooldown theo key (proxy host:port, hoặc "direct")
// Dùng khi nhiều token chạy song song mà dùng chung proxy pool
export class CooldownRegistry {
  constructor() {
    this.map = new Map();
  }

  get(key, ms, opts = {}) {
    if (!this.map.has(key)) {
      this.map.set(key, new Cooldown(ms, opts));
    }
    return this.map.get(key);
  }

  clear(key) {
    if (key === undefined) this.map.clear();
    else this.map.delete(key);
  }

  size() {
    return this.map.size;
  }
}