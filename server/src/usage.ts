/**
 * 웹 사용 기록(익명)과 의견 받기. 서비스 개선용으로만 모으며 IP 등 개인정보는 저장하지 않는다.
 *
 * POST /api/events    { v: 방문자 ID, s: 세션 ID, events: [{ n: 이름, p: 속성, t: 브라우저 시각(ms) }] }
 * POST /api/feedback  { v: 방문자 ID, category: 'bug' | 'idea' | 'other', message, context }
 *
 * 브라우저는 sendBeacon(text/plain)으로 보내므로 Content-Type은 보지 않고 본문을 JSON으로 읽는다.
 */

import { query } from './db.ts';

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const EVENT_NAME_RE = /^[a-z0-9_]{1,40}$/;
const PROP_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const MAX_EVENTS = 50;
const MAX_PROPS = 20;
const MAX_STRING = 300;
const MAX_FEEDBACK = 1000;
const CLOCK_SKEW_MS = 24 * 3600 * 1000;

export class BadRequest extends Error {}

type PropValue = string | number | boolean | null;

/** 속성은 평평한 객체만 받고, 문자열은 잘라서, 그 외 형식은 버린다 */
function cleanProps(raw: unknown): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw).slice(0, MAX_PROPS)) {
    if (!PROP_KEY_RE.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING);
    else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

function requireId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new BadRequest(`invalid ${name}`);
  return value;
}

/** 브라우저 시계가 크게 틀리면 저장하지 않는다 */
function clientTime(value: unknown): string | null {
  if (typeof value !== 'number' || Math.abs(value - Date.now()) > CLOCK_SKEW_MS) return null;
  return new Date(value).toISOString();
}

export async function saveEvents(body: unknown): Promise<{ saved: number }> {
  const b = (body ?? {}) as { v?: unknown; s?: unknown; events?: unknown };
  const visitor = requireId(b.v, 'visitor id');
  const session = requireId(b.s, 'session id');
  if (!Array.isArray(b.events)) throw new BadRequest('events must be an array');

  const names: string[] = [];
  const props: string[] = [];
  const times: (string | null)[] = [];
  for (const e of b.events.slice(0, MAX_EVENTS)) {
    const name = (e as { n?: unknown })?.n;
    if (typeof name !== 'string' || !EVENT_NAME_RE.test(name)) continue;
    names.push(name);
    props.push(JSON.stringify(cleanProps((e as { p?: unknown }).p)));
    times.push(clientTime((e as { t?: unknown }).t));
  }
  if (names.length === 0) return { saved: 0 };

  await query(
    `INSERT INTO usage_events (visitor_id, session_id, name, props, client_at)
     SELECT $1, $2, n, p, t FROM unnest($3::text[], $4::jsonb[], $5::timestamptz[]) AS x(n, p, t)`,
    [visitor, session, names, props, times]
  );
  return { saved: names.length };
}

export async function saveFeedback(body: unknown): Promise<{ ok: true }> {
  const b = (body ?? {}) as { v?: unknown; category?: unknown; message?: unknown; context?: unknown };
  const visitor = requireId(b.v, 'visitor id');
  const category = b.category === 'bug' || b.category === 'idea' ? b.category : 'other';
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, MAX_FEEDBACK) : '';
  if (!message) throw new BadRequest('message is required');

  await query(
    `INSERT INTO feedback (visitor_id, category, message, context) VALUES ($1, $2, $3, $4)`,
    [visitor, category, message, JSON.stringify(cleanProps(b.context))]
  );
  return { ok: true };
}

/**
 * 같은 주소에서 너무 많이 보내는 것을 막는다. 주소는 메모리에서 횟수 세기에만 쓰고 저장하지 않는다.
 * windowMs 동안 limit번까지 허용.
 */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return (key: string): boolean => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    h.count++;
    return h.count <= limit;
  };
}
