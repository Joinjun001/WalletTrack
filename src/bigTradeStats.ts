/**
 * 대형 체결(1 BTC 이상) 1분 합계 — 수집기가 실시간 체결과 거래소 과거 파일 모두에 쓰는 순수 로직 (DOM 없음, node:test로 테스트).
 * 체결을 주문 단위로 묶는 건 실시간과 같은 TradeMerger(exchangeFeeds.ts)를 쓴다.
 */

import type { Exchange, Fill, MergedTrade } from './exchangeFeeds.ts';

export const BIG_TRADE_MIN_BTC = 1;
const MINUTE_MS = 60_000;

export interface MinuteRow {
  minute: number; // 분 시작 시각 ms (UTC)
  exchange: Exchange;
  buyBtc: number;
  sellBtc: number;
  buyCount: number;
  sellCount: number;
}

/** 거래소·분별 매수·매도 합계. 1 BTC 미만 주문은 버린다 */
export class MinuteSums {
  private rows = new Map<string, MinuteRow>();

  add(t: MergedTrade) {
    if (t.btc < BIG_TRADE_MIN_BTC) return;
    const minute = Math.floor(t.ts / MINUTE_MS) * MINUTE_MS;
    const key = `${minute}|${t.exchange}`;
    let row = this.rows.get(key);
    if (!row) {
      row = { minute, exchange: t.exchange, buyBtc: 0, sellBtc: 0, buyCount: 0, sellCount: 0 };
      this.rows.set(key, row);
    }
    if (t.side === 'buy') {
      row.buyBtc += t.btc;
      row.buyCount++;
    } else {
      row.sellBtc += t.btc;
      row.sellCount++;
    }
  }

  /** before(ms) 이전에 끝난 분을 꺼낸다 (아직 진행 중인 분은 남긴다). before가 없으면 전부 */
  take(before = Infinity): MinuteRow[] {
    const out: MinuteRow[] = [];
    for (const [key, row] of this.rows) {
      if (row.minute + MINUTE_MS <= before) {
        out.push(row);
        this.rows.delete(key);
      }
    }
    return out;
  }
}

// ---------- 거래소 과거 체결 파일 한 줄 ----------

/**
 * 바이낸스 aggTrades CSV (data.binance.vision): id,price,qty,firstId,lastId,time,isBuyerMaker[,isBestMatch]
 * 선물은 첫 줄이 머리글이고 시각이 ms, 현물은 머리글이 없고 시각이 µs(2025년부터)다. true/True 둘 다 온다.
 */
export function parseBinanceAggTradeCsv(line: string, exchange: 'binance-futures' | 'binance-spot'): Fill | null {
  const c = line.split(',');
  const btc = parseFloat(c[2]);
  let ts = Number(c[5]);
  if (!(btc > 0) || !Number.isFinite(ts)) return null; // 머리글·빈 줄
  if (ts > 1e14) ts = Math.floor(ts / 1000); // µs → ms
  const buyerMaker = c[6]?.toLowerCase() === 'true';
  return { exchange, side: buyerMaker ? 'sell' : 'buy', btc, ts };
}

/** 바이비트 체결 CSV (public.bybit.com/trading): timestamp(초, 소수),symbol,side,size,... */
export function parseBybitCsv(line: string): Fill | null {
  const c = line.split(',');
  const ts = parseFloat(c[0]);
  const btc = parseFloat(c[3]);
  if (c[1] !== 'BTCUSDT' || !(btc > 0) || !Number.isFinite(ts)) return null;
  return { exchange: 'bybit', side: c[2] === 'Sell' ? 'sell' : 'buy', btc, ts: Math.round(ts * 1000) };
}

/** 업비트 체결 조회 API(/v1/trades/ticks) 한 건 */
export function parseUpbitTick(t: { timestamp?: number; trade_volume?: number; ask_bid?: string }): Fill | null {
  const btc = Number(t.trade_volume);
  const ts = Number(t.timestamp);
  if (!(btc > 0) || !Number.isFinite(ts)) return null;
  return { exchange: 'upbit', side: t.ask_bid === 'BID' ? 'buy' : 'sell', btc, ts };
}
