/**
 * 거래소별 비트코인 체결·강제청산 메시지를 공통 형태로 바꾸는 순수 로직 (DOM 없음, node:test로 테스트).
 * 연결은 btcStreams.ts가 맡는다.
 */

export type Exchange = 'binance-futures' | 'binance-spot' | 'bybit' | 'okx' | 'upbit';

export const EXCHANGE_LABELS: Record<Exchange, string> = {
  'binance-futures': '바이낸스 선물',
  'binance-spot': '바이낸스 현물',
  bybit: '바이비트',
  okx: 'OKX',
  upbit: '업비트'
};

/** 체결 한 건. side는 시장가로 주문한 쪽(테이커): buy = 시장가 매수 */
export interface Fill {
  exchange: Exchange;
  side: 'buy' | 'sell';
  btc: number;
  ts: number; // 체결 시각 ms
}

/** 강제청산 한 건. position = 청산된 포지션 */
export interface BtcLiquidation {
  exchange: Exchange;
  position: 'long' | 'short';
  usd: number;
  ts: number;
}

const OKX_BTC_USDT_CONTRACT_BTC = 0.01; // BTC-USDT-SWAP 계약 1개 = 0.01 BTC (ctVal)
const OKX_BTC_USD_CONTRACT_USD = 100;   // BTC-USD-SWAP(코인 마진) 계약 1개 = 100달러

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));
// 메시지는 거래소마다 모양이 달라 느슨하게 다룬다 (필요한 필드는 함수마다 확인)
type Msg = Record<string, any>;

/** 바이낸스 aggTrade (선물·현물 같은 모양). m = true면 매수자가 메이커 → 시장가 매도 */
export function parseBinanceAggTrade(msg: Msg, exchange: 'binance-futures' | 'binance-spot'): Fill | null {
  if (msg?.e !== 'aggTrade' || msg.s !== 'BTCUSDT') return null;
  const btc = num(msg.q);
  if (!(btc > 0)) return null;
  return { exchange, side: msg.m ? 'sell' : 'buy', btc, ts: num(msg.T) };
}

/** 바이비트 publicTrade.BTCUSDT. S = 테이커 방향 */
export function parseBybitTrades(msg: Msg): Fill[] {
  if (msg?.topic !== 'publicTrade.BTCUSDT' || !Array.isArray(msg.data)) return [];
  return msg.data
    .map((t: Msg): Fill => ({ exchange: 'bybit', side: t.S === 'Sell' ? 'sell' : 'buy', btc: num(t.v), ts: num(t.T) }))
    .filter((f: Fill) => f.btc > 0);
}

/** OKX trades BTC-USDT-SWAP. sz는 계약 수 (소수 가능) */
export function parseOkxTrades(msg: Msg): Fill[] {
  if (msg?.arg?.channel !== 'trades' || !Array.isArray(msg.data)) return [];
  return msg.data
    .filter((t: Msg) => t.instId === 'BTC-USDT-SWAP')
    .map((t: Msg): Fill => ({ exchange: 'okx', side: t.side === 'sell' ? 'sell' : 'buy', btc: num(t.sz) * OKX_BTC_USDT_CONTRACT_BTC, ts: num(t.ts) }))
    .filter((f: Fill) => f.btc > 0);
}

/** 업비트 trade KRW-BTC. ask_bid: BID = 매수 체결, ASK = 매도 체결 */
export function parseUpbitTrade(msg: Msg): Fill | null {
  if (msg?.type !== 'trade' || msg.code !== 'KRW-BTC') return null;
  const btc = num(msg.trade_volume);
  if (!(btc > 0)) return null;
  return { exchange: 'upbit', side: msg.ask_bid === 'BID' ? 'buy' : 'sell', btc, ts: num(msg.trade_timestamp) };
}

/** 바이비트 allLiquidation.BTCUSDT. 문서: S = Buy면 롱 포지션이 청산된 것 */
export function parseBybitLiquidations(msg: Msg): BtcLiquidation[] {
  if (msg?.topic !== 'allLiquidation.BTCUSDT' || !Array.isArray(msg.data)) return [];
  return msg.data
    .map((l: Msg): BtcLiquidation => ({ exchange: 'bybit', position: l.S === 'Buy' ? 'long' : 'short', usd: num(l.v) * num(l.p), ts: num(l.T) }))
    .filter((l: BtcLiquidation) => l.usd > 0);
}

/** OKX liquidation-orders (전체 무기한). BTC만 고른다. side = 청산 주문 방향: sell이면 롱이 청산된 것 */
export function parseOkxLiquidations(msg: Msg): BtcLiquidation[] {
  if (msg?.arg?.channel !== 'liquidation-orders' || !Array.isArray(msg.data)) return [];
  const out: BtcLiquidation[] = [];
  for (const item of msg.data) {
    const linear = item.instId === 'BTC-USDT-SWAP';
    const inverse = item.instId === 'BTC-USD-SWAP';
    if (!linear && !inverse) continue;
    for (const d of item.details ?? []) {
      const sz = num(d.sz);
      const usd = linear ? sz * OKX_BTC_USDT_CONTRACT_BTC * num(d.bkPx) : sz * OKX_BTC_USD_CONTRACT_USD;
      if (usd > 0) out.push({ exchange: 'okx', position: d.side === 'sell' ? 'long' : 'short', usd, ts: num(d.ts) });
    }
  }
  return out;
}

/** 큰 시장가 주문은 여러 체결로 쪼개져 오므로, 거래소별로 같은 방향 체결을 잠깐 모아 주문 하나로 본다 */
export interface MergedTrade {
  exchange: Exchange;
  side: 'buy' | 'sell';
  btc: number;
  ts: number; // 첫 체결 시각
}

export class TradeMerger {
  private pending = new Map<Exchange, MergedTrade & { touchedAt: number }>();
  private windowMs: number;
  private emit: (trade: MergedTrade) => void;

  constructor(windowMs: number, emit: (trade: MergedTrade) => void) {
    this.windowMs = windowMs;
    this.emit = emit;
  }

  /** now: 받은 시각 (조용해지면 내보낼 때 쓴다) */
  add(fill: Fill, now: number) {
    const p = this.pending.get(fill.exchange);
    if (p && (p.side !== fill.side || fill.ts - p.ts > this.windowMs)) this.flushOne(fill.exchange);
    const cur = this.pending.get(fill.exchange);
    if (cur) {
      cur.btc += fill.btc;
      cur.touchedAt = now;
    } else {
      this.pending.set(fill.exchange, { exchange: fill.exchange, side: fill.side, btc: fill.btc, ts: fill.ts, touchedAt: now });
    }
  }

  /** windowMs 동안 새 체결이 없던 묶음을 내보낸다 */
  flushIdle(now: number) {
    for (const [exchange, p] of this.pending) {
      if (now - p.touchedAt >= this.windowMs) this.flushOne(exchange);
    }
  }

  private flushOne(exchange: Exchange) {
    const p = this.pending.get(exchange);
    if (!p) return;
    this.pending.delete(exchange);
    this.emit({ exchange: p.exchange, side: p.side, btc: p.btc, ts: p.ts });
  }
}
