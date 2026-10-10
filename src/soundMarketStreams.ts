/**
 * 사운드 알림 전용 다중 코인 실시간 스트림.
 *
 * BTC는 기존 btcStreams.ts가 여러 거래소(바이낸스·바이비트·OKX·업비트)를 이미 합치므로 여기서 중복 수집하지 않는다.
 * BTC 외 관심 코인은 바이낸스(선물·현물)와 바이비트 체결을 받고,
 * 강제청산은 futuresPanel.ts의 바이낸스 전체 청산 스트림 + 바이비트에서 받는다.
 * 브라우저가 거래소 WebSocket에 직접 연결하며 API 키는 사용하지 않는다.
 */

import { onLiveLiquidation } from './futuresPanel.ts';
import { trackOnce } from './analytics.ts';

const MERGE_MS = 100;
const RECONNECT_MS = 3000;
const BYBIT_PING_MS = 20_000;
const MAX_SYMBOLS = 5;

type Side = 'buy' | 'sell';
type Position = 'long' | 'short';
type Exchange = 'binance-futures' | 'binance-spot' | 'bybit';

export interface SoundTradeEvent {
  symbol: string;
  exchange: Exchange;
  side: Side;
  usd: number;
  ts: number;
}

export interface SoundLiquidationEvent {
  symbol: string;
  exchange: 'binance-futures' | 'bybit';
  position: Position;
  usd: number;
  ts: number;
}

export interface SoundStreamConfig {
  symbols: string[];
  trades: boolean;
  liquidations: boolean;
}

const tradeListeners: ((event: SoundTradeEvent) => void)[] = [];
const liquidationListeners: ((event: SoundLiquidationEvent) => void)[] = [];

export function onSoundMarketTrade(fn: (event: SoundTradeEvent) => void) {
  tradeListeners.push(fn);
}

export function onSoundMarketLiquidation(fn: (event: SoundLiquidationEvent) => void) {
  liquidationListeners.push(fn);
}

type PendingTrade = SoundTradeEvent & { touchedAt: number };
const pendingTrades = new Map<string, PendingTrade>();

function tradeKey(event: Pick<SoundTradeEvent, 'exchange' | 'symbol'>): string {
  return `${event.exchange}|${event.symbol}`;
}

function flushTrade(key: string) {
  const pending = pendingTrades.get(key);
  if (!pending) return;
  pendingTrades.delete(key);
  const event: SoundTradeEvent = {
    symbol: pending.symbol,
    exchange: pending.exchange,
    side: pending.side,
    usd: pending.usd,
    ts: pending.ts
  };
  for (const fn of tradeListeners) fn(event);
}

function addTrade(event: SoundTradeEvent) {
  if (!(event.usd > 0)) return;
  const key = tradeKey(event);
  const now = Date.now();
  const pending = pendingTrades.get(key);
  if (pending && (pending.side !== event.side || event.ts - pending.ts > MERGE_MS)) flushTrade(key);
  const current = pendingTrades.get(key);
  if (current) {
    current.usd += event.usd;
    current.touchedAt = now;
  } else {
    pendingTrades.set(key, { ...event, touchedAt: now });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, pending] of pendingTrades) {
    if (now - pending.touchedAt >= MERGE_MS) flushTrade(key);
  }
}, MERGE_MS);

function emitLiquidation(event: SoundLiquidationEvent) {
  if (!(event.usd > 0)) return;
  for (const fn of liquidationListeners) fn(event);
}

let config: SoundStreamConfig = { symbols: ['BTC'], trades: true, liquidations: true };
let generation = 0;
let sockets: WebSocket[] = [];
let initialized = false;

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{2,10}$/.test(s)))].slice(0, MAX_SYMBOLS);
}

function closeSockets() {
  generation++;
  for (const ws of sockets) {
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch { /* 이미 닫힌 소켓 */ }
  }
  sockets = [];
  pendingTrades.clear();
}

function connect(
  name: string,
  url: string,
  onMessage: (data: string) => void,
  subscribe?: unknown,
  ping?: { message: string; ms: number }
) {
  const myGeneration = generation;
  const ws = new WebSocket(url);
  sockets.push(ws);
  let timer = 0;

  ws.onopen = () => {
    if (myGeneration !== generation) return;
    if (subscribe) ws.send(JSON.stringify(subscribe));
    if (ping) timer = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(ping.message), ping.ms);
  };
  ws.onmessage = (event) => {
    if (myGeneration !== generation || typeof event.data !== 'string' || event.data === 'pong') return;
    try {
      onMessage(event.data);
    } catch (e) {
      console.error(`${name} sound WS parse error:`, e);
    }
  };
  ws.onerror = () => trackOnce('api_fail', `${name}_sound_ws`, { source: `${name}_sound_ws`, status: 0 });
  ws.onclose = () => {
    clearInterval(timer);
    if (myGeneration !== generation) return;
    setTimeout(() => {
      if (myGeneration === generation) connect(name, url, onMessage, subscribe, ping);
    }, RECONNECT_MS);
  };
}

