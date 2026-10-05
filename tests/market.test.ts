import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kimchiPremium, formatKrw, formatKrwShort, formatSignedPct, halvingInfo, fearGreedLabelKo, timeAgoKo,
  formatKrwPrice, formatUsdShort, formatFundingRate, formatCountdown, liquidatedPosition,
  candleTimeOf, applyTick, KST_OFFSET_SEC, alertDirection, isAlertTriggered, isThresholdCrossed,
  topMovers, formatDurationKo, pushPriceBucket, detectSurge, topByValue, coinKimchiPremium, formatUsdPrice, liquidationSoundTier, tradeSoundTier
} from '../src/market.ts';
import type { PriceBucket } from '../src/market.ts';

test('kimchiPremium compares KRW price with USD price x USDT rate', () => {
  // 1 BTC = $100,000, 1 USDT = 1,400원 -> 1.4억원이면 0%, 1.428억원이면 +2%
  assert.equal(kimchiPremium(140_000_000, 100_000, 1400), 0);
  assert.ok(Math.abs(kimchiPremium(142_800_000, 100_000, 1400)! - 2) < 1e-9);
  assert.ok(kimchiPremium(137_200_000, 100_000, 1400)! < 0);
});

test('kimchiPremium returns null until every price is known', () => {
  assert.equal(kimchiPremium(0, 100_000, 1400), null);
  assert.equal(kimchiPremium(140_000_000, 0, 1400), null);
  assert.equal(kimchiPremium(140_000_000, 100_000, NaN), null);
});

test('KRW formatting', () => {
  assert.equal(formatKrw(115135000), '115,135,000원');
  assert.equal(formatKrwShort(1_035_000_000), '10.35억원');
  assert.equal(formatKrwShort(23_450_000), '2,345만원');
  assert.equal(formatKrwShort(9800), '9,800원');
  assert.equal(formatSignedPct(1.234), '+1.23%');
  assert.equal(formatSignedPct(-0.5), '-0.50%');
});

test('halvingInfo targets the next multiple of 210,000', () => {
  assert.deepEqual(halvingInfo(969722), { nextHeight: 1_050_000, remainingBlocks: 80278, estimatedDays: 558 });
  assert.equal(halvingInfo(840000).nextHeight, 1_050_000);
  assert.equal(halvingInfo(839999).remainingBlocks, 1);
});

test('fear & greed labels and time ago in Korean', () => {
  assert.equal(fearGreedLabelKo('Extreme Greed'), '극단적 탐욕');
  assert.equal(fearGreedLabelKo('Unknown'), 'Unknown');
  assert.equal(timeAgoKo(30), '방금 전');
  assert.equal(timeAgoKo(300), '5분 전');
  assert.equal(timeAgoKo(7200), '2시간 전');
});

test('coin price, USD and funding formatting', () => {
  assert.equal(formatKrwPrice(3651000), '3,651,000원');
  assert.equal(formatKrwPrice(18.5), '18.50원');
  assert.equal(formatKrwPrice(0.1234), '0.1234원');
  assert.equal(formatUsdShort(1_234_000_000), '$1.23B');
  assert.equal(formatUsdShort(12_340_000), '$12.3M');
  assert.equal(formatUsdShort(45_600), '$45.6K');
  assert.equal(formatUsdShort(950), '$950');
  assert.equal(formatFundingRate(0.0001), '+0.0100%');
  assert.equal(formatFundingRate(-0.00005), '-0.0050%');
  assert.equal(formatCountdown(3 * 3600_000 + 25 * 60_000 + 9_000), '03:25:09');
  assert.equal(formatCountdown(-5), '00:00:00');
});

test('liquidation side: SELL order closes a long', () => {
  assert.equal(liquidatedPosition('SELL'), 'long');
  assert.equal(liquidatedPosition('BUY'), 'short');
});

