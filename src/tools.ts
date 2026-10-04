/**
 * 사이드 도구: BTC ↔ 사토시 ↔ 원화 ↔ 달러 환산 계산기, BTC 원화 가격 알림, 김프 알림, 고래(대형 체결) 알림 (브라우저 알림 + 화면 토스트)
 */

import { prices, subscribePrices } from './priceStore.ts';
import { alertDirection, formatKrw, formatSignedPct, isThresholdCrossed, kimchiPremium } from './market.ts';
import type { PriceAlert } from './market.ts';
import { onBtcTrade } from './btcStreams.ts';
import { EXCHANGE_LABELS } from './exchangeFeeds.ts';
import { track, trackOnce } from './analytics.ts';

const SATS_PER_BTC = 100_000_000;
const ALERTS_KEY = 'wallettrack.priceAlerts';
const KIMCHI_ALERTS_KEY = 'wallettrack.kimchiAlerts';
const WHALE_ALERT_KEY = 'wallettrack.whaleAlertBtc';
const WHALE_ALERT_GAP_MS = 10 * 1000; // 고래 알림은 10초에 한 번까지 (작은 기준값이면 너무 자주 온다)

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
      trackOnce('calc_use', unit, { unit });
      anchor = { unit, value: parseNumber(input.value) };
      recalc();
    });
  }
  const btcInput = document.getElementById('calc-btc') as HTMLInputElement | null;
  if (btcInput) btcInput.value = '1';
  recalc();
  subscribePrices(recalc);
}

// ---------- 가격·김프 알림 ----------

interface AlertCardConfig {
  kind: 'price' | 'kimchi';             // 사용 기록용
  storageKey: string;
  formId: string;
  inputId: string;
  listId: string;
  title: string;                        // 브라우저 알림 제목
  current: () => number | null;         // 아직 모르면 null
  parse: (text: string) => number | null;
  format: (value: number) => string;
  describe: (alert: PriceAlert, value: number) => string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

function notify(title: string, message: string) {
  showToast(`🔔 ${message}`);
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body: message });
}

// 알림 권한은 사용자가 버튼을 누르는 등 직접 조작한 시점에만 요청할 수 있다
function requestNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().then((permission) => track('notification_permission', { permission }));
}

