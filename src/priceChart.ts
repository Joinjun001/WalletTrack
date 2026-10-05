/**
 * 업비트 원화 캔들 차트 (TradingView lightweight-charts). 과거 캔들은 REST, 현재 캔들은 실시간 시세로 갱신한다.
 * 업비트는 한 번에 200개까지만 주므로, 차트를 왼쪽 끝 가까이 옮기면 그 이전 200개를 이어서 받는다.
 * 캔들 위에 큰 강제청산(바이낸스 선물, 그 코인)과 고래 거래소 입출금(비트코인만)을 표시한다 (기록 서버, 캔들 구간별 합계).
 * 차트 위 정보 줄에는 커서를 올린 캔들(없으면 최신 캔들)의 시가·고가·저가·종가·변동률·거래량을 보여 준다.
 */

import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, ColorType } from 'lightweight-charts';
import type { CandlestickData, DeepPartial, HistogramData, IChartApi, ISeriesApi, ISeriesMarkersPluginApi, SeriesMarker, Time, TimeChartOptions, UTCTimestamp } from 'lightweight-charts';
import { onUpbitTicker } from './krMarket.ts';
import { coinName } from './coins.ts';
import { applyTick, candleTimeOf, formatKrwShort, formatSignedPct, formatUsdShort, krwPricePrecision, KST_OFFSET_SEC, topByValue } from './market.ts';
import type { Candle, CandleInterval } from './market.ts';
import { track } from './analytics.ts';
import { getHistory, getUpbit } from './historyApi.ts';
import type { LiquidationBucket, WhaleBucket } from './historyApi.ts';
import { chartThemeOptions, marketColors, onMarketColorsChange, registerThemedChart } from './theme.ts';
import { onSelectedCoinChange, selectedCoin } from './selectedCoin.ts';

const UPBIT_CANDLES = 'https://api.upbit.com/v1/candles';
const CANDLE_COUNT = 200;
const REFRESH_MS = 60 * 1000; // 거래량 등 실시간으로 못 받는 값을 맞추기 위한 재조회
const CANDLE_RETRY_MS = 5 * 1000;
const LOAD_OLDER_MARGIN = 30; // 왼쪽 끝까지 이만큼 캔들이 남으면 이전 캔들을 미리 받는다

// 차트 표시: 캔들 구간별 합계가 큰 것부터 몇 개만 (너무 많으면 캔들이 가려진다)
const MARKERS_KEY = 'wallettrack.chartMarkers';
const MAX_LIQ_MARKERS = 5;    // 롱·숏 각각
const MIN_LIQ_USD = 20_000;
const MAX_WHALE_MARKERS = 3;  // 입금·출금 각각
const MIN_WHALE_BTC = 50;
const MAX_MARKER_HOURS = 720; // 기록 서버가 받는 최대 기간
const MAX_MARKER_BUCKETS = 4_900; // 기록 서버가 한 번에 받는 구간 수(5,000)보다 조금 적게
// 고래 입출금 색은 고래 카드와 같게 고정 (상승·하락 색 설정과 무관)
const WHALE_DEPOSIT_COLOR = '#FF5252';
const WHALE_WITHDRAWAL_COLOR = '#00C853';
type MarkerKind = 'liq' | 'whale';

const DAY = 86400;
/** bucket: 캔들 구간 (주·월은 길이가 일정하지 않다). markers: 청산·고래 표시 가능 여부 (기록 서버 구간은 최대 1일) */
const INTERVALS: Record<string, { path: string; bucket: CandleInterval; markers: boolean }> = {
  '1m': { path: 'minutes/1', bucket: 60, markers: true },
  '3m': { path: 'minutes/3', bucket: 180, markers: true },
  '5m': { path: 'minutes/5', bucket: 300, markers: true },
  '15m': { path: 'minutes/15', bucket: 900, markers: true },
  '30m': { path: 'minutes/30', bucket: 1800, markers: true },
  '1h': { path: 'minutes/60', bucket: 3600, markers: true },
  '4h': { path: 'minutes/240', bucket: 14400, markers: true },
  '1d': { path: 'days', bucket: DAY, markers: true },
  '1w': { path: 'weeks', bucket: 'week', markers: false },
  '1M': { path: 'months', bucket: 'month', markers: false }
};

