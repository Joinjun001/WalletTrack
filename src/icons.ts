/**
 * 선 아이콘 (index.html의 SVG 묶음 #i-이름). 이모지 대신 쓴다. 모양·굵기는 style.css .icon
 */

export type IconName =
  | 'whale' | 'sun' | 'moon' | 'zap' | 'link' | 'chart' | 'activity' | 'trend-up' | 'trend-down'
  | 'deposit' | 'withdraw' | 'transfer' | 'bell' | 'bell-off' | 'percent' | 'layers' | 'scale'
  | 'flame' | 'bars' | 'won' | 'gauge' | 'cube' | 'hourglass' | 'sliders' | 'queue' | 'calculator'
  | 'volume' | 'message';

export function icon(name: IconName): string {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
