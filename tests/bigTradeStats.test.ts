import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MinuteSums, parseBinanceAggTradeCsv, parseBybitCsv, parseUpbitTick } from '../src/bigTradeStats.ts';
import { TradeMerger } from '../src/exchangeFeeds.ts';
import type { FeedCoin, MergedTrade } from '../src/exchangeFeeds.ts';

test('바이낸스 aggTrades CSV: 선물(ms, 머리글)과 현물(µs, True/False)', () => {
  assert.equal(parseBinanceAggTradeCsv('agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker', 'binance-futures', 'BTC'), null);
  assert.deepEqual(parseBinanceAggTradeCsv('3474393766,84710.5,1.5,8143941190,8143941190,1791072000005,true', 'binance-futures', 'BTC'),
    { exchange: 'binance-futures', coin: 'BTC', side: 'sell', qty: 1.5, ts: 1791072000005 });
  assert.deepEqual(parseBinanceAggTradeCsv('4080241628,84753.57,2.0,6734009177,6734009177,1791072000259957,False,True', 'binance-spot', 'BTC'),
    { exchange: 'binance-spot', coin: 'BTC', side: 'buy', qty: 2, ts: 1791072000259 });
});

test('바이비트 CSV: 초 단위 소수 시각, Buy/Sell', () => {
  assert.equal(parseBybitCsv('timestamp,symbol,side,size,price,tickDirection,trdMatchID,grossValue,homeNotional,foreignNotional,RPI', 'BTC'), null);
  assert.deepEqual(parseBybitCsv('1791072000.8251,BTCUSDT,Sell,1.2,84716.50,ZeroMinusTick,id,1,1.2,1,0', 'BTC'),
    { exchange: 'bybit', coin: 'BTC', side: 'sell', qty: 1.2, ts: 1791072000825 });
  assert.equal(parseBybitCsv('1791072000.8251,BTCUSDT,Sell,1.2,84716.50,ZeroMinusTick,id,1,1.2,1,0', 'ETH'), null); // 다른 코인 파일 줄
});

test('업비트 체결 조회: BID = 매수', () => {
  assert.deepEqual(parseUpbitTick({ timestamp: 1000, trade_volume: 1.1, ask_bid: 'BID' }, 'BTC'), { exchange: 'upbit', coin: 'BTC', side: 'buy', qty: 1.1, ts: 1000 });
  assert.equal(parseUpbitTick({ timestamp: 1000, trade_volume: 0, ask_bid: 'ASK' }, 'BTC'), null);
});

test('MinuteSums: 코인별 최소 수량 이상만 거래소·코인·분별로 더하고, 끝난 분만 꺼낸다', () => {
  const sums = new MinuteSums();
  const t = (qty: number, side: 'buy' | 'sell', ts: number, coin: FeedCoin = 'BTC'): MergedTrade => ({ exchange: 'okx', coin, side, qty, ts });
  sums.add(t(2, 'buy', 60_000));
  sums.add(t(3, 'sell', 90_000));
  sums.add(t(0.5, 'buy', 100_000)); // 1 BTC 미만은 버린다
  sums.add(t(1, 'buy', 125_000));
  sums.add(t(29, 'buy', 70_000, 'ETH'));  // ETH는 30개부터
  sums.add(t(30, 'sell', 70_000, 'ETH'));
  assert.deepEqual(sums.take(120_000), [
    { minute: 60_000, exchange: 'okx', coin: 'BTC', buyQty: 2, sellQty: 3, buyCount: 1, sellCount: 1 },
    { minute: 60_000, exchange: 'okx', coin: 'ETH', buyQty: 0, sellQty: 30, buyCount: 0, sellCount: 1 }
  ]);
  assert.deepEqual(sums.take(), [{ minute: 120_000, exchange: 'okx', coin: 'BTC', buyQty: 1, sellQty: 0, buyCount: 1, sellCount: 0 }]);
  assert.deepEqual(sums.take(), []);
});

test('과거 파일도 실시간처럼 0.1초 안의 같은 방향 체결을 주문 하나로 묶는다', () => {
  const sums = new MinuteSums();
  const merger = new TradeMerger(100, (m) => sums.add(m));
  for (const [qty, ts] of [[0.6, 1000], [0.6, 1050], [0.6, 5000]] as const) {
    merger.add({ exchange: 'bybit', coin: 'BTC', side: 'buy', qty, ts }, ts);
    merger.flushIdle(ts);
  }
  merger.flushIdle(Infinity);
  const [row] = sums.take();
  assert.equal(row.buyCount, 1); // 1.2 BTC 하나, 0.6 BTC는 버림
  assert.ok(Math.abs(row.buyQty - 1.2) < 1e-9);
});
