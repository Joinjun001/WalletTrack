/**
 * 업비트 원화 시세(WebSocket, 사이드바·차트와 공유), 상단 시세 바, 공포·탐욕 지수.
 * 상단 시세 바와 오늘 시세(고가·저가)는 지금 보고 있는 코인(selectedCoin.ts)을 따라간다.
 */

import { prices, subscribePrices, updatePrices } from './priceStore.ts';
import { coinKimchiPremium, formatKrwPrice, formatSignedPct, formatUsdPrice, fearGreedLabelKo } from './market.ts';
import { COINS } from './coins.ts';
import { getUpbit } from './historyApi.ts';
import { selectedCoin, onSelectedCoinChange } from './selectedCoin.ts';
import { onUsdQuote, usdQuote } from './binanceSpot.ts';
import type { UsdQuote } from './binanceSpot.ts';

// BTC/USDT는 상단 바, 나머지는 코인 시세 표와 차트가 함께 쓴다 (업비트 연결 하나로 공유)
const UPBIT_CODES = Array.from(new Set(['KRW-BTC', 'KRW-USDT', ...COINS.map((c) => `KRW-${c.symbol}`)]));
const UPBIT_REST = `https://api.upbit.com/v1/ticker?markets=${UPBIT_CODES.join(',')}`;
// 실시간으로 받을 마켓. 코인 사이드바가 원화 마켓 전체로 넓힌다
let wsCodes = UPBIT_CODES;
let upbitWs: WebSocket | null = null;
const UPBIT_WS = 'wss://api.upbit.com/websocket/v1';
const FEAR_GREED_API = 'https://api.alternative.me/fng/';
const FEAR_GREED_REFRESH_MS = 60 * 60 * 1000;

export interface UpbitTicker {
  market?: string; // REST
  code?: string;   // WebSocket
  trade_price: number;
  signed_change_rate: number;
  opening_price: number; // 오늘(오전 9시) 시가
  high_price: number;
  low_price: number;
  acc_trade_price_24h: number;
  trade_timestamp: number; // ms
}

type TickerListener = (market: string, t: UpbitTicker) => void;
const tickerListeners: TickerListener[] = [];
const latestTickers = new Map<string, UpbitTicker>(); // 마켓별 마지막 시세 (상단 시세 바)

const tradeListeners: ((msg: Record<string, unknown>) => void)[] = [];

/** 업비트 원화 마켓 체결 (대형 체결 피드, setUpbitTradeCoins로 고른 코인). 시세와 같은 연결로 받는다 */
export function onUpbitTrade(fn: (msg: Record<string, unknown>) => void) {
  tradeListeners.push(fn);
}

let tradeCodes = ['KRW-BTC'];

/** 체결을 받을 코인을 바꾼다. 업비트는 연결 수를 엄격하게 제한해 새로 열지 않고 시세 연결을 다시 연다 */
export function setUpbitTradeCoins(coins: string[]) {
  const next = coins.map((c) => `KRW-${c}`);
  if (next.join(',') === tradeCodes.join(',')) return;
  tradeCodes = next;
  reconnectUpbit();
}

/** 업비트 원화 마켓 시세 수신 (기본 UPBIT_CODES, subscribeUpbitMarkets로 넓힌 마켓 포함) */
export function onUpbitTicker(fn: TickerListener) {
  tickerListeners.push(fn);
}

function applyUpbitTicker(t: UpbitTicker) {
  const market = t.market || t.code;
  if (!market) return;
  latestTickers.set(market, t);
  for (const fn of tickerListeners) fn(market, t);
  if (market === `KRW-${selectedCoin()}` || market === 'KRW-USDT') queueHeader();
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
  // 서버 중계는 원화 마켓 전체를 준다 (사이드바에서 어느 코인을 골라도 상단 시세 바가 바로 채워지게 전부 쓴다)
  const list = await getUpbit<UpbitTicker[]>('/upbit/tickers', UPBIT_REST);
  list?.forEach(applyUpbitTicker);
}

/** 실시간으로 받을 마켓을 넓힌다 (기본 마켓은 항상 포함). 연결을 새로 연다 */
export function subscribeUpbitMarkets(markets: string[]) {
  wsCodes = Array.from(new Set([...UPBIT_CODES, ...markets]));
  reconnectUpbit();
}

