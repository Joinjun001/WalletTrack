/**
 * 읽기 전용 기록 API. 웹은 처음 열 때 여기서 지난 기록을 받고, 이후 실시간 데이터는 지금처럼 거래소에서 직접 받는다.
 *
 * GET /api/health                              수집 상태 (테이블별 마지막 저장 시각)
 * GET /api/whales?hours=24&minBtc=0.1&limit=300
 * GET /api/liquidations?hours=24&minUsd=1000&limit=40
 * GET /api/liquidations/summary?hours=24
 * GET /api/liquidations/by-symbol?hours=24&limit=10
 * GET /api/whales/flow?hours=24
 * GET /api/futures?symbol=BTCUSDT&hours=24
 * GET /api/kimchi?symbol=BTC&hours=24
 *
 * POST /api/events, /api/feedback: 웹 사용 기록(익명)과 의견 받기 (usage.ts)
 */

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { config, log } from './config.ts';
import { query } from './db.ts';
import { BadRequest, rateLimiter, saveEvents, saveFeedback } from './usage.ts';

type Params = URLSearchParams;

/** 숫자 쿼리 값을 [min, max]로 제한한다 */
function numParam(q: Params, name: string, fallback: number, min: number, max: number): number {
  const value = Number(q.get(name));
  if (!q.has(name) || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function symbolParam(q: Params, fallback: string): string {
  const value = (q.get('symbol') || fallback).toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(value)) throw new HttpError(400, 'invalid symbol');
  return value;
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
             (SELECT max(recorded_at) FROM kimchi_premium) AS kimchi`);
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
       WHERE occurred_at > now() - $1::float8 * interval '1 hour' AND usd_value >= $2
       ORDER BY occurred_at DESC LIMIT $3`,
      [numParam(q, 'hours', 24, 0.1, 24 * 30), numParam(q, 'minUsd', 1000, 0, 1e12), Math.round(numParam(q, 'limit', 40, 1, 500))]
    );
    return rows.map((r) => ({ symbol: r.symbol, position: r.position, usd: r.usd_value, occurredAt: ms(r.occurred_at) }));
  },

  '/api/liquidations/summary': async (q) => {
    const hours = numParam(q, 'hours', 24, 0.1, 24 * 30);
    const rows = await query<{ position: string; usd: number; count: number }>(
      `SELECT position, sum(usd_value) AS usd, count(*) AS count FROM liquidations
       WHERE occurred_at > now() - $1::float8 * interval '1 hour' GROUP BY position`,
      [hours]
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
  }
};

const MAX_BODY_BYTES = 64 * 1024;

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
    'Cache-Control': 'public, max-age=10'
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

  const handler = routes[url.pathname.replace(/\/$/, '')];
  if (!handler) return send(404, { error: 'not found' });

  try {
    send(200, await handler(url.searchParams));
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    log(`${url.pathname} 실패:`, e);
    send(500, { error: 'internal error' });
  }
});

server.listen(config.apiPort, () => log(`API 서버 시작: 포트 ${config.apiPort}`));
