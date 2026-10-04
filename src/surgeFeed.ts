/**
 * 급등·급락 포착: 업비트 원화 마켓 전체에서 5분 안에 기준(%) 이상 움직인 코인 (판정은 src/surge.ts).
 * 처음 열 때와 기준을 바꿀 때 서버 기록(지난 24시간)을 불러오고, 이후는 브라우저가 실시간 시세로 바로 잡아 위에 쌓는다.
 * 서버 수집기도 같은 판정을 하므로, 서버 기록과 같은 급등(같은 코인·방향, 10분 안)은 한 번만 보여 준다.
 * 서버가 응답하지 않으면 페이지를 연 뒤부터만 보여 준다.
 */

import { onUpbitTicker } from './krMarket.ts';
import { coinName } from './coins.ts';
import { formatKrwPrice, formatKrwShort, formatSignedPct } from './market.ts';
import { SurgeDetector, SURGE_COOLDOWN_MS, SURGE_THRESHOLDS } from './surge.ts';
import type { SurgeEvent } from './surge.ts';
import { getHistory } from './historyApi.ts';
import type { SurgeRecord } from './historyApi.ts';
import { setSelectedCoin } from './selectedCoin.ts';
import { showToast } from './tools.ts';
import { escapeHtml } from './txAnalysis.ts';
import { track } from './analytics.ts';

const HISTORY_HOURS = 24;
const MAX_ITEMS = 50;
const THRESHOLD_KEY = 'wallettrack.surgeThreshold';
const TOAST_KEY = 'wallettrack.surgeToast';

interface Item {
  market: string;
  direction: 'up' | 'down';
  pct: number;
  price: number;
  volumeKrw: number;
  at: number;
}

const live = new Map<number, Item[]>(SURGE_THRESHOLDS.map((t) => [t, []])); // 기준별 실시간 감지 (최신이 앞)
let history: Item[] = [];        // 지금 기준의 서버 기록 (최신이 앞)
let historyState: 'loading' | 'ok' | 'failed' = 'loading';
let historyRequest = 0;
let threshold = 3;
let toastOn = false;
let unseen = 0;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

function panelVisible(): boolean {
  const panel = document.querySelector<HTMLElement>('.tab-panel[data-panel="surge"]');
  return !!panel && !panel.hidden;
}

function renderBadge() {
  const badge = document.getElementById('surge-badge');
  if (!badge) return;
  badge.hidden = unseen === 0;
  badge.textContent = unseen > 99 ? '99+' : String(unseen);
}

/** 서버 기록에 이미 있는 급등이면 (같은 코인·방향, 쿨다운 안) 실시간 감지를 다시 보여 주지 않는다 */
function inHistory(item: Item): boolean {
  return history.some((h) => h.market === item.market && h.direction === item.direction && Math.abs(h.at - item.at) < SURGE_COOLDOWN_MS);
}

function merged(): Item[] {
  const fresh = (live.get(threshold) ?? []).filter((i) => !inHistory(i));
  return [...fresh, ...history].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
}