test('candleTimeOf buckets by UTC interval and shifts to KST for display', () => {
  const ms = Date.parse('2026-10-03T12:34:56Z');
  assert.equal(candleTimeOf(ms, 900), Date.parse('2026-10-03T12:30:00Z') / 1000 + KST_OFFSET_SEC);
  // 일봉은 UTC 00:00 = KST 09:00 시작
  assert.equal(candleTimeOf(ms, 86400), Date.parse('2026-10-03T00:00:00Z') / 1000 + KST_OFFSET_SEC);
  // 4시간봉도 UTC 00:00부터 4시간 단위
  assert.equal(candleTimeOf(ms, 14400), Date.parse('2026-10-03T12:00:00Z') / 1000 + KST_OFFSET_SEC);
});

test('candleTimeOf: weekly candles start Monday UTC 00:00, monthly on the 1st', () => {
  const sat = Date.parse('2026-10-03T12:34:56Z'); // 토요일
  assert.equal(candleTimeOf(sat, 'week'), Date.parse('2026-09-28T00:00:00Z') / 1000 + KST_OFFSET_SEC);
  const mon = Date.parse('2026-10-05T00:00:00Z'); // 월요일 시작 시각은 그 주에 속한다
  assert.equal(candleTimeOf(mon, 'week'), mon / 1000 + KST_OFFSET_SEC);
  assert.equal(candleTimeOf(Date.parse('2026-10-04T23:59:59Z'), 'week'), Date.parse('2026-09-28T00:00:00Z') / 1000 + KST_OFFSET_SEC);
  assert.equal(candleTimeOf(sat, 'month'), Date.parse('2026-10-01T00:00:00Z') / 1000 + KST_OFFSET_SEC);
});

test('applyTick updates the current candle, opens a new one, ignores late ticks', () => {
  const c = { time: 100, open: 10, high: 12, low: 9, close: 11 };
  assert.deepEqual(applyTick(c, 13, 100), { time: 100, open: 10, high: 13, low: 9, close: 13 });
  assert.deepEqual(applyTick(c, 8, 100), { time: 100, open: 10, high: 12, low: 8, close: 8 });
  assert.deepEqual(applyTick(c, 14, 160), { time: 160, open: 14, high: 14, low: 14, close: 14 });
  assert.equal(applyTick(c, 14, 40), null);
});

test('price alerts fire when the price crosses the target in the registered direction', () => {
  assert.equal(alertDirection(120_000_000, 115_000_000), 'above');
  assert.equal(alertDirection(110_000_000, 115_000_000), 'below');
  const above = { id: 'a', target: 120_000_000, direction: 'above' as const };
  const below = { id: 'b', target: 110_000_000, direction: 'below' as const };
  assert.equal(isAlertTriggered(above, 119_999_000), false);
  assert.equal(isAlertTriggered(above, 120_000_000), true);
  assert.equal(isAlertTriggered(below, 110_500_000), false);
  assert.equal(isAlertTriggered(below, 109_000_000), true);
  assert.equal(isAlertTriggered(below, 0), false); // 시세 수신 전
});

test('threshold alerts work with negative values such as kimchi premium', () => {
  const below = { id: 'k', target: -0.5, direction: 'below' as const };
  const above = { id: 'k2', target: 3, direction: 'above' as const };
  assert.equal(isThresholdCrossed(below, -0.4), false);
  assert.equal(isThresholdCrossed(below, -0.5), true);
  assert.equal(isThresholdCrossed(above, 3.2), true);
  assert.equal(isThresholdCrossed(above, null), false); // 시세 수신 전
});

