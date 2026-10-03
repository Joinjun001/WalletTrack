/**
 * 업비트 시세 중계. 업비트는 브라우저 요청(Origin 헤더가 있는 요청)을 출처별로 아주 적게만 받아서(초당 0~1회 수준)
 * 페이지를 열 때 시세·캔들 요청이 겹치면 429로 막힌다. 서버에서 대신 받아 잠깐 캐시해서 돌려준다.
 */

const UPBIT_API = 'https://api.upbit.com/v1';
const CANDLE_UNITS = new Set(['minutes/1', 'minutes/15', 'minutes/60', 'days']);
const CANDLES_TTL_MS = 3_000;
const TICKERS_TTL_MS = 3_000;
const MAX_CACHE_ENTRIES = 500;

export class UpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** 같은 주소는 ttl 동안 한 번만 업비트에 요청한다 (동시에 들어온 요청도 하나로 합친다) */
function cachedGet(url: string, ttlMs: number): Promise<unknown> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs) return hit.value;

  const value = fetch(url, { signal: AbortSignal.timeout(5_000) }).then(async (res) => {
    if (!res.ok) throw new UpstreamError(res.status === 429 ? 503 : 502, `upbit ${res.status}`);
    return res.json();
  });
  value.catch(() => cache.delete(url)); // 실패는 캐시하지 않는다
  cache.set(url, { at: now, value });
  if (cache.size > MAX_CACHE_ENTRIES) {
    for (const [key, entry] of cache) if (now - entry.at >= ttlMs) cache.delete(key);
  }
  return value;
}

/** GET /api/upbit/candles?unit=minutes/15&market=KRW-BTC&count=200 */
export function upbitCandles(q: URLSearchParams): Promise<unknown> {
  const unit = q.get('unit') || '';
  const market = (q.get('market') || '').toUpperCase();
  const count = Math.round(Number(q.get('count') || 200));
  if (!CANDLE_UNITS.has(unit)) throw new UpstreamError(400, 'invalid unit');
  if (!/^KRW-[A-Z0-9]{1,15}$/.test(market)) throw new UpstreamError(400, 'invalid market');
  if (!(count >= 1 && count <= 200)) throw new UpstreamError(400, 'invalid count');
  return cachedGet(`${UPBIT_API}/candles/${unit}?market=${market}&count=${count}`, CANDLES_TTL_MS);
}

/** GET /api/upbit/tickers: 원화 마켓 전체 시세 */
export function upbitTickers(): Promise<unknown> {
  return cachedGet(`${UPBIT_API}/ticker/all?quote_currencies=KRW`, TICKERS_TTL_MS);
}
