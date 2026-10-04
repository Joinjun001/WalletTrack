/**
 * 급등·급락 포착: 업비트 원화 마켓 전체 실시간 시세에서 최근 5분 최저가보다 기준(%) 이상 오르거나
 * 최고가보다 그만큼 내린 코인을 피드에 올린다. 페이지를 연 뒤부터 모은다 (서버 기록 없음).
 * 같은 코인·방향은 10분 동안 다시 올리지 않는다 (그 사이 기준만큼 더 움직이면 다시 올린다).
 */

import { onUpbitTicker } from './krMarket.ts';
import { coinName } from './coins.ts';
import { detectSurge, formatKrwPrice, formatKrwShort, formatSignedPct, pushPriceBucket } from './market.ts';
import type { PriceBucket } from './market.ts';
import { setSelectedCoin } from './selectedCoin.ts';
import { showToast } from './tools.ts';
import { escapeHtml } from './txAnalysis.ts';
import { track } from './analytics.ts';

const BUCKET_MS = 10_000;
const WINDOW_MS = 5 * 60_000;
const COOLDOWN_MS = 10 * 60_000;
const MIN_VOLUME_KRW = 5e8; // 24시간 거래대금 5억원 미만은 조금만 사고팔아도 튀어서 뺀다
const MAX_ITEMS = 50;
const THRESHOLDS = [2, 3, 5, 10];
const THRESHOLD_KEY = 'wallettrack.surgeThreshold';
const TOAST_KEY = 'wallettrack.surgeToast';

const buckets = new Map<string, PriceBucket[]>();
const lastFired = new Map<string, { at: number; pct: number }>(); // "KRW-ETH|up"
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

function emptyText(): string {
  return `5분 안에 ±${threshold}% 이상 움직인 코인을 실시간으로 잡아요. 페이지를 연 뒤부터 모아요.`;
}

function prependItem(symbol: string, direction: 'up' | 'down', pct: number, price: number, volume: number) {
  const list = document.getElementById('surge-feed');
  if (!list) return;
  list.querySelector('.liq-empty')?.remove();
  const name = coinName(symbol);
  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const item = document.createElement('li');
  item.className = `surge-item ${direction}`;
  item.dataset.symbol = symbol;
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `${name} 차트 보기`);
  item.innerHTML = `
    <span class="surge-side">${direction === 'up' ? '🚀 급등' : '📉 급락'}</span>
    <span class="surge-name"><strong>${escapeHtml(name)}</strong> <span>${escapeHtml(symbol)}</span></span>
    <span class="surge-pct">${formatSignedPct(pct)}</span>
    <span class="surge-price">${formatKrwPrice(price)} <span class="surge-vol">· ${formatKrwShort(volume)}</span></span>
    <span class="liq-time">${time}</span>`;
  list.prepend(item);
  while (list.children.length > MAX_ITEMS) list.lastElementChild?.remove();

  if (!panelVisible()) {
    unseen++;
    renderBadge();
  }
  if (toastOn) showToast(`${direction === 'up' ? '🚀' : '📉'} ${name}(${symbol}) 5분 ${formatSignedPct(pct)} ${direction === 'up' ? '급등' : '급락'}`);
}

function onTicker(market: string, price: number, volume24h: number) {
  if (!market.startsWith('KRW-') || market === 'KRW-USDT') return;
  const now = Date.now();
  let list = buckets.get(market);
  if (!list) {
    list = [];
    buckets.set(market, list);
  }
  pushPriceBucket(list, price, now, BUCKET_MS, WINDOW_MS);
  if (volume24h < MIN_VOLUME_KRW) return;

  const surge = detectSurge(list, price, threshold);
  if (!surge) return;
  const key = `${market}|${surge.direction}`;
  const prev = lastFired.get(key);
  if (prev && now - prev.at < COOLDOWN_MS && Math.abs(surge.pct) < Math.abs(prev.pct) + threshold) return;
  lastFired.set(key, { at: now, pct: surge.pct });
  prependItem(market.slice(4), surge.direction, surge.pct, price, volume24h);
}

function renderControls() {
  document.querySelectorAll<HTMLButtonElement>('.surge-btn').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.surge) === threshold));
  const toggle = document.getElementById('surge-toast-toggle');
  if (toggle) {
    toggle.classList.toggle('active', toastOn);
    toggle.setAttribute('aria-pressed', String(toastOn));
    toggle.textContent = toastOn ? '🔔 화면 알림 켬' : '🔕 화면 알림 끔';
  }
  const empty = document.querySelector('#surge-feed .liq-empty');
  if (empty) empty.textContent = emptyText();
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
  if (THRESHOLDS.includes(saved)) threshold = saved;
  toastOn = load(TOAST_KEY) === 'on';
  renderControls();

  document.querySelectorAll<HTMLButtonElement>('.surge-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.surge);
      if (!THRESHOLDS.includes(next) || next === threshold) return;
      threshold = next;
      lastFired.clear();
      save(THRESHOLD_KEY, String(next));
      renderControls();
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

  onUpbitTicker((market, t) => onTicker(market, t.trade_price, t.acc_trade_price_24h));
}
