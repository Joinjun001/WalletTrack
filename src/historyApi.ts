/**
 * 기록 API 서버(server/)에서 지난 기록을 받는다.
 * 서버가 꺼져 있거나 느리면 null을 돌려주고, 화면은 지금처럼 실시간 데이터만 보여준다.
 */

const HISTORY_API = 'https://bittrack.duckdns.org/api';
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

export async function getHistory<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${HISTORY_API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch (e) {
    console.warn(`History API ${path} failed:`, e);
    return null;
  }
}
