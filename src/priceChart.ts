/**
 * 업비트 원화 캔들 차트 (TradingView lightweight-charts). 과거 캔들은 REST, 현재 캔들은 실시간 시세로 갱신한다.
 * 업비트는 한 번에 200개까지만 주므로, 차트를 왼쪽 끝 가까이 옮기면 그 이전 200개를 이어서 받는다.
 */

import { createChart, CandlestickSeries, HistogramSeries, ColorType } from 'lightweight-charts';
import type { DeepPartial, IChartApi, ISeriesApi, TimeChartOptions, UTCTimestamp } from 'lightweight-charts';
import { onUpbitTicker } from './krMarket.ts';
import { coinName } from './coins.ts';
import { applyTick, candleTimeOf, krwPricePrecision, KST_OFFSET_SEC } from './market.ts';
import type { Candle } from './market.ts';
import { track } from './analytics.ts';
import { getUpbit } from './historyApi.ts';
import { chartThemeOptions, registerThemedChart } from './theme.ts';

const UPBIT_CANDLES = 'https://api.upbit.com/v1/candles';
const CANDLE_COUNT = 200;
const REFRESH_MS = 60 * 1000; // 거래량 등 실시간으로 못 받는 값을 맞추기 위한 재조회
const CANDLE_RETRY_MS = 5 * 1000;
const LOAD_OLDER_MARGIN = 30; // 왼쪽 끝까지 이만큼 캔들이 남으면 이전 캔들을 미리 받는다

const INTERVALS: Record<string, { path: string; seconds: number }> = {
  '1m': { path: 'minutes/1', seconds: 60 },
  '15m': { path: 'minutes/15', seconds: 900 },
  '1h': { path: 'minutes/60', seconds: 3600 },
  '1d': { path: 'days', seconds: 86400 }
};

const UP_COLOR = '#00E676';
const DOWN_COLOR = '#FF5252';

interface UpbitCandle {
  candle_date_time_utc: string; // "2026-10-03T12:00:00"
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  candle_acc_trade_volume: number;
}

let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let volumeSeries: ISeriesApi<'Histogram'> | null = null;
let symbol = 'BTC';
let interval = '15m';
let lastCandle: Candle | null = null;
let pricePrecision = 0;
let oldestUtc: string | null = null; // 받아 둔 가장 오래된 캔들 시각 (업비트 to 값으로 쓴다)
let loadingOlder = false;
let noMoreOlder = false;

function toCandle(c: UpbitCandle): Candle {
  return {
    time: Date.parse(`${c.candle_date_time_utc}Z`) / 1000 + KST_OFFSET_SEC,
    open: c.opening_price,
    high: c.high_price,
    low: c.low_price,
    close: c.trade_price
  };
}

function volumeBar(c: UpbitCandle, time: number) {
  return {
    time: time as UTCTimestamp,
    value: c.candle_acc_trade_volume,
    color: c.trade_price >= c.opening_price ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 82, 82, 0.35)'
  };
}

/** to: 이 시각(UTC, 미포함) 이전 캔들. 없으면 최신 캔들 */
async function fetchCandles(count: number, to?: string): Promise<UpbitCandle[] | null> {
  const key = `${symbol}|${interval}`;
  const unit = INTERVALS[interval].path;
  const query = `market=KRW-${symbol}&count=${count}${to ? `&to=${to}` : ''}`;
  const list = await getUpbit<UpbitCandle[]>(`/upbit/candles?unit=${unit}&${query}`, `${UPBIT_CANDLES}/${unit}?${query}`);
  // 그 사이 코인/간격이 바뀌었으면 버린다
  return list && key === `${symbol}|${interval}` ? list.slice().reverse() : null;
}

async function loadCandles() {
  if (!candleSeries || !volumeSeries) return;
  const status = document.getElementById('price-chart-status');
  const list = await fetchCandles(CANDLE_COUNT);
  if (!list || list.length === 0) {
    // 일시적으로 못 받으면 잠시 뒤 다시 시도한다 (빈 차트로 남지 않게)
    if (status) status.hidden = false;
    setTimeout(() => { if (!lastCandle) loadCandles(); }, CANDLE_RETRY_MS);
    return;
  }
  if (status) status.hidden = true;

  const candles = list.map(toCandle);
  pricePrecision = krwPricePrecision(candles[candles.length - 1].close);
  candleSeries.applyOptions({ priceFormat: { type: 'price', precision: pricePrecision, minMove: 1 / 10 ** pricePrecision } });
  candleSeries.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
  volumeSeries.setData(list.map((c, i) => volumeBar(c, candles[i].time)));
  lastCandle = candles[candles.length - 1];
  oldestUtc = list[0].candle_date_time_utc;
  noMoreOlder = list.length < CANDLE_COUNT;
}