/** 오늘이면 시각만, 아니면 날짜도 */
function timeLabel(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time.slice(0, 5)}`;
}

function itemHtml(i: Item): string {
  const symbol = i.market.slice(4);
  const name = coinName(symbol);
  return `
    <li class="surge-item ${i.direction}" data-symbol="${escapeHtml(symbol)}" tabindex="0" role="button" aria-label="${escapeHtml(name)} 차트 보기">
      <span class="surge-side">${i.direction === 'up' ? '🚀 급등' : '📉 급락'}</span>
      <span class="surge-name"><strong>${escapeHtml(name)}</strong> <span>${escapeHtml(symbol)}</span></span>
      <span class="surge-pct">${formatSignedPct(i.pct)}</span>
      <span class="surge-price">${formatKrwPrice(i.price)} <span class="surge-vol">· ${formatKrwShort(i.volumeKrw)}</span></span>
      <span class="liq-time">${timeLabel(i.at)}</span>
    </li>`;
}

function emptyText(): string {
  if (historyState === 'loading') return '지난 기록을 불러오는 중...';
  const since = historyState === 'ok' ? `최근 ${HISTORY_HOURS}시간 동안 없었어요. ` : '기록 서버에 연결할 수 없어 페이지를 연 뒤부터 모아요. ';
  return `5분 안에 ±${threshold}% 이상 움직인 코인이 ${since}새로 잡히면 바로 보여 드려요.`;
}

function renderList() {
  const list = document.getElementById('surge-feed');
  if (!list) return;
  const items = merged();
  list.innerHTML = items.length ? items.map(itemHtml).join('') : `<li class="liq-empty">${emptyText()}</li>`;
}

async function loadHistory() {
  const request = ++historyRequest;
  historyState = 'loading';
  history = [];
  renderList();
  const records = await getHistory<SurgeRecord[]>(`/surges?threshold=${threshold}&hours=${HISTORY_HOURS}&limit=${MAX_ITEMS}`);
  if (request !== historyRequest) return; // 그 사이 기준을 또 바꿨다
  historyState = records ? 'ok' : 'failed';
  history = (records ?? []).map((r) => ({ market: r.market, direction: r.direction, pct: r.pct, price: r.price, volumeKrw: r.volumeKrw, at: r.detectedAt }));
  renderList();
}

function onSurge(e: SurgeEvent) {
  const item: Item = { market: e.market, direction: e.direction, pct: e.pct, price: e.price, volumeKrw: e.volumeKrw, at: e.at };
  const list = live.get(e.threshold);
  if (!list) return;
  list.unshift(item);
  if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  if (e.threshold !== threshold || inHistory(item)) return;

  renderList();
  if (!panelVisible()) {
    unseen++;
    renderBadge();
  }
  const symbol = e.market.slice(4);
  if (toastOn) showToast(`${e.direction === 'up' ? '🚀' : '📉'} ${coinName(symbol)}(${symbol}) 5분 ${formatSignedPct(e.pct)} ${e.direction === 'up' ? '급등' : '급락'}`);
}

function renderControls() {
  document.querySelectorAll<HTMLButtonElement>('.surge-btn').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.surge) === threshold));
  const toggle = document.getElementById('surge-toast-toggle');
  if (toggle) {
    toggle.classList.toggle('active', toastOn);
    toggle.setAttribute('aria-pressed', String(toastOn));
    toggle.textContent = toastOn ? '🔔 화면 알림 켬' : '🔕 화면 알림 끔';
  }
}

function selectFromFeed(target: EventTarget | null) {
  const item = (target as HTMLElement | null)?.closest<HTMLElement>('.surge-item');
  if (!item?.dataset.symbol) return;
  setSelectedCoin(item.dataset.symbol);
  document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  track('chart_coin', { symbol: item.dataset.symbol, from: 'surge_feed' });
}

export function initSurgeFeed() {
  const saved = Number(load(THRESHOLD_KEY));
  if (SURGE_THRESHOLDS.includes(saved)) threshold = saved;
  toastOn = load(TOAST_KEY) === 'on';
  renderControls();

  document.querySelectorAll<HTMLButtonElement>('.surge-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.surge);
      if (!SURGE_THRESHOLDS.includes(next) || next === threshold) return;
      threshold = next;
      save(THRESHOLD_KEY, String(next));
      renderControls();
      loadHistory();
      track('surge_threshold', { pct: next });
    });
  });
  document.getElementById('surge-toast-toggle')?.addEventListener('click', () => {
    toastOn = !toastOn;
    save(TOAST_KEY, toastOn ? 'on' : 'off');
    renderControls();
    track('surge_toast', { on: toastOn });
  });

  const feed = document.getElementById('surge-feed');
  feed?.addEventListener('click', (e) => selectFromFeed(e.target));
  feed?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectFromFeed(e.target);
    }
  });

  // 탭을 열면 안 본 개수를 지운다
  document.querySelector('.tab-btn[data-tab="surge"]')?.addEventListener('click', () => {
    unseen = 0;
    renderBadge();
  });

  const detector = new SurgeDetector(onSurge);
  onUpbitTicker((market, t) => detector.update(market, t.trade_price, t.acc_trade_price_24h, Date.now()));
  loadHistory();
}
