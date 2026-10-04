import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBinanceAggTrade, parseBybitTrades, parseOkxTrades, parseUpbitTrade,
  parseBybitLiquidations, parseOkxLiquidations, TradeMerger
} from '../src/exchangeFeeds.ts';
import type { MergedTrade } from '../src/exchangeFeeds.ts';

// 아래 메시지는 2026-10-04 실제 스트림에서 받은 모양 그대로다

test('binance aggTrade: m=true is a market sell', () => {
  const msg = { e: 'aggTrade', s: 'BTCUSDT', p: '85032.10', q: '0.011', T: 1791103477156, m: true };
  assert.deepEqual(parseBinanceAggTrade(msg, 'binance-futures'), { exchange: 'binance-futures', side: 'sell', btc: 0.011, ts: 1791103477156 });
  assert.equal(parseBinanceAggTrade({ ...msg, m: false }, 'binance-spot')?.side, 'buy');
  assert.equal(parseBinanceAggTrade({ ...msg, s: 'ETHUSDT' }, 'binance-spot'), null);
});

test('bybit publicTrade uses taker side and size in BTC', () => {
  const msg = { topic: 'publicTrade.BTCUSDT', data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '0.002', p: '85048.80' }, { T: 2, S: 'Sell', v: '1.5', p: '85000' }] };
  assert.deepEqual(parseBybitTrades(msg), [
    { exchange: 'bybit', side: 'buy', btc: 0.002, ts: 1 },
    { exchange: 'bybit', side: 'sell', btc: 1.5, ts: 2 }
  ]);
  assert.deepEqual(parseBybitTrades({ success: true, op: 'subscribe' }), []);
});

test('okx trades convert contracts to BTC (1 contract = 0.01 BTC)', () => {
  const msg = { arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' }, data: [{ instId: 'BTC-USDT-SWAP', px: '85034.3', sz: '250', side: 'sell', ts: '1791103475331' }] };
  const [fill] = parseOkxTrades(msg);
  assert.equal(fill.side, 'sell');
  assert.ok(Math.abs(fill.btc - 2.5) < 1e-9);
  assert.equal(fill.ts, 1791103475331);
});

test('upbit trade: BID is a buy, ASK is a sell', () => {
  const msg = { type: 'trade', code: 'KRW-BTC', trade_timestamp: 1791103475125, trade_price: 115700000, trade_volume: 0.0502, ask_bid: 'ASK' };
  assert.deepEqual(parseUpbitTrade(msg), { exchange: 'upbit', side: 'sell', btc: 0.0502, ts: 1791103475125 });
  assert.equal(parseUpbitTrade({ ...msg, ask_bid: 'BID' })?.side, 'buy');
  assert.equal(parseUpbitTrade({ ...msg, code: 'KRW-ETH' }), null);
  assert.equal(parseUpbitTrade({ type: 'ticker', code: 'KRW-BTC' }), null);
});

test('bybit allLiquidation: Buy means a long was liquidated', () => {
  const msg = { topic: 'allLiquidation.BTCUSDT', data: [{ T: 5, s: 'BTCUSDT', S: 'Buy', v: '2', p: '85000' }, { T: 6, S: 'Sell', v: '1', p: '86000' }] };
  assert.deepEqual(parseBybitLiquidations(msg), [
    { exchange: 'bybit', position: 'long', usd: 170000, ts: 5 },
    { exchange: 'bybit', position: 'short', usd: 86000, ts: 6 }
  ]);
});

test('okx liquidation-orders keeps BTC only (USDT and coin-margined)', () => {
  const msg = {
    arg: { channel: 'liquidation-orders', instType: 'SWAP' },
    data: [
      { instId: 'GALA-USDT-SWAP', details: [{ side: 'sell', sz: '3865', bkPx: '0.0026', ts: '1' }] },
      { instId: 'BTC-USDT-SWAP', details: [{ side: 'sell', posSide: 'long', sz: '100', bkPx: '85000', ts: '2' }] },
      { instId: 'BTC-USD-SWAP', details: [{ side: 'buy', posSide: 'short', sz: '30', bkPx: '86000', ts: '3' }] }
    ]
  };
  assert.deepEqual(parseOkxLiquidations(msg), [
    { exchange: 'okx', position: 'long', usd: 85000, ts: 2 },
    { exchange: 'okx', position: 'short', usd: 3000, ts: 3 }
  ]);
});

test('TradeMerger joins same-side fills within the window per exchange', () => {
  const out: MergedTrade[] = [];
  const m = new TradeMerger(100, (t) => out.push(t));
  m.add({ exchange: 'bybit', side: 'buy', btc: 1, ts: 1000 }, 0);
  m.add({ exchange: 'bybit', side: 'buy', btc: 2, ts: 1050 }, 10);
  m.add({ exchange: 'okx', side: 'buy', btc: 5, ts: 1060 }, 10);      // 다른 거래소는 따로
  m.add({ exchange: 'bybit', side: 'sell', btc: 4, ts: 1070 }, 20);    // 방향이 바뀌면 앞 묶음을 내보낸다
  assert.deepEqual(out, [{ exchange: 'bybit', side: 'buy', btc: 3, ts: 1000 }]);
  m.add({ exchange: 'bybit', side: 'sell', btc: 1, ts: 1300 }, 30);    // 창을 넘으면 새 묶음
  assert.deepEqual(out[1], { exchange: 'bybit', side: 'sell', btc: 4, ts: 1070 });
  m.flushIdle(200);
  assert.deepEqual(out.slice(2).map((t) => [t.exchange, t.btc]), [['okx', 5], ['bybit', 1]]);
});
