/**
 * 🐋 대형 체결 탭: 여러 거래소 BTC 체결 중 큰 주문(1 BTC 이상)을 실시간 피드로 보여 주고,
 * 최근 1시간 매수·매도·순매수 합계를 낸다. 페이지를 연 뒤부터 모은다 (서버 기록 없음).
 */

import { onBtcTrade } from './btcStreams.ts';
import { EXCHANGE_LABELS } from './exchangeFeeds.ts';
import type { MergedTrade } from './exchangeFeeds.ts';
import { prices } from './priceStore.ts';
import { formatKrwShort, formatUsdShort } from './market.ts';
import { setSelectedCoin } from './selectedCoin.ts';
import { track } from './analytics.ts';

const MIN_BTC = 1;            // 가장 낮은 필터. 이 이상은 모두 모아 둔다
const WHALE_BTC = 10;         // 이 이상은 강조
const SUMMARY_MS = 60 * 60 * 1000;
const MAX_STORED = 500;
const MAX_SHOWN = 60;
const FILTERS = [1, 5, 10, 50];
const FILTER_KEY = 'wallettrack.bigTradeBtc';

interface Item extends MergedTrade {
  krw: number; // 받은 시점 시세로 환산
  usd: number;
}

let items: Item[] = []; // 최신이 앞
let minBtc = MIN_BTC;

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

function renderSummary() {
  const since = Date.now() - SUMMARY_MS;
  let buy = 0;
  let sell = 0;
  for (const t of items) {
    if (t.ts < since) continue;
    if (t.side === 'buy') buy += t.btc;
    else sell += t.btc;
  }
  const net = buy - sell;
  const set = (id: string, text: string, tone?: number) => {
    const elem = document.getElementById(id);
    if (!elem) return;
    elem.textContent = text;
    if (tone !== undefined) {
      elem.classList.toggle('up', tone > 0);
      elem.classList.toggle('down', tone < 0);
    }
  };
  set('big-buy', formatBtc(buy));
  set('big-sell', formatBtc(sell));
  set('big-net', `${net >= 0 ? '+' : ''}${formatBtc(net)}`, net);
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

  renderList();
  renderSummary();
  onBtcTrade(onTrade);
  setInterval(renderSummary, 30_000); // 1시간이 지난 체결을 합계에서 뺀다
}
