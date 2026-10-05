/**
 * 🐋 대형 체결 탭: 여러 거래소 BTC 체결 중 큰 주문(1 BTC 이상)을 실시간 피드로 보여 주고,
 * 기간별 매수·매도·순매수 합계를 낸다. 1시간은 페이지를 연 뒤부터 브라우저에서 모은 값,
 * 하루·1주·1달은 기록 서버가 모은 1분 합계(server/src/bigTrades.ts)를 1분마다 받는다.
 */

import { onBtcTrade } from './btcStreams.ts';
import { EXCHANGE_LABELS } from './exchangeFeeds.ts';
import type { MergedTrade } from './exchangeFeeds.ts';
import { prices } from './priceStore.ts';
import { formatKrwShort, formatUsdShort } from './market.ts';
import { setSelectedCoin } from './selectedCoin.ts';
import { track } from './analytics.ts';
import { getHistory } from './historyApi.ts';
import type { BigTradeSummary } from './historyApi.ts';

const MIN_BTC = 1;            // 가장 낮은 필터. 이 이상은 모두 모아 둔다
const WHALE_BTC = 10;         // 이 이상은 강조
const SUMMARY_MS = 60 * 60 * 1000;
const MAX_STORED = 500;
const MAX_SHOWN = 60;
const FILTERS = [1, 5, 10, 50];
const FILTER_KEY = 'wallettrack.bigTradeBtc';
const FLOW_PERIODS = [1, 24, 168, 720]; // 시간. 1시간만 브라우저에서 계산
const SERVER_REFRESH_MS = 60_000;
const LOCAL_UNIT = '1 BTC 이상 · 페이지를 연 뒤부터';
const SERVER_UNIT = '1 BTC 이상 · 5개 거래소 · 기록 서버';

interface Item extends MergedTrade {
  krw: number; // 받은 시점 시세로 환산
  usd: number;
}

let items: Item[] = []; // 최신이 앞
let minBtc = MIN_BTC;
let flowHours = 1;
let serverRequest = 0;

function formatBtc(btc: number): string {
  return `${btc.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BTC`;
}

