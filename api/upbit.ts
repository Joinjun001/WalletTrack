type QueryValue = string | string[] | undefined;

interface ApiRequest {
  method?: string;
  query: Record<string, QueryValue>;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

const UPBIT_API = 'https://api.upbit.com/v1';
const CANDLE_UNITS = new Set([
  'minutes/1', 'minutes/3', 'minutes/5', 'minutes/15', 'minutes/30',
  'minutes/60', 'minutes/240', 'days', 'weeks', 'months'
]);

function first(value: QueryValue): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function upbitJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    return { status: response.status === 429 ? 503 : 502, body: { error: `upbit ${response.status}` } };
  }
  return { status: 200, body: await response.json() };
}

/** OCI 중계가 멈췄을 때 차트·코인 목록을 살리는 Vercel 폴백. 허용한 업비트 조회만 대신 호출한다. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const kind = first(req.query.kind);
  let url = '';
  let cache = 'public, max-age=2, s-maxage=3, stale-while-revalidate=30';

  if (kind === 'tickers') {
    url = `${UPBIT_API}/ticker/all?quote_currencies=KRW`;
  } else if (kind === 'markets') {
    url = `${UPBIT_API}/market/all?isDetails=false`;
    cache = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
  } else if (kind === 'candles') {
    const unit = first(req.query.unit);
    const market = first(req.query.market).toUpperCase();
    const count = Math.round(Number(first(req.query.count) || 200));
    const to = first(req.query.to);
    if (!CANDLE_UNITS.has(unit) || !/^KRW-[A-Z0-9]{1,15}$/.test(market) || !(count >= 1 && count <= 200)) {
      return res.status(400).json({ error: 'invalid candle query' });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(to)) {
      return res.status(400).json({ error: 'invalid to' });
    }
    const params = new URLSearchParams({ market, count: String(count) });
    if (to) {
      params.set('to', to);
      cache = 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400';
    }
    url = `${UPBIT_API}/candles/${unit}?${params}`;
  } else {
    return res.status(400).json({ error: 'invalid kind' });
  }

  try {
    const result = await upbitJson(url);
    let body = result.body;
    if (result.status === 200 && kind === 'markets' && Array.isArray(body)) {
      body = body.filter((item) => typeof item === 'object' && item !== null && String((item as { market?: unknown }).market).startsWith('KRW-'));
    }
    res.setHeader('Cache-Control', cache);
    return res.status(result.status).json(body);
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError' ? 'upbit timeout' : 'upbit unavailable';
    return res.status(504).json({ error: message });
  }
}
