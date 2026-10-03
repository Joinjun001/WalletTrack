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

/** 체결 시각(ms)이 속한 캔들의 차트 시각. 업비트 분봉/일봉 모두 UTC 기준 구간이다 (일봉 = KST 09:00 시작). */
export function candleTimeOf(tradeMs: number, intervalSec: number): number {
  const sec = Math.floor(tradeMs / 1000);
  return Math.floor(sec / intervalSec) * intervalSec + KST_OFFSET_SEC;
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
  return alert.direction === 'above' ? price >= alert.target : price <= alert.target;
}
