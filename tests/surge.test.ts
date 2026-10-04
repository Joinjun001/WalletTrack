import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SurgeDetector, SURGE_MIN_VOLUME_KRW } from '../src/surge.ts';
import type { SurgeEvent } from '../src/surge.ts';

const VOL = SURGE_MIN_VOLUME_KRW * 2;

test('fires once per threshold as the price climbs, with cooldown', () => {
  const out: SurgeEvent[] = [];
  const d = new SurgeDetector((e) => out.push(e));
  d.update('KRW-ETH', 100, VOL, 0);
  d.update('KRW-ETH', 102, VOL, 10_000);   // +2% → 2% 기준만
  d.update('KRW-ETH', 102.5, VOL, 20_000); // 쿨다운 중, 더 오르지 않음
  d.update('KRW-ETH', 103, VOL, 30_000);   // +3% → 3% 기준
  assert.deepEqual(out.map((e) => [e.threshold, e.direction]), [[2, 'up'], [3, 'up']]);
  d.update('KRW-ETH', 104.5, VOL, 40_000); // 2% 기준: 앞 +2%보다 2%p 더 → 다시
  assert.deepEqual(out.slice(2).map((e) => e.threshold), [2]);
  assert.equal(out[0].from, 100);
  assert.equal(out[0].market, 'KRW-ETH');
});

test('detects drops and ignores thin markets and USDT', () => {
  const out: SurgeEvent[] = [];
  const d = new SurgeDetector((e) => out.push(e));
  d.update('KRW-XRP', 1000, VOL, 0);
  d.update('KRW-XRP', 940, VOL, 10_000);  // -6%
  assert.deepEqual(out.map((e) => [e.threshold, e.direction]), [[2, 'down'], [3, 'down'], [5, 'down']]);
  d.update('KRW-THIN', 100, 1, 0);
  d.update('KRW-THIN', 150, 1, 10_000);
  d.update('KRW-USDT', 1400, VOL, 0);
  d.update('KRW-USDT', 1500, VOL, 10_000);
  assert.equal(out.length, 3);
});
