/**
 * Shared live prices. Price sources write here; panels subscribe and re-render.
 */

export interface Prices {
  usdBtc: number;        // Binance BTCUSDT (fallback: mempool.space USD)
  usdChangePct: number | null; // Binance 24h rolling change (%)
  krwBtc: number;        // Upbit KRW-BTC
  krwChangePct: number | null; // Upbit 전일 대비 (KST 09:00 기준, %)
  krwHigh: number;       // Upbit 당일 고가
  krwLow: number;        // Upbit 당일 저가
  krwUsdt: number;       // Upbit KRW-USDT
}

export const prices: Prices = {
  usdBtc: 0,
  usdChangePct: null,
  krwBtc: 0,
  krwChangePct: null,
  krwHigh: 0,
  krwLow: 0,
  krwUsdt: 0
};

type Listener = (p: Prices) => void;
const listeners: Listener[] = [];

export function subscribePrices(fn: Listener) {
  listeners.push(fn);
}

export function updatePrices(patch: Partial<Prices>) {
  Object.assign(prices, patch);
  for (const fn of listeners) fn(prices);
}