test('topMovers picks gainers and losers without mutating the input', () => {
  const list = [{ s: 'A', changePct: 5 }, { s: 'B', changePct: -3 }, { s: 'C', changePct: 12 }, { s: 'D', changePct: -8 }, { s: 'E', changePct: 0 }];
  const { gainers, losers } = topMovers(list, 2);
  assert.deepEqual(gainers.map((t) => t.s), ['C', 'A']);
  assert.deepEqual(losers.map((t) => t.s), ['D', 'B']);
  assert.equal(list[0].s, 'A');
  // 오른 코인이 n개보다 적으면 0%나 하락 코인을 상승 목록에 넣지 않는다
  assert.deepEqual(topMovers(list, 4).gainers.map((t) => t.s), ['C', 'A']);
});

test('formatDurationKo', () => {
  assert.equal(formatDurationKo((13 * 24 + 9) * 3600_000 + 59_000), '13일 9시간');
  assert.equal(formatDurationKo(5 * 3600_000 + 20 * 60_000), '5시간 20분');
  assert.equal(formatDurationKo(12 * 60_000), '12분');
  assert.equal(formatDurationKo(-1), '0분');
});

test('price buckets keep low/high per bucket and drop old ones', () => {
  const b: PriceBucket[] = [];
  pushPriceBucket(b, 100, 0, 10_000, 60_000);
  pushPriceBucket(b, 90, 5_000, 10_000, 60_000);
  pushPriceBucket(b, 110, 15_000, 10_000, 60_000);
  assert.deepEqual(b, [{ t: 0, lo: 90, hi: 100 }, { t: 10_000, lo: 110, hi: 110 }]);
  pushPriceBucket(b, 120, 75_000, 10_000, 60_000);
  assert.deepEqual(b.map((x) => x.t), [70_000]);
  pushPriceBucket(b, 0, 80_000, 10_000, 60_000); // 잘못된 가격은 무시
  assert.equal(b.length, 1);
});

test('detectSurge compares the price with the window low/high', () => {
  const b: PriceBucket[] = [{ t: 0, lo: 100, hi: 101 }, { t: 10_000, lo: 101, hi: 102 }];
  assert.equal(detectSurge(b, 102, 3), null);
  const up = detectSurge(b, 104, 3)!;
  assert.equal(up.direction, 'up');
  assert.equal(up.from, 100);
  assert.ok(Math.abs(up.pct - 4) < 1e-9);
  const down = detectSurge(b, 98, 3)!;
  assert.equal(down.direction, 'down');
  assert.equal(down.from, 102);
  assert.equal(detectSurge([], 100, 3), null);
});

test('topByValue keeps the n largest above the floor in original order', () => {
  const list = [{ t: 1, v: 5 }, { t: 2, v: 50 }, { t: 3, v: 20 }, { t: 4, v: 30 }];
  assert.deepEqual(topByValue(list, (x) => x.v, 2, 10).map((x) => x.t), [2, 4]);
  assert.deepEqual(topByValue(list, (x) => x.v, 10, 25).map((x) => x.t), [2, 4]);
});

test('coinKimchiPremium hides absurd gaps (same ticker, different coin)', () => {
  assert.equal(coinKimchiPremium(1400, 1, 1400), 0);
  assert.equal(coinKimchiPremium(14000, 1, 1400), null);
});

test('formatUsdPrice keeps small coin prices readable', () => {
  assert.equal(formatUsdPrice(84746), '$84,746.00');
  assert.equal(formatUsdPrice(0.5123), '$0.5123');
  assert.equal(formatUsdPrice(0.00001234), '$0.00001234');
});

test('sound tiers grow with liquidation size and trade ratio', () => {
  assert.equal(liquidationSoundTier(50_000), 1);
  assert.equal(liquidationSoundTier(100_000), 2);
  assert.equal(liquidationSoundTier(700_000), 3);
  assert.equal(liquidationSoundTier(2_000_000), 4);
  assert.equal(tradeSoundTier(1_000_000, 1_000_000), 1);
  assert.equal(tradeSoundTier(3_000_000, 1_000_000), 2);
  assert.equal(tradeSoundTier(10_000_000, 1_000_000), 3);
  assert.equal(tradeSoundTier(50_000_000, 1_000_000), 4);
});
