/**
 * 데이터 수집기: 거래소·블록체인 실시간 데이터를 받아 DB에 저장한다.
 * - 고래 거래: mempool.space 미확인 거래 → 웹과 같은 analyzeTransaction으로 금액/입출금 판정
 * - 강제청산: 바이낸스 선물 전체 마켓
 * - 선물 지표: 펀딩비, 미결제약정, 롱/숏 비율 (FUTURES_INTERVAL_SEC마다)
 * - 김치 프리미엄: 업비트 원화 가격 vs 바이낸스 달러 가격 (KIMCHI_INTERVAL_SEC마다)
 */

import { analyzeTransaction, fromMempoolTx } from '../../src/txAnalysis.ts';
import type { MempoolTx } from '../../src/txAnalysis.ts';
import { kimchiPremium, liquidatedPosition } from '../../src/market.ts';
import { COINS } from '../../src/coins.ts';
import { config, log } from './config.ts';
import { dryRun, migrate, query } from './db.ts';
import { keepStream } from './stream.ts';

const MEMPOOL_WS = 'wss://mempool.space/api/v1/ws';
const LIQUIDATION_WS = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const FAPI = 'https://fapi.binance.com';
const BINANCE_API = 'https://api.binance.com/api/v3';
const UPBIT_API = 'https://api.upbit.com/v1';
const STATS_LOG_MS = 10 * 60 * 1000;
const RETENTION_CHECK_MS = 60 * 60 * 1000;

const saved = { whales: 0, liquidations: 0, futures: 0, kimchi: 0 };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

// ---------- 고래 거래 ----------

async function saveWhale(tx: MempoolTx) {
  const { hash, btcAmount, direction, exchange } = analyzeTransaction(fromMempoolTx(tx));
  if (btcAmount < config.minWhaleBtc) return;
  await query(
    `INSERT INTO whale_txs (hash, btc_amount, direction, exchange_address)
     VALUES ($1, $2, $3, $4) ON CONFLICT (hash) DO NOTHING`,
    [hash, btcAmount, direction, exchange?.address ?? null]
  );
  saved.whales++;
}

function collectWhales() {
  keepStream('mempool.space', {
    url: MEMPOOL_WS,
    idleMs: 60_000,
    onOpen: (ws) => ws.send(JSON.stringify({ 'track-mempool': true })),
    onMessage: async (data) => {
      const added: MempoolTx[] | undefined = JSON.parse(data)?.['mempool-transactions']?.added;
      if (!added) return;
      for (const tx of added) await saveWhale(tx);
    }
  });
}

// ---------- 강제청산 ----------

interface ForceOrder {
  o?: { s: string; S: string; ap: string; z: string; T: number };
}

function collectLiquidations() {
  keepStream('binance 청산', {
    url: LIQUIDATION_WS,
    idleMs: 10 * 60_000, // 장이 조용하면 몇 분씩 청산이 없을 수 있다
    onMessage: async (data) => {
      const order = (JSON.parse(data) as ForceOrder).o;
      if (!order) return;
      const price = parseFloat(order.ap);
      const quantity = parseFloat(order.z);
      if (!(price > 0 && quantity > 0)) return;
      await query(
        `INSERT INTO liquidations (symbol, position, price, quantity, usd_value, occurred_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) ON CONFLICT DO NOTHING`,
        [order.s, liquidatedPosition(order.S), price, quantity, price * quantity, order.T]
      );
      saved.liquidations++;
    }
  });
}

// ---------- 선물 지표 ----------

