type QueryValue = string | string[] | undefined;

interface ApiRequest {
  method?: string;
  body?: unknown;
  query: Record<string, QueryValue>;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
  end(): void;
}

interface VisitorBody {
  v?: unknown;
  s?: unknown;
  active?: unknown;
  pageView?: unknown;
}

const PRESENCE_KEY = 'wallettrack:presence';
const ALL_VISITORS_KEY = 'wallettrack:visitors:all';
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const DAILY_TTL_SECONDS = 90 * 24 * 60 * 60;

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redisPipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const config = redisConfig();
  if (!config) throw new Error('redis is not configured');
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(4_000)
  });
  if (!response.ok) throw new Error(`redis ${response.status}`);
  const rows = await response.json() as { result?: unknown; error?: string }[];
  const failed = rows.find((row) => row.error);
  if (failed?.error) throw new Error(failed.error);
  return rows.map((row) => row.result);
}

function kstDate(now = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function requireId(value: unknown): string {
  const id = typeof value === 'string' ? value : '';
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) throw new Error('invalid id');
  return id;
}

function parseBody(body: unknown): VisitorBody {
  if (typeof body === 'string') return JSON.parse(body) as VisitorBody;
  if (body && typeof body === 'object') return body as VisitorBody;
  return {};
}

function dailyKeys(now = Date.now()) {
  const day = kstDate(now);
  return {
    visitors: `wallettrack:visitors:${day}`,
    sessions: `wallettrack:sessions:${day}`
  };
}

/** OCI와 독립적으로 방문 통계만 유지하는 Vercel API. IP나 개인정보는 저장하지 않는다. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!redisConfig()) return res.status(503).json({ error: 'visitor store unavailable' });

  try {
    if (req.method === 'POST') {
      const body = parseBody(req.body);
      const visitor = requireId(body.v);
      const session = requireId(body.s);
      const now = Date.now();
      const commands: (string | number)[][] = [];

      // 닫힌 탭이 다른 열린 탭의 접속 상태를 지우지 않도록 active=false는 만료에 맡긴다.
      if (body.active === true) commands.push(['ZADD', PRESENCE_KEY, now, visitor]);
      if (body.pageView === true) {
        const keys = dailyKeys(now);
        commands.push(
          ['SADD', ALL_VISITORS_KEY, visitor],
          ['SADD', keys.visitors, visitor],
          ['EXPIRE', keys.visitors, DAILY_TTL_SECONDS],
          ['SADD', keys.sessions, session],
          ['EXPIRE', keys.sessions, DAILY_TTL_SECONDS]
        );
      }
      if (commands.length > 0) await redisPipeline(commands);
      return res.status(204).end();
    }

    if (req.method === 'GET') {
      const now = Date.now();
      const keys = dailyKeys(now);
      const values = await redisPipeline([
        ['ZREMRANGEBYSCORE', PRESENCE_KEY, 0, now - ONLINE_WINDOW_MS],
        ['ZCARD', PRESENCE_KEY],
        ['SCARD', keys.visitors],
        ['SCARD', keys.sessions],
        ['SCARD', ALL_VISITORS_KEY]
      ]);
      return res.status(200).json({
        online: Number(values[1] || 0),
        today: Number(values[2] || 0),
        todayVisits: Number(values[3] || 0),
        total: Number(values[4] || 0)
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (error) {
    const message = error instanceof Error && error.message === 'invalid id' ? 'invalid request' : 'visitor store unavailable';
    return res.status(message === 'invalid request' ? 400 : 503).json({ error: message });
  }
}