/** 표시 구간의 초 (주·월은 정보 줄 시각 형식에만 쓴다) */
function intervalSeconds(): number {
  const b = INTERVALS[interval].bucket;
  return b === 'week' ? 7 * DAY : b === 'month' ? 30 * DAY : b;
}

interface UpbitCandle {
  candle_date_time_utc: string; // "2026-10-03T12:00:00"
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  candle_acc_trade_volume: number;
  candle_acc_trade_price: number; // 원화 거래대금
}

let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<'Candlestick'> | null = null;
let volumeSeries: ISeriesApi<'Histogram'> | null = null;
let seriesMarkers: ISeriesMarkersPluginApi<Time> | null = null;
let markerKinds = loadMarkerKinds();
let markerData: { key: string; liq: LiquidationBucket[]; whale: WhaleBucket[] } | null = null;
let markerRequest = 0;
let symbol = selectedCoin();
let interval = '15m';
let lastCandle: Candle | null = null;
let pricePrecision = 0;
let oldestUtc: string | null = null; // 받아 둔 가장 오래된 캔들 시각 (업비트 to 값으로 쓴다)
let loadingOlder = false;
let noMoreOlder = false;
const turnover = new Map<number, number>(); // 캔들 시각 → 원화 거래대금 (정보 줄)
let hovering = false;

interface MarkerInfo {
  kind: MarkerKind;
  title: string;  // 크게: "💥 숏 청산 $5.6M"
  detail: string;
}
const markerInfo = new Map<string, MarkerInfo>(); // 표시 id → 내용
let hoveredMarker: string | null = null;
let markerTip: HTMLElement | null = null;

function toCandle(c: UpbitCandle): Candle {
  return {
    time: Date.parse(`${c.candle_date_time_utc}Z`) / 1000 + KST_OFFSET_SEC,
    open: c.opening_price,
    high: c.high_price,
    low: c.low_price,
    close: c.trade_price
  };
}

const VOLUME_ALPHA = 0.35;

function volumeColor(rising: boolean): string {
  const colors = marketColors();
  return rising ? colors.upAlpha(VOLUME_ALPHA) : colors.downAlpha(VOLUME_ALPHA);
}

function volumeBar(c: UpbitCandle, time: number) {
  return {
    time: time as UTCTimestamp,
    value: c.candle_acc_trade_volume,
    color: volumeColor(c.trade_price >= c.opening_price)
  };
}

function candleColors() {
  const { up, down } = marketColors();
  return { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down };
}

/** 상승·하락 색 설정이 바뀌면 캔들과 거래량 막대를 다시 칠한다 */
function recolor() {
  if (!candleSeries || !volumeSeries) return;
  candleSeries.applyOptions(candleColors());
  const rising = new Map(candleSeries.data().map((c) => [c.time, 'close' in c && c.close >= c.open]));
  volumeSeries.setData(volumeSeries.data().map((v) => ({ ...v, color: volumeColor(rising.get(v.time) ?? true) })));
  drawMarkers();
}

function loadMarkerKinds(): Set<MarkerKind> {
  try {
    const saved = JSON.parse(localStorage.getItem(MARKERS_KEY) || 'null');
    if (Array.isArray(saved)) return new Set(saved.filter((k): k is MarkerKind => k === 'liq' || k === 'whale'));
  } catch {
    // 저장된 값이 없거나 읽을 수 없으면 기본값
  }
  return new Set<MarkerKind>(['liq', 'whale']);
}

