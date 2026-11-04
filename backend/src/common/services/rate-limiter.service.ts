import { Injectable } from '@nestjs/common';

interface Bucket {
  hits: number[];
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Sliding-window rate limiting, in process memory.
 *
 * Scope note, stated rather than glossed over: this is per-instance. The
 * deployment target is a single self-hosted node, which is why it is adequate
 * here. Running more than one instance requires moving these counters to Redis
 * or the limits multiply by the instance count.
 *
 * Brute-force protection for the Document Master Password does NOT rely on
 * this alone — `dmp_attempts` in the database provides a durable count that a
 * process restart cannot clear. See DmpService.
 */
@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  constructor() {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  private sweep(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, bucket] of this.buckets) {
      bucket.hits = bucket.hits.filter((t) => t > cutoff);
      if (bucket.hits.length === 0) this.buckets.delete(key);
    }
  }

  consume(key: string, limit: number, windowSeconds: number): RateLimitVerdict {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => t > now - windowMs);

    if (bucket.hits.length >= limit) {
      this.buckets.set(key, bucket);
      const oldest = bucket.hits[0];
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Test-only. */
  reset(): void {
    this.buckets.clear();
  }
}
