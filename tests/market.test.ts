import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kimchiPremium, formatKrw, formatKrwShort, formatSignedPct, halvingInfo, fearGreedLabelKo, timeAgoKo } from '../src/market.ts';

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