function saveMarkerKinds() {
  try {
    localStorage.setItem(MARKERS_KEY, JSON.stringify([...markerKinds]));
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

/** 받아 둔 청산·고래 합계로 표시를 다시 그린다 (색 바뀜, 켜고 끄기) */
function drawMarkers() {
  if (!seriesMarkers || !candleSeries) return;
  if (!markerData || markerData.key !== `${symbol}|${interval}`) {
    seriesMarkers.setMarkers([]);
    return;
  }
  const bucket = INTERVALS[interval].bucket;
  const times = new Set(candleSeries.data().map((c) => c.time as number));
  const { up, down } = marketColors();
  const markers: SeriesMarker<Time>[] = [];
  markerInfo.clear();
  // 커서를 올린 표시는 크게, 나머지는 흐리게 (표시 글자를 따로 굵게 할 수는 없다)
  const add = (t: number, info: MarkerInfo, marker: Omit<SeriesMarker<Time>, 'time' | 'id'>) => {
    const time = candleTimeOf(t, bucket);
    if (!times.has(time)) return;
    const id = `${info.kind}|${time}|${marker.position}`;
    markerInfo.set(id, info);
    const hovered = hoveredMarker === id;
    const color = hoveredMarker && !hovered ? fadeColor(marker.color) : marker.color;
    markers.push({ ...marker, id, color, size: hovered ? 2 : 1, time: time as UTCTimestamp } as SeriesMarker<Time>);
  };
  if (markerKinds.has('liq')) {
    // 롱 청산 = 강제 매도라 가격이 떨어질 때 나온다 → 캔들 아래, 하락 색
    for (const b of topByValue(markerData.liq, (x) => x.longUsd, MAX_LIQ_MARKERS, MIN_LIQ_USD)) {
      add(b.t, { kind: 'liq', title: `💥 롱 청산 ${formatUsdShort(b.longUsd)}`, detail: '바이낸스 선물 · 이 캔들 동안 합계' },
        { position: 'belowBar', shape: 'circle', color: down, text: `롱 ${formatUsdShort(b.longUsd)}` });
    }
    for (const b of topByValue(markerData.liq, (x) => x.shortUsd, MAX_LIQ_MARKERS, MIN_LIQ_USD)) {
      add(b.t, { kind: 'liq', title: `💥 숏 청산 ${formatUsdShort(b.shortUsd)}`, detail: '바이낸스 선물 · 이 캔들 동안 합계' },
        { position: 'aboveBar', shape: 'circle', color: up, text: `숏 ${formatUsdShort(b.shortUsd)}` });
    }
  }
  if (markerKinds.has('whale') && symbol === 'BTC') {
    const btc = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}₿`;
    const btcLong = (n: number) => `${Math.round(n).toLocaleString('ko-KR')} BTC`;
    for (const b of topByValue(markerData.whale, (x) => x.depositBtc, MAX_WHALE_MARKERS, MIN_WHALE_BTC)) {
      add(b.t, { kind: 'whale', title: `⛓️ 거래소 입금 ${btcLong(b.depositBtc)}`, detail: '온체인 · 이 캔들 동안 합계 (팔려고 옮겼을 수 있어요)' },
        { position: 'aboveBar', shape: 'arrowDown', color: WHALE_DEPOSIT_COLOR, text: `입금 ${btc(b.depositBtc)}` });
    }
    for (const b of topByValue(markerData.whale, (x) => x.withdrawalBtc, MAX_WHALE_MARKERS, MIN_WHALE_BTC)) {
      add(b.t, { kind: 'whale', title: `⛓️ 거래소 출금 ${btcLong(b.withdrawalBtc)}`, detail: '온체인 · 이 캔들 동안 합계 (보관하려고 뺐을 수 있어요)' },
        { position: 'belowBar', shape: 'arrowUp', color: WHALE_WITHDRAWAL_COLOR, text: `출금 ${btc(b.withdrawalBtc)}` });
    }
  }
  seriesMarkers.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)));
}

/** #RRGGBB → 흐린 rgba */
function fadeColor(color: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0.3)` : color;
}

/** 커서를 올린 표시 옆에 전체 내용을 크게 띄운다 */
function renderMarkerTip(point: { x: number; y: number } | undefined) {
  if (!markerTip) return;
  const info = hoveredMarker ? markerInfo.get(hoveredMarker) : undefined;
  if (!info || !point) {
    markerTip.hidden = true;
    return;
  }
  const [title, detail] = markerTip.children as unknown as [HTMLElement, HTMLElement];
  title.textContent = info.title;
  detail.textContent = info.detail;
  markerTip.hidden = false;
  // 커서 오른쪽 위에, 차트 밖으로 나가면 왼쪽·아래로
  const box = markerTip.parentElement!.getBoundingClientRect();
  const w = markerTip.offsetWidth;
  const h = markerTip.offsetHeight;
  const x = point.x + 14 + w > box.width - 80 ? point.x - 14 - w : point.x + 14;
  const y = point.y - 10 - h < 0 ? point.y + 14 : point.y - 10 - h;
  markerTip.style.transform = `translate(${Math.max(0, x)}px, ${y}px)`;
}

/** 받아 둔 캔들 기간만큼 청산·고래 합계를 기록 서버에서 다시 받는다 */
async function refreshMarkers() {
  if (!candleSeries) return;
  const first = candleSeries.data()[0];
  const key = `${symbol}|${interval}`;
  const allowed = INTERVALS[interval].markers;
  const wantLiq = allowed && markerKinds.has('liq');
  const wantWhale = allowed && markerKinds.has('whale') && symbol === 'BTC';
  if (!first || (!wantLiq && !wantWhale)) {
    drawMarkers();
    return;
  }
  const request = ++markerRequest;
  const seconds = intervalSeconds();
  const minutes = seconds / 60;
  const firstMs = ((first.time as number) - KST_OFFSET_SEC) * 1000;
  // 이전 캔들을 많이 불러와도 기록 서버의 구간 수 제한을 넘지 않게 한다 (넘으면 표시가 통째로 사라진다)
  const hours = Math.min(MAX_MARKER_HOURS, (MAX_MARKER_BUCKETS * minutes) / 60, (Date.now() - firstMs) / 3_600_000 + seconds / 3600).toFixed(2);
  const [liq, whale] = await Promise.all([
    wantLiq ? getHistory<LiquidationBucket[]>(`/liquidations/buckets?symbol=${encodeURIComponent(symbol)}USDT&hours=${hours}&minutes=${minutes}`) : null,
    wantWhale ? getHistory<WhaleBucket[]>(`/whales/buckets?hours=${hours}&minutes=${minutes}`) : null
  ]);
  if (request !== markerRequest || key !== `${symbol}|${interval}`) return; // 그 사이 코인·간격이 바뀌었다
  markerData = { key, liq: liq ?? [], whale: whale ?? [] };
  drawMarkers();
}

function renderMarkerButtons() {
  document.querySelectorAll<HTMLButtonElement>('.marker-btn').forEach((btn) => {
    const kind = btn.dataset.marker as MarkerKind;
    const whaleOff = kind === 'whale' && symbol !== 'BTC';
    const intervalOff = !INTERVALS[interval].markers;
    btn.disabled = whaleOff || intervalOff;
    btn.title = intervalOff ? '주봉·월봉에서는 표시하지 않아요'
      : whaleOff ? '고래 입출금은 비트코인 차트에서만 보여요'
      : btn.dataset.title || '';
    const on = markerKinds.has(kind) && !whaleOff && !intervalOff;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
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
  turnover.clear();
  list.forEach((c, i) => turnover.set(candles[i].time, c.candle_acc_trade_price));
  lastCandle = candles[candles.length - 1];
  renderLatestLegend();
  oldestUtc = list[0].candle_date_time_utc;
  noMoreOlder = list.length < CANDLE_COUNT;
  refreshMarkers();
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
    for (const [c, raw] of keep) turnover.set(c.time, raw.candle_acc_trade_price);
    oldestUtc = list[0].candle_date_time_utc;
    refreshMarkers();
    track('chart_load_older', { interval, symbol });
  } finally {
    loadingOlder = false;
  }
}

/** 코인이나 간격이 바뀌면 처음부터 다시 받는다 */
function resetCandles() {
  markerData = null;
  drawMarkers();
  turnover.clear();
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
  turnover.set(candle.time, raw.candle_acc_trade_price);
  renderLatestLegend();
}

function applyLivePrice(price: number, tradeMs: number) {
  if (!candleSeries || !lastCandle) return;
  const next = applyTick(lastCandle, price, candleTimeOf(tradeMs, INTERVALS[interval].bucket));
  if (!next) return;
  lastCandle = next;
  candleSeries.update({ ...next, time: next.time as UTCTimestamp });
  renderLatestLegend();
}

// ---------- 정보 줄 (커서를 올린 캔들) ----------

function formatLegendTime(time: number): string {
  const d = new Date(time * 1000); // 이미 KST로 밀어 둔 시각이라 UTC 값을 그대로 읽는다
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  if (INTERVALS[interval].bucket === 'month') return date.slice(0, 7);
  if (intervalSeconds() >= DAY) return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatVolume(v: number): string {
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return v.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

function formatTurnover(krw: number): string {
  if (krw >= 1e12) return `${(krw / 1e12).toFixed(2)}조원`;
  if (krw >= 1e8) return `${(krw / 1e8).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}억원`;
  return formatKrwShort(krw);
}

/** index: 캔들 데이터 순번 (= 차트의 논리 위치) */
function renderLegend(index: number) {
  const legend = document.getElementById('price-legend');
  if (!legend || !candleSeries || !volumeSeries) return;
  const bar = candleSeries.dataByIndex(index) as CandlestickData<UTCTimestamp> | null;
  if (!bar || !('open' in bar)) {
    legend.hidden = true;
    return;
  }
  legend.hidden = false;
  const prev = index > 0 ? (candleSeries.dataByIndex(index - 1) as CandlestickData | null) : null;
  // 업비트처럼 직전 캔들 종가 대비 (첫 캔들은 시가 대비)
  const base = prev && 'close' in prev ? prev.close : bar.open;
  const pct = base > 0 ? ((bar.close - base) / base) * 100 : 0;
  const vol = volumeSeries.dataByIndex(index) as HistogramData | null;
  const krw = turnover.get(bar.time as number);
  const price = (p: number) => p.toLocaleString('ko-KR', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision });

  const set = (key: string, text: string) => {
    const el = legend.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (el) el.textContent = text;
  };
  set('time', formatLegendTime(bar.time as number));
  set('open', price(bar.open));
  set('high', price(bar.high));
  set('low', price(bar.low));
  set('close', price(bar.close));
  set('change', formatSignedPct(pct));
  set('volume', vol && 'value' in vol ? `${formatVolume(vol.value)} ${symbol}` : '-');
  set('turnover', krw !== undefined ? formatTurnover(krw) : '-');
  legend.dataset.dir = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
}

function renderLatestLegend() {
  if (!hovering && candleSeries) renderLegend(candleSeries.data().length - 1);
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

/** 사이드바·급등 피드에서 코인을 고르면 */
function selectChartCoin(next: string) {
  if (next === symbol) return;
  symbol = next;
  renderTitle();
  renderMarkerButtons();
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

  candleSeries = chart.addSeries(CandlestickSeries, { ...candleColors(), borderVisible: false });
  volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  seriesMarkers = createSeriesMarkers(candleSeries, []);

  onMarketColorsChange(recolor);

  markerTip = document.createElement('div');
  markerTip.className = 'marker-tip';
  markerTip.hidden = true;
  markerTip.append(document.createElement('strong'), document.createElement('span'));
  container.append(markerTip);

  chart.subscribeCrosshairMove((param) => {
    hovering = param.logical !== undefined && param.time !== undefined;
    if (hovering) renderLegend(param.logical as number);
    else renderLatestLegend();

    const id = typeof param.hoveredObjectId === 'string' && markerInfo.has(param.hoveredObjectId) ? param.hoveredObjectId : null;
    if (id !== hoveredMarker) {
      hoveredMarker = id;
      drawMarkers();
    }
    renderMarkerTip(param.point);
  });

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
      renderMarkerButtons();
      resetCandles();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.marker-btn').forEach((btn) => {
    btn.dataset.title = btn.title;
    btn.addEventListener('click', () => {
      const kind = btn.dataset.marker as MarkerKind;
      if (markerKinds.has(kind)) markerKinds.delete(kind);
      else markerKinds.add(kind);
      saveMarkerKinds();
      renderMarkerButtons();
      refreshMarkers();
      track('chart_markers', { kind, on: markerKinds.has(kind) });
    });
  });
  renderMarkerButtons();
  onSelectedCoinChange(selectChartCoin);

  onUpbitTicker((market, t) => {
    if (market === `KRW-${symbol}`) applyLivePrice(t.trade_price, t.trade_timestamp || Date.now());
  });

  renderTitle();
  loadCandles();
  setInterval(() => {
    refreshLatestCandle();
    refreshMarkers();
  }, REFRESH_MS);
}
