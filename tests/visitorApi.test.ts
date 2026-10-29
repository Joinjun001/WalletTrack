import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/visitors.ts';

function responseCapture() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  return {
    response: {
      setHeader(name: string, value: string) { headers.set(name, value); },
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { body = value; },
      end() { body = undefined; }
    },
    result: () => ({ statusCode, body, headers })
  };
}

test('visitor API는 Redis 집계를 화면 응답 형태로 바꾼다', async () => {
  process.env.KV_REST_API_URL = 'https://redis.example';
  process.env.KV_REST_API_TOKEN = 'token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const commands = JSON.parse(String(init?.body));
    assert.equal(commands[0][0], 'ZREMRANGEBYSCORE');
    assert.deepEqual(commands.slice(1).map((c: string[]) => c[0]), ['ZCARD', 'SCARD', 'SCARD', 'SCARD']);
    return new Response(JSON.stringify([
      { result: 0 }, { result: 2 }, { result: 3 }, { result: 4 }, { result: 5 }
    ]), { status: 200 });
  };
  try {
    const capture = responseCapture();
    await handler({ method: 'GET', query: {} }, capture.response);
    assert.equal(capture.result().statusCode, 200);
    assert.deepEqual(capture.result().body, { online: 2, today: 3, todayVisits: 4, total: 5 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('페이지 보기는 순 방문자·세션·현재 접속을 한 번에 기록한다', async () => {
  process.env.KV_REST_API_URL = 'https://redis.example';
  process.env.KV_REST_API_TOKEN = 'token';
  const originalFetch = globalThis.fetch;
  let commands: (string | number)[][] = [];
  globalThis.fetch = async (_input, init) => {
    commands = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(commands.map(() => ({ result: 1 }))), { status: 200 });
  };
  try {
    const capture = responseCapture();
    await handler({
      method: 'POST', query: {},
      body: { v: 'visitor-12345678', s: 'session-12345678', active: true, pageView: true }
    }, capture.response);
    assert.equal(capture.result().statusCode, 204);
    assert.deepEqual(commands.map((c) => c[0]), ['ZADD', 'SADD', 'SADD', 'EXPIRE', 'SADD', 'EXPIRE']);
    assert.equal(commands[0][3], 'visitor-12345678');
    assert.equal(commands[4][2], 'session-12345678');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('저장소가 연결되지 않았으면 명확한 503을 돌려준다', async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const capture = responseCapture();
  await handler({ method: 'GET', query: {} }, capture.response);
  assert.equal(capture.result().statusCode, 503);
  assert.deepEqual(capture.result().body, { error: 'visitor store unavailable' });
});

