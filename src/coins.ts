/**
 * 코인 시세 표/차트에 쓰는 주요 코인 (업비트 KRW 마켓 & 바이낸스 USDT 마켓 모두 상장)
 */

export interface Coin {
  symbol: string; // 업비트 KRW-{symbol}, 바이낸스 {symbol}USDT
  name: string;
}

export const COINS: Coin[] = [
  { symbol: 'BTC', name: '비트코인' },
  { symbol: 'ETH', name: '이더리움' },
  { symbol: 'XRP', name: '리플' },
  { symbol: 'SOL', name: '솔라나' },
  { symbol: 'DOGE', name: '도지코인' },
  { symbol: 'ADA', name: '에이다' },
  { symbol: 'TRX', name: '트론' },
  { symbol: 'LINK', name: '체인링크' },
  { symbol: 'AVAX', name: '아발란체' },
  { symbol: 'SUI', name: '수이' }
];

export function coinName(symbol: string): string {
  return COINS.find((c) => c.symbol === symbol)?.name ?? symbol;
}
