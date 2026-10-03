/**
 * 업비트 원화 캔들 차트 (TradingView lightweight-charts). 과거 캔들은 REST, 현재 캔들은 실시간 시세로 갱신한다.
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

async function fetchCandles(count: number): Promise<UpbitCandle[] | null> {
  const key = `${symbol}|${interval}`;
  const unit = INTERVALS[interval].path;
  const list = await getUpbit<UpbitCandle[]>(
    `/upbit/candles?unit=${unit}&market=KRW-${symbol}&count=${count}`,
    `${UPBIT_CANDLES}/${unit}?market=KRW-${symbol}&count=${count}`
  );
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
  lastCandle = null;
  renderTitle();
  loadCandles();
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

  document.querySelectorAll<HTMLButtonElement>('.interval-btn[data-interval]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.interval;
      if (!next || !INTERVALS[next] || next === interval) return;
      interval = next;
      track('chart_interval', { interval, symbol });
      document.querySelectorAll('.interval-btn[data-interval]').forEach((b) => b.classList.toggle('active', b === btn));
      lastCandle = null;
      loadCandles();
    });
  });

  onUpbitTicker((market, t) => {
    if (market === `KRW-${symbol}`) applyLivePrice(t.trade_price, t.trade_timestamp || Date.now());
  });

  renderTitle();
  loadCandles();
  setInterval(refreshLatestCandle, REFRESH_MS);
}