/** 지금 받아 둔 것보다 이전 캔들 200개를 앞에 붙인다 */
async function loadOlderCandles() {
  if (!candleSeries || !volumeSeries || !oldestUtc || loadingOlder || noMoreOlder) return;
  loadingOlder = true;
  const key = `${symbol}|${interval}`;
  try {
    const list = await fetchCandles(CANDLE_COUNT, `${oldestUtc}Z`);
    if (!list || key !== `${symbol}|${interval}`) return;
    if (list.length < CANDLE_COUNT) noMoreOlder = true;
    if (list.length === 0) return;
    const candles = list.map(toCandle);
    const firstTime = candleSeries.data()[0]?.time as number | undefined;
    // 혹시 겹치는 캔들이 오면 뺀다 (to는 미포함이지만 방어)
    const keep = candles.map((c, i) => [c, list[i]] as const).filter(([c]) => firstTime === undefined || c.time < firstTime);
    candleSeries.setData([...keep.map(([c]) => ({ ...c, time: c.time as UTCTimestamp })), ...candleSeries.data()]);
    volumeSeries.setData([...keep.map(([c, raw]) => volumeBar(raw, c.time)), ...volumeSeries.data()]);
    oldestUtc = list[0].candle_date_time_utc;
    track('chart_load_older', { interval, symbol });
  } finally {
    loadingOlder = false;
  }
}

/** 코인이나 간격이 바뀌면 처음부터 다시 받는다 */
function resetCandles() {
  lastCandle = null;
  oldestUtc = null;
  noMoreOlder = false;
  loadCandles();
}

/** 현재 캔들만 다시 받아 거래량을 맞춘다. setData를 다시 하면 사용자가 옮긴 화면 위치가 초기화된다. */
async function refreshLatestCandle() {
  if (!candleSeries || !volumeSeries || !lastCandle) return;
  const list = await fetchCandles(1);
  const raw = list?.[0];
  if (!raw || !lastCandle) return;
  const candle = toCandle(raw);
  if (candle.time < lastCandle.time) return;
  lastCandle = candle;
  candleSeries.update({ ...candle, time: candle.time as UTCTimestamp });
  volumeSeries.update(volumeBar(raw, candle.time));
}

function applyLivePrice(price: number, tradeMs: number) {
  if (!candleSeries || !lastCandle) return;
  const next = applyTick(lastCandle, price, candleTimeOf(tradeMs, INTERVALS[interval].seconds));
  if (!next) return;
  lastCandle = next;
  candleSeries.update({ ...next, time: next.time as UTCTimestamp });
}

/** 사이트 차트 공통 모양 (기록 추이 차트도 같이 쓴다) */
export function baseChartOptions(): DeepPartial<TimeChartOptions> {
  const themed = chartThemeOptions();
  return {
    ...themed,
    autoSize: true,
    layout: {
      ...themed.layout,
      background: { type: ColorType.Solid, color: 'transparent' },
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11
    },
    timeScale: { ...themed.timeScale, timeVisible: true, secondsVisible: false }
  };
}

function renderTitle() {
  const title = document.getElementById('chart-title');
  if (title) title.textContent = `${coinName(symbol)} ${symbol}/KRW`;
}

/** 코인 시세 표에서 행을 누르면 호출 */
export function selectChartCoin(next: string) {
  if (next === symbol) return;
  symbol = next;
  renderTitle();
  resetCandles();
}

export function initPriceChart() {
  const container = document.getElementById('price-chart');
  if (!container) return;

  chart = createChart(container, {
    ...baseChartOptions(),
    localization: {
      locale: 'ko-KR',
      priceFormatter: (p: number) => p.toLocaleString('ko-KR', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision })
    }
  });

  registerThemedChart(chart);

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
    borderVisible: false
  });
  volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range && range.from < LOAD_OLDER_MARGIN) loadOlderCandles();
  });

  document.querySelectorAll<HTMLButtonElement>('.interval-btn[data-interval]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.interval;
      if (!next || !INTERVALS[next] || next === interval) return;
      interval = next;
      track('chart_interval', { interval, symbol });
      document.querySelectorAll('.interval-btn[data-interval]').forEach((b) => b.classList.toggle('active', b === btn));
      resetCandles();
    });
  });

  onUpbitTicker((market, t) => {
    if (market === `KRW-${symbol}`) applyLivePrice(t.trade_price, t.trade_timestamp || Date.now());
  });

  renderTitle();
  loadCandles();
  setInterval(refreshLatestCandle, REFRESH_MS);
}
