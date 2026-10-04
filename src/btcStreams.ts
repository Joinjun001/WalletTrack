/**
 * 비트코인 대형 체결·강제청산을 여러 거래소에서 받아 하나로 모은다 (브라우저가 거래소에 직접 연결, API 키 없음).
 * - 체결: 바이낸스 선물·현물 BTCUSDT, 바이비트 BTCUSDT, OKX BTC-USDT-SWAP, 업비트 KRW-BTC
 *   큰 시장가 주문은 여러 체결로 쪼개져 오므로 거래소별로 같은 방향 체결을 0.1초 동안 모아 주문 하나로 본다.
 * - 강제청산: 바이낸스(futuresPanel.ts의 전체 마켓 스트림에서 BTCUSDT만), 바이비트, OKX
 * 메시지 해석은 exchangeFeeds.ts (테스트 있음).
 */

import {
  parseBinanceAggTrade, parseBybitLiquidations, parseBybitTrades, parseOkxLiquidations, parseOkxTrades, parseUpbitTrade, TradeMerger
} from './exchangeFeeds.ts';
import type { BtcLiquidation, Fill, MergedTrade } from './exchangeFeeds.ts';
import { onLiveLiquidation } from './futuresPanel.ts';
import { onUpbitBtcTrade } from './krMarket.ts';
import { trackOnce } from './analytics.ts';

const MERGE_MS = 100;
const RECONNECT_MS = 3000;
const BYBIT_PING_MS = 20_000; // 바이비트는 20초마다 ping이 없으면 연결을 끊는다
const OKX_PING_MS = 25_000;   // OKX는 30초 동안 아무것도 없으면 끊는다

const tradeListeners: ((t: MergedTrade) => void)[] = [];
const liquidationListeners: ((l: BtcLiquidation) => void)[] = [];

/** 모아진 체결 (주문 하나 단위, 크기 상관없이 전부) */
export function onBtcTrade(fn: (t: MergedTrade) => void) {
  tradeListeners.push(fn);
}

/** BTC 강제청산 (바이낸스·바이비트·OKX) */
export function onBtcLiquidation(fn: (l: BtcLiquidation) => void) {
  liquidationListeners.push(fn);
}

const merger = new TradeMerger(MERGE_MS, (t) => tradeListeners.forEach((fn) => fn(t)));

function addFill(fill: Fill | null) {
  if (fill) merger.add(fill, Date.now());
}

function emitLiquidation(l: BtcLiquidation) {
  liquidationListeners.forEach((fn) => fn(l));
}

/**
 * 끊기면 다시 연결하는 WebSocket. subscribe는 연결될 때마다 보낼 메시지, ping은 주기적으로 보낼 메시지.
 */
function connect(name: string, url: string, onMessage: (data: string) => void, subscribe?: unknown, ping?: { message: string; ms: number }) {
  const ws = new WebSocket(url);
  let timer = 0;
  ws.onopen = () => {
    if (subscribe) ws.send(JSON.stringify(subscribe));
    if (ping) timer = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(ping.message), ping.ms);
  };
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string' || event.data === 'pong') return;
    try {
      onMessage(event.data);
    } catch (e) {
      console.error(`${name} WS Parse Error:`, e);
    }
  };
  ws.onerror = () => trackOnce('api_fail', `${name}_ws`, { source: `${name}_ws`, status: 0 });
  ws.onclose = () => {
    clearInterval(timer);
    setTimeout(() => connect(name, url, onMessage, subscribe, ping), RECONNECT_MS);
  };
}

export function initBtcStreams() {
  // 바이낸스 선물 시장 데이터 스트림은 /market 경로 (futuresPanel.ts 참고)
  connect('binance_futures_trade', 'wss://fstream.binance.com/market/ws/btcusdt@aggTrade',
    (data) => addFill(parseBinanceAggTrade(JSON.parse(data), 'binance-futures')));
  connect('binance_spot_trade', 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade',
    (data) => addFill(parseBinanceAggTrade(JSON.parse(data), 'binance-spot')));
  connect('bybit', 'wss://stream.bybit.com/v5/public/linear', (data) => {
    const msg = JSON.parse(data);
    parseBybitTrades(msg).forEach(addFill);
    parseBybitLiquidations(msg).forEach(emitLiquidation);
  }, { op: 'subscribe', args: ['publicTrade.BTCUSDT', 'allLiquidation.BTCUSDT'] }, { message: '{"op":"ping"}', ms: BYBIT_PING_MS });
  connect('okx', 'wss://ws.okx.com:8443/ws/v5/public', (data) => {
    const msg = JSON.parse(data);
    parseOkxTrades(msg).forEach(addFill);
    parseOkxLiquidations(msg).forEach(emitLiquidation);
  }, { op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT-SWAP' }, { channel: 'liquidation-orders', instType: 'SWAP' }] }, { message: 'ping', ms: OKX_PING_MS });

  onUpbitBtcTrade((msg) => addFill(parseUpbitTrade(msg)));
  onLiveLiquidation((position, usd, symbol) => {
    if (symbol === 'BTCUSDT') emitLiquidation({ exchange: 'binance-futures', position, usd, ts: Date.now() });
  });

  // 조용해진 묶음을 내보낸다
  setInterval(() => merger.flushIdle(Date.now()), MERGE_MS);
}
