/**
 * Pure market/network helpers (no DOM) — testable with node:test
 */

/**
 * 김치 프리미엄(%) = 업비트 원화 BTC 가격 / (해외 BTC 달러 가격 × 업비트 USDT 원화 가격) - 1
 * 환율 대신 업비트 USDT 가격을 쓰므로 테더 프리미엄만큼 오차가 있다.
 */
export function kimchiPremium(krwBtc: number, usdBtc: number, krwUsdt: number): number | null {
  if (!(krwBtc > 0 && usdBtc > 0 && krwUsdt > 0)) return null;
  return (krwBtc / (usdBtc * krwUsdt) - 1) * 100;
}

/** 115135000 -> "115,135,000원" */
export function formatKrw(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/** 큰 금액 요약: 1억 이상 "10.35억원", 1만 이상 "2,345만원", 그 외 "9,800원" */
export function formatKrwShort(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}억원`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원`;
  return formatKrw(n);
}

/** 0.0123 -> "+1.23%", -0.5 -> "-0.50%" (입력은 이미 % 단위) */
export function formatSignedPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export const HALVING_INTERVAL = 210000;
export const TARGET_BLOCK_SECONDS = 600;

export interface HalvingInfo {
  nextHeight: number;
  remainingBlocks: number;
  estimatedDays: number;
}

