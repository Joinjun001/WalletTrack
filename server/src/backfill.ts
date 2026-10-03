/**
 * 과거 기록 채우기 (한 번 실행): 수집기를 켜기 전 기간의 김치 프리미엄·선물 지표를 거래소 과거 데이터로 계산해 DB에 넣는다.
 * 기록 추이 차트가 수집기를 켠 뒤부터만 보이던 문제를 메운다. 이미 있는 기록은 건드리지 않는다 (가장 오래된 기록 이전만 채움).
 *
 * 실행: cd server && docker compose run --rm collector node src/backfill.ts [김프 일수=90]
 *
 * - 김프: 업비트 1시간봉(코인, USDT) 종가 + 바이낸스 현물 1시간봉 종가 → 1시간 간격
 * - 선물: 바이낸스 미결제약정·롱 비율 1시간 통계(바이낸스가 최근 30일만 제공), 마크 가격 1시간봉, 그 시점에 정산된 펀딩비
 */

import { kimchiPremium } from '../../src/market.ts';
import { COINS } from '../../src/coins.ts';
import { config, log } from './config.ts';
import { closeDb, query } from './db.ts';

const UPBIT_API = 'https://api.upbit.com/v1';
const BINANCE_API = 'https://api.binance.com/api/v3';
const FAPI = 'https://fapi.binance.com';
const HOUR_MS = 60 * 60 * 1000;
const FUTURES_DAYS = 30; // 바이낸스 openInterestHist·롱숏 비율은 최근 30일까지만 준다
const UPBIT_GAP_MS = 150;  // 업비트 캔들 요청은 IP당 초당 10회까지

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    throw new Error(`${res.status} ${url}`);
  }
}

/** 이 종목의 가장 오래된 기록 시각. 그 이전만 채운다 (없으면 지금) */
async function oldestRecorded(table: 'kimchi_premium' | 'futures_stats', symbol: string): Promise<number> {
  const [row] = await query<{ t: Date | null }>(`SELECT min(recorded_at) AS t FROM ${table} WHERE symbol = $1`, [symbol]);
  return row?.t ? row.t.getTime() : Date.now();
}

// ---------- 김프 ----------

/** 업비트 1시간봉 종가: 캔들이 끝나는 시각(ms) → 가격. from 이후 ~ until 이전 */
async function upbitHourlyCloses(market: string, from: number, until: number): Promise<Map<number, number>> {
  const closes = new Map<number, number>();
  let to = new Date(until).toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (;;) {
    const list = await getJson<{ candle_date_time_utc: string; trade_price: number }[]>(
      `${UPBIT_API}/candles/minutes/60?market=${market}&count=200&to=${to}`
    );
    await sleep(UPBIT_GAP_MS);
    if (list.length === 0) break;
    for (const c of list) {
      const open = Date.parse(`${c.candle_date_time_utc}Z`);
      if (open >= from) closes.set(open + HOUR_MS, c.trade_price);
    }
    const oldest = list[list.length - 1].candle_date_time_utc;
    if (Date.parse(`${oldest}Z`) <= from || list.length < 200) break;
    to = `${oldest}Z`;
  }
  return closes;
}

/** 바이낸스 1시간봉 종가 (현물 또는 선물 마크 가격): 캔들이 끝나는 시각(ms) → 가격 */
async function binanceHourlyCloses(url: (start: number) => string, from: number, until: number): Promise<Map<number, number>> {
  const closes = new Map<number, number>();
  let start = from;
  while (start < until) {
    const list = await getJson<[number, string, string, string, string][]>(url(start));
    if (list.length === 0) break;
    for (const k of list) if (k[0] + HOUR_MS <= until) closes.set(k[0] + HOUR_MS, parseFloat(k[4]));
    start = list[list.length - 1][0] + HOUR_MS;
    if (list.length < 1000) break;
  }
  return closes;
}

