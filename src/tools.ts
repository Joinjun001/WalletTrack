/**
 * 사이드 도구: BTC ↔ 사토시 ↔ 원화 ↔ 달러 환산 계산기, BTC 원화 가격 알림 (브라우저 알림 + 화면 토스트)
 */

import { prices, subscribePrices } from './priceStore.ts';
import { alertDirection, formatKrw, isAlertTriggered } from './market.ts';
import type { PriceAlert } from './market.ts';

const SATS_PER_BTC = 100_000_000;
const ALERTS_KEY = 'wallettrack.priceAlerts';

// ---------- 환산 계산기 ----------

type Unit = 'btc' | 'sats' | 'krw' | 'usd';
const UNITS: Unit[] = ['btc', 'sats', 'krw', 'usd'];

/** 마지막으로 입력한 칸을 기준으로, 시세가 바뀌면 나머지 칸을 다시 계산한다 */
let anchor: { unit: Unit; value: number } = { unit: 'btc', value: 1 };

function parseNumber(text: string): number {
  return parseFloat(text.replace(/,/g, ''));
}

function toBtc(unit: Unit, value: number): number | null {
  switch (unit) {
    case 'btc': return value;
    case 'sats': return value / SATS_PER_BTC;
    case 'krw': return prices.krwBtc > 0 ? value / prices.krwBtc : null;
    case 'usd': return prices.usdBtc > 0 ? value / prices.usdBtc : null;
  }
}

function formatUnit(unit: Unit, btc: number): string | null {
  switch (unit) {
    case 'btc': return String(Number(btc.toFixed(8)));
    case 'sats': return Math.round(btc * SATS_PER_BTC).toLocaleString('en-US');
    case 'krw': return prices.krwBtc > 0 ? Math.round(btc * prices.krwBtc).toLocaleString('ko-KR') : null;
    case 'usd': return prices.usdBtc > 0 ? (btc * prices.usdBtc).toLocaleString('en-US', { maximumFractionDigits: 2 }) : null;
  }
}

function recalc() {
  const btc = toBtc(anchor.unit, anchor.value);
  for (const unit of UNITS) {
    if (unit === anchor.unit) continue;
    const input = document.getElementById(`calc-${unit}`) as HTMLInputElement | null;
    if (!input) continue;
    input.value = btc === null || isNaN(btc) ? '' : (formatUnit(unit, btc) ?? '');
  }
}

function initCalculator() {
  for (const unit of UNITS) {
    const input = document.getElementById(`calc-${unit}`) as HTMLInputElement | null;
    input?.addEventListener('input', () => {
      anchor = { unit, value: parseNumber(input.value) };
      recalc();
    });
  }
  const btcInput = document.getElementById('calc-btc') as HTMLInputElement | null;
  if (btcInput) btcInput.value = '1';
  recalc();
  subscribePrices(recalc);
}

// ---------- 가격 알림 ----------

let alerts: PriceAlert[] = loadAlerts();

function loadAlerts(): PriceAlert[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAlerts() {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

function renderAlerts() {
  const list = document.getElementById('alert-list');
  if (!list) return;
  list.innerHTML = '';
  if (alerts.length === 0) {
    list.innerHTML = '<li class="alert-empty">등록된 알림이 없어요</li>';
    return;
  }
  for (const alert of alerts) {
    const li = document.createElement('li');
    li.className = 'alert-item';
    li.innerHTML = `
      <span class="${alert.direction === 'above' ? 'up' : 'down'}">${alert.direction === 'above' ? '▲ 이상' : '▼ 이하'}</span>
      <strong>${formatKrw(alert.target)}</strong>
      <button class="alert-remove" aria-label="알림 삭제">×</button>`;
    li.querySelector('button')?.addEventListener('click', () => {
      alerts = alerts.filter((a) => a.id !== alert.id);
      saveAlerts();
      renderAlerts();
    });
    list.appendChild(li);
  }
}

function addAlert(form: HTMLFormElement, input: HTMLInputElement) {
  const target = parseNumber(input.value);
  if (!(target > 0)) return;
  if (!(prices.krwBtc > 0)) {
    showToast('시세를 받아오는 중이에요. 잠시 후 다시 시도해 주세요.');
    return;
  }
  alerts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, target, direction: alertDirection(target, prices.krwBtc) });
  saveAlerts();
  renderAlerts();
  form.reset();

  // 알림 권한은 사용자가 버튼을 누른 이 시점에만 요청할 수 있다
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function checkAlerts() {
  const price = prices.krwBtc;
  const fired = alerts.filter((a) => isAlertTriggered(a, price));
  if (fired.length === 0) return;
  alerts = alerts.filter((a) => !fired.includes(a));
  saveAlerts();
  renderAlerts();
  for (const alert of fired) {
    const message = `BTC가 ${formatKrw(alert.target)} ${alert.direction === 'above' ? '이상으로 올랐어요' : '이하로 내렸어요'} (현재 ${formatKrw(price)})`;
    showToast(`🔔 ${message}`);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('가격 알림', { body: message });
  }
}

function showToast(message: string) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = 'toast glass-panel';
  toast.textContent = message;
  root.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function initAlerts() {
  const form = document.getElementById('alert-form') as HTMLFormElement | null;
  const input = document.getElementById('alert-price') as HTMLInputElement | null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input) addAlert(form, input);
  });
  // 입력 칸 안내 문구로 현재가를 보여준다
  subscribePrices((p) => {
    if (input && p.krwBtc > 0) input.placeholder = `현재 ${Math.round(p.krwBtc).toLocaleString('ko-KR')}`;
  });
  renderAlerts();
  subscribePrices(checkAlerts);
}

export function initTools() {
  initCalculator();
  initAlerts();
}
