/**
 * 익명 사용 기록. 서비스 개선을 위해 방문·기능 사용·오류·성능을 기록 서버(server/)에 모은다.
 * - 브라우저마다 무작위 방문자 ID만 쓰고, 개인정보·IP는 보내거나 저장하지 않는다
 * - 브라우저의 추적 거부(Do Not Track, GPC) 설정이나 사이트 아래 "수집 끄기"를 누르면 보내지 않는다
 * - 모아서 10초마다, 그리고 페이지를 떠날 때 sendBeacon으로 보낸다
 */

import { HISTORY_API } from './historyApi.ts';

const VISITOR_KEY = 'wallettrack.vid';
const SESSION_KEY = 'wallettrack.sid';
const SESSION_SEEN_KEY = 'wallettrack.sessionSeen';
const FIRST_VISIT_KEY = 'wallettrack.firstVisit';
const VISIT_COUNT_KEY = 'wallettrack.visits';
const OPT_OUT_KEY = 'wallettrack.analyticsOff';
const FLUSH_MS = 10 * 1000;
const PRESENCE_MS = 30 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_QUEUE = 20;
const MAX_ERRORS = 10; // 같은 오류가 반복돼도 세션당 이만큼만

type PropValue = string | number | boolean | null;
type Props = Record<string, PropValue>;

let queue: { n: string; p: Props; t: number }[] = [];
const onceKeys = new Set<string>();
let errorCount = 0;
let visitorId = '';
const sessionId = currentSessionId();
const startedAt = Date.now();
let visibleMs = 0;
let visibleSince: number | null = null;

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만
  }
}

/** 새로고침·여러 탭은 30분 동안 한 번의 방문으로 묶는다. */
function currentSessionId(): string {
  const now = Date.now();
  const saved = storageGet(SESSION_KEY);
  const seen = Number(storageGet(SESSION_SEEN_KEY)) || 0;
  const id = saved && now - seen < SESSION_TTL_MS ? saved : randomId();
  storageSet(SESSION_KEY, id);
  storageSet(SESSION_SEEN_KEY, String(now));
  return id;
}

function touchSession() {
  storageSet(SESSION_SEEN_KEY, String(Date.now()));
}

