/**
 * 왼쪽 코인 사이드바: 업비트 원화 마켓 전체를 검색·정렬(거래대금/상승/하락)해서 보여주고, 누르면 가운데 차트가 그 코인으로 바뀐다.
 * 코인마다 오늘 일봉을 축소한 미니 캔들을 그린다 (업비트 목록처럼). 모든 코인을 시가 기준 ±15% 같은 눈금으로 그려서
 * 크게 움직인 코인일수록 막대가 꽉 차 보인다.
 * 가격은 업비트 실시간 시세(WebSocket)로 갱신한다. 줄 순서는 정렬·검색을 바꿀 때와 주기적으로만 다시 매긴다 (누르려는 줄이 움직이지 않게).
 */

import { getUpbit } from './historyApi.ts';
import { onUpbitTicker, subscribeUpbitMarkets } from './krMarket.ts';
import type { UpbitTicker } from './krMarket.ts';
import { selectChartCoin } from './priceChart.ts';
import { setCoinNames } from './coins.ts';
import { escapeHtml } from './txAnalysis.ts';
import { formatKrwPrice, formatKrwShort, formatSignedPct } from './market.ts';
import { track } from './analytics.ts';

const UPBIT_MARKETS = 'https://api.upbit.com/v1/market/all?isDetails=false';
const UPBIT_TICKER_ALL = 'https://api.upbit.com/v1/ticker/all?quote_currencies=KRW';
const RESORT_MS = 30 * 1000;
const MINI_CANDLE_RANGE = 0.15; // 미니 캔들 위아래 끝 = 시가 대비 ±15%

type SortMode = 'volume' | 'up' | 'down';

interface Row {
  market: string;   // KRW-BTC
  symbol: string;   // BTC
  ko: string;
  en: string;
  price: number;
  changePct: number | null;
  volume24h: number; // 원화 거래대금
  open: number;      // 오늘 시가·고가·저가 (미니 캔들)
  high: number;
  low: number;
}

const rows = new Map<string, Row>();
const dirty = new Set<string>();
let sortMode: SortMode = 'volume';
let query = '';
let selected = 'BTC';
let renderQueued = false;

function matches(row: Row, q: string): boolean {
  if (!q) return true;
  return row.ko.toLowerCase().includes(q) || row.en.toLowerCase().includes(q) || row.symbol.toLowerCase().includes(q);
}

function sorted(): Row[] {
  const list = [...rows.values()].filter((r) => matches(r, query));
  if (sortMode === 'volume') return list.sort((a, b) => b.volume24h - a.volume24h);
  const pct = (r: Row) => r.changePct ?? 0;
  return list.sort((a, b) => (sortMode === 'up' ? pct(b) - pct(a) : pct(a) - pct(b)));
}

/** 시가 대비 가격을 미니 캔들 세로 위치(위에서 %)로. ±15% 밖은 끝에 붙인다 */
function candleY(price: number, open: number): number {
  const change = Math.max(-MINI_CANDLE_RANGE, Math.min(MINI_CANDLE_RANGE, price / open - 1));
  return ((MINI_CANDLE_RANGE - change) / (2 * MINI_CANDLE_RANGE)) * 100;
}

/** 꼬리(저가~고가)와 몸통(시가~현재가)의 위치. 시세를 아직 모르면 null */
function miniCandleStyle(row: Row) {
  if (!(row.open > 0 && row.price > 0)) return null;
  const top = (a: number, b: number) => Math.min(candleY(a, row.open), candleY(b, row.open));
  const height = (a: number, b: number) => Math.abs(candleY(a, row.open) - candleY(b, row.open));
  return {
    rising: row.price >= row.open,
    wick: `top:${top(row.high, row.low).toFixed(1)}%;height:${height(row.high, row.low).toFixed(1)}%`,
    // 거의 안 움직였어도 가는 선은 보이게
    body: `top:${top(row.open, row.price).toFixed(1)}%;height:max(1px,${height(row.open, row.price).toFixed(1)}%)`
  };
}

function miniCandleHtml(row: Row): string {
  const s = miniCandleStyle(row);
  if (!s) return '<span class="mini-candle" aria-hidden="true"></span>';
  return `<span class="mini-candle ${s.rising ? 'up' : 'down'}" aria-hidden="true"><i class="mc-wick" style="${s.wick}"></i><i class="mc-body" style="${s.body}"></i></span>`;
}

function toneClass(pct: number | null): string {
  return pct === null || pct === 0 ? '' : pct > 0 ? 'up' : 'down';
}

/** 줄 전체를 다시 그린다 (정렬·검색이 바뀔 때) */
function renderList() {
  const list = document.getElementById('coin-list');
  if (!list) return;
  const items = sorted();
  list.innerHTML = items.length === 0
    ? '<li class="coin-list-empty">검색 결과가 없어요</li>'
    : items.map((r) => `
      <li class="coin-row${r.symbol === selected ? ' selected' : ''}" data-market="${escapeHtml(r.market)}" data-symbol="${escapeHtml(r.symbol)}">
        ${miniCandleHtml(r)}
        <span class="coin-row-name"><strong>${escapeHtml(r.ko)}</strong><span>${escapeHtml(r.symbol)}</span></span>
        <span class="coin-row-quote">
          <span class="coin-row-price ${toneClass(r.changePct)}" data-col="price">${r.price > 0 ? formatKrwPrice(r.price) : '-'}</span>
          <span class="coin-row-sub"><span class="${toneClass(r.changePct)}" data-col="change">${r.changePct === null ? '-' : formatSignedPct(r.changePct)}</span> · <span data-col="volume">${formatKrwShort(r.volume24h)}</span></span>
        </span>
      </li>`).join('');
  dirty.clear();
}

