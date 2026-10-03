/**
 * Korean market panel: Upbit KRW price (WebSocket), kimchi premium, Fear & Greed index
 */

import { prices, subscribePrices, updatePrices } from './priceStore.ts';
import type { Prices } from './priceStore.ts';
import { kimchiPremium, formatKrw, formatSignedPct, fearGreedLabelKo } from './market.ts';
import { COINS } from './coins.ts';
import { getUpbit } from './historyApi.ts';

// BTC/USDT는 상단 바, 나머지는 코인 시세 표와 차트가 함께 쓴다 (업비트 연결 하나로 공유)
const UPBIT_CODES = Array.from(new Set(['KRW-BTC', 'KRW-USDT', ...COINS.map((c) => `KRW-${c.symbol}`)]));
const UPBIT_REST = `https://api.upbit.com/v1/ticker?markets=${UPBIT_CODES.join(',')}`;
const UPBIT_WS = 'wss://api.upbit.com/websocket/v1';
const FEAR_GREED_API = 'https://api.alternative.me/fng/';
const FEAR_GREED_REFRESH_MS = 60 * 60 * 1000;

export interface UpbitTicker {
  market?: string; // REST
  code?: string;   // WebSocket
  trade_price: number;
  signed_change_rate: number;
  high_price: number;
  low_price: number;
  acc_trade_price_24h: number;
  trade_timestamp: number; // ms
}

type TickerListener = (market: string, t: UpbitTicker) => void;
const tickerListeners: TickerListener[] = [];

/** 업비트 원화 마켓 시세 수신 (UPBIT_CODES 전체) */
export function onUpbitTicker(fn: TickerListener) {
  tickerListeners.push(fn);
}

function applyUpbitTicker(t: UpbitTicker) {
  const market = t.market || t.code;
  if (!market) return;
  for (const fn of tickerListeners) fn(market, t);
  if (market === 'KRW-BTC') {
    updatePrices({
      krwBtc: t.trade_price,
      krwChangePct: t.signed_change_rate * 100,
      krwHigh: t.high_price,
      krwLow: t.low_price
    });
  } else if (market === 'KRW-USDT') {
    updatePrices({ krwUsdt: t.trade_price });
  }
}

async function fetchUpbitOnce() {
  // 서버 중계는 원화 마켓 전체를 주므로 필요한 것만 쓴다
  const wanted = new Set(UPBIT_CODES);
  const list = await getUpbit<UpbitTicker[]>('/upbit/tickers', UPBIT_REST);
  list?.filter((t) => t.market && wanted.has(t.market)).forEach(applyUpbitTicker);
}

function connectUpbitWebSocket() {
  const ws = new WebSocket(UPBIT_WS);
  ws.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();

  ws.onopen = () => {
    ws.send(JSON.stringify([{ ticket: 'wallet-track' }, { type: 'ticker', codes: UPBIT_CODES }]));
  };
  ws.onmessage = (event) => {
    try {
      const text = typeof event.data === 'string' ? event.data : decoder.decode(event.data);
      applyUpbitTicker(JSON.parse(text));
    } catch (e) {
      console.error('Upbit WS Parse Error:', e);
    }
  };
  ws.onclose = () => {
    console.warn('Upbit WS Closed, reconnecting in 2 seconds...');
    setTimeout(connectUpbitWebSocket, 2000);
  };
}

async function refreshFearGreed() {
  const elem = document.getElementById('fear-greed');
  if (!elem) return;
  try {
    const res = await fetch(FEAR_GREED_API);
    if (!res.ok) return;
    const data = await res.json();
    const entry = data?.data?.[0];
    const value = parseInt(entry?.value, 10);
    if (isNaN(value)) return;
    elem.textContent = `${value} ${fearGreedLabelKo(entry.value_classification)}`;
    elem.className = `stat-value ${value >= 55 ? 'up' : value <= 45 ? 'down' : ''}`;
  } catch (e) {
    console.warn('Fear & Greed fetch failed:', e);
  }
}

function setText(id: string, text: string, tone?: number | null) {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.textContent = text;
  if (tone !== undefined) {
    elem.classList.toggle('up', tone !== null && tone > 0);
    elem.classList.toggle('down', tone !== null && tone < 0);
  }
}

let lastKrwBtc = 0;

function flashPrice(elem: HTMLElement, newPrice: number) {
  if (lastKrwBtc > 0 && newPrice !== lastKrwBtc) {
    const cls = newPrice > lastKrwBtc ? 'price-up' : 'price-down';
    elem.classList.remove('price-up', 'price-down');
    elem.classList.add(cls);
    setTimeout(() => elem.classList.remove(cls), 600);
  }
  lastKrwBtc = newPrice;
}

function render(p: Prices) {
  const krwElem = document.getElementById('krw-btc-price');
  if (krwElem && p.krwBtc > 0) {
    if (p.krwBtc !== lastKrwBtc) flashPrice(krwElem, p.krwBtc);
    krwElem.textContent = formatKrw(p.krwBtc);
  }
  if (p.krwChangePct !== null) setText('krw-change', formatSignedPct(p.krwChangePct), p.krwChangePct);
  if (p.krwHigh > 0) setText('krw-high', formatKrw(p.krwHigh));
  if (p.krwLow > 0) setText('krw-low', formatKrw(p.krwLow));

  const premium = kimchiPremium(p.krwBtc, p.usdBtc, p.krwUsdt);
  if (premium !== null) setText('kimchi-premium', formatSignedPct(premium), premium);
}

export function initKrMarket() {
  subscribePrices(render);
  render(prices);
  fetchUpbitOnce();
  connectUpbitWebSocket();
  refreshFearGreed();
  setInterval(refreshFearGreed, FEAR_GREED_REFRESH_MS);
}
