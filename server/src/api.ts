/**
 * 읽기 전용 기록 API. 웹은 처음 열 때 여기서 지난 기록을 받고, 이후 실시간 데이터는 지금처럼 거래소에서 직접 받는다.
 *
 * GET /api/health                              수집 상태 (테이블별 마지막 저장 시각)
 * GET /api/whales?hours=24&minBtc=0.1&limit=300
 * GET /api/liquidations?hours=24&minUsd=1000&limit=40[&symbol=BTCUSDT]
 * GET /api/liquidations/summary?hours=24[&symbol=BTCUSDT]
 * GET /api/liquidations/by-symbol?hours=24&limit=10
 * GET /api/whales/flow?hours=24
 * GET /api/liquidations/buckets?symbol=BTCUSDT&hours=50&minutes=15   캔들 구간별 롱·숏 청산 합계 (차트 표시)
 * GET /api/whales/buckets?hours=50&minutes=15&minBtc=1               캔들 구간별 거래소 입금·출금 합계 (차트 표시)
 * GET /api/futures?symbol=BTCUSDT&hours=24
 * GET /api/kimchi?symbol=BTC&hours=24
 * GET /api/surges?threshold=3&hours=24&limit=50                       업비트 원화 마켓 급등·급락 기록
 * GET /api/big-trades/summary?hours=24                                대형 체결(1 BTC 이상) 매수·매도 합계(until까지)와 거래소별 기록 시작 시각
 * GET /api/upbit/candles?unit=minutes/15&market=KRW-BTC&count=200[&to=...], /api/upbit/tickers, /api/upbit/markets: 업비트 중계 (upbitProxy.ts)
 *
 * POST /api/events, /api/feedback: 웹 사용 기록(익명)과 의견 받기 (usage.ts). config.postOrigins에서 보낸 것만 받는다
 *
 * 남용 방지: 조회는 IP별 1분 300회, 업비트 중계는 1분 120회(업비트가 우리 서버 IP를 막지 않게), 구간 합계는 점 5,000개까지.
 */

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { config, log } from './config.ts';
import { query } from './db.ts';
import { BadRequest, rateLimiter, saveEvents, saveFeedback } from './usage.ts';
import { UpstreamError, upbitCandles, upbitMarkets, upbitTickers } from './upbitProxy.ts';
import { FILE_URLS } from './bigTrades.ts';

type Params = URLSearchParams;

