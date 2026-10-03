/**
 * Korean market panel: Upbit KRW price (WebSocket), kimchi premium, Fear & Greed index
 */

import { prices, subscribePrices, updatePrices } from './priceStore.ts';
import type { Prices } from './priceStore.ts';
import { kimchiPremium, formatKrw, formatSignedPct, fearGreedLabelKo } from './market.ts';

const UPBIT_REST = 'https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-USDT';
const UPBIT_WS = 'wss://api.upbit.com/websocket/v1';
const FEAR_GREED_API = 'https://api.alternative.me/fng/';
const FEAR_GREED_REFRESH_MS = 60 * 60 * 1000;

interface UpbitTicker {
  market?: string; // REST
  code?: string;   // WebSocket
  trade_price: number;
  signed_change_rate: number;
  high_price: number;
  low_price: number;
}

function applyUpbitTicker(t: UpbitTicker) {
  const market = t.market || t.code;
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
  try {
    const res = await fetch(UPBIT_REST);
    if (!res.ok) return;
    const list: UpbitTicker[] = await res.json();
    list.forEach(applyUpbitTicker);
  } catch (e) {
    console.warn('Upbit REST failed:', e);
  }
}

function connectUpbitWebSocket() {
  const ws = new WebSocket(UPBIT_WS);
  ws.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();

  ws.onopen = () => {
    ws.send(JSON.stringify([{ ticket: 'wallet-track' }, { type: 'ticker', codes: ['KRW-BTC', 'KRW-USDT'] }]));
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
    document.getElementById('price-live-badge')?.classList.remove('active');
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
    document.getElementById('price-live-badge')?.classList.add('active');
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
