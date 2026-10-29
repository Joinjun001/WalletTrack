/**
 * 기록 API 서버(server/)에서 지난 기록을 받는다.
 * 서버가 꺼져 있거나 느리면 null을 돌려주고, 화면은 지금처럼 실시간 데이터만 보여준다.
 */

import { trackOnce } from './analytics.ts';

export const HISTORY_API = 'https://bittrack.duckdns.org/api';
const TIMEOUT_MS = 5000;

export interface WhaleRecord {
  hash: string;
  btcAmount: number;
  direction: 'deposit' | 'withdrawal' | 'transfer';
  exchangeAddress: string | null;
  detectedAt: number; // ms
}

export interface LiquidationRecord {
  symbol: string;
  position: 'long' | 'short';
  usd: number;
  occurredAt: number; // ms
}

export interface LiquidationSummary {
  hours: number;
  longUsd: number;
  shortUsd: number;
}

export interface LiquidationBySymbol {
  symbol: string;
  longUsd: number;
  shortUsd: number;
}

/** 캔들 구간별 청산 합계 (차트 표시) */
export interface LiquidationBucket {
  t: number; // 구간 시작 ms
  longUsd: number;
  shortUsd: number;
}

/** 캔들 구간별 고래 거래소 입출금 합계 (차트 표시) */
export interface WhaleBucket {
  t: number;
  depositBtc: number;
  withdrawalBtc: number;
}

/** 급등·급락 기록 (/api/surges) */
export interface SurgeRecord {
  market: string;
  direction: 'up' | 'down';
  pct: number;
  from: number;
  price: number;
  volumeKrw: number;
  detectedAt: number;
}

export interface WhaleFlow {
  hours: number;
  depositBtc: number;
  withdrawalBtc: number;
  depositCount: number;
  withdrawalCount: number;
}

/** 대형 체결 기간 합계 (코인 하나). buyBtc·sellBtc는 예전 이름 그대로이고 값은 그 코인 수량. since: 거래소별 기록 시작 시각(ms) */
export interface BigTradeSummary {
  hours: number;
  until: number; // 합계에 들어간 마지막 시각(ms, 미포함). 이후 체결은 웹이 실시간으로 더한다
  buyBtc: number;
  sellBtc: number;
  buyCount: number;
  sellCount: number;
  since: Record<string, number>;
  missingDays: Record<string, string[]>; // 아직 못 채운 날 (YYYY-MM-DD, UTC). 거래소가 다음 날 파일을 올리면 채워진다
}

export interface KimchiPoint {
  t: number; // ms
  premiumPct: number;
}

export interface FuturesPoint {
  t: number; // ms
  fundingRate: number | null;
  openInterest: number | null; // 코인 수량
  markPrice: number | null;
  longRatio: number | null;    // 0~1
}

/** 업비트 서버 경로를 같은 출처의 Vercel 폴백 함수 주소로 바꾼다. */
function upbitFallbackPath(serverPath: string): string {
  const [path, search = ''] = serverPath.split('?', 2);
  const kind = path.split('/').pop() || '';
  const params = new URLSearchParams(search);
  params.set('kind', kind);
  return `/api/upbit?${params}`;
}

async function fetchJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

/**
 * 업비트 REST는 브라우저에서 직접 호출하면 CORS로 막힌다. 같은 출처 Vercel 폴백을 먼저 쓰고,
 * 로컬 개발이나 Vercel 장애 때만 OCI 중계로 넘어간다.
 */
export async function getUpbit<T>(serverPath: string, directUrl: string): Promise<T | null> {
  const viaFallback = await fetchJson<T>(upbitFallbackPath(serverPath));
  if (viaFallback !== null) return viaFallback;
  const viaServer = await getHistory<T>(serverPath);
  if (viaServer !== null) return viaServer;
  trackOnce('api_fail', `upbit-proxies:${serverPath.split('?')[0]}`, { source: 'upbit', status: 0, path: serverPath.split('?')[0] });
  console.warn(`Upbit proxies failed: ${directUrl}`);
  return null;
}

export async function getHistory<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${HISTORY_API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return (await res.json()) as T;
    trackOnce('api_fail', `history:${res.status}`, { source: 'history', status: res.status, path: path.split('?')[0] });
    return null;
  } catch (e) {
    console.warn(`History API ${path} failed:`, e);
    trackOnce('api_fail', 'history:network', { source: 'history', status: 0, path: path.split('?')[0] });
    return null;
  }
}
