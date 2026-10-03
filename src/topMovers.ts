/**
 * 업비트 원화 마켓 전체에서 전일 대비 상승·하락 상위 코인 (거래대금이 적은 코인은 뺀다). 누르면 위 차트가 그 코인으로 바뀐다.
 */

import { selectChartCoin } from './priceChart.ts';
import { escapeHtml } from './txAnalysis.ts';
import { coinName } from './coins.ts';
import { formatKrwPrice, formatSignedPct, topMovers } from './market.ts';
import { track } from './analytics.ts';

const UPBIT_TICKER_ALL = 'https://api.upbit.com/v1/ticker/all?quote_currencies=KRW';
const REFRESH_MS = 30 * 1000;
const TOP_N = 5;
const MIN_VOLUME_KRW = 1e9; // 24시간 거래대금 10억원 미만은 제외 (거래가 거의 없는 코인의 급등락 제외)

interface Mover {
  symbol: string;
  price: number;
  changePct: number;
}

function renderList(id: string, list: Mover[]) {
  const ul = document.getElementById(id);
  if (!ul) return;
  ul.innerHTML = list.length === 0
    ? '<li class="liq-empty">해당 코인이 없어요</li>'
    : list.map((m) => `
      <li class="mover-item" data-symbol="${escapeHtml(m.symbol)}" title="눌러서 차트 보기">
        <span class="mover-name"><strong>${escapeHtml(coinName(m.symbol))}</strong>${m.symbol !== coinName(m.symbol) ? ` <span>${escapeHtml(m.symbol)}</span>` : ''}</span>
        <span class="mover-price">${formatKrwPrice(m.price)}</span>
        <span class="mover-change ${m.changePct > 0 ? 'up' : 'down'}">${formatSignedPct(m.changePct)}</span>
      </li>`).join('');
}

async function refresh() {
  try {
    const res = await fetch(UPBIT_TICKER_ALL);
    if (!res.ok) return;
    const list: { market: string; trade_price: number; signed_change_rate: number; acc_trade_price_24h: number }[] = await res.json();
    const movers = list
      .filter((t) => t.acc_trade_price_24h >= MIN_VOLUME_KRW)
      .map((t) => ({ symbol: t.market.replace(/^KRW-/, ''), price: t.trade_price, changePct: t.signed_change_rate * 100 }));
    const { gainers, losers } = topMovers(movers, TOP_N);
    renderList('movers-up', gainers);
    renderList('movers-down', losers);
  } catch (e) {
    console.warn('Upbit ticker/all failed:', e);
  }
}

export function initTopMovers() {
  document.querySelectorAll('.mover-list').forEach((ul) => {
    ul.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-symbol]');
      if (!item?.dataset.symbol) return;
      selectChartCoin(item.dataset.symbol);
      track('chart_coin', { symbol: item.dataset.symbol, from: ul.id === 'movers-up' ? 'movers_up' : 'movers_down' });
      // 코인 표에 없는 코인이면 표의 선택 표시를 지운다
      document.querySelectorAll('#coin-table-body tr').forEach((r) => r.classList.toggle('selected', (r as HTMLElement).dataset.symbol === item.dataset.symbol));
      document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  refresh();
  setInterval(refresh, REFRESH_MS);
}
