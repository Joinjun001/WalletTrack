/**
 * 대형 체결 1분 합계 — 수집기가 실시간 체결과 거래소 과거 파일 모두에 쓰는 순수 로직 (DOM 없음, node:test로 테스트).
 * 체결을 주문 단위로 묶는 건 실시간과 같은 TradeMerger(exchangeFeeds.ts)를 쓴다.
 */

import type { Exchange, FeedCoin, Fill, MergedTrade } from './exchangeFeeds.ts';

/**
 * 코인별 대형 체결 최소 수량. BTC 1개 가치(2026-10 약 $83K)에 맞췄다. 웹 필터는 이 값의 1·5·10·50배.
 * 바꾸면 서버에 이미 쌓인 합계와 기준이 달라지므로 바꾸지 않는다.
 */
export const BIG_TRADE_MIN: Record<FeedCoin, number> = { BTC: 1, ETH: 30, XRP: 60_000, SOL: 700, DOGE: 1_000_000 };
const MINUTE_MS = 60_000;

export interface MinuteRow {
  minute: number; // 분 시작 시각 ms (UTC)
  exchange: Exchange;
  coin: FeedCoin;
  buyQty: number; // 코인 수량
  sellQty: number;
  buyCount: number;
  sellCount: number;
}

/** 거래소·코인·분별 매수·매도 합계. 코인별 최소 수량 미만 주문은 버린다 */
export class MinuteSums {
  private rows = new Map<string, MinuteRow>();

  add(t: MergedTrade) {
    if (t.qty < BIG_TRADE_MIN[t.coin]) return;
    const minute = Math.floor(t.ts / MINUTE_MS) * MINUTE_MS;
    const key = `${minute}|${t.exchange}|${t.coin}`;
    let row = this.rows.get(key);
    if (!row) {
      row = { minute, exchange: t.exchange, coin: t.coin, buyQty: 0, sellQty: 0, buyCount: 0, sellCount: 0 };
      this.rows.set(key, row);
    }
    if (t.side === 'buy') {
      row.buyQty += t.qty;
      row.buyCount++;
    } else {
      row.sellQty += t.qty;
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
export function parseBinanceAggTradeCsv(line: string, exchange: 'binance-futures' | 'binance-spot', coin: FeedCoin): Fill | null {
  const c = line.split(',');
  const qty = parseFloat(c[2]);
  let ts = Number(c[5]);
  if (!(qty > 0) || !Number.isFinite(ts)) return null; // 머리글·빈 줄
  if (ts > 1e14) ts = Math.floor(ts / 1000); // µs → ms
  const buyerMaker = c[6]?.toLowerCase() === 'true';
  return { exchange, coin, side: buyerMaker ? 'sell' : 'buy', qty, ts };
}

/** 바이비트 체결 CSV (public.bybit.com/trading): timestamp(초, 소수),symbol,side,size,... */
export function parseBybitCsv(line: string, coin: FeedCoin): Fill | null {
  const c = line.split(',');
  const ts = parseFloat(c[0]);
  const qty = parseFloat(c[3]);
  if (c[1] !== `${coin}USDT` || !(qty > 0) || !Number.isFinite(ts)) return null;
  return { exchange: 'bybit', coin, side: c[2] === 'Sell' ? 'sell' : 'buy', qty, ts: Math.round(ts * 1000) };
}

/** 업비트 체결 조회 API(/v1/trades/ticks) 한 건 */
export function parseUpbitTick(t: { timestamp?: number; trade_volume?: number; ask_bid?: string }, coin: FeedCoin): Fill | null {
  const qty = Number(t.trade_volume);
  const ts = Number(t.timestamp);
  if (!(qty > 0) || !Number.isFinite(ts)) return null;
  return { exchange: 'upbit', coin, side: t.ask_bid === 'BID' ? 'buy' : 'sell', qty, ts };
}
