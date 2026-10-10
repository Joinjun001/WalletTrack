/**
 * 거래소별 대형 코인(BTC·ETH·XRP·SOL·DOGE) 체결·강제청산 메시지를 공통 형태로 바꾸는 순수 로직 (DOM 없음, node:test로 테스트).
 * 연결은 btcStreams.ts(웹)와 server/src/bigTrades.ts(수집기)가 맡는다.
 */

export type Exchange = 'binance-futures' | 'binance-spot' | 'bybit' | 'okx' | 'upbit';

export const EXCHANGE_LABELS: Record<Exchange, string> = {
  'binance-futures': '바이낸스 선물',
  'binance-spot': '바이낸스 현물',
  bybit: '바이비트',
  okx: 'OKX',
  upbit: '업비트'
};

/** 대형 체결·강제청산을 코인별로 볼 수 있는 대형 코인. 다섯 거래소(업비트 원화 포함)에 모두 상장돼 있다 */
export const FEED_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE'] as const;
export type FeedCoin = (typeof FEED_COINS)[number];

export function isFeedCoin(v: unknown): v is FeedCoin {
  return (FEED_COINS as readonly unknown[]).includes(v);
}

/** 체결 한 건. side는 시장가로 주문한 쪽(테이커): buy = 시장가 매수. qty = 코인 수량 */
export interface Fill {
  exchange: Exchange;
  coin: FeedCoin;
  side: 'buy' | 'sell';
  qty: number;
  ts: number; // 체결 시각 ms
}

/** 강제청산 한 건. position = 청산된 포지션 */
export interface Liquidation {
  exchange: Exchange;
  coin: FeedCoin;
  position: 'long' | 'short';
  usd: number;
  ts: number;
}

// OKX 무기한 계약 1개 크기 (/api/v5/public/instruments ctVal, 2026-10-10 확인)
const OKX_USDT_CONTRACT: Record<FeedCoin, number> = { BTC: 0.01, ETH: 0.1, XRP: 100, SOL: 1, DOGE: 1000 }; // 코인 수량
const OKX_USD_CONTRACT: Record<FeedCoin, number> = { BTC: 100, ETH: 10, XRP: 10, SOL: 10, DOGE: 10 };      // 코인 마진: 달러

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));
// 메시지는 거래소마다 모양이 달라 느슨하게 다룬다 (필요한 필드는 함수마다 확인)
type Msg = Record<string, any>;

/** 'ETHUSDT' → 'ETH' (대형 코인이 아니면 null) */
export function usdtCoin(symbol: unknown): FeedCoin | null {
  const coin = typeof symbol === 'string' && symbol.endsWith('USDT') ? symbol.slice(0, -4) : null;
  return isFeedCoin(coin) ? coin : null;
}

/** 'ETH-USDT-SWAP' → ETH, 코인 마진('ETH-USD-SWAP')인지 */
function okxSwap(instId: unknown): { coin: FeedCoin; linear: boolean } | null {
  const m = typeof instId === 'string' ? /^([A-Z]+)-(USDT|USD)-SWAP$/.exec(instId) : null;
  return m && isFeedCoin(m[1]) ? { coin: m[1], linear: m[2] === 'USDT' } : null;
}

/** 바이낸스 aggTrade (선물·현물 같은 모양, 묶음 스트림이면 data 안). m = true면 매수자가 메이커 → 시장가 매도 */
export function parseBinanceAggTrade(msg: Msg, exchange: 'binance-futures' | 'binance-spot'): Fill | null {
  const d = msg?.data ?? msg;
  const coin = usdtCoin(d?.s);
  if (d?.e !== 'aggTrade' || !coin) return null;
  const qty = num(d.q);
  if (!(qty > 0)) return null;
  return { exchange, coin, side: d.m ? 'sell' : 'buy', qty, ts: num(d.T) };
}

/** 바이비트 publicTrade.{코인}USDT. S = 테이커 방향 */
export function parseBybitTrades(msg: Msg): Fill[] {
  const coin = typeof msg?.topic === 'string' && msg.topic.startsWith('publicTrade.') ? usdtCoin(msg.topic.slice(12)) : null;
  if (!coin || !Array.isArray(msg.data)) return [];
  return msg.data
    .map((t: Msg): Fill => ({ exchange: 'bybit', coin, side: t.S === 'Sell' ? 'sell' : 'buy', qty: num(t.v), ts: num(t.T) }))
    .filter((f: Fill) => f.qty > 0);
}