function reconnect() {
  closeSockets();
  const altSymbols = config.symbols.filter((symbol) => symbol !== 'BTC');
  if (altSymbols.length === 0) return;

  if (config.trades) {
    const streams = altSymbols.map((symbol) => `${symbol.toLowerCase()}usdt@aggTrade`).join('/');
    connect('binance_futures_multi', `wss://fstream.binance.com/stream?streams=${streams}`, (raw) => {
      const msg = JSON.parse(raw)?.data;
      const symbol = String(msg?.s || '').replace(/USDT$/, '');
      const price = Number(msg?.p);
      const quantity = Number(msg?.q);
      if (msg?.e !== 'aggTrade' || !altSymbols.includes(symbol) || !(price > 0) || !(quantity > 0)) return;
      addTrade({ exchange: 'binance-futures', symbol, side: msg.m ? 'sell' : 'buy', usd: price * quantity, ts: Number(msg.T) || Date.now() });
    });

    connect('binance_spot_multi', `wss://stream.binance.com:9443/stream?streams=${streams}`, (raw) => {
      const msg = JSON.parse(raw)?.data;
      const symbol = String(msg?.s || '').replace(/USDT$/, '');
      const price = Number(msg?.p);
      const quantity = Number(msg?.q);
      if (msg?.e !== 'aggTrade' || !altSymbols.includes(symbol) || !(price > 0) || !(quantity > 0)) return;
      addTrade({ exchange: 'binance-spot', symbol, side: msg.m ? 'sell' : 'buy', usd: price * quantity, ts: Number(msg.T) || Date.now() });
    });
  }

  if (config.trades || config.liquidations) {
    const args = altSymbols.flatMap((symbol) => [
      ...(config.trades ? [`publicTrade.${symbol}USDT`] : []),
      ...(config.liquidations ? [`allLiquidation.${symbol}USDT`] : [])
    ]);
    connect('bybit_multi', 'wss://stream.bybit.com/v5/public/linear', (raw) => {
      const msg = JSON.parse(raw);
      const topic = String(msg?.topic || '');
      const symbol = topic.replace(/^(publicTrade|allLiquidation)\./, '').replace(/USDT$/, '');
      if (!altSymbols.includes(symbol) || !Array.isArray(msg?.data)) return;

      if (config.trades && topic.startsWith('publicTrade.')) {
        for (const row of msg.data) {
          const price = Number(row?.p);
          const quantity = Number(row?.v);
          if (!(price > 0) || !(quantity > 0)) continue;
          addTrade({
            exchange: 'bybit', symbol,
            side: row?.S === 'Sell' ? 'sell' : 'buy',
            usd: price * quantity,
            ts: Number(row?.T) || Date.now()
          });
        }
      } else if (config.liquidations && topic.startsWith('allLiquidation.')) {
        for (const row of msg.data) {
          const price = Number(row?.p);
          const quantity = Number(row?.v);
          if (!(price > 0) || !(quantity > 0)) continue;
          emitLiquidation({
            exchange: 'bybit', symbol,
            position: row?.S === 'Buy' ? 'long' : 'short',
            usd: price * quantity,
            ts: Number(row?.T) || Date.now()
          });
        }
      }
    }, { op: 'subscribe', args }, { message: '{"op":"ping"}', ms: BYBIT_PING_MS });
  }
}

export function setSoundMarketStreamConfig(next: SoundStreamConfig) {
  const normalized: SoundStreamConfig = {
    symbols: normalizeSymbols(next.symbols),
    trades: !!next.trades,
    liquidations: !!next.liquidations
  };
  const same = normalized.trades === config.trades
    && normalized.liquidations === config.liquidations
    && normalized.symbols.join(',') === config.symbols.join(',');
  config = normalized;
  if (initialized && !same) reconnect();
}

/** 한 번만 초기화. 이후 선택 코인/알림 종류가 바뀌면 setSoundMarketStreamConfig가 소켓을 다시 구성한다. */
export function initSoundMarketStreams() {
  if (initialized) return;
  initialized = true;

  // 바이낸스 전체 강제청산 스트림은 futuresPanel.ts가 이미 연결하므로 중복 WebSocket을 만들지 않는다.
  onLiveLiquidation((position, usd, marketSymbol) => {
    if (!config.liquidations || !marketSymbol.endsWith('USDT')) return;
    const symbol = marketSymbol.replace(/USDT$/, '');
    if (symbol === 'BTC' || !config.symbols.includes(symbol)) return; // BTC는 기존 btcStreams에서 처리
    emitLiquidation({ exchange: 'binance-futures', symbol, position, usd, ts: Date.now() });
  });

  reconnect();
}
