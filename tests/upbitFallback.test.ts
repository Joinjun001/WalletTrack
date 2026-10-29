import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/upbit.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function responseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  return {
    headers,
    result: () => ({ statusCode, body }),
    response: {
      setHeader(name: string, value: string) { headers.set(name, value); },
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { body = value; }
    }
  };
}

test('Vercel 업비트 폴백은 원화 마켓만 돌려준다', async () => {
  let requested = '';
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify([
      { market: 'KRW-BTC', korean_name: '비트코인' },
      { market: 'BTC-ETH', korean_name: '이더리움' }
    ]), { status: 200 });
  };
  const rec = responseRecorder();
  await handler({ method: 'GET', query: { kind: 'markets' } }, rec.response);
  assert.equal(requested, 'https://api.upbit.com/v1/market/all?isDetails=false');
  assert.deepEqual(rec.result(), { statusCode: 200, body: [{ market: 'KRW-BTC', korean_name: '비트코인' }] });
  assert.match(rec.headers.get('Cache-Control') || '', /s-maxage=3600/);
});

test('Vercel 업비트 폴백은 임의 경로와 잘못된 캔들 값을 거절한다', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };

  const invalidKind = responseRecorder();
  await handler({ method: 'GET', query: { kind: 'private' } }, invalidKind.response);
  assert.equal(invalidKind.result().statusCode, 400);

  const invalidCandle = responseRecorder();
  await handler({ method: 'GET', query: { kind: 'candles', unit: 'minutes/2', market: 'KRW-BTC' } }, invalidCandle.response);
  assert.equal(invalidCandle.result().statusCode, 400);
  assert.equal(calls, 0);
});