/** 목표값을 등록해 두고, 값이 등록 시점 기준 방향으로 목표를 넘으면 한 번 알리고 지운다 */
function initAlertCard(cfg: AlertCardConfig) {
  const stored = loadJson<unknown>(cfg.storageKey, []);
  // 저장된 값이 깨졌거나 형식이 다르면 버린다 (화면에 그대로 그리므로 숫자·방향만 받는다)
  let alerts: PriceAlert[] = (Array.isArray(stored) ? stored : []).filter((a): a is PriceAlert =>
    !!a && typeof a === 'object' && typeof a.id === 'string' && Number.isFinite(a.target) && (a.direction === 'above' || a.direction === 'below'));
  const form = document.getElementById(cfg.formId) as HTMLFormElement | null;
  const input = document.getElementById(cfg.inputId) as HTMLInputElement | null;

  const render = () => {
    const list = document.getElementById(cfg.listId);
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
        <strong>${cfg.format(alert.target)}</strong>
        <button class="alert-remove" aria-label="알림 삭제">×</button>`;
      li.querySelector('button')?.addEventListener('click', () => {
        alerts = alerts.filter((a) => a.id !== alert.id);
        saveJson(cfg.storageKey, alerts);
        render();
        track('alert_remove', { kind: cfg.kind });
      });
      list.appendChild(li);
    }
  };

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input) return;
    const target = cfg.parse(input.value);
    if (target === null) return;
    const current = cfg.current();
    if (current === null) {
      showToast('시세를 받아오는 중이에요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    const direction = alertDirection(target, current);
    alerts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, target, direction });
    saveJson(cfg.storageKey, alerts);
    render();
    form.reset();
    track('alert_add', { kind: cfg.kind, target, current, direction, count: alerts.length, permission: 'Notification' in window ? Notification.permission : 'unsupported' });
    requestNotificationPermission();
  });

  subscribePrices(() => {
    const value = cfg.current();
    if (value === null) return;
    // 입력 칸 안내 문구로 현재 값을 보여준다
    if (input) input.placeholder = `현재 ${cfg.format(value)}`;
    const fired = alerts.filter((a) => isThresholdCrossed(a, value));
    if (fired.length === 0) return;
    alerts = alerts.filter((a) => !fired.includes(a));
    saveJson(cfg.storageKey, alerts);
    render();
    for (const alert of fired) {
      notify(cfg.title, cfg.describe(alert, value));
      track('alert_fired', { kind: cfg.kind, target: alert.target, direction: alert.direction });
    }
  });
  render();
}

function initAlerts() {
  initAlertCard({
    kind: 'price',
    storageKey: ALERTS_KEY,
    formId: 'alert-form',
    inputId: 'alert-price',
    listId: 'alert-list',
    title: '가격 알림',
    current: () => (prices.krwBtc > 0 ? prices.krwBtc : null),
    parse: (text) => {
      const v = parseNumber(text);
      return v > 0 ? v : null;
    },
    format: formatKrw,
    describe: (a, v) => `BTC가 ${formatKrw(a.target)} ${a.direction === 'above' ? '이상으로 올랐어요' : '이하로 내렸어요'} (현재 ${formatKrw(v)})`
  });

  initAlertCard({
    kind: 'kimchi',
    storageKey: KIMCHI_ALERTS_KEY,
    formId: 'kimchi-alert-form',
    inputId: 'kimchi-alert-input',
    listId: 'kimchi-alert-list',
    title: '김프 알림',
    current: () => kimchiPremium(prices.krwBtc, prices.usdBtc, prices.krwUsdt),
    parse: (text) => {
      const v = parseFloat(text.replace(/[%\s]/g, ''));
      return Number.isFinite(v) && Math.abs(v) < 100 ? v : null;
    },
    format: formatSignedPct,
    describe: (a, v) => `BTC 김프가 ${formatSignedPct(a.target)} ${a.direction === 'above' ? '이상으로 올랐어요' : '이하로 내렸어요'} (현재 ${formatSignedPct(v)})`
  });
}

// ---------- 고래 알림 (BTC 대형 체결) ----------

function initWhaleAlert() {
  const select = document.getElementById('whale-alert-threshold') as HTMLSelectElement | null;
  if (!select) return;
  let threshold = Number(loadJson<unknown>(WHALE_ALERT_KEY, 0)) || 0;
  if ([...select.options].some((o) => Number(o.value) === threshold)) select.value = String(threshold);
  else threshold = 0;

  select.addEventListener('change', () => {
    threshold = Number(select.value) || 0;
    saveJson(WHALE_ALERT_KEY, threshold);
    track('whale_alert_set', { btc: threshold });
    if (threshold > 0) requestNotificationPermission();
  });

  let lastNotifiedAt = 0;
  onBtcTrade((t) => {
    if (!(threshold > 0) || t.btc < threshold) return;
    const now = Date.now();
    if (now - lastNotifiedAt < WHALE_ALERT_GAP_MS) return;
    lastNotifiedAt = now;
    const krw = prices.krwBtc > 0 ? ` (약 ${formatKrw(t.btc * prices.krwBtc)})` : '';
    track('whale_alert_fired', { btc: threshold });
    notify('고래 체결', `🐋 ${EXCHANGE_LABELS[t.exchange]} ${t.btc.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} BTC ${t.side === 'buy' ? '매수' : '매도'}${krw}`);
  });
}

export function showToast(message: string) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = 'toast glass-panel';
  toast.textContent = message;
  root.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

export function initTools() {
  initCalculator();
  initAlerts();
  initWhaleAlert();
}
