/**
 * 기록 추이 탭: 서버에 쌓인 코인별 김치 프리미엄, 바이낸스 선물 지표(펀딩비·미결제약정·롱 비율) 추이 차트
 */

import { createChart, BaselineSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { baseChartOptions } from './priceChart.ts';
import { COINS } from './coins.ts';
import { formatFundingRate, formatSignedPct, KST_OFFSET_SEC } from './market.ts';
import { getHistory } from './historyApi.ts';
import type { FuturesPoint, KimchiPoint } from './historyApi.ts';
import { track } from './analytics.ts';
import { registerThemedChart } from './theme.ts';

const REFRESH_MS = 60 * 1000;
const UP_COLOR = '#00E676';
const DOWN_COLOR = '#FF5252';
const LINE_COLOR = '#F7931A';

interface Point {
  t: number; // ms
  value: number;
}

type SeriesKind = 'baseline' | 'line'; // baseline: 0 위는 초록, 아래는 빨강

interface Metric {
  kind: SeriesKind;
  format: (v: number) => string;
  minMove: number;
}

/** 차트 하나 + 상태 문구. 기간/종목을 바꾸면 load를 다시 부른다 */
class HistoryChart {
  private chart: IChartApi;
  private series: ISeriesApi<'Baseline'> | ISeriesApi<'Line'> | null = null;
  private seriesKey = '';
  private status: HTMLElement | null;
  private requestId = 0;

  constructor(container: HTMLElement, statusId: string) {
    this.chart = createChart(container, {
      ...baseChartOptions(),
      localization: { locale: 'ko-KR' }
    });
    registerThemedChart(this.chart);
    this.status = document.getElementById(statusId);
  }

  private ensureSeries(metric: Metric) {
    const key = `${metric.kind}|${metric.minMove}`;
    const priceFormat = { type: 'custom' as const, formatter: metric.format, minMove: metric.minMove };
    if (this.series && this.seriesKey === key) {
      this.series.applyOptions({ priceFormat });
      return this.series;
    }
    if (this.series) this.chart.removeSeries(this.series);
    this.series = metric.kind === 'baseline'
      ? this.chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: 0 },
          topLineColor: UP_COLOR,
          topFillColor1: 'rgba(0, 230, 118, 0.25)',
          topFillColor2: 'rgba(0, 230, 118, 0.02)',
          bottomLineColor: DOWN_COLOR,
          bottomFillColor1: 'rgba(255, 82, 82, 0.02)',
          bottomFillColor2: 'rgba(255, 82, 82, 0.25)',
          lineWidth: 2,
          priceFormat
        })
      : this.chart.addSeries(LineSeries, { color: LINE_COLOR, lineWidth: 2, priceFormat });
    this.seriesKey = key;
    return this.series;
  }

  /** fit: 기간/종목을 바꾼 경우에만 화면을 전체 기간에 맞춘다 (주기적 갱신 때는 사용자가 옮긴 화면 유지) */
  async load(fetchPoints: () => Promise<Point[] | null>, metric: Metric, fit: boolean) {
    const id = ++this.requestId;
    if (fit) this.setStatus('불러오는 중...');
    const points = await fetchPoints();
    if (id !== this.requestId) return; // 그 사이 다른 조건으로 다시 불렀다

    if (points === null) {
      this.setStatus('기록 서버에 연결할 수 없어요. 잠시 후 다시 시도해요.');
      return;
    }
    const series = this.ensureSeries(metric);
    series.setData(points.map((p) => ({ time: (Math.floor(p.t / 1000) + KST_OFFSET_SEC) as UTCTimestamp, value: p.value })));
    if (fit) this.chart.timeScale().fitContent();

    if (points.length === 0) {
      this.setStatus('이 기간에 쌓인 기록이 아직 없어요');
    } else {
      const first = new Date(points[0].t);
      const since = `${first.getMonth() + 1}/${first.getDate()} ${first.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      this.setStatus(`${since}부터 · ${points.length.toLocaleString('ko-KR')}개 지점 · 1분마다 갱신`);
    }
  }

  private setStatus(text: string) {
    if (this.status) this.status.textContent = text;
  }
}

/** 카드 안의 [data-hours] 버튼 묶음 */
function bindHours(card: Element, onChange: (hours: number) => void) {
  card.querySelectorAll<HTMLButtonElement>('[data-hours]').forEach((btn) => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('[data-hours]').forEach((b) => b.classList.toggle('active', b === btn));
      onChange(Number(btn.dataset.hours));
    });
  });
}

// ---------- 김프 추이 ----------

const KIMCHI_METRIC: Metric = { kind: 'baseline', format: formatSignedPct, minMove: 0.01 };

function initKimchiChart() {
  const container = document.getElementById('kimchi-chart');
  const card = container?.closest('.history-card');
  const select = document.getElementById('kimchi-coin') as HTMLSelectElement | null;
  if (!container || !card || !select) return;

  select.innerHTML = COINS.map((c) => `<option value="${c.symbol}">${c.name} ${c.symbol}</option>`).join('');
  const chart = new HistoryChart(container, 'kimchi-chart-status');
  let hours = 24;

  const load = (fit: boolean) =>
    chart.load(async () => {
      const list = await getHistory<KimchiPoint[]>(`/kimchi?symbol=${select.value}&hours=${hours}`);
      return list && list.map((p) => ({ t: p.t, value: p.premiumPct }));
    }, KIMCHI_METRIC, fit);

  select.addEventListener('change', () => {
    track('history_chart', { chart: 'kimchi', symbol: select.value, hours });
    load(true);
  });
  bindHours(card, (h) => {
    hours = h;
    track('history_chart', { chart: 'kimchi', symbol: select.value, hours });
    load(true);
  });
  load(true);
  setInterval(() => load(false), REFRESH_MS);
}

// ---------- 선물 지표 추이 ----------

const FUTURES_METRICS: Record<string, Metric & { pick: (p: FuturesPoint) => number | null }> = {
  // 펀딩비는 소수(0.0001 = 0.01%)로 저장돼 있다
  funding: { kind: 'baseline', format: formatFundingRate, minMove: 0.000001, pick: (p) => p.fundingRate },
  oi: { kind: 'line', format: (v) => Math.round(v).toLocaleString('ko-KR'), minMove: 1, pick: (p) => p.openInterest },
  long: { kind: 'line', format: (v) => `${v.toFixed(1)}%`, minMove: 0.1, pick: (p) => (p.longRatio === null ? null : p.longRatio * 100) }
};

function initFuturesChart() {
  const container = document.getElementById('futures-history-chart');
  const card = container?.closest('.history-card');
  const select = document.getElementById('futures-symbol') as HTMLSelectElement | null;
  if (!container || !card || !select) return;

  const chart = new HistoryChart(container, 'futures-history-status');
  let hours = 24;
  let metricKey = 'funding';

  const load = (fit: boolean) => {
    const metric = FUTURES_METRICS[metricKey];
    return chart.load(async () => {
      const list = await getHistory<FuturesPoint[]>(`/futures?symbol=${select.value}&hours=${hours}`);
      if (!list) return null;
      const points: Point[] = [];
      for (const p of list) {
        const value = metric.pick(p);
        if (value !== null) points.push({ t: p.t, value });
      }
      return points;
    }, metric, fit);
  };

  card.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!btn.dataset.metric || !FUTURES_METRICS[btn.dataset.metric]) return;
      metricKey = btn.dataset.metric;
      track('history_chart', { chart: 'futures', symbol: select.value, metric: metricKey, hours });
      card.querySelectorAll('[data-metric]').forEach((b) => b.classList.toggle('active', b === btn));
      load(true);
    });
  });
  select.addEventListener('change', () => {
    track('history_chart', { chart: 'futures', symbol: select.value, metric: metricKey, hours });
    load(true);
  });
  bindHours(card, (h) => {
    hours = h;
    track('history_chart', { chart: 'futures', symbol: select.value, metric: metricKey, hours });
    load(true);
  });
  load(true);
  setInterval(() => load(false), REFRESH_MS);
}

export function initHistoryCharts() {
  initKimchiChart();
  initFuturesChart();
}
