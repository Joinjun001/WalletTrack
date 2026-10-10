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
  assert.deepEqual(parseBinanceAggTrade(msg, 'binance-futures'), { exchange: 'binance-futures', coin: 'BTC', side: 'sell', qty: 0.011, ts: 1791103477156 });
  assert.equal(parseBinanceAggTrade({ ...msg, m: false }, 'binance-spot')?.side, 'buy');
  assert.equal(parseBinanceAggTrade({ ...msg, s: 'PEPEUSDT' }, 'binance-spot'), null);
  // 묶음 스트림(/stream?streams=)은 data 안에 온다
  assert.equal(parseBinanceAggTrade({ stream: 'ethusdt@aggTrade', data: { ...msg, s: 'ETHUSDT', q: '20' } }, 'binance-futures')?.coin, 'ETH');
});

test('bybit publicTrade uses taker side and size in BTC', () => {
  const msg = { topic: 'publicTrade.BTCUSDT', data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '0.002', p: '85048.80' }, { T: 2, S: 'Sell', v: '1.5', p: '85000' }] };
  assert.deepEqual(parseBybitTrades(msg), [
    { exchange: 'bybit', coin: 'BTC', side: 'buy', qty: 0.002, ts: 1 },
    { exchange: 'bybit', coin: 'BTC', side: 'sell', qty: 1.5, ts: 2 }
  ]);
  assert.deepEqual(parseBybitTrades({ success: true, op: 'subscribe' }), []);
  assert.equal(parseBybitTrades({ topic: 'publicTrade.XRPUSDT', data: [{ T: 3, S: 'Buy', v: '70000' }] })[0].coin, 'XRP');
  assert.deepEqual(parseBybitTrades({ topic: 'publicTrade.PEPEUSDT', data: [{ T: 3, S: 'Buy', v: '1' }] }), []);
});

