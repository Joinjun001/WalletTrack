/**
 * 지금 보고 있는 코인. 사이드바나 급등·급락 피드에서 고르면 차트, 상단 시세 바, 오늘 시세가 같이 바뀐다.
 */

let selected = 'BTC';
const listeners: ((symbol: string) => void)[] = [];

export function selectedCoin(): string {
  return selected;
}

export function onSelectedCoinChange(fn: (symbol: string) => void) {
  listeners.push(fn);
}

export function setSelectedCoin(symbol: string) {
  if (symbol === selected) return;
  selected = symbol;
  for (const fn of listeners) fn(symbol);
}