/** 숫자 쿼리 값을 [min, max]로 제한한다 */
function numParam(q: Params, name: string, fallback: number, min: number, max: number): number {
  const value = Number(q.get(name));
  if (!q.has(name) || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** symbol을 주면 그 종목만, 없으면 전체 (null) */
function optionalSymbol(q: Params): string | null {
  return q.has('symbol') ? symbolParam(q, '') : null;
}

function symbolParam(q: Params, fallback: string): string {
  const value = (q.get('symbol') || fallback).toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(value)) throw new HttpError(400, 'invalid symbol');
  return value;
}

const MAX_BUCKETS = 5_000;
const BIG_TRADE_CACHE_MS = 60_000;
const BIG_TRADE_CACHE_1H_MS = 10_000; // 1시간은 짧은 기간이라 자주 갱신
// 수집기는 끝난 분을 1분마다 저장하므로 2분 전 분까지는 저장이 끝나 있다. 그 뒤는 웹이 실시간 체결로 더한다
const BIG_TRADE_SAVED_LAG_MS = 2 * 60_000;
const bigTradeCache = new Map<number, { at: number; value: unknown }>();

/** 캔들 구간 합계용: 기간 ÷ 구간이 너무 많으면 거절한다 (한 요청에 수만 행 계산 방지) */
function bucketParams(q: Params, maxHours: number): { hours: number; minutes: number } {
  const hours = numParam(q, 'hours', 24, 0.1, maxHours);
  const minutes = Math.round(numParam(q, 'minutes', 15, 1, 1440));
  if ((hours * 60) / minutes > MAX_BUCKETS) throw new HttpError(400, 'too many buckets');
  return { hours, minutes };
}

/** 조회 기간이 길면 평균을 내서 점 개수를 줄인다 (분 단위 버킷) */
function bucketMinutes(hours: number, baseMinutes: number): number {
  if (hours <= 24) return baseMinutes;
  if (hours <= 24 * 7) return Math.max(baseMinutes, 15);
  return Math.max(baseMinutes, 60);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ms = (d: Date | null) => (d ? d.getTime() : null);

const routes: Record<string, (q: Params) => Promise<unknown>> = {
  '/api/health': async () => {
    const [row] = await query<Record<string, Date | null>>(`
      SELECT (SELECT max(detected_at) FROM whale_txs) AS whales,
             (SELECT max(occurred_at) FROM liquidations) AS liquidations,
             (SELECT max(recorded_at) FROM futures_stats) AS futures,
             (SELECT max(recorded_at) FROM kimchi_premium) AS kimchi,
             (SELECT max(detected_at) FROM surge_events) AS surges`);
    return {
      ok: true,
      latest: row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, ms(v)])) : null
    };
  },

  '/api/whales': async (q) => {
    const rows = await query<{ hash: string; btc_amount: number; direction: string; exchange_address: string | null; detected_at: Date }>(
      `SELECT hash, btc_amount, direction, exchange_address, detected_at FROM whale_txs
       WHERE detected_at > now() - $1::float8 * interval '1 hour' AND btc_amount >= $2
       ORDER BY detected_at DESC LIMIT $3`,
      [numParam(q, 'hours', 24, 0.1, 24 * 30), numParam(q, 'minBtc', 0.1, 0, 1e6), Math.round(numParam(q, 'limit', 300, 1, 1000))]
    );
    return rows.map((r) => ({
      hash: r.hash,
      btcAmount: r.btc_amount,
      direction: r.direction,
      exchangeAddress: r.exchange_address,
      detectedAt: ms(r.detected_at)
    }));
  },

  '/api/liquidations': async (q) => {
    const rows = await query<{ symbol: string; position: string; usd_value: number; occurred_at: Date }>(
      `SELECT symbol, position, usd_value, occurred_at FROM liquidations
       WHERE occurred_at > now() - $1::float8 * interval '1 hour' AND usd_value >= $2 AND ($4::text IS NULL OR symbol = $4)
       ORDER BY occurred_at DESC LIMIT $3`,
      [numParam(q, 'hours', 24, 0.1, 24 * 30), numParam(q, 'minUsd', 1000, 0, 1e12), Math.round(numParam(q, 'limit', 40, 1, 500)), optionalSymbol(q)]
    );
    return rows.map((r) => ({ symbol: r.symbol, position: r.position, usd: r.usd_value, occurredAt: ms(r.occurred_at) }));
  },

  '/api/liquidations/summary': async (q) => {
    const hours = numParam(q, 'hours', 24, 0.1, 24 * 30);
    const rows = await query<{ position: string; usd: number; count: number }>(
      `SELECT position, sum(usd_value) AS usd, count(*) AS count FROM liquidations
       WHERE occurred_at > now() - $1::float8 * interval '1 hour' AND ($2::text IS NULL OR symbol = $2) GROUP BY position`,
      [hours, optionalSymbol(q)]
    );
    const by = (p: string) => rows.find((r) => r.position === p);
    return {
      hours,
      longUsd: by('long')?.usd ?? 0,
      shortUsd: by('short')?.usd ?? 0,
      longCount: by('long')?.count ?? 0,
      shortCount: by('short')?.count ?? 0
    };
  },

  '/api/liquidations/by-symbol': async (q) => {
    const rows = await query<{ symbol: string; long_usd: number; short_usd: number }>(
      `SELECT symbol,
              coalesce(sum(usd_value) FILTER (WHERE position = 'long'), 0) AS long_usd,
              coalesce(sum(usd_value) FILTER (WHERE position = 'short'), 0) AS short_usd
       FROM liquidations WHERE occurred_at > now() - $1::float8 * interval '1 hour'
       GROUP BY symbol ORDER BY sum(usd_value) DESC LIMIT $2`,
      [numParam(q, 'hours', 24, 0.1, 24 * 30), Math.round(numParam(q, 'limit', 10, 1, 50))]
    );
    return rows.map((r) => ({ symbol: r.symbol, longUsd: r.long_usd, shortUsd: r.short_usd }));
  },

  '/api/whales/flow': async (q) => {
    const hours = numParam(q, 'hours', 24, 0.1, 24 * 30);
    const rows = await query<{ direction: string; btc: number; count: number }>(
      `SELECT direction, sum(btc_amount) AS btc, count(*) AS count FROM whale_txs
       WHERE detected_at > now() - $1::float8 * interval '1 hour' GROUP BY direction`,
      [hours]
    );
    const by = (d: string) => rows.find((r) => r.direction === d);
    return {
      hours,
      depositBtc: by('deposit')?.btc ?? 0,
      withdrawalBtc: by('withdrawal')?.btc ?? 0,
      transferBtc: by('transfer')?.btc ?? 0,
      depositCount: by('deposit')?.count ?? 0,
      withdrawalCount: by('withdrawal')?.count ?? 0,
      transferCount: by('transfer')?.count ?? 0
    };
  },

  // 구간은 'epoch' 기준이라 업비트 분봉·일봉(UTC 0시 = KST 9시) 경계와 맞는다
  '/api/liquidations/buckets': async (q) => {
    const { hours, minutes } = bucketParams(q, 24 * 30);
    const rows = await query<{ t: Date; long_usd: number; short_usd: number }>(
      `SELECT date_bin($3::int * interval '1 minute', occurred_at, 'epoch') AS t,
              coalesce(sum(usd_value) FILTER (WHERE position = 'long'), 0) AS long_usd,
              coalesce(sum(usd_value) FILTER (WHERE position = 'short'), 0) AS short_usd
       FROM liquidations WHERE symbol = $1 AND occurred_at > now() - $2::float8 * interval '1 hour'
       GROUP BY t ORDER BY t`,
      [symbolParam(q, 'BTCUSDT'), hours, minutes]
    );
    return rows.map((r) => ({ t: ms(r.t), longUsd: r.long_usd, shortUsd: r.short_usd }));
  },

  '/api/whales/buckets': async (q) => {
    const { hours, minutes } = bucketParams(q, 24 * 30);
    const rows = await query<{ t: Date; deposit_btc: number; withdrawal_btc: number }>(
      `SELECT date_bin($2::int * interval '1 minute', detected_at, 'epoch') AS t,
              coalesce(sum(btc_amount) FILTER (WHERE direction = 'deposit'), 0) AS deposit_btc,
              coalesce(sum(btc_amount) FILTER (WHERE direction = 'withdrawal'), 0) AS withdrawal_btc
       FROM whale_txs WHERE direction IN ('deposit', 'withdrawal') AND btc_amount >= $3
         AND detected_at > now() - $1::float8 * interval '1 hour'
       GROUP BY t ORDER BY t`,
      [hours, minutes, numParam(q, 'minBtc', 1, 0, 1e6)]
    );
    return rows.map((r) => ({ t: ms(r.t), depositBtc: r.deposit_btc, withdrawalBtc: r.withdrawal_btc }));
  },

  '/api/futures': async (q) => {
    const hours = numParam(q, 'hours', 24, 1, 24 * 90);
    const rows = await query<{ t: Date; funding_rate: number; open_interest: number; mark_price: number; long_ratio: number | null }>(
      `SELECT date_bin($3::int * interval '1 minute', recorded_at, 'epoch') AS t,
              avg(funding_rate) AS funding_rate, avg(open_interest) AS open_interest,
              avg(mark_price) AS mark_price, avg(long_ratio) AS long_ratio
       FROM futures_stats WHERE symbol = $1 AND recorded_at > now() - $2::float8 * interval '1 hour'
       GROUP BY t ORDER BY t`,
      [symbolParam(q, 'BTCUSDT'), hours, bucketMinutes(hours, 5)]
    );
    return rows.map((r) => ({
      t: ms(r.t),
      fundingRate: r.funding_rate,
      openInterest: r.open_interest,
      markPrice: r.mark_price,
      longRatio: r.long_ratio
    }));
  },

  '/api/kimchi': async (q) => {
    const hours = numParam(q, 'hours', 24, 1, 24 * 90);
    const rows = await query<{ t: Date; premium_pct: number }>(
      `SELECT date_bin($3::int * interval '1 minute', recorded_at, 'epoch') AS t, avg(premium_pct) AS premium_pct
       FROM kimchi_premium WHERE symbol = $1 AND recorded_at > now() - $2::float8 * interval '1 hour'
       GROUP BY t ORDER BY t`,
      [symbolParam(q, 'BTC'), hours, bucketMinutes(hours, 1)]
    );
    return rows.map((r) => ({ t: ms(r.t), premiumPct: r.premium_pct }));
  },

  '/api/surges': async (q) => {
    const rows = await query<{ market: string; direction: string; change_pct: number; from_price: number; price: number; volume_krw: number; detected_at: Date }>(
      `SELECT market, direction, change_pct, from_price, price, volume_krw, detected_at FROM surge_events
       WHERE threshold = $1 AND detected_at > now() - $2::float8 * interval '1 hour'
       ORDER BY detected_at DESC LIMIT $3`,
      [numParam(q, 'threshold', 3, 0.1, 100), numParam(q, 'hours', 24, 0.1, 24 * 30), Math.round(numParam(q, 'limit', 50, 1, 500))]
    );
    return rows.map((r) => ({
      market: r.market,
      direction: r.direction,
      pct: r.change_pct,
      from: r.from_price,
      price: r.price,
      volumeKrw: r.volume_krw,
      detectedAt: ms(r.detected_at)
    }));
  },

  // 1달이면 최대 수십만 행을 더하므로 기간별로 캐시한다 (1시간 10초, 그 외 1분)
  // 합계는 until(저장이 확실히 끝난 분의 경계)까지. 웹은 until 이후 체결을 직접 더해 실시간으로 보여 준다
  '/api/big-trades/summary': async (q) => {
    const hours = Math.round(numParam(q, 'hours', 24, 1, 24 * 31));
    const hit = bigTradeCache.get(hours);
    if (hit && Date.now() - hit.at < (hours === 1 ? BIG_TRADE_CACHE_1H_MS : BIG_TRADE_CACHE_MS)) return hit.value;
    const until = Math.floor((Date.now() - BIG_TRADE_SAVED_LAG_MS) / 60_000) * 60_000;
    const [sums, since, live, filled] = await Promise.all([
      query<{ buy_btc: number | null; sell_btc: number | null; buy_count: number | null; sell_count: number | null }>(
        `SELECT sum(buy_btc) AS buy_btc, sum(sell_btc) AS sell_btc, sum(buy_count)::int8 AS buy_count, sum(sell_count)::int8 AS sell_count
         FROM big_trade_minutes
         WHERE minute >= to_timestamp($2 / 1000.0) - $1::int * interval '1 hour' AND minute < to_timestamp($2 / 1000.0)`,
        [hours, until]
      ),
      query<{ exchange: string; since: Date }>(`SELECT exchange, min(minute) AS since FROM big_trade_minutes GROUP BY exchange`),
      query<{ t: Date | null }>(`SELECT min(started_at) AS t FROM big_trade_live`),
      query<{ source: string; day: string }>(
        `SELECT source, to_char(day, 'YYYY-MM-DD') AS day FROM big_trade_filled WHERE day >= (now() - $1::int * interval '1 hour')::date`,
        [hours]
      )
    ]);
    const s = sums[0];
    // 실시간 수집을 처음 시작하기 전인데 아직 파일로 못 채운 날 (거래소가 다음 날 파일을 올리면 채워진다)
    const filledSet = new Set(filled.map((r) => `${r.source}|${r.day}`));
    const DAY = 86_400_000;
    const liveStart = live[0]?.t?.getTime() ?? Date.now();
    const missingDays: Record<string, string[]> = {};
    for (const source of Object.keys(FILE_URLS)) {
      const first = since.find((r) => r.exchange === source)?.since.getTime() ?? Date.now();
      const from = Math.floor(Math.max(Date.now() - hours * 3_600_000, first) / DAY) * DAY;
      for (let d = from; d < liveStart; d += DAY) {
        const day = new Date(d).toISOString().slice(0, 10);
        if (!filledSet.has(`${source}|${day}`)) (missingDays[source] ??= []).push(day);
      }
    }
    const value = {
      hours,
      until,
      buyBtc: s?.buy_btc ?? 0,
      sellBtc: s?.sell_btc ?? 0,
      buyCount: s?.buy_count ?? 0,
      sellCount: s?.sell_count ?? 0,
      since: Object.fromEntries(since.map((r) => [r.exchange, ms(r.since)])),
      missingDays
    };
    if (bigTradeCache.size > 50) bigTradeCache.clear();
    bigTradeCache.set(hours, { at: Date.now(), value });
    return value;
  },

  '/api/upbit/candles': async (q) => upbitCandles(q),
  '/api/upbit/tickers': async () => upbitTickers(),
  '/api/upbit/markets': async () => upbitMarkets()
};

