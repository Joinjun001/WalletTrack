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