function itemHtml(t: Item): string {
  const time = new Date(t.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const value = [t.krw > 0 ? `≈${formatKrwShort(t.krw)}` : '', t.usd > 0 ? formatUsdShort(t.usd) : ''].filter(Boolean).join(' · ');
  return `
    <li class="big-item ${t.side}${t.btc >= WHALE_BTC ? ' whale' : ''}" title="누르면 비트코인 차트로">
      <span class="big-side">${t.side === 'buy' ? '매수' : '매도'}</span>
      <span class="big-btc">${formatBtc(t.btc)}</span>
      <span class="big-value">${value}</span>
      <span class="big-exchange">${EXCHANGE_LABELS[t.exchange]}</span>
      <span class="liq-time">${time}</span>
    </li>`;
}

function emptyHtml(): string {
  return `<li class="liq-empty">${minBtc} BTC 이상 체결을 기다리는 중... (페이지를 연 뒤부터 모아요)</li>`;
}

function renderList() {
  const list = document.getElementById('big-feed');
  if (!list) return;
  const shown = items.filter((t) => t.btc >= minBtc).slice(0, MAX_SHOWN);
  list.innerHTML = shown.length ? shown.map(itemHtml).join('') : emptyHtml();
  renderCount();
}

function renderCount() {
  const count = document.getElementById('big-count');
  if (count) count.textContent = `${items.filter((t) => t.btc >= minBtc).length}건`;
}

function setText(id: string, text: string) {
  const elem = document.getElementById(id);
  if (elem) elem.textContent = text;
}

function renderSums(buy: number | null, sell: number | null) {
  const set = (id: string, text: string, tone?: number) => {
    const elem = document.getElementById(id);
    if (!elem) return;
    elem.textContent = text;
    if (tone !== undefined) {
      elem.classList.toggle('up', tone > 0);
      elem.classList.toggle('down', tone < 0);
    }
  };
  if (buy === null || sell === null) {
    set('big-buy', '-');
    set('big-sell', '-');
    set('big-net', '-', 0);
    return;
  }
  const net = buy - sell;
  set('big-buy', formatSumBtc(buy));
  set('big-sell', formatSumBtc(sell));
  set('big-net', `${net >= 0 ? '+' : ''}${formatSumBtc(net)}`, net);
}

/** 합계용: 1달이면 수백만 BTC라 1,000 BTC 이상은 정수로 */
function formatSumBtc(btc: number): string {
  const digits = Math.abs(btc) >= 1000 ? 0 : 2;
  return `${btc.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} BTC`;
}

/** 1시간: 페이지를 연 뒤 받은 체결로 계산 */
function renderSummary() {
  if (flowHours !== 1) return;
  const since = Date.now() - SUMMARY_MS;
  let buy = 0;
  let sell = 0;
  for (const t of items) {
    if (t.ts < since) continue;
    if (t.side === 'buy') buy += t.btc;
    else sell += t.btc;
  }
  renderSums(buy, sell);
}

/** 기록이 기간보다 짧은 거래소를 알려 준다 (예: "OKX 10/6 07:00부터") */
function coverageNote(s: BigTradeSummary): string {
  const start = Date.now() - s.hours * 3_600_000 + 3_600_000; // 1시간 정도 모자란 건 넘어간다
  const short: string[] = [];
  for (const [exchange, label] of Object.entries(EXCHANGE_LABELS)) {
    const since = s.since[exchange];
    if (since === undefined) short.push(`${label} 기록 없음`);
    else if (since > start) {
      const d = new Date(since);
      const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      short.push(`${label} ${d.getMonth() + 1}/${d.getDate()} ${time}부터`);
    }
  }
  // 아직 못 채운 날: "10/5 일부 거래소 채우는 중"
  const days = [...new Set(Object.values(s.missingDays ?? {}).flat())].sort();
  if (days.length) {
    const label = days.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`).join(', ');
    short.unshift(`${label} 일부 거래소 기록 채우는 중 (다음 날 반영)`);
  }
  return short.join(' · ');
}

/** 하루·1주·1달: 기록 서버 합계 */
async function loadServerSummary() {
  if (flowHours === 1) return;
  const request = ++serverRequest;
  const hours = flowHours;
  const s = await getHistory<BigTradeSummary>(`/big-trades/summary?hours=${hours}`);
  if (request !== serverRequest || hours !== flowHours) return; // 그 사이 기간이 바뀌었다
  if (!s) {
    renderSums(null, null);
    setText('big-flow-note', '기록 서버에 연결할 수 없어요');
    return;
  }
  renderSums(s.buyBtc, s.sellBtc);
  setText('big-flow-note', coverageNote(s));
}

function selectFlowPeriod(hours: number) {
  flowHours = hours;
  serverRequest++;
  document.querySelectorAll<HTMLButtonElement>('.flow-period-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.flowHours) === hours));
  setText('big-flow-unit', hours === 1 ? LOCAL_UNIT : SERVER_UNIT);
  setText('big-flow-note', '');
  if (hours === 1) renderSummary();
  else {
    renderSums(null, null);
    loadServerSummary();
  }
}

function onTrade(t: MergedTrade) {
  if (t.btc < MIN_BTC) return;
  const item: Item = { ...t, krw: t.btc * prices.krwBtc, usd: t.btc * prices.usdBtc };
  items.unshift(item);
  if (items.length > MAX_STORED) items.length = MAX_STORED;
  renderSummary();
  if (t.btc < minBtc) return;

  const list = document.getElementById('big-feed');
  if (!list) return;
  list.querySelector('.liq-empty')?.remove();
  list.insertAdjacentHTML('afterbegin', itemHtml(item));
  while (list.children.length > MAX_SHOWN) list.lastElementChild?.remove();
  renderCount();
}

export function initBigTradeFeed() {
  try {
    const saved = Number(localStorage.getItem(FILTER_KEY));
    if (FILTERS.includes(saved)) minBtc = saved;
  } catch {
    // 저장된 값이 없으면 기본값
  }
  const buttons = document.querySelectorAll<HTMLButtonElement>('.big-btn');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.big) === minBtc);
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.big);
      if (!FILTERS.includes(next) || next === minBtc) return;
      minBtc = next;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      try {
        localStorage.setItem(FILTER_KEY, String(next));
      } catch {
        // 시크릿 모드 등: 이번 방문 동안만 유지
      }
      renderList();
      track('big_trade_filter', { btc: next });
    });
  });

  document.getElementById('big-feed')?.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.big-item')) return;
    setSelectedCoin('BTC');
    document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelectorAll<HTMLButtonElement>('.flow-period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hours = Number(btn.dataset.flowHours);
      if (!FLOW_PERIODS.includes(hours) || hours === flowHours) return;
      selectFlowPeriod(hours);
      track('big_trade_period', { hours });
    });
  });

  renderList();
  renderSummary();
  onBtcTrade(onTrade);
  setInterval(renderSummary, 30_000); // 1시간이 지난 체결을 합계에서 뺀다
  setInterval(loadServerSummary, SERVER_REFRESH_MS);
}