async function backfillKimchi(days: number) {
  const from = Math.floor((Date.now() - days * 24 * HOUR_MS) / HOUR_MS) * HOUR_MS;
  const usdtUntil = Math.min(...(await Promise.all(COINS.map((c) => oldestRecorded('kimchi_premium', c.symbol)))));
  log(`김프: 업비트 USDT 1시간봉 받는 중 (${days}일)`);
  const usdt = await upbitHourlyCloses('KRW-USDT', from, usdtUntil);

  for (const { symbol } of COINS) {
    const until = await oldestRecorded('kimchi_premium', symbol);
    if (until <= from) continue;
    const [krw, usd] = await Promise.all([
      upbitHourlyCloses(`KRW-${symbol}`, from, until),
      binanceHourlyCloses((s) => `${BINANCE_API}/klines?symbol=${symbol}USDT&interval=1h&startTime=${s}&limit=1000`, from, until)
    ]);
    let saved = 0;
    for (const [t, krwPrice] of krw) {
      const usdPrice = usd.get(t);
      const usdtKrw = usdt.get(t);
      if (t >= until || !usdPrice || !usdtKrw) continue;
      const premium = kimchiPremium(krwPrice, usdPrice, usdtKrw);
      if (premium === null) continue;
      await query(
        `INSERT INTO kimchi_premium (symbol, recorded_at, krw_price, usd_price, usdt_krw, premium_pct)
         VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [symbol, t, krwPrice, usdPrice, usdtKrw, premium]
      );
      saved++;
    }
    log(`김프 ${symbol}: ${saved}개 저장`);
  }
}

// ---------- 선물 지표 ----------

/** 바이낸스 선물 통계(1시간): startTime만 주면 최신 500개를 주므로 500시간씩 끊어서 받는다 */
async function futuresStats<T extends { timestamp: number }>(path: string, symbol: string, from: number, until: number): Promise<T[]> {
  const rows: T[] = [];
  for (let start = from; start < until; ) {
    const end = Math.min(start + 500 * HOUR_MS, until);
    const list = await getJson<T[]>(`${FAPI}/futures/data/${path}?symbol=${symbol}&period=1h&limit=500&startTime=${start}&endTime=${end}`);
    rows.push(...list);
    start = list.length > 0 ? list[list.length - 1].timestamp + HOUR_MS : end;
  }
  return rows;
}

async function backfillFutures() {
  const from = Math.floor((Date.now() - (FUTURES_DAYS - 1) * 24 * HOUR_MS) / HOUR_MS) * HOUR_MS;
  for (const symbol of config.futuresSymbols) {
    const until = await oldestRecorded('futures_stats', symbol);
    if (until <= from) continue;
    const [oiList, ratioList, fundingList, marks] = await Promise.all([
      futuresStats<{ timestamp: number; sumOpenInterest: string }>('openInterestHist', symbol, from, until),
      futuresStats<{ timestamp: number; longAccount: string }>('globalLongShortAccountRatio', symbol, from, until),
      getJson<{ fundingTime: number; fundingRate: string }[]>(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${from - 8 * HOUR_MS}&limit=1000`),
      binanceHourlyCloses((s) => `${FAPI}/fapi/v1/markPriceKlines?symbol=${symbol}&interval=1h&startTime=${s}&limit=1000`, from, until)
    ]);
    const oi = new Map(oiList.map((r) => [r.timestamp, parseFloat(r.sumOpenInterest)]));
    const ratio = new Map(ratioList.map((r) => [r.timestamp, parseFloat(r.longAccount)]));
    fundingList.sort((a, b) => a.fundingTime - b.fundingTime);

    let saved = 0;
    for (let t = from; t < until; t += HOUR_MS) {
      // 그 시점에 가장 최근 정산된 펀딩비 (수집기는 다음 정산 예정 값을 저장하지만 과거에는 정산 값만 있다)
      let funding: number | null = null;
      for (const f of fundingList) {
        if (f.fundingTime > t) break;
        funding = parseFloat(f.fundingRate);
      }
      const row = [funding, oi.get(t) ?? null, marks.get(t) ?? null, ratio.get(t) ?? null];
      if (row.every((v) => v === null)) continue;
      await query(
        `INSERT INTO futures_stats (symbol, recorded_at, funding_rate, open_interest, mark_price, long_ratio)
         VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [symbol, t, ...row]
      );
      saved++;
    }
    log(`선물 ${symbol}: ${saved}개 저장`);
  }
}

async function main() {
  const days = Number(process.argv[2]) || 90;
  await backfillKimchi(Math.min(days, config.retentionDays));
  await backfillFutures();
  log('과거 기록 채우기 완료');
}

main()
  .catch((e) => {
    log('과거 기록 채우기 실패:', e);
    process.exitCode = 1;
  })
  .finally(closeDb);