async function saveFuturesStats(symbol: string) {
  const [premium, oi, ratio] = await Promise.all([
    getJson<{ markPrice: string; lastFundingRate: string }>(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`),
    getJson<{ openInterest: string }>(`${FAPI}/fapi/v1/openInterest?symbol=${symbol}`),
    getJson<{ longAccount: string }[]>(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`)
  ]);
  await query(
    `INSERT INTO futures_stats (symbol, recorded_at, funding_rate, open_interest, mark_price, long_ratio)
     VALUES ($1, date_trunc('minute', now()), $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [symbol, parseFloat(premium.lastFundingRate), parseFloat(oi.openInterest), parseFloat(premium.markPrice),
      ratio[0] ? parseFloat(ratio[0].longAccount) : null]
  );
  saved.futures++;
}

async function collectFutures() {
  for (const symbol of config.futuresSymbols) {
    try {
      await saveFuturesStats(symbol);
    } catch (e) {
      log(`선물 지표 ${symbol} 실패:`, (e as Error).message);
    }
  }
}

// ---------- 김치 프리미엄 ----------

async function collectKimchi() {
  try {
    const markets = ['KRW-USDT', ...COINS.map((c) => `KRW-${c.symbol}`)];
    const symbols = JSON.stringify(COINS.map((c) => `${c.symbol}USDT`));
    const [upbit, binance] = await Promise.all([
      getJson<{ market: string; trade_price: number }[]>(`${UPBIT_API}/ticker?markets=${markets.join(',')}`),
      getJson<{ symbol: string; price: string }[]>(`${BINANCE_API}/ticker/price?symbols=${encodeURIComponent(symbols)}`)
    ]);
    const krw = new Map(upbit.map((t) => [t.market.replace(/^KRW-/, ''), t.trade_price]));
    const usd = new Map(binance.map((t) => [t.symbol.replace(/USDT$/, ''), parseFloat(t.price)]));
    const usdtKrw = krw.get('USDT') ?? 0;

    for (const { symbol } of COINS) {
      const krwPrice = krw.get(symbol) ?? 0;
      const usdPrice = usd.get(symbol) ?? 0;
      const premium = kimchiPremium(krwPrice, usdPrice, usdtKrw);
      if (premium === null) continue;
      await query(
        `INSERT INTO kimchi_premium (symbol, recorded_at, krw_price, usd_price, usdt_krw, premium_pct)
         VALUES ($1, date_trunc('minute', now()), $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [symbol, krwPrice, usdPrice, usdtKrw, premium]
      );
      saved.kimchi++;
    }
  } catch (e) {
    log('김치 프리미엄 실패:', (e as Error).message);
  }
}

// ---------- 오래된 기록 정리 ----------

async function deleteOldRows() {
  const tables: [string, string][] = [
    ['whale_txs', 'detected_at'],
    ['liquidations', 'occurred_at'],
    ['futures_stats', 'recorded_at'],
    ['kimchi_premium', 'recorded_at'],
    ['usage_events', 'created_at']
  ];
  try {
    for (const [table, column] of tables) {
      await query(`DELETE FROM ${table} WHERE ${column} < now() - $1::int * interval '1 day'`, [config.retentionDays]);
    }
  } catch (e) {
    log('오래된 기록 정리 실패:', (e as Error).message);
  }
}

function every(ms: number, fn: () => Promise<void>) {
  fn();
  setInterval(fn, ms);
}

async function main() {
  log(`수집기 시작${dryRun ? ' (dry-run: DATABASE_URL 없음, 저장하지 않고 로그만 출력)' : ''}`);
  await migrate();

  collectWhales();
  collectLiquidations();
  every(config.futuresIntervalMs, collectFutures);
  every(config.kimchiIntervalMs, collectKimchi);
  if (!dryRun) every(RETENTION_CHECK_MS, deleteOldRows);

  setInterval(() => {
    log(`최근 10분 저장: 고래 ${saved.whales}, 청산 ${saved.liquidations}, 선물 ${saved.futures}, 김프 ${saved.kimchi}`);
    saved.whales = saved.liquidations = saved.futures = saved.kimchi = 0;
  }, STATS_LOG_MS);
}

main().catch((e) => {
  log('수집기 시작 실패:', e);
  process.exit(1);
});
