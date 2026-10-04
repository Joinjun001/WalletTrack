/**
 * 바이낸스 현물 USDT 마켓 달러 시세 (코인별 김프, 상단 시세 바). 업비트 원화 코인 중 바이낸스에도 있는 것만 온다.
 * 결합 스트림에 바이낸스에 없는 심볼이 섞여 있어도 그 심볼만 조용히 빠진다.
 */

const STREAM_URL = 'wss://stream.binance.com:9443/stream?streams=';
const RECONNECT_MS = 3000;

export interface UsdQuote {
  price: number;
  changePct: number; // 24시간 변동 (%)
}

interface MiniTicker {
  s: string; // ETHUSDT
  c: string; // 현재가
  o: string; // 24시간 전 가격
}

const quotes = new Map<string, UsdQuote>(); // 심볼(ETH) -> 시세
const listeners: ((symbol: string, q: UsdQuote) => void)[] = [];
let symbols: string[] = [];
let ws: WebSocket | null = null;

export function usdQuote(symbol: string): UsdQuote | null {
  return quotes.get(symbol) ?? null;
}

export function onUsdQuote(fn: (symbol: string, q: UsdQuote) => void) {
  listeners.push(fn);
}

function connect() {
  if (symbols.length === 0) return;
  const socket = new WebSocket(STREAM_URL + symbols.map((s) => `${s.toLowerCase()}usdt@miniTicker`).join('/'));
  ws = socket;
  socket.onmessage = (event) => {
    try {
      const t: MiniTicker | undefined = JSON.parse(event.data)?.data;
      if (!t?.s?.endsWith('USDT')) return;
      const price = parseFloat(t.c);
      const open = parseFloat(t.o);
      if (!(price > 0)) return;
      const symbol = t.s.slice(0, -4);
      const quote = { price, changePct: open > 0 ? (price / open - 1) * 100 : 0 };
      quotes.set(symbol, quote);
      for (const fn of listeners) fn(symbol, quote);
    } catch (e) {
      console.error('Binance spot WS Parse Error:', e);
    }
  };
  socket.onclose = () => {
    if (ws !== socket) return; // 새 목록으로 다시 연결했다
    setTimeout(connect, RECONNECT_MS);
  };
}

/** 받을 코인 목록을 정하고 연결한다 (USDT 자체는 뺀다) */
export function subscribeUsdQuotes(list: string[]) {
  symbols = Array.from(new Set(list.filter((s) => s !== 'USDT' && /^[A-Z0-9]+$/.test(s))));
  const old = ws;
  ws = null;
  old?.close();
  connect();
}
