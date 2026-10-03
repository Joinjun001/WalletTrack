/**
 * 주요 코인 시세 표: 업비트 원화 가격/전일 대비/거래대금 + 바이낸스 달러 가격으로 코인별 김치 프리미엄
 */

import { COINS } from './coins.ts';
import { onUpbitTicker } from './krMarket.ts';
import { prices, subscribePrices } from './priceStore.ts';
import { selectChartCoin } from './priceChart.ts';
import { kimchiPremium, formatKrwPrice, formatKrwShort, formatSignedPct } from './market.ts';

const BINANCE_REST = 'https://api.binance.com/api/v3/ticker/price';
const BINANCE_WS = 'wss://stream.binance.com:9443/stream';

interface CoinQuote {
  krw: number;
  krwChangePct: number | null;
  krwVolume24h: number;
  usd: number;
}

const quotes = new Map<string, CoinQuote>(
  COINS.map((c) => [c.symbol, { krw: 0, krwChangePct: null, krwVolume24h: 0, usd: 0 }])
);
let renderQueued = false;

function binanceSymbol(symbol: string) {
  return `${symbol}USDT`;
}

async function fetchBinanceOnce() {
  try {
    const symbols = JSON.stringify(COINS.map((c) => binanceSymbol(c.symbol)));
    const res = await fetch(`${BINANCE_REST}?symbols=${encodeURIComponent(symbols)}`);
    if (!res.ok) return; // 지역 제한(451) 등: 김프만 비어 있게 된다
    const list: { symbol: string; price: string }[] = await res.json();
    for (const t of list) setUsd(t.symbol, parseFloat(t.price));
    queueRender();
  } catch (e) {
    console.warn('Binance prices failed:', e);
  }
}

function setUsd(binanceSym: string, price: number) {
  const quote = quotes.get(binanceSym.replace(/USDT$/, ''));
  if (quote && price > 0) quote.usd = price;
}

function connectBinanceWebSocket() {
  const streams = COINS.map((c) => `${binanceSymbol(c.symbol).toLowerCase()}@miniTicker`).join('/');
  const ws = new WebSocket(`${BINANCE_WS}?streams=${streams}`);
  ws.onmessage = (event) => {
    try {
      const { data } = JSON.parse(event.data);
      setUsd(data.s, parseFloat(data.c));
      queueRender();
    } catch (e) {
      console.error('Binance WS Parse Error:', e);
    }
  };
  ws.onclose = () => setTimeout(connectBinanceWebSocket, 3000);
}

function buildRows() {
  const tbody = document.getElementById('coin-table-body');
  if (!tbody) return;
  tbody.innerHTML = COINS.map((c, i) => `
    <tr data-symbol="${c.symbol}" class="${i === 0 ? 'selected' : ''}" title="눌러서 차트 보기">
      <td class="coin-name-cell"><strong>${c.name}</strong><span>${c.symbol}</span></td>
      <td class="num" data-col="price">-</td>
      <td class="num" data-col="change">-</td>
      <td class="num" data-col="premium">-</td>
      <td class="num hide-mobile" data-col="volume">-</td>
    </tr>`).join('');

  tbody.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-symbol]');
    if (!row?.dataset.symbol) return;
    tbody.querySelectorAll('tr').forEach((r) => r.classList.toggle('selected', r === row));
    selectChartCoin(row.dataset.symbol);
    document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function setCell(row: Element, col: string, text: string, tone?: number | null) {
  const cell = row.querySelector<HTMLElement>(`[data-col="${col}"]`);
  if (!cell) return;
  cell.textContent = text;
  cell.classList.toggle('up', tone != null && tone > 0);
  cell.classList.toggle('down', tone != null && tone < 0);
}

// 업비트·바이낸스 시세가 초당 수십 번 오므로 화면 갱신은 프레임당 한 번으로 묶는다
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  for (const [symbol, q] of quotes) {
    const row = document.querySelector(`#coin-table-body tr[data-symbol="${symbol}"]`);
    if (!row) continue;
    if (q.krw > 0) setCell(row, 'price', formatKrwPrice(q.krw), q.krwChangePct);
    if (q.krwChangePct !== null) setCell(row, 'change', formatSignedPct(q.krwChangePct), q.krwChangePct);
    if (q.krwVolume24h > 0) setCell(row, 'volume', formatKrwShort(q.krwVolume24h));
    const premium = kimchiPremium(q.krw, q.usd, prices.krwUsdt);
    if (premium !== null) setCell(row, 'premium', formatSignedPct(premium), premium);
  }
}

export function initCoinTable() {
  buildRows();
  onUpbitTicker((market, t) => {
    const quote = quotes.get(market.replace(/^KRW-/, ''));
    if (!quote) return;
    quote.krw = t.trade_price;
    quote.krwChangePct = t.signed_change_rate * 100;
    quote.krwVolume24h = t.acc_trade_price_24h;
    queueRender();
  });
  subscribePrices(queueRender); // 업비트 USDT 가격이 바뀌면 김프도 바뀐다
  fetchBinanceOnce();
  connectBinanceWebSocket();
}