const MAX_BODY_BYTES = 64 * 1024;
const allowGet = rateLimiter(300, 60_000);   // 페이지 하나가 1분에 수십 번 부르는 정도
const allowUpbit = rateLimiter(120, 60_000); // 업비트 중계는 캐시를 우회하는 요청을 막으려고 더 엄격하게

const postRoutes: Record<string, { handle: (body: unknown) => Promise<unknown>; allow: (key: string) => boolean }> = {
  '/api/events': { handle: saveEvents, allow: rateLimiter(120, 60_000) },       // 1분에 120번
  '/api/feedback': { handle: saveFeedback, allow: rateLimiter(5, 10 * 60_000) } // 10분에 5번
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid json'));
      }
    });
    req.on('error', reject);
  });
}

/** nginx가 X-Forwarded-For 끝에 실제 접속 주소를 붙인다 (앞쪽 값은 사용자가 조작할 수 있다) */
function clientAddress(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded[forwarded.length - 1] || req.socket.remoteAddress || 'unknown';
}

const server = createServer(async (req, res) => {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=10',
    'X-Content-Type-Options': 'nosniff'
  };
  const send = (status: number, body: unknown) => {
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'POST') {
    headers['Cache-Control'] = 'no-store';
    const route = postRoutes[url.pathname.replace(/\/$/, '')];
    if (!route) return send(404, { error: 'not found' });
    if (!config.postOrigins.includes(String(req.headers.origin || ''))) return send(403, { error: 'origin not allowed' });
    if (!route.allow(clientAddress(req))) return send(429, { error: 'too many requests' });
    try {
      send(200, await route.handle(await readBody(req)));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      if (e instanceof BadRequest) return send(400, { error: e.message });
      log(`${url.pathname} 실패:`, e);
      send(500, { error: 'internal error' });
    }
    return;
  }
  if (req.method !== 'GET') return send(405, { error: 'method not allowed' });

  const pathname = url.pathname.replace(/\/$/, '');
  const handler = routes[pathname];
  if (!handler) return send(404, { error: 'not found' });
  const address = clientAddress(req);
  if (!allowGet(address) || (pathname.startsWith('/api/upbit/') && !allowUpbit(address))) return send(429, { error: 'too many requests' });
  // 업비트 중계는 실시간 시세라 브라우저·프록시 캐시를 짧게
  if (pathname.startsWith('/api/upbit/')) headers['Cache-Control'] = 'public, max-age=2';

  try {
    send(200, await handler(url.searchParams));
  } catch (e) {
    if (e instanceof HttpError || e instanceof UpstreamError) return send(e.status, { error: e.message });
    log(`${url.pathname} 실패:`, e);
    send(500, { error: 'internal error' });
  }
});

server.listen(config.apiPort, () => log(`API 서버 시작: 포트 ${config.apiPort}`));
