/**
 * 대형 체결(1 BTC 이상) 1분 합계 수집 — 고래 체결 탭의 하루·1주·1달 합계용 (big_trade_minutes 테이블).
 *
 * - 실시간: 바이낸스 선물·현물, 바이비트, OKX 체결 스트림 + 업비트(수집기의 업비트 연결에 함께 구독).
 *   웹과 같은 TradeMerger로 주문 단위로 묶고, 1분 합계만 1분에 한 번 저장한다.
 * - 과거 채우기: 거래소가 공개하는 일별 체결 파일(바이낸스 선물·현물, 바이비트)로 지난 30일을 채운다.
 *   파일은 다음 날 올라오므로 6시간마다 아직 못 채운 날을 다시 확인한다 (수집기가 멈췄던 구간도 메워진다).
 *   업비트는 체결 조회 API가 최근 7일만 주므로 처음 한 번만 채운다. OKX는 과거 없이 실시간부터.
 * - 실시간이 시작된 분 이후는 실시간 값이 우선이다 (과거 채우기는 이미 있는 분을 건드리지 않는다).
 */

import { Readable } from 'node:stream';
import { createGunzip, createInflateRaw } from 'node:zlib';
import { createInterface } from 'node:readline';
import { parseBinanceAggTrade, parseBybitTrades, parseOkxTrades, parseUpbitTrade, TradeMerger } from '../../src/exchangeFeeds.ts';
import type { Fill } from '../../src/exchangeFeeds.ts';
import { MinuteSums, parseBinanceAggTradeCsv, parseBybitCsv, parseUpbitTick } from '../../src/bigTradeStats.ts';
import type { MinuteRow } from '../../src/bigTradeStats.ts';
import { log } from './config.ts';
import { dryRun, query } from './db.ts';
import { keepStream } from './stream.ts';

const MERGE_MS = 100;           // 웹(btcStreams.ts)과 같은 묶음 기준
const SAVE_MS = 60_000;
const SAVE_DELAY_MS = 2_000;    // 분이 끝나고 묶음이 마저 나올 시간
const HISTORY_DAYS = 30;
const HISTORY_CHECK_MS = 6 * 60 * 60_000;
const HISTORY_START_DELAY_MS = 60_000; // 수집기 시작 직후 부하를 피한다
const UPBIT_DAYS = 7;
const UPBIT_GAP_MS = 150;       // 업비트 REST는 IP당 초당 10회
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 이 분부터는 실시간 값으로 채운다 (시작한 분은 일부만 받으므로 다음 분부터)
const liveFrom = Math.ceil(Date.now() / MINUTE_MS) * MINUTE_MS;

const liveSums = new MinuteSums();
const liveMerger = new TradeMerger(MERGE_MS, (t) => {
  if (t.ts >= liveFrom) liveSums.add(t);
});
let savedMinutes = 0;

function addLiveFill(fill: Fill | null) {
  if (fill) liveMerger.add(fill, Date.now());
}

/** 수집기의 업비트 연결로 받은 체결 메시지 */
export function addUpbitTradeMessage(msg: Record<string, unknown>) {
  addLiveFill(parseUpbitTrade(msg));
}

async function saveRows(rows: MinuteRow[], mode: 'add' | 'keep') {
  if (rows.length === 0) return;
  const onConflict = mode === 'add'
    ? `DO UPDATE SET buy_btc = big_trade_minutes.buy_btc + excluded.buy_btc, sell_btc = big_trade_minutes.sell_btc + excluded.sell_btc,
         buy_count = big_trade_minutes.buy_count + excluded.buy_count, sell_count = big_trade_minutes.sell_count + excluded.sell_count`
    : 'DO NOTHING';
  await query(
    `INSERT INTO big_trade_minutes (minute, exchange, buy_btc, sell_btc, buy_count, sell_count)
     SELECT to_timestamp(m / 1000.0), e, b, s, bc, sc
     FROM unnest($1::float8[], $2::text[], $3::float8[], $4::float8[], $5::int[], $6::int[]) AS t(m, e, b, s, bc, sc)
     ON CONFLICT (minute, exchange) ${onConflict}`,
    [rows.map((r) => r.minute), rows.map((r) => r.exchange), rows.map((r) => r.buyBtc), rows.map((r) => r.sellBtc),
      rows.map((r) => r.buyCount), rows.map((r) => r.sellCount)]
  );
}