function doNotTrack(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

export function isAnalyticsEnabled(): boolean {
  return !doNotTrack() && storageGet(OPT_OUT_KEY) !== '1';
}

/** 브라우저 설정으로 막혀 있으면 사이트에서 켤 수 없다 */
export function analyticsBlockedByBrowser(): boolean {
  return doNotTrack();
}

export function setAnalyticsEnabled(enabled: boolean) {
  if (!enabled) {
    track('analytics_off');
    flush(true); // 끈다는 기록까지만 보내고 멈춘다
    sendPresence(false);
    queue = [];
  }
  storageSet(OPT_OUT_KEY, enabled ? '0' : '1');
  if (enabled) track('analytics_on');
}

/** 의견 보내기에도 같은 ID를 쓴다 (어떤 사용 흐름 뒤에 의견을 남겼는지 볼 수 있게) */
export function getVisitorId(): string {
  if (!visitorId) {
    visitorId = storageGet(VISITOR_KEY) || randomId();
    storageSet(VISITOR_KEY, visitorId);
  }
  return visitorId;
}

export function track(name: string, props: Props = {}) {
  if (!isAnalyticsEnabled()) return;
  queue.push({ n: name, p: props, t: Date.now() });
  if (queue.length >= MAX_QUEUE) flush(false);
}

/** 같은 key는 세션에 한 번만 기록 (연결 실패처럼 반복되는 것) */
export function trackOnce(name: string, key: string, props: Props = {}) {
  if (onceKeys.has(`${name}|${key}`)) return;
  onceKeys.add(`${name}|${key}`);
  track(name, props);
}

function flush(leaving: boolean) {
  if (queue.length === 0 || !isAnalyticsEnabled()) return;
  const body = JSON.stringify({ v: getVisitorId(), s: sessionId, events: queue });
  queue = [];
  const url = `${HISTORY_API}/events`;
  // text/plain이면 CORS 사전 요청 없이 보낼 수 있다 (서버는 본문을 JSON으로 읽는다)
  if (leaving && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
  fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {
    // 기록 서버가 꺼져 있으면 버린다
  });
}

function sendPresence(active: boolean) {
  if (active && !isAnalyticsEnabled()) return;
  const body = JSON.stringify({ v: getVisitorId(), s: sessionId, active });
  const url = `${HISTORY_API}/presence`;
  if (!active && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
  fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {
    // 기록 서버가 꺼져 있으면 다음 heartbeat에서 다시 시도한다.
  });
}

function deviceType(): string {
  if (matchMedia('(max-width: 768px)').matches) return 'mobile';
  if (matchMedia('(max-width: 960px)').matches) return 'tablet';
  return 'desktop';
}

function referrerHost(): string | null {
  try {
    const host = document.referrer ? new URL(document.referrer).host : '';
    return host && host !== location.host ? host : null;
  } catch {
    return null;
  }
}

function trackPageView() {
  const firstVisit = Number(storageGet(FIRST_VISIT_KEY)) || 0;
  const visits = (Number(storageGet(VISIT_COUNT_KEY)) || 0) + 1;
  if (!firstVisit) storageSet(FIRST_VISIT_KEY, String(Date.now()));
  storageSet(VISIT_COUNT_KEY, String(visits));

  const params = new URLSearchParams(location.search);
  track('page_view', {
    returning: firstVisit > 0,
    visit_count: visits,
    days_since_first: firstVisit ? Math.floor((Date.now() - firstVisit) / 86_400_000) : 0,
    device: deviceType(),
    vw: innerWidth,
    vh: innerHeight,
    dpr: devicePixelRatio,
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: referrerHost(),
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign')
  });
}

function trackPerformance() {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return;
  track('perf', {
    load_ms: Math.round(nav.loadEventEnd),
    dom_ms: Math.round(nav.domContentLoadedEventEnd),
    ttfb_ms: Math.round(nav.responseStart),
    transfer_kb: Math.round(nav.transferSize / 1024)
  });
}

function trackError(message: string, file: string, line: number) {
  if (errorCount++ >= MAX_ERRORS) return;
  track('js_error', { message: message.slice(0, 200), file: file.split('/').pop()?.split('?')[0] || '', line });
}

function updateVisibleTime() {
  const now = Date.now();
  if (visibleSince !== null) visibleMs += now - visibleSince;
  visibleSince = document.visibilityState === 'visible' ? now : null;
}

interface VisitorCounts {
  total: number;
  today: number;
  todayVisits: number;
  online: number;
}

async function loadVisitorCounts() {
  const today = document.getElementById('visitor-today');
  const todayVisits = document.getElementById('visitor-today-visits');
  const online = document.getElementById('visitor-online');
  const total = document.getElementById('visitor-total');
  if (!today || !todayVisits || !online || !total) return;
  try {
    const res = await fetch(`${HISTORY_API}/usage/visitors`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json() as VisitorCounts;
    today.textContent = Number(data.today || 0).toLocaleString('ko-KR');
    todayVisits.textContent = Number(data.todayVisits || 0).toLocaleString('ko-KR');
    online.textContent = Number(data.online || 0).toLocaleString('ko-KR');
    total.textContent = Number(data.total || 0).toLocaleString('ko-KR');
  } catch {
    // 통계 서버가 잠시 꺼져 있어도 본 기능에는 영향이 없다.
  }
}

export function initAnalytics() {
  visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  trackPageView();
  touchSession();
  flush(false); // 첫 방문은 바로 저장해서 통계 반영이 10초 늦지 않게 한다.
  sendPresence(document.visibilityState === 'visible');
  loadVisitorCounts();
  setTimeout(loadVisitorCounts, 2_000);
  setInterval(loadVisitorCounts, 60_000);
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      touchSession();
      sendPresence(true);
    }
  }, PRESENCE_MS);

  addEventListener('error', (e) => trackError(e.message || 'error', e.filename || '', e.lineno || 0));
  addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    trackError(`unhandled: ${reason}`, '', 0);
  });
  if (document.readyState === 'complete') setTimeout(trackPerformance, 0);
  else addEventListener('load', () => setTimeout(trackPerformance, 0));

  document.addEventListener('visibilitychange', () => {
    updateVisibleTime();
    if (document.visibilityState === 'hidden') {
      // 모바일은 페이지를 닫을 때 pagehide가 오지 않을 수 있어 숨겨질 때마다 머문 시간을 남긴다
      track('page_hide', { duration_s: Math.round((Date.now() - startedAt) / 1000), visible_s: Math.round(visibleMs / 1000) });
      flush(true);
      sendPresence(false);
    } else {
      touchSession();
      sendPresence(true);
    }
  });
  setInterval(() => flush(false), FLUSH_MS);
}