/** 실시간 시세는 바뀐 줄의 글자만 고친다 (프레임당 한 번) */
function queueCellUpdate(market: string) {
  dirty.add(market);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const list = document.getElementById('coin-list');
    if (!list) return;
    for (const market of dirty) {
      const row = rows.get(market);
      const li = list.querySelector(`[data-market="${market}"]`);
      if (!row || !li) continue;
      const tone = toneClass(row.changePct);
      const price = li.querySelector<HTMLElement>('[data-col="price"]');
      const change = li.querySelector<HTMLElement>('[data-col="change"]');
      const volume = li.querySelector<HTMLElement>('[data-col="volume"]');
      if (price) {
        price.textContent = formatKrwPrice(row.price);
        price.className = `coin-row-price ${tone}`;
      }
      if (change && row.changePct !== null) {
        change.textContent = formatSignedPct(row.changePct);
        change.className = tone;
      }
      if (volume) volume.textContent = formatKrwShort(row.volume24h);
      const candle = li.querySelector('.mini-candle');
      if (candle) candle.outerHTML = miniCandleHtml(row);
    }
    dirty.clear();
  });
}

function setQuote(row: Row, t: UpbitTicker) {
  row.price = t.trade_price;
  row.changePct = t.signed_change_rate * 100;
  row.volume24h = t.acc_trade_price_24h;
  row.open = t.opening_price;
  row.high = t.high_price;
  row.low = t.low_price;
}

function applyTicker(market: string, t: UpbitTicker) {
  const row = rows.get(market);
  if (!row) return;
  setQuote(row, t);
  queueCellUpdate(market);
}

function select(symbol: string) {
  if (symbol === selected) return;
  selected = symbol;
  document.querySelectorAll('#coin-list .coin-row').forEach((li) => li.classList.toggle('selected', (li as HTMLElement).dataset.symbol === symbol));
  selectChartCoin(symbol);
}

function initControls() {
  const search = document.getElementById('coin-search') as HTMLInputElement | null;
  let searchTracked = false;
  search?.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderList();
    if (!searchTracked && query) {
      searchTracked = true;
      track('coin_search');
    }
  });
  // 검색 중 Enter를 누르면 맨 위 코인을 고른다
  search?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = document.querySelector<HTMLElement>('#coin-list .coin-row');
    if (first?.dataset.symbol) {
      select(first.dataset.symbol);
      track('chart_coin', { symbol: first.dataset.symbol, from: 'sidebar_search' });
    }
  });

  document.querySelectorAll<HTMLButtonElement>('.coin-sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.sort as SortMode | undefined;
      if (!mode || mode === sortMode) return;
      sortMode = mode;
      document.querySelectorAll('.coin-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderList();
      document.getElementById('coin-list')?.scrollTo({ top: 0 });
      track('coin_sort', { sort: mode });
    });
  });

  document.getElementById('coin-list')?.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.coin-row');
    if (!li?.dataset.symbol) return;
    select(li.dataset.symbol);
    track('chart_coin', { symbol: li.dataset.symbol, from: query ? 'sidebar_search' : `sidebar_${sortMode}` });
  });
}

export async function initCoinSidebar() {
  initControls();
  onUpbitTicker(applyTicker);

  const [markets, tickers] = await Promise.all([
    getUpbit<{ market: string; korean_name: string; english_name: string }[]>('/upbit/markets', UPBIT_MARKETS),
    getUpbit<UpbitTicker[]>('/upbit/tickers', UPBIT_TICKER_ALL)
  ]);
  const list = document.getElementById('coin-list');
  if (!markets) {
    if (list) list.innerHTML = '<li class="coin-list-empty">코인 목록을 불러오지 못했어요</li>';
    return;
  }

  for (const m of markets) {
    if (!m.market.startsWith('KRW-')) continue;
    const symbol = m.market.slice(4);
    rows.set(m.market, { market: m.market, symbol, ko: m.korean_name, en: m.english_name, price: 0, changePct: null, volume24h: 0, open: 0, high: 0, low: 0 });
  }
  setCoinNames([...rows.values()].map((r) => [r.symbol, r.ko] as [string, string]));
  for (const t of tickers ?? []) {
    const row = t.market ? rows.get(t.market) : undefined;
    if (row) setQuote(row, t);
  }
  renderList();

  subscribeUpbitMarkets([...rows.keys()]);
  // 거래대금·등락률 순서는 30초마다 다시 매긴다 (스크롤 위치는 유지)
  setInterval(() => {
    const listElem = document.getElementById('coin-list');
    const top = listElem?.scrollTop ?? 0;
    renderList();
    if (listElem) listElem.scrollTop = top;
  }, RESORT_MS);
}