/** keepStream + 주기적 ping (바이비트·OKX는 ping이 없으면 끊는다) */
function tradeStream(name: string, url: string, onMessage: (data: string) => void, subscribe?: unknown, ping?: { message: string; ms: number }) {
  keepStream(name, {
    url,
    idleMs: 60_000,
    onOpen: (ws) => {
      if (subscribe) ws.send(JSON.stringify(subscribe));
      if (!ping) return;
      const timer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(ping.message);
        else if (ws.readyState === WebSocket.CLOSED) clearInterval(timer);
      }, ping.ms);
    },
    onMessage: (data) => {
      if (data === 'pong') return; // OKX
      onMessage(data);
    }
  });
}

export function collectBigTrades() {
  tradeStream('바이낸스 선물 체결', 'wss://fstream.binance.com/market/ws/btcusdt@aggTrade',
    (data) => addLiveFill(parseBinanceAggTrade(JSON.parse(data), 'binance-futures')));
  tradeStream('바이낸스 현물 체결', 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade',
    (data) => addLiveFill(parseBinanceAggTrade(JSON.parse(data), 'binance-spot')));
  tradeStream('바이비트 체결', 'wss://stream.bybit.com/v5/public/linear',
    (data) => parseBybitTrades(JSON.parse(data)).forEach(addLiveFill),
    { op: 'subscribe', args: ['publicTrade.BTCUSDT'] }, { message: '{"op":"ping"}', ms: 20_000 });
  tradeStream('OKX 체결', 'wss://ws.okx.com:8443/ws/v5/public',
    (data) => parseOkxTrades(JSON.parse(data)).forEach(addLiveFill),
    { op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT-SWAP' }] }, { message: 'ping', ms: 25_000 });

  setInterval(() => liveMerger.flushIdle(Date.now()), MERGE_MS * 5);
  setInterval(async () => {
    const rows = liveSums.take(Date.now() - SAVE_DELAY_MS);
    try {
      await saveRows(rows, 'add');
      savedMinutes += rows.length;
    } catch (e) {
      log('대형 체결 저장 실패:', (e as Error).message);
    }
  }, SAVE_MS);

  if (!dryRun) {
    query(`INSERT INTO big_trade_live (started_at) VALUES (to_timestamp($1 / 1000.0)) ON CONFLICT DO NOTHING`, [liveFrom])
      .catch((e) => log('대형 체결 시작 시각 저장 실패:', (e as Error).message));
    setTimeout(() => {
      fillHistory();
      setInterval(fillHistory, HISTORY_CHECK_MS);
    }, HISTORY_START_DELAY_MS);
  }
}

/** 최근 저장 수 (수집기 10분 로그용) */
export function takeSavedCount(): number {
  const n = savedMinutes;
  savedMinutes = 0;
  return n;
}

// ---------- 과거 채우기 ----------

export type FileSource = 'binance-futures' | 'binance-spot' | 'bybit';

export const FILE_URLS: Record<FileSource, (day: string) => string> = {
  'binance-futures': (d) => `https://data.binance.vision/data/futures/um/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-${d}.zip`,
  'binance-spot': (d) => `https://data.binance.vision/data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-${d}.zip`,
  bybit: (d) => `https://public.bybit.com/trading/BTCUSDT/BTCUSDT${d}.csv.gz`
};

/** zip 안의 첫 파일(압축 해제 스트림). 바이낸스 파일은 CSV 하나만 들어 있다 */
function unzipFirst(buf: Buffer): Readable {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 아님');
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  if (method !== 8 || size === 0) throw new Error(`지원하지 않는 zip (method ${method}, size ${size})`);
  return Readable.from([buf.subarray(start, start + size)]).pipe(createInflateRaw());
}

/** 하루치 파일을 받아 1분 합계로. 아직 안 올라왔으면 null */
async function fileDayRows(source: FileSource, day: string): Promise<MinuteRow[] | null> {
  const res = await fetch(FILE_URLS[source](day), { signal: AbortSignal.timeout(5 * 60_000) });
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`${res.status}`);
  const input = source === 'bybit'
    ? Readable.fromWeb(res.body as never).pipe(createGunzip())
    : unzipFirst(Buffer.from(await res.arrayBuffer()));

  const sums = new MinuteSums();
  const merger = new TradeMerger(MERGE_MS, (t) => sums.add(t));
  let n = 0;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const fill = source === 'bybit' ? parseBybitCsv(line) : parseBinanceAggTradeCsv(line, source);
    if (!fill) continue;
    merger.add(fill, fill.ts); // 파일은 시간순이라 체결 시각을 '지금'으로 쓴다
    if (++n % 1000 === 0) merger.flushIdle(fill.ts);
  }
  merger.flushIdle(Infinity);
  return sums.take();
}

