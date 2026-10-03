/**
 * 바이낸스 BTCUSDT 무기한 선물 지표(펀딩비, 미결제약정, 롱/숏 비율), 주요 코인 펀딩비 표, 전체 마켓 실시간 강제청산 피드
 */

import { escapeHtml } from './txAnalysis.ts';
import { COINS } from './coins.ts';
import { formatCountdown, formatFundingRate, formatSignedPct, formatUsdShort, liquidatedPosition } from './market.ts';
import { getHistory } from './historyApi.ts';
import { trackOnce } from './analytics.ts';
import type { LiquidationRecord, LiquidationSummary } from './historyApi.ts';

const FAPI = 'https://fapi.binance.com';
// 바이낸스 선물 시장 데이터 스트림은 /market 경로 (예전 /ws 경로는 연결만 되고 데이터가 오지 않는다)
const LIQUIDATION_WS = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const REFRESH_MS = 30 * 1000;
const MIN_LIQUIDATION_USD = 1_000; // 목록에는 이 이상만 (합계는 전부 포함)
const MAX_LIQUIDATION_ITEMS = 40;

type LiquidationListener = (position: 'long' | 'short', usd: number, symbol: string) => void;
const liquidationListeners: LiquidationListener[] = [];

/** 실시간으로 들어온 강제청산 (서버 기록은 포함하지 않는다). 사운드 알림이 쓴다 */
export function onLiveLiquidation(fn: LiquidationListener) {
  liquidationListeners.push(fn);
}

let nextFundingTime = 0;
let longLiquidatedUsd = 0;
let shortLiquidatedUsd = 0;

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
  setText('liq-long-total', formatUsdShort(longLiquidatedUsd));
  setText('liq-short-total', formatUsdShort(shortLiquidatedUsd));
}

function onLiquidation(order: ForceOrder['o']) {
  const usd = parseFloat(order.ap) * parseFloat(order.z);
  if (!(usd > 0)) return;
  const position = liquidatedPosition(order.S);
  if (position === 'long') longLiquidatedUsd += usd;
  else shortLiquidatedUsd += usd;
  renderTotals();
  for (const fn of liquidationListeners) fn(position, usd, order.s);

  if (usd >= MIN_LIQUIDATION_USD) prependLiquidation(order.s, position, usd, order.T);
}

function prependLiquidation(symbol: string, position: 'long' | 'short', usd: number, timestamp: number) {
  const list = document.getElementById('liq-feed');
  if (!list) return;
  list.querySelector('.liq-empty')?.remove();

  const item = document.createElement('li');
  item.className = `liq-item ${position}${usd >= 1e6 ? ' big' : ''}`;
  const time = new Date(timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  item.innerHTML = `
    <span class="liq-symbol">${escapeHtml(symbol.replace(/USDT$/, ''))}</span>
    <span class="liq-side">${position === 'long' ? '롱 청산' : '숏 청산'}</span>
    <span class="liq-usd">${formatUsdShort(usd)}</span>
    <span class="liq-time">${time}</span>`;
  list.prepend(item);
  while (list.children.length > MAX_LIQUIDATION_ITEMS) list.lastElementChild?.remove();
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

/** 서버에 쌓인 최근 24시간 청산 기록과 합계. 서버가 응답하지 않으면 페이지를 연 뒤부터만 집계한다 */
async function loadLiquidationHistory() {
  const [records, summary] = await Promise.all([
    getHistory<LiquidationRecord[]>(`/liquidations?hours=24&minUsd=${MIN_LIQUIDATION_USD}&limit=${MAX_LIQUIDATION_ITEMS}`),
    getHistory<LiquidationSummary>('/liquidations/summary?hours=24')
  ]);
  // 기록은 최신순이므로 오래된 것부터 앞에 붙여야 최신이 맨 위로 온다
  records?.slice().reverse().forEach((r) => prependLiquidation(r.symbol, r.position, r.usd, r.occurredAt));
  if (summary) {
    longLiquidatedUsd = summary.longUsd;
    shortLiquidatedUsd = summary.shortUsd;
    renderTotals();
    setText('liq-totals-note', '최근 24시간 + 실시간');
  }
}

export async function initFuturesPanel() {
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderCountdown, 1000);
  // 기록을 먼저 받고 실시간 연결을 열어야 같은 청산이 합계에 두 번 들어가지 않는다
  await loadLiquidationHistory();
  connectLiquidationWebSocket();
}
