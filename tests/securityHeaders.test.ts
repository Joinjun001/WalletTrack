import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

// vercel.json의 CSP는 index.html 인라인 테마 스크립트를 해시로만 허용한다.
// 스크립트를 고치면 해시도 바꿔야 한다 (안 바꾸면 배포 사이트에서 테마 스크립트가 막힌다).
const csp = (JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers as { key: string; value: string }[])
  .find((h) => h.key === 'Content-Security-Policy')!.value;

test('CSP allows the inline theme script by its current hash', () => {
  const scripts = [...readFileSync('index.html', 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    const hash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
    assert.ok(csp.includes(hash), `vercel.json CSP에 ${hash} 를 넣으세요`);
  }
});

test('CSP connect-src covers every external address the web code uses', () => {
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src'))!;
  const sources = readdirSync('src').filter((f) => f.endsWith('.ts')).map((f) => readFileSync(`src/${f}`, 'utf8'));
  const urls = new Set<string>();
  for (const code of sources) {
    // 주석 속 주소(예: 더 이상 안 쓰는 blockchain.info)는 빼고, 코드 안 문자열만 본다
    const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    for (const m of withoutComments.matchAll(/(https|wss):\/\/[a-zA-Z0-9.-]+(:\d+)?/g)) urls.add(m[0]);
  }
  const external = [...urls].filter((u) => !u.includes('fonts.g'));
  assert.ok(external.length > 5);
  for (const url of external) assert.ok(connect.includes(url), `CSP connect-src에 ${url} 이 없어요`);
});
