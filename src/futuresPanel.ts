/**
 * 바이낸스 BTCUSDT 무기한 선물 지표(펀딩비, 미결제약정, 롱/숏 비율), 주요 코인 펀딩비 표, 실시간 강제청산 피드.
 * 청산 피드는 'BTC'(기본: 바이낸스·바이비트·OKX의 BTC 청산 합산, 사운드 알림과 같은 기준)와 '전체'(바이낸스 선물 전체 코인)로 바꿔 볼 수 있다.
 * 바이비트·OKX 청산은 main.ts가 btcStreams.ts에서 받아 addOtherExchangeLiquidation으로 넣는다.
 */

import { escapeHtml } from './txAnalysis.ts';
import { COINS } from './coins.ts';
import { formatCountdown, formatFundingRate, formatSignedPct, formatUsdShort, liquidatedPosition } from './market.ts';
import { getHistory } from './historyApi.ts';
import { trackOnce } from './analytics.ts';
import type { LiquidationRecord, LiquidationSummary } from './historyApi.ts';
import { EXCHANGE_LABELS } from './exchangeFeeds.ts';
import type { BtcLiquidation, Exchange } from './exchangeFeeds.ts';
import { track } from './analytics.ts';

const FAPI = 'https://fapi.binance.com';
// 바이낸스 선물 시장 데이터 스트림은 /market 경로 (예전 /ws 경로는 연결만 되고 데이터가 오지 않는다)
const LIQUIDATION_WS = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const REFRESH_MS = 30 * 1000;
const MIN_LIQUIDATION_USD = 1_000; // 목록에는 이 이상만 (합계는 전부 포함)
const MAX_LIQUIDATION_ITEMS = 40;
const MAX_STORED = 300;
const MODE_KEY = 'wallettrack.liqMode';

export type LiqMode = 'btc' | 'all';

interface LiqItem {
  symbol: string; // BTCUSDT
  exchange: Exchange;
  position: 'long' | 'short';
  usd: number;
  ts: number;
}

let mode: LiqMode = 'btc';
const modeListeners: ((m: LiqMode) => void)[] = [];
let items: LiqItem[] = []; // 최신이 앞

/** 청산 피드 보기 (BTC / 전체). 청산 통계도 따라 바뀐다 */
export function liqMode(): LiqMode {
  return mode;
}

export function onLiqModeChange(fn: (m: LiqMode) => void) {
  modeListeners.push(fn);
}

type LiquidationListener = (position: 'long' | 'short', usd: number, symbol: string) => void;
const liquidationListeners: LiquidationListener[] = [];

/** 실시간으로 들어온 강제청산 (서버 기록은 포함하지 않는다). 사운드 알림이 쓴다 */
export function onLiveLiquidation(fn: LiquidationListener) {
  liquidationListeners.push(fn);
}

