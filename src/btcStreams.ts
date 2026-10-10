/**
 * 대형 체결·강제청산을 여러 거래소에서 받아 하나로 모은다 (브라우저가 거래소에 직접 연결, API 키 없음).
 * - 체결: 바이낸스 선물·현물 {코인}USDT, 바이비트 {코인}USDT, OKX {코인}-USDT-SWAP, 업비트 KRW-{코인}
 *   BTC는 항상 받고(사운드 알림·고래 알림도 쓴다), 대형 체결 탭에서 다른 코인을 고르면 그 코인 연결을 따로 연다(setExtraTradeCoin).
 *   큰 시장가 주문은 여러 체결로 쪼개져 오므로 거래소·코인별로 같은 방향 체결을 0.1초 동안 모아 주문 하나로 본다.
 * - 강제청산: 대형 코인 전부. 바이낸스(futuresPanel.ts의 전체 마켓 스트림), 바이비트, OKX
 * 메시지 해석은 exchangeFeeds.ts (테스트 있음).
 */

import {
  FEED_COINS, parseBinanceAggTrade, parseBybitLiquidations, parseBybitTrades, parseOkxLiquidations, parseOkxTrades, parseUpbitTrade,
  TradeMerger, usdtCoin
} from './exchangeFeeds.ts';
import type { FeedCoin, Fill, Liquidation, MergedTrade } from './exchangeFeeds.ts';
import { onLiveLiquidation } from './futuresPanel.ts';
import { onUpbitTrade, setUpbitTradeCoins } from './krMarket.ts';
import { trackOnce } from './analytics.ts';

const MERGE_MS = 100;
const RECONNECT_MS = 3000;
const BYBIT_PING_MS = 20_000; // 바이비트는 20초마다 ping이 없으면 연결을 끊는다
const OKX_PING_MS = 25_000;   // OKX는 30초 동안 아무것도 없으면 끊는다
const BYBIT_PING = { message: '{"op":"ping"}', ms: BYBIT_PING_MS };
const OKX_PING = { message: 'ping', ms: OKX_PING_MS };

const btcTradeListeners: ((t: MergedTrade) => void)[] = [];
const tradeListeners: ((t: MergedTrade) => void)[] = [];
const btcLiquidationListeners: ((l: Liquidation) => void)[] = [];
const liquidationListeners: ((l: Liquidation) => void)[] = [];

/** 모아진 BTC 체결 (주문 하나 단위, 크기 상관없이 전부) */
export function onBtcTrade(fn: (t: MergedTrade) => void) {
  btcTradeListeners.push(fn);
}

/** 모아진 체결: BTC + setExtraTradeCoin으로 고른 코인 */
export function onFeedTrade(fn: (t: MergedTrade) => void) {
  tradeListeners.push(fn);
}

/** BTC 강제청산 (바이낸스·바이비트·OKX) */
export function onBtcLiquidation(fn: (l: Liquidation) => void) {
  btcLiquidationListeners.push(fn);
}

/** 대형 코인 강제청산 (바이낸스·바이비트·OKX) */
export function onFeedLiquidation(fn: (l: Liquidation) => void) {
  liquidationListeners.push(fn);
}

const merger = new TradeMerger(MERGE_MS, (t) => {
  if (t.coin === 'BTC') btcTradeListeners.forEach((fn) => fn(t));
  tradeListeners.forEach((fn) => fn(t));
});

function addFill(fill: Fill | null) {
  if (fill) merger.add(fill, Date.now());
}

function emitLiquidation(l: Liquidation) {
  if (l.coin === 'BTC') btcLiquidationListeners.forEach((fn) => fn(l));
  liquidationListeners.forEach((fn) => fn(l));
}

/**
 * 끊기면 다시 연결하는 WebSocket. subscribe는 연결될 때마다 보낼 메시지, ping은 주기적으로 보낼 메시지.
 * 돌려주는 함수를 부르면 닫고 다시 연결하지 않는다.
 */
function connect(name: string, url: string, onMessage: (data: string) => void, subscribe?: unknown, ping?: { message: string; ms: number }): () => void {
  let closed = false;
  let ws: WebSocket;
  const open = () => {
    ws = new WebSocket(url);
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
      if (!closed) setTimeout(open, RECONNECT_MS);
    };
  };
  open();
  return () => {
    closed = true;
    ws.close();
  };
}

/** 한 코인의 체결 연결 (바이낸스 선물·현물, 바이비트, OKX). 업비트는 krMarket.ts의 시세 연결로 받는다 */
function connectTrades(coin: FeedCoin, withLiquidations = false): (() => void)[] {
  const lower = coin.toLowerCase();
  // 바이낸스 선물 시장 데이터 스트림은 /market 경로 (futuresPanel.ts 참고)
  const bybitArgs = [`publicTrade.${coin}USDT`, ...(withLiquidations ? FEED_COINS.map((c) => `allLiquidation.${c}USDT`) : [])];
  const okxArgs = [{ channel: 'trades', instId: `${coin}-USDT-SWAP` }, ...(withLiquidations ? [{ channel: 'liquidation-orders', instType: 'SWAP' }] : [])];
  return [
    connect('binance_futures_trade', `wss://fstream.binance.com/market/ws/${lower}usdt@aggTrade`,
      (data) => addFill(parseBinanceAggTrade(JSON.parse(data), 'binance-futures'))),
    connect('binance_spot_trade', `wss://stream.binance.com:9443/ws/${lower}usdt@aggTrade`,
      (data) => addFill(parseBinanceAggTrade(JSON.parse(data), 'binance-spot'))),
    connect('bybit', 'wss://stream.bybit.com/v5/public/linear', (data) => {
      const msg = JSON.parse(data);
      parseBybitTrades(msg).forEach(addFill);
      parseBybitLiquidations(msg).forEach(emitLiquidation);
    }, { op: 'subscribe', args: bybitArgs }, BYBIT_PING),
    connect('okx', 'wss://ws.okx.com:8443/ws/v5/public', (data) => {
      const msg = JSON.parse(data);
      parseOkxTrades(msg).forEach(addFill);
      parseOkxLiquidations(msg).forEach(emitLiquidation);
    }, { op: 'subscribe', args: okxArgs }, OKX_PING)
  ];
}

let extraCoin: FeedCoin | null = null;
let closeExtra: (() => void)[] = [];

/** BTC 말고 체결을 더 받을 코인 (대형 체결 탭에서 고른 코인). null이나 'BTC'면 BTC만 */
export function setExtraTradeCoin(coin: FeedCoin | null) {
  const next = coin === 'BTC' ? null : coin;
  if (next === extraCoin) return;
  closeExtra.forEach((close) => close());
  extraCoin = next;
  closeExtra = next ? connectTrades(next) : [];
  setUpbitTradeCoins(next ? ['BTC', next] : ['BTC']);
}

export function initBtcStreams() {
  connectTrades('BTC', true); // BTC 연결이 대형 코인 청산(바이비트·OKX)도 받는다

  onUpbitTrade((msg) => addFill(parseUpbitTrade(msg)));
  onLiveLiquidation((position, usd, symbol) => {
    const coin = usdtCoin(symbol);
    if (coin) emitLiquidation({ exchange: 'binance-futures', coin, position, usd, ts: Date.now() });
  });

  // 조용해진 묶음을 내보낸다
  setInterval(() => merger.flushIdle(Date.now()), MERGE_MS);
}