/** 업비트 최근 7일 체결 (조회 API, 하루씩 뒤로 넘기며) */
async function upbitRows(): Promise<MinuteRow[]> {
  const fills: Fill[] = [];
  const oldest = Date.now() - UPBIT_DAYS * DAY_MS;
  for (let daysAgo = 0; daysAgo <= UPBIT_DAYS; daysAgo++) {
    let cursor = '';
    for (;;) {
      const url = `https://api.upbit.com/v1/trades/ticks?market=KRW-BTC&count=500${daysAgo ? `&days_ago=${daysAgo}` : ''}${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      await sleep(UPBIT_GAP_MS);
      if (res.status === 429) {
        await sleep(2000);
        continue;
      }
      if (!res.ok) throw new Error(`업비트 ${res.status}`);
      const list = (await res.json()) as { timestamp: number; trade_volume: number; ask_bid: string; sequential_id: number }[];
      for (const t of list) {
        const fill = parseUpbitTick(t);
        if (fill && fill.ts >= oldest) fills.push(fill);
      }
      if (list.length < 500) break;
      cursor = String(list[list.length - 1].sequential_id);
    }
  }
  fills.sort((a, b) => a.ts - b.ts);
  const sums = new MinuteSums();
  const merger = new TradeMerger(MERGE_MS, (t) => sums.add(t));
  for (const f of fills) {
    merger.add(f, f.ts);
    merger.flushIdle(f.ts);
  }
  merger.flushIdle(Infinity);
  return sums.take();
}

async function isFilled(source: string, day: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM big_trade_filled WHERE source = $1 AND day = $2`, [source, day]);
  return rows.length > 0;
}

async function markFilled(source: string, day: string) {
  await query(`INSERT INTO big_trade_filled (source, day) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [source, day]);
}

let filling = false;

async function fillHistory() {
  if (filling) return;
  filling = true;
  try {
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    for (let i = HISTORY_DAYS; i >= 1; i--) {
      const day = new Date(today - i * DAY_MS).toISOString().slice(0, 10);
      for (const source of Object.keys(FILE_URLS) as FileSource[]) {
        if (await isFilled(source, day)) continue;
        try {
          const rows = await fileDayRows(source, day);
          if (!rows) continue; // 아직 안 올라온 날은 다음 확인 때
          // 실시간으로 받은 분은 그대로 둔다
          await saveRows(rows, 'keep');
          await markFilled(source, day);
          log(`대형 체결 과거 채우기 ${source} ${day}: ${rows.length}분`);
        } catch (e) {
          log(`대형 체결 과거 채우기 ${source} ${day} 실패:`, (e as Error).message);
        }
      }
    }
    if (!(await isFilled('upbit', '1970-01-01'))) {
      // 실시간 시작 전 분만 (그 뒤는 실시간 값)
      const rows = (await upbitRows()).filter((r) => r.minute < liveFrom);
      await saveRows(rows, 'keep');
      await markFilled('upbit', '1970-01-01'); // 업비트는 처음 한 번만
      log(`대형 체결 과거 채우기 업비트 ${UPBIT_DAYS}일: ${rows.length}분`);
    }
  } catch (e) {
    log('대형 체결 과거 채우기 실패:', (e as Error).message);
  } finally {
    filling = false;
  }
}