/** OKX trades {코인}-USDT-SWAP. sz는 계약 수 (소수 가능) */
export function parseOkxTrades(msg: Msg): Fill[] {
  if (msg?.arg?.channel !== 'trades' || !Array.isArray(msg.data)) return [];
  const out: Fill[] = [];
  for (const t of msg.data) {
    const swap = okxSwap(t.instId);
    if (!swap?.linear) continue;
    const qty = num(t.sz) * OKX_USDT_CONTRACT[swap.coin];
    if (qty > 0) out.push({ exchange: 'okx', coin: swap.coin, side: t.side === 'sell' ? 'sell' : 'buy', qty, ts: num(t.ts) });
  }
  return out;
}

/** 업비트 trade KRW-{코인}. ask_bid: BID = 매수 체결, ASK = 매도 체결 */
export function parseUpbitTrade(msg: Msg): Fill | null {
  const coin = typeof msg?.code === 'string' ? msg.code.replace(/^KRW-/, '') : null;
  if (msg?.type !== 'trade' || !msg.code.startsWith('KRW-') || !isFeedCoin(coin)) return null;
  const qty = num(msg.trade_volume);
  if (!(qty > 0)) return null;
  return { exchange: 'upbit', coin, side: msg.ask_bid === 'BID' ? 'buy' : 'sell', qty, ts: num(msg.trade_timestamp) };
}

/** 바이비트 allLiquidation.{코인}USDT. 문서: S = Buy면 롱 포지션이 청산된 것 */
export function parseBybitLiquidations(msg: Msg): Liquidation[] {
  const coin = typeof msg?.topic === 'string' && msg.topic.startsWith('allLiquidation.') ? usdtCoin(msg.topic.slice(15)) : null;
  if (!coin || !Array.isArray(msg.data)) return [];
  return msg.data
    .map((l: Msg): Liquidation => ({ exchange: 'bybit', coin, position: l.S === 'Buy' ? 'long' : 'short', usd: num(l.v) * num(l.p), ts: num(l.T) }))
    .filter((l: Liquidation) => l.usd > 0);
}

/** OKX liquidation-orders (전체 무기한). 대형 코인만 고른다. side = 청산 주문 방향: sell이면 롱이 청산된 것 */
export function parseOkxLiquidations(msg: Msg): Liquidation[] {
  if (msg?.arg?.channel !== 'liquidation-orders' || !Array.isArray(msg.data)) return [];
  const out: Liquidation[] = [];
  for (const item of msg.data) {
    const swap = okxSwap(item.instId);
    if (!swap) continue;
    for (const d of item.details ?? []) {
      const sz = num(d.sz);
      const usd = swap.linear ? sz * OKX_USDT_CONTRACT[swap.coin] * num(d.bkPx) : sz * OKX_USD_CONTRACT[swap.coin];
      if (usd > 0) out.push({ exchange: 'okx', coin: swap.coin, position: d.side === 'sell' ? 'long' : 'short', usd, ts: num(d.ts) });
    }
  }
  return out;
}

/** 큰 시장가 주문은 여러 체결로 쪼개져 오므로, 거래소·코인별로 같은 방향 체결을 잠깐 모아 주문 하나로 본다 */
export interface MergedTrade {
  exchange: Exchange;
  coin: FeedCoin;
  side: 'buy' | 'sell';
  qty: number;
  ts: number; // 첫 체결 시각
}

export class TradeMerger {
  private pending = new Map<string, MergedTrade & { touchedAt: number }>(); // 키: 거래소|코인
  private windowMs: number;
  private emit: (trade: MergedTrade) => void;

  constructor(windowMs: number, emit: (trade: MergedTrade) => void) {
    this.windowMs = windowMs;
    this.emit = emit;
  }

  /** now: 받은 시각 (조용해지면 내보낼 때 쓴다) */
  add(fill: Fill, now: number) {
    const key = `${fill.exchange}|${fill.coin}`;
    const p = this.pending.get(key);
    if (p && (p.side !== fill.side || fill.ts - p.ts > this.windowMs)) this.flushOne(key);
    const cur = this.pending.get(key);
    if (cur) {
      cur.qty += fill.qty;
      cur.touchedAt = now;
    } else {
      this.pending.set(key, { exchange: fill.exchange, coin: fill.coin, side: fill.side, qty: fill.qty, ts: fill.ts, touchedAt: now });
    }
  }

  /** windowMs 동안 새 체결이 없던 묶음을 내보낸다 */
  flushIdle(now: number) {
    for (const [key, p] of this.pending) {
      if (now - p.touchedAt >= this.windowMs) this.flushOne(key);
    }
  }

  private flushOne(key: string) {
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    this.emit({ exchange: p.exchange, coin: p.coin, side: p.side, qty: p.qty, ts: p.ts });
  }
}