export function halvingInfo(tipHeight: number): HalvingInfo {
  const nextHeight = (Math.floor(tipHeight / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
  const remainingBlocks = nextHeight - tipHeight;
  return {
    nextHeight,
    remainingBlocks,
    estimatedDays: Math.ceil((remainingBlocks * TARGET_BLOCK_SECONDS) / 86400)
  };
}

const FEAR_GREED_KO: Record<string, string> = {
  'Extreme Fear': '극단적 공포',
  'Fear': '공포',
  'Neutral': '중립',
  'Greed': '탐욕',
  'Extreme Greed': '극단적 탐욕'
};

export function fearGreedLabelKo(classification: string): string {
  return FEAR_GREED_KO[classification] || classification;
}

/** 초 단위 경과 시간 -> "방금 전" / "5분 전" / "2시간 전" */
export function timeAgoKo(elapsedSeconds: number): string {
  if (elapsedSeconds < 60) return '방금 전';
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}분 전`;
  return `${Math.floor(elapsedSeconds / 3600)}시간 전`;
}

/** 코인 원화 가격: 100원 이상은 정수, 1원 이상은 소수 2자리, 그 미만은 4자리 (업비트 호가 단위와 비슷하게) */
export function krwPricePrecision(price: number): number {
  if (price >= 100) return 0;
  if (price >= 1) return 2;
  return 4;
}

export function formatKrwPrice(price: number): string {
  const digits = krwPricePrecision(price);
  return `${price.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}원`;
}

/** 큰 달러 금액 요약: "$1.23B" / "$12.3M" / "$45.6K" / "$950" */
export function formatUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** 펀딩비(소수) -> "+0.0100%" */
export function formatFundingRate(rate: number): string {
  const pct = rate * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
}

/** 남은 밀리초 -> "03:25:09" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** 강제청산 주문 방향 -> 청산된 포지션. 롱 포지션은 매도(SELL) 주문으로 청산된다. */
export function liquidatedPosition(orderSide: string): 'long' | 'short' {
  return orderSide === 'SELL' ? 'long' : 'short';
}

export interface Candle {
  time: number; // 차트 표시용 초 (KST로 보이도록 +9시간 이동)
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 차트 라이브러리는 UTC로 표시하므로, 한국 시간으로 보이게 시각을 9시간 민다 */
export const KST_OFFSET_SEC = 9 * 3600;

/** 캔들 간격: 초 단위 고정 간격, 또는 길이가 일정하지 않은 주봉·월봉 */
export type CandleInterval = number | 'week' | 'month';

/**
 * 체결 시각(ms)이 속한 캔들의 차트 시각. 업비트 캔들은 모두 UTC 기준 구간이다
 * (일봉 = KST 09:00 시작, 주봉 = 월요일 UTC 00:00 시작, 월봉 = 1일 UTC 00:00 시작).
 */
export function candleTimeOf(tradeMs: number, interval: CandleInterval): number {
  let start: number;
  if (interval === 'week') {
    const day = Math.floor(tradeMs / 86_400_000); // 1970-01-01은 목요일 → 월요일까지 3일
    start = (day - ((day + 3) % 7)) * 86400;
  } else if (interval === 'month') {
    const d = new Date(tradeMs);
    start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  } else {
    const sec = Math.floor(tradeMs / 1000);
    start = Math.floor(sec / interval) * interval;
  }
  return start + KST_OFFSET_SEC;
}

/** 실시간 체결가를 마지막 캔들에 반영. 새 구간이면 새 캔들, 지난 구간의 늦은 체결은 무시(null). */
export function applyTick(last: Candle | null, price: number, time: number): Candle | null {
  if (!last || time > last.time) return { time, open: price, high: price, low: price, close: price };
  if (time < last.time) return null;
  return { time, open: last.open, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
}

export interface PriceAlert {
  id: string;
  target: number;              // 원화 가격
  direction: 'above' | 'below'; // 등록 시점 가격 기준으로 이 방향으로 넘으면 알림
}

export function alertDirection(target: number, currentPrice: number): 'above' | 'below' {
  return target >= currentPrice ? 'above' : 'below';
}

export function isAlertTriggered(alert: PriceAlert, price: number): boolean {
  if (!(price > 0)) return false;
  return isThresholdCrossed(alert, price);
}

/** 값이 음수일 수 있는 알림(김프 등)용. 값을 아직 모르면 null */
export function isThresholdCrossed(alert: PriceAlert, value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  return alert.direction === 'above' ? value >= alert.target : value <= alert.target;
}

/** 등락률 상위/하위 n개. 같은 목록을 정렬하지 않고 복사해서 쓴다 */
export function topMovers<T extends { changePct: number }>(list: T[], n: number): { gainers: T[]; losers: T[] } {
  const sorted = [...list].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.slice(0, n).filter((t) => t.changePct > 0),
    losers: sorted.reverse().slice(0, n).filter((t) => t.changePct < 0)
  };
}

/** 남은 밀리초 -> "13일 9시간" / "5시간 20분" / "12분" */
export function formatDurationKo(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes % 60}분`;
  return `${minutes}분`;
}

/** 급등·급락 감지용 가격 구간 (구간마다 최저·최고가) */
export interface PriceBucket {
  t: number;  // 구간 시작 ms
  lo: number;
  hi: number;
}

/** 실시간 가격을 bucketMs 단위 구간에 넣고, windowMs보다 오래된 구간은 버린다 (배열을 직접 고친다) */
export function pushPriceBucket(buckets: PriceBucket[], price: number, nowMs: number, bucketMs: number, windowMs: number): void {
  if (!(price > 0)) return;
  const t = Math.floor(nowMs / bucketMs) * bucketMs;
  const last = buckets[buckets.length - 1];
  if (last && last.t === t) {
    last.lo = Math.min(last.lo, price);
    last.hi = Math.max(last.hi, price);
  } else {
    buckets.push({ t, lo: price, hi: price });
  }
  while (buckets.length > 0 && buckets[0].t < nowMs - windowMs) buckets.shift();
}

export interface Surge {
  direction: 'up' | 'down';
  pct: number;  // 구간 최저가(급등)·최고가(급락) 대비 지금 가격 변화 (%)
  from: number; // 기준 가격
}

/** 최근 구간의 최저가보다 thresholdPct% 이상 오르면 급등, 최고가보다 그만큼 내리면 급락. 둘 다면 더 큰 쪽 */
export function detectSurge(buckets: PriceBucket[], price: number, thresholdPct: number): Surge | null {
  if (!(price > 0) || buckets.length === 0) return null;
  const lo = Math.min(...buckets.map((b) => b.lo));
  const hi = Math.max(...buckets.map((b) => b.hi));
  const rise = (price / lo - 1) * 100;
  const fall = (price / hi - 1) * 100;
  const up = rise >= thresholdPct ? { direction: 'up' as const, pct: rise, from: lo } : null;
  const down = fall <= -thresholdPct ? { direction: 'down' as const, pct: fall, from: hi } : null;
  if (up && down) return Math.abs(up.pct) >= Math.abs(down.pct) ? up : down;
  return up ?? down;
}

/** 값이 큰 순서로 n개, 단 minValue 이상만. 결과는 원래 순서(시간순)를 유지한다 */
export function topByValue<T>(list: T[], value: (item: T) => number, n: number, minValue: number): T[] {
  const keep = new Set([...list].filter((item) => value(item) >= minValue).sort((a, b) => value(b) - value(a)).slice(0, n));
  return list.filter((item) => keep.has(item));
}

/**
 * 업비트 원화 가격과 해외 달러 가격의 김프. 같은 심볼이 다른 코인인 경우(드물다)는 차이가 터무니없이 커서 null로 거른다.
 */
export function coinKimchiPremium(krw: number, usd: number, krwUsdt: number): number | null {
  const premium = kimchiPremium(krw, usd, krwUsdt);
  return premium !== null && Math.abs(premium) <= 50 ? premium : null;
}

/** 코인 달러 가격: 1달러 이상은 소수 2자리, 0.01 이상은 4자리, 그 미만은 유효숫자 4자리 */
export function formatUsdPrice(price: number): string {
  const digits = price >= 1 ? 2 : price >= 0.01 ? 4 : Math.min(10, 3 - Math.floor(Math.log10(price)));
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export type SoundTier = 1 | 2 | 3 | 4;

/** 청산 금액(달러)별 소리 단계: $100K 미만 1, $500K 미만 2, $2M 미만 3, 그 이상 4 (기준 금액과 무관하게 큰 청산은 크게) */
export function liquidationSoundTier(usd: number): SoundTier {
  if (usd >= 2_000_000) return 4;
  if (usd >= 500_000) return 3;
  if (usd >= 100_000) return 2;
  return 1;
}

/** 대량 체결은 고른 기준 대비 배수로: 1배 1, 3배 2, 10배 3, 30배 이상 4 */
export function tradeSoundTier(usd: number, threshold: number): SoundTier {
  const ratio = threshold > 0 ? usd / threshold : 1;
  if (ratio >= 30) return 4;
  if (ratio >= 10) return 3;
  if (ratio >= 3) return 2;
  return 1;
}
