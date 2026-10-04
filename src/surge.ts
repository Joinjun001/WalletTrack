/**
 * 급등·급락 판정 (웹 surgeFeed.ts와 서버 수집기가 같이 쓴다 → server/Dockerfile COPY에 포함).
 * 업비트 원화 마켓 실시간 시세로 최근 5분 최저가보다 기준(%) 이상 오르면 급등, 최고가보다 그만큼 내리면 급락.
 * 기준(2·3·5·10%)마다 따로 판정한다: 같은 코인·방향은 10분 동안 다시 내보내지 않고, 그 사이 기준만큼 더 움직이면 다시 내보낸다.
 * 거래대금이 아주 적은 코인(24시간 5억원 미만)은 뺀다.
 */

import { detectSurge, pushPriceBucket } from './market.ts';
import type { PriceBucket } from './market.ts';

export const SURGE_THRESHOLDS = [2, 3, 5, 10];
export const SURGE_BUCKET_MS = 10_000;
export const SURGE_WINDOW_MS = 5 * 60_000;
export const SURGE_COOLDOWN_MS = 10 * 60_000;
export const SURGE_MIN_VOLUME_KRW = 5e8;

export interface SurgeEvent {
  market: string;     // KRW-ETH
  threshold: number;  // 판정 기준 (%)
  direction: 'up' | 'down';
  pct: number;        // 기준 가격 대비 변화 (%)
  from: number;       // 5분 최저가(급등)·최고가(급락)
  price: number;
  volumeKrw: number;  // 24시간 거래대금
  at: number;         // ms
}

export class SurgeDetector {
  private buckets = new Map<string, PriceBucket[]>();
  private lastFired = new Map<string, { at: number; pct: number }>(); // "KRW-ETH|3|up"
  private emit: (e: SurgeEvent) => void;

  constructor(emit: (e: SurgeEvent) => void) {
    this.emit = emit;
  }

  update(market: string, price: number, volumeKrw: number, now: number) {
    if (!market.startsWith('KRW-') || market === 'KRW-USDT') return;
    let list = this.buckets.get(market);
    if (!list) {
      list = [];
      this.buckets.set(market, list);
    }
    pushPriceBucket(list, price, now, SURGE_BUCKET_MS, SURGE_WINDOW_MS);
    if (volumeKrw < SURGE_MIN_VOLUME_KRW) return;

    for (const threshold of SURGE_THRESHOLDS) {
      const surge = detectSurge(list, price, threshold);
      if (!surge) continue;
      const key = `${market}|${threshold}|${surge.direction}`;
      const prev = this.lastFired.get(key);
      if (prev && now - prev.at < SURGE_COOLDOWN_MS && Math.abs(surge.pct) < Math.abs(prev.pct) + threshold) continue;
      this.lastFired.set(key, { at: now, pct: surge.pct });
      this.emit({ market, threshold, direction: surge.direction, pct: surge.pct, from: surge.from, price, volumeKrw, at: now });
    }
  }
}