test('okx trades convert contracts to BTC (1 contract = 0.01 BTC)', () => {
  const msg = { arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' }, data: [{ instId: 'BTC-USDT-SWAP', px: '85034.3', sz: '250', side: 'sell', ts: '1791103475331' }] };
  const [fill] = parseOkxTrades(msg);
  assert.equal(fill.side, 'sell');
  assert.ok(Math.abs(fill.qty - 2.5) < 1e-9);
  assert.equal(fill.ts, 1791103475331);
  // 계약 크기는 코인마다 다르다 (DOGE 1000개, 코인 마진은 체결로 보지 않는다)
  const doge = parseOkxTrades({ arg: { channel: 'trades' }, data: [{ instId: 'DOGE-USDT-SWAP', sz: '3', side: 'buy', ts: '1' }, { instId: 'DOGE-USD-SWAP', sz: '3', side: 'buy', ts: '1' }] });
  assert.deepEqual(doge, [{ exchange: 'okx', coin: 'DOGE', side: 'buy', qty: 3000, ts: 1 }]);
});

test('upbit trade: BID is a buy, ASK is a sell', () => {
  const msg = { type: 'trade', code: 'KRW-BTC', trade_timestamp: 1791103475125, trade_price: 115700000, trade_volume: 0.0502, ask_bid: 'ASK' };
  assert.deepEqual(parseUpbitTrade(msg), { exchange: 'upbit', coin: 'BTC', side: 'sell', qty: 0.0502, ts: 1791103475125 });
  assert.equal(parseUpbitTrade({ ...msg, ask_bid: 'BID' })?.side, 'buy');
  assert.equal(parseUpbitTrade({ ...msg, code: 'KRW-ETH' })?.coin, 'ETH');
  assert.equal(parseUpbitTrade({ ...msg, code: 'KRW-PEPE' }), null);
  assert.equal(parseUpbitTrade({ ...msg, code: 'BTC-ETH' }), null);
  assert.equal(parseUpbitTrade({ type: 'ticker', code: 'KRW-BTC' }), null);
});

test('bybit allLiquidation: Buy means a long was liquidated', () => {
  const msg = { topic: 'allLiquidation.BTCUSDT', data: [{ T: 5, s: 'BTCUSDT', S: 'Buy', v: '2', p: '85000' }, { T: 6, S: 'Sell', v: '1', p: '86000' }] };
  assert.deepEqual(parseBybitLiquidations(msg), [
    { exchange: 'bybit', coin: 'BTC', position: 'long', usd: 170000, ts: 5 },
    { exchange: 'bybit', coin: 'BTC', position: 'short', usd: 86000, ts: 6 }
  ]);
  assert.equal(parseBybitLiquidations({ topic: 'allLiquidation.SOLUSDT', data: [{ T: 7, S: 'Sell', v: '10', p: '100' }] })[0].coin, 'SOL');
});

test('okx liquidation-orders keeps feed coins only (USDT and coin-margined)', () => {
  const msg = {
    arg: { channel: 'liquidation-orders', instType: 'SWAP' },
    data: [
      { instId: 'GALA-USDT-SWAP', details: [{ side: 'sell', sz: '3865', bkPx: '0.0026', ts: '1' }] },
      { instId: 'BTC-USDT-SWAP', details: [{ side: 'sell', posSide: 'long', sz: '100', bkPx: '85000', ts: '2' }] },
      { instId: 'BTC-USD-SWAP', details: [{ side: 'buy', posSide: 'short', sz: '30', bkPx: '86000', ts: '3' }] },
      { instId: 'ETH-USDT-SWAP', details: [{ side: 'sell', sz: '10', bkPx: '2500', ts: '4' }] },
      { instId: 'ETH-USD-SWAP', details: [{ side: 'buy', sz: '5', bkPx: '2500', ts: '5' }] }
    ]
  };
  assert.deepEqual(parseOkxLiquidations(msg), [
    { exchange: 'okx', coin: 'BTC', position: 'long', usd: 85000, ts: 2 },
    { exchange: 'okx', coin: 'BTC', position: 'short', usd: 3000, ts: 3 },
    { exchange: 'okx', coin: 'ETH', position: 'long', usd: 2500, ts: 4 },  // 10계약 × 0.1 ETH × $2,500
    { exchange: 'okx', coin: 'ETH', position: 'short', usd: 50, ts: 5 }     // 코인 마진 5계약 × $10
  ]);
});

test('TradeMerger joins same-side fills within the window per exchange and coin', () => {
  const out: MergedTrade[] = [];
  const m = new TradeMerger(100, (t) => out.push(t));
  m.add({ exchange: 'bybit', coin: 'BTC', side: 'buy', qty: 1, ts: 1000 }, 0);
  m.add({ exchange: 'bybit', coin: 'BTC', side: 'buy', qty: 2, ts: 1050 }, 10);
  m.add({ exchange: 'okx', coin: 'BTC', side: 'buy', qty: 5, ts: 1060 }, 10);      // 다른 거래소는 따로
  m.add({ exchange: 'bybit', coin: 'ETH', side: 'buy', qty: 7, ts: 1065 }, 10);    // 같은 거래소라도 코인이 다르면 따로
  m.add({ exchange: 'bybit', coin: 'BTC', side: 'sell', qty: 4, ts: 1070 }, 20);   // 방향이 바뀌면 앞 묶음을 내보낸다
  assert.deepEqual(out, [{ exchange: 'bybit', coin: 'BTC', side: 'buy', qty: 3, ts: 1000 }]);
  m.add({ exchange: 'bybit', coin: 'BTC', side: 'sell', qty: 1, ts: 1300 }, 30);   // 창을 넘으면 새 묶음
  assert.deepEqual(out[1], { exchange: 'bybit', coin: 'BTC', side: 'sell', qty: 4, ts: 1070 });
  m.flushIdle(200);
  assert.deepEqual(out.slice(2).map((t) => [t.exchange, t.coin, t.qty]), [['okx', 'BTC', 5], ['bybit', 'ETH', 7], ['bybit', 'BTC', 1]]);
});