let nextFundingTime = 0;
// 피드 위 롱·숏 합계 (보기별). 서버 24시간 합계 + 페이지를 연 뒤 실시간
const totals: Record<LiqMode, { long: number; short: number; fromServer: boolean }> = {
  all: { long: 0, short: 0, fromServer: false },
  btc: { long: 0, short: 0, fromServer: false }
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${FAPI}${path}`);
    if (res.ok) return (await res.json()) as T;
    // 지역 제한(451)으로 선물 탭이 비는 사용자가 얼마나 되는지 보기 위해 남긴다
    trackOnce('api_fail', `binance_futures:${res.status}`, { source: 'binance_futures', status: res.status });
    return null;
  } catch (e) {
    console.warn(`Binance futures ${path} failed:`, e);
    return null;
  }
}

function setText(id: string, text: string, tone?: number) {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.textContent = text;
  if (tone !== undefined) {
    elem.classList.toggle('up', tone > 0);
    elem.classList.toggle('down', tone < 0);
  }
}

interface PremiumIndex {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

/** 주요 코인 펀딩비 표. 바이낸스 선물에 없는 코인은 '-' */
function renderFundingTable(list: PremiumIndex[]) {
  const tbody = document.getElementById('funding-table-body');
  if (!tbody) return;
  const bySymbol = new Map(list.map((p) => [p.symbol, p]));
  tbody.innerHTML = COINS.map((c) => {
    const p = bySymbol.get(`${c.symbol}USDT`);
    const rate = p ? parseFloat(p.lastFundingRate) : NaN;
    const mark = p ? parseFloat(p.markPrice) : NaN;
    const tone = rate > 0 ? 'up' : rate < 0 ? 'down' : '';
    return `
      <tr>
        <td class="coin-name-cell"><strong>${c.name}</strong><span>${c.symbol}</span></td>
        <td class="num ${tone}">${isNaN(rate) ? '-' : formatFundingRate(rate)}</td>
        <td class="num hide-mobile">${isNaN(rate) ? '-' : formatSignedPct(rate * 100 * 3 * 365)}</td>
        <td class="num">${isNaN(mark) ? '-' : `$${mark.toLocaleString('en-US', { maximumSignificantDigits: 6 })}`}</td>
      </tr>`;
  }).join('');
}

async function refresh() {
  const [premiums, oi, ratio] = await Promise.all([
    getJson<PremiumIndex[]>('/fapi/v1/premiumIndex'),
    getJson<{ openInterest: string }>('/fapi/v1/openInterest?symbol=BTCUSDT'),
    getJson<{ longAccount: string; shortAccount: string }[]>('/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1')
  ]);

  const status = document.getElementById('futures-status');
  if (status) status.hidden = !!(premiums || oi || ratio);

  if (premiums) renderFundingTable(premiums);
  const premium = premiums?.find((p) => p.symbol === 'BTCUSDT');

  const mark = premium ? parseFloat(premium.markPrice) : 0;
  if (premium) {
    const rate = parseFloat(premium.lastFundingRate);
    // 펀딩비 양수 = 롱이 숏에게 지불 (롱 과열)
    setText('fut-funding', formatFundingRate(rate), rate);
    nextFundingTime = premium.nextFundingTime;
    renderCountdown();
  }

  if (oi) {
    const btc = parseFloat(oi.openInterest);
    setText('fut-oi', `${Math.round(btc).toLocaleString('ko-KR')} BTC`);
    if (mark > 0) setText('fut-oi-usd', formatUsdShort(btc * mark));
  }

  const latest = ratio?.[0];
  if (latest) {
    const longPct = parseFloat(latest.longAccount) * 100;
    const shortPct = parseFloat(latest.shortAccount) * 100;
    setText('fut-long-pct', `롱 ${longPct.toFixed(1)}%`);
    setText('fut-short-pct', `숏 ${shortPct.toFixed(1)}%`);
    const bar = document.getElementById('fut-ls-bar');
    if (bar) bar.style.width = `${longPct}%`;
  }
}

function renderCountdown() {
  if (nextFundingTime > 0) setText('fut-funding-countdown', `다음 정산까지 ${formatCountdown(nextFundingTime - Date.now())}`);
}

interface ForceOrder {
  o: { s: string; S: string; ap: string; z: string; T: number };
}

function renderTotals() {
  const t = totals[mode];
  setText('liq-long-total', formatUsdShort(t.long));
  setText('liq-short-total', formatUsdShort(t.short));
  setText('liq-totals-note', !t.fromServer ? '페이지를 연 뒤부터' : mode === 'btc' ? '24시간(바이낸스) + 실시간' : '최근 24시간 + 실시간');
}

const isBtc = (i: LiqItem) => i.symbol === 'BTCUSDT';

function itemHtml(i: LiqItem): string {
  const time = new Date(i.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  // BTC 보기는 코인 대신 거래소를 보여 준다
  const label = mode === 'btc' ? EXCHANGE_LABELS[i.exchange].replace(' 선물', '') : i.symbol.replace(/USDT$/, '');
  return `
    <li class="liq-item ${i.position}${i.usd >= 1e6 ? ' big' : ''}">
      <span class="liq-symbol">${escapeHtml(label)}</span>
      <span class="liq-side">${i.position === 'long' ? '롱 청산' : '숏 청산'}</span>
      <span class="liq-usd">${formatUsdShort(i.usd)}</span>
      <span class="liq-time">${time}</span>
    </li>`;
}

/** 보기에 맞는 청산만 (전체 = 바이낸스 전체 코인, BTC = 세 거래소의 BTC) */
function visible(i: LiqItem): boolean {
  return mode === 'btc' ? isBtc(i) : i.exchange === 'binance-futures';
}

function renderFeed() {
  const list = document.getElementById('liq-feed');
  if (!list) return;
  const shown = items.filter((i) => i.usd >= MIN_LIQUIDATION_USD && visible(i)).slice(0, MAX_LIQUIDATION_ITEMS);
  list.innerHTML = shown.length ? shown.map(itemHtml).join('') : '<li class="liq-empty">청산 주문을 기다리는 중...</li>';
  const unit = document.getElementById('liq-feed-unit');
  if (unit) unit.textContent = mode === 'btc' ? 'BTC · 바이낸스·바이비트·OKX · $1K 이상' : '바이낸스 선물 전체 · $1K 이상';
}

function addItem(item: LiqItem, live: boolean) {
  if (live) {
    if (item.exchange === 'binance-futures') {
      totals.all[item.position] += item.usd;
    }
    if (isBtc(item)) totals.btc[item.position] += item.usd;
    renderTotals();
  }
  if (item.usd < MIN_LIQUIDATION_USD) return;
  items.unshift(item);
  if (items.length > MAX_STORED) items.length = MAX_STORED;
  if (!live || !visible(item)) return;
  const list = document.getElementById('liq-feed');
  if (!list) return;
  list.querySelector('.liq-empty')?.remove();
  list.insertAdjacentHTML('afterbegin', itemHtml(item));
  while (list.children.length > MAX_LIQUIDATION_ITEMS) list.lastElementChild?.remove();
}

function onLiquidation(order: ForceOrder['o']) {
  const usd = parseFloat(order.ap) * parseFloat(order.z);
  if (!(usd > 0)) return;
  const position = liquidatedPosition(order.S);
  for (const fn of liquidationListeners) fn(position, usd, order.s);
  addItem({ symbol: order.s, exchange: 'binance-futures', position, usd, ts: order.T }, true);
}

/** 바이비트·OKX BTC 청산 (바이낸스는 위 전체 마켓 스트림에서 이미 받는다) */
export function addOtherExchangeLiquidation(l: BtcLiquidation) {
  if (l.exchange === 'binance-futures') return;
  addItem({ symbol: 'BTCUSDT', exchange: l.exchange, position: l.position, usd: l.usd, ts: l.ts }, true);
}

function setMode(next: LiqMode, save: boolean) {
  mode = next;
  document.querySelectorAll<HTMLButtonElement>('.liq-mode-btn').forEach((b) => {
    const on = b.dataset.mode === next;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  renderFeed();
  renderTotals();
  if (save) {
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // 시크릿 모드 등: 이번 방문 동안만 유지
    }
  }
  for (const fn of modeListeners) fn(next);
}

function connectLiquidationWebSocket() {
  const ws = new WebSocket(LIQUIDATION_WS);
  ws.onmessage = (event) => {
    try {
      const msg: ForceOrder = JSON.parse(event.data);
      if (msg?.o) onLiquidation(msg.o);
    } catch (e) {
      console.error('Liquidation WS Parse Error:', e);
    }
  };
  ws.onclose = () => setTimeout(connectLiquidationWebSocket, 3000);
}

/** 서버에 쌓인 최근 24시간 청산 기록과 합계 (전체·BTC). 서버가 응답하지 않으면 페이지를 연 뒤부터만 집계한다 */
async function loadLiquidationHistory() {
  const base = `/liquidations?hours=24&minUsd=${MIN_LIQUIDATION_USD}&limit=${MAX_LIQUIDATION_ITEMS}`;
  const [allRecords, btcRecords, allSummary, btcSummary] = await Promise.all([
    getHistory<LiquidationRecord[]>(base),
    getHistory<LiquidationRecord[]>(`${base}&symbol=BTCUSDT`),
    getHistory<LiquidationSummary>('/liquidations/summary?hours=24'),
    getHistory<LiquidationSummary>('/liquidations/summary?hours=24&symbol=BTCUSDT')
  ]);
  const seen = new Set<string>();
  const records = [...(allRecords ?? []), ...(btcRecords ?? [])].filter((r) => {
    const key = `${r.symbol}|${r.occurredAt}|${r.position}|${r.usd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 기록을 받는 동안 바이비트·OKX 실시간 청산이 먼저 들어왔을 수 있어 합친다
  items = [...items, ...records.map((r): LiqItem => ({ symbol: r.symbol, exchange: 'binance-futures', position: r.position, usd: r.usd, ts: r.occurredAt }))]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_STORED);
  // 실시간으로 이미 더한 바이비트·OKX 몫은 서버 합계(바이낸스)에 없으므로 유지한다
  const otherBtc = { long: 0, short: 0 };
  for (const i of items) if (i.exchange !== 'binance-futures') otherBtc[i.position] += i.usd;
  if (allSummary) totals.all = { long: allSummary.longUsd, short: allSummary.shortUsd, fromServer: true };
  if (btcSummary) totals.btc = { long: btcSummary.longUsd + otherBtc.long, short: btcSummary.shortUsd + otherBtc.short, fromServer: true };
  renderFeed();
  renderTotals();
}

export async function initFuturesPanel() {
  try {
    if (localStorage.getItem(MODE_KEY) === 'all') mode = 'all';
  } catch {
    // 저장된 값이 없으면 BTC
  }
  document.querySelectorAll<HTMLButtonElement>('.liq-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode === 'all' ? 'all' : 'btc';
      if (next === mode) return;
      setMode(next, true);
      track('liq_mode', { mode: next });
    });
  });
  setMode(mode, false);
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderCountdown, 1000);
  // 기록을 먼저 받고 실시간 연결을 열어야 같은 청산이 합계에 두 번 들어가지 않는다
  await loadLiquidationHistory();
  connectLiquidationWebSocket();
}
