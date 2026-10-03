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

export interface WhaleFlow {
  hours: number;
  depositBtc: number;
  withdrawalBtc: number;
  depositCount: number;
  withdrawalCount: number;
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

/**
 * 업비트 시세는 서버 중계(/api/upbit/...)로 받는다. 업비트가 브라우저 요청을 출처별로 아주 적게만 받아서
 * 직접 부르면 페이지를 열 때 429로 막히기 쉽다. 서버가 응답하지 않을 때만 업비트에 직접 요청한다.
 */
export async function getUpbit<T>(serverPath: string, directUrl: string): Promise<T | null> {
  const viaServer = await getHistory<T>(serverPath);
  if (viaServer !== null) return viaServer;
  try {
    const res = await fetch(directUrl);
    if (res.ok) return (await res.json()) as T;
    trackOnce('api_fail', `upbit:${res.status}`, { source: 'upbit', status: res.status, path: serverPath.split('?')[0] });
    return null;
  } catch (e) {
    console.warn(`Upbit ${directUrl} failed:`, e);
    return null;
  }
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
