import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MinuteSums, parseBinanceAggTradeCsv, parseBybitCsv, parseUpbitTick } from '../src/bigTradeStats.ts';
import { TradeMerger } from '../src/exchangeFeeds.ts';
import type { MergedTrade } from '../src/exchangeFeeds.ts';

test('바이낸스 aggTrades CSV: 선물(ms, 머리글)과 현물(µs, True/False)', () => {
  assert.equal(parseBinanceAggTradeCsv('agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker', 'binance-futures'), null);
  assert.deepEqual(parseBinanceAggTradeCsv('3474393766,84710.5,1.5,8143941190,8143941190,1791072000005,true', 'binance-futures'),
    { exchange: 'binance-futures', side: 'sell', btc: 1.5, ts: 1791072000005 });
  assert.deepEqual(parseBinanceAggTradeCsv('4080241628,84753.57,2.0,6734009177,6734009177,1791072000259957,False,True', 'binance-spot'),
    { exchange: 'binance-spot', side: 'buy', btc: 2, ts: 1791072000259 });
});

test('바이비트 CSV: 초 단위 소수 시각, Buy/Sell', () => {
  assert.equal(parseBybitCsv('timestamp,symbol,side,size,price,tickDirection,trdMatchID,grossValue,homeNotional,foreignNotional,RPI'), null);
  assert.deepEqual(parseBybitCsv('1791072000.8251,BTCUSDT,Sell,1.2,84716.50,ZeroMinusTick,id,1,1.2,1,0'),
    { exchange: 'bybit', side: 'sell', btc: 1.2, ts: 1791072000825 });
});

test('업비트 체결 조회: BID = 매수', () => {
  assert.deepEqual(parseUpbitTick({ timestamp: 1000, trade_volume: 1.1, ask_bid: 'BID' }), { exchange: 'upbit', side: 'buy', btc: 1.1, ts: 1000 });
  assert.equal(parseUpbitTick({ timestamp: 1000, trade_volume: 0, ask_bid: 'ASK' }), null);
});

test('MinuteSums: 1 BTC 이상만 거래소·분별로 더하고, 끝난 분만 꺼낸다', () => {
  const sums = new MinuteSums();
  const t = (btc: number, side: 'buy' | 'sell', ts: number): MergedTrade => ({ exchange: 'okx', side, btc, ts });
  sums.add(t(2, 'buy', 60_000));
  sums.add(t(3, 'sell', 90_000));
  sums.add(t(0.5, 'buy', 100_000)); // 1 BTC 미만은 버린다
  sums.add(t(1, 'buy', 125_000));
  assert.deepEqual(sums.take(120_000), [{ minute: 60_000, exchange: 'okx', buyBtc: 2, sellBtc: 3, buyCount: 1, sellCount: 1 }]);
  assert.deepEqual(sums.take(), [{ minute: 120_000, exchange: 'okx', buyBtc: 1, sellBtc: 0, buyCount: 1, sellCount: 0 }]);
  assert.deepEqual(sums.take(), []);
});

test('과거 파일도 실시간처럼 0.1초 안의 같은 방향 체결을 주문 하나로 묶는다', () => {
  const sums = new MinuteSums();
  const merger = new TradeMerger(100, (m) => sums.add(m));
  for (const [btc, ts] of [[0.6, 1000], [0.6, 1050], [0.6, 5000]] as const) {
    merger.add({ exchange: 'bybit', side: 'buy', btc, ts }, ts);
    merger.flushIdle(ts);
  }
  merger.flushIdle(Infinity);
  const [row] = sums.take();
  assert.equal(row.buyCount, 1); // 1.2 BTC 하나, 0.6 BTC는 버림
  assert.ok(Math.abs(row.buyBtc - 1.2) < 1e-9);
});