function reconnectUpbit() {
  if (!upbitWs) return; // 아직 처음 연결 전 (initKrMarket이 연다)
  const old = upbitWs;
  upbitWs = null; // 닫힌 연결이 다시 연결하지 않게
  old?.close();
  connectUpbitWebSocket();
}

function connectUpbitWebSocket() {
  const ws = new WebSocket(UPBIT_WS);
  upbitWs = ws;
  ws.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();

  ws.onopen = () => {
    ws.send(JSON.stringify([{ ticket: 'wallet-track' }, { type: 'ticker', codes: wsCodes }, { type: 'trade', codes: tradeCodes }]));
  };
  ws.onmessage = (event) => {
    try {
      const text = typeof event.data === 'string' ? event.data : decoder.decode(event.data);
      const msg = JSON.parse(text);
      if (msg?.type === 'trade') tradeListeners.forEach((fn) => fn(msg));
      else applyUpbitTicker(msg);
    } catch (e) {
      console.error('Upbit WS Parse Error:', e);
    }
  };
  ws.onclose = () => {
    if (upbitWs !== ws) return; // subscribeUpbitMarkets가 새 연결로 바꿨다
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

let lastPrice = 0;
let lastSymbol = '';

function flashPrice(elem: HTMLElement, newPrice: number) {
  if (lastPrice > 0 && newPrice !== lastPrice) {
    const cls = newPrice > lastPrice ? 'price-up' : 'price-down';
    elem.classList.remove('price-up', 'price-down');
    elem.classList.add(cls);
    setTimeout(() => elem.classList.remove(cls), 600);
  }
  lastPrice = newPrice;
}

/** 고른 코인의 달러 시세. BTC는 상단 바 전용 연결(24시간 변동 포함, 막히면 mempool.space 가격)을 쓴다 */
function selectedUsd(symbol: string): UsdQuote | null {
  if (symbol === 'BTC') return prices.usdBtc > 0 ? { price: prices.usdBtc, changePct: prices.usdChangePct ?? NaN } : null;
  return usdQuote(symbol);
}

function renderHeader() {
  const symbol = selectedCoin();
  if (symbol !== lastSymbol) {
    lastSymbol = symbol;
    lastPrice = 0; // 코인이 바뀌면 깜빡이지 않게
  }
  const t = latestTickers.get(`KRW-${symbol}`);
  const usd = selectedUsd(symbol);

  setText('price-label', `${symbol} / KRW`);
  setText('usd-label', `${symbol} / USD`);
  setText('kimchi-coin-label', symbol);
  setText('range-coin-label', symbol);

  const krwElem = document.getElementById('krw-btc-price');
  if (krwElem) {
    if (t) flashPrice(krwElem, t.trade_price);
    krwElem.textContent = t ? formatKrwPrice(t.trade_price) : '-';
  }
  const change = t ? t.signed_change_rate * 100 : null;
  setText('krw-change', change === null ? '-' : formatSignedPct(change), change);
  setText('krw-high', t ? formatKrwPrice(t.high_price) : '-');
  setText('krw-low', t ? formatKrwPrice(t.low_price) : '-');

  setText('usd-btc-price', usd ? formatUsdPrice(usd.price) : symbol === 'USDT' ? '$1' : '바이낸스 없음');
  const usdChange = usd && Number.isFinite(usd.changePct) ? usd.changePct : null;
  setText('usd-change', usdChange === null ? '' : formatSignedPct(usdChange), usdChange);

  const premium = t && usd ? coinKimchiPremium(t.trade_price, usd.price, prices.krwUsdt) : null;
  setText('kimchi-premium', premium === null ? '-' : formatSignedPct(premium), premium);
}

let headerQueued = false;

function queueHeader() {
  if (headerQueued) return;
  headerQueued = true;
  requestAnimationFrame(() => {
    headerQueued = false;
    renderHeader();
  });
}

export function initKrMarket() {
  subscribePrices(() => { if (selectedCoin() === 'BTC') queueHeader(); });
  onUsdQuote((symbol) => { if (symbol === selectedCoin()) queueHeader(); });
  onSelectedCoinChange(renderHeader);
  renderHeader();
  fetchUpbitOnce();
  connectUpbitWebSocket();
  refreshFearGreed();
  setInterval(refreshFearGreed, FEAR_GREED_REFRESH_MS);
}
