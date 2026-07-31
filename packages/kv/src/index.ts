/**
 * KV abstraction: Redis when REDIS_URL is set, otherwise an in-process
 * fallback. Gives us the wait-queue (sorted set) and the distance cache
 * without making Redis a hard dependency for local dev/review.
 * Graceful degradation is an explicit NFR: if Redis dies mid-event, the
 * system keeps working on the in-memory fallback (queue is rebuilt from
 * Postgres state on worker restart — DB remains the source of truth).
 */
import Redis from "ioredis";

export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  /** ascending by score */
  zrangeWithScores(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]>;
  zscore(key: string, member: string): Promise<number | null>;
}

class MemoryKv implements Kv {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private zsets = new Map<string, Map<string, number>>();

  async get(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt && Date.now() > e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: string, ttlSeconds?: number) {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }
  private z(key: string) {
    let m = this.zsets.get(key);
    if (!m) {
      m = new Map();
      this.zsets.set(key, m);
    }
    return m;
  }
  async zadd(key: string, score: number, member: string) {
    this.z(key).set(member, score);
  }
  async zrem(key: string, member: string) {
    this.z(key).delete(member);
  }
  async zrangeWithScores(key: string, start: number, stop: number) {
    const all = [...this.z(key).entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score);
    const end = stop === -1 ? all.length : stop + 1;
    return all.slice(start, end);
  }
  async zscore(key: string, member: string) {
    return this.z(key).get(member) ?? null;
  }
}

class RedisKv implements Kv {
  constructor(private r: Redis) {}
  async get(key: string) {
    return this.r.get(key);
  }
  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.r.set(key, value, "EX", ttlSeconds);
    else await this.r.set(key, value);
  }
  async zadd(key: string, score: number, member: string) {
    await this.r.zadd(key, score, member);
  }
  async zrem(key: string, member: string) {
    await this.r.zrem(key, member);
  }
  async zrangeWithScores(key: string, start: number, stop: number) {
    const raw = await this.r.zrange(key, start, stop, "WITHSCORES");
    const out: { member: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      out.push({ member: raw[i]!, score: Number(raw[i + 1]) });
    }
    return out;
  }
  async zscore(key: string, member: string) {
    const s = await this.r.zscore(key, member);
    return s === null ? null : Number(s);
  }
}

let instance: Kv | undefined;

export function getKv(): Kv {
  if (!instance) {
    const url = process.env.REDIS_URL;
    if (url) {
      instance = new RedisKv(new Redis(url, { maxRetriesPerRequest: 2 }));
    } else {
      instance = new MemoryKv();
    }
  }
  return instance;
}
