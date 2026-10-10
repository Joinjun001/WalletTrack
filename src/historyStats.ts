/**
 * 서버 기록 통계: 기간별(1h/4h/24h) 청산 합계와 코인별 청산 순위, 고래 거래의 거래소 입금·출금 흐름 (24시간)
 * 기간별 청산 합계는 청산 피드 보기를 따른다 (코인 = 바이낸스 {코인}USDT, 전체 = 바이낸스 전체 코인). 서버는 바이낸스 청산만 모은다.
 */

import { escapeHtml } from './txAnalysis.ts';
import { formatUsdShort } from './market.ts';
import { getHistory } from './historyApi.ts';
import type { LiquidationBySymbol, LiquidationSummary, WhaleFlow } from './historyApi.ts';
import { liqMode, onLiqModeChange } from './futuresPanel.ts';

const REFRESH_MS = 60 * 1000;
const WINDOWS = [1, 4, 24];
const TOP_SYMBOLS = 5;

function setText(id: string, text: string, tone?: number) {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.textContent = text;
  if (tone !== undefined) {
    elem.classList.toggle('up', tone > 0);
    elem.classList.toggle('down', tone < 0);
  }
}

function formatBtcAmount(btc: number): string {
  return `${btc.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} BTC`;
}

let statsRequest = 0;

async function refreshLiquidationStats() {
  const request = ++statsRequest;
  const m = liqMode();
  const symbol = m === 'all' ? '' : `&symbol=${m}USDT`;
  setText('liq-stats-unit', m === 'all' ? '바이낸스 전체 코인 · 1분마다 갱신' : `바이낸스 ${m}USDT · 1분마다 갱신`);
  const [summaries, top] = await Promise.all([
    Promise.all(WINDOWS.map((h) => getHistory<LiquidationSummary>(`/liquidations/summary?hours=${h}${symbol}`))),
    getHistory<LiquidationBySymbol[]>(`/liquidations/by-symbol?hours=24&limit=${TOP_SYMBOLS}`)
  ]);

  if (request !== statsRequest) return; // 그 사이 보기를 바꿨다
  const status = document.getElementById('liq-stats-status');
  if (status) status.hidden = summaries.some((s) => s !== null);

  summaries.forEach((s, i) => {
    if (!s) return;
    const h = WINDOWS[i];
    setText(`liq-stat-${h}-long`, formatUsdShort(s.longUsd));
    setText(`liq-stat-${h}-short`, formatUsdShort(s.shortUsd));
    setText(`liq-stat-${h}-total`, formatUsdShort(s.longUsd + s.shortUsd));
  });

  const list = document.getElementById('liq-top-list');
  if (list && top) {
    const max = Math.max(1, ...top.map((t) => t.longUsd + t.shortUsd));
    list.innerHTML = top.length === 0
      ? '<li class="liq-empty">아직 청산 기록이 없어요</li>'
      : top.map((t) => {
          const total = t.longUsd + t.shortUsd;
          const longPct = total > 0 ? (t.longUsd / total) * 100 : 50;
          return `
            <li class="liq-top-item" title="롱 ${formatUsdShort(t.longUsd)} · 숏 ${formatUsdShort(t.shortUsd)}">
              <span class="liq-symbol">${escapeHtml(t.symbol.replace(/USDT$/, ''))}</span>
              <span class="liq-top-bar" style="width: ${((total / max) * 100).toFixed(1)}%">
                <span class="liq-top-long" style="width: ${longPct.toFixed(1)}%"></span>
              </span>
              <span class="liq-usd">${formatUsdShort(total)}</span>
            </li>`;
        }).join('');
  }
}

async function refreshWhaleFlow() {
  const flow = await getHistory<WhaleFlow>('/whales/flow?hours=24');
  const box = document.getElementById('whale-flow');
  if (!box) return;
  box.hidden = !flow;
  if (!flow) return;
  setText('whale-flow-deposit', `${formatBtcAmount(flow.depositBtc)} (${flow.depositCount}건)`);
  setText('whale-flow-withdrawal', `${formatBtcAmount(flow.withdrawalBtc)} (${flow.withdrawalCount}건)`);
  // 순유입이 양수면 거래소로 들어온 코인이 더 많다 (매도 대기 물량 증가로 보는 경우가 많다)
  const net = flow.depositBtc - flow.withdrawalBtc;
  setText('whale-flow-net', `${net >= 0 ? '+' : ''}${formatBtcAmount(net)}`, -net);
}

export function initHistoryStats() {
  refreshLiquidationStats();
  refreshWhaleFlow();
  setInterval(refreshLiquidationStats, REFRESH_MS);
  onLiqModeChange(refreshLiquidationStats);
  setInterval(refreshWhaleFlow, REFRESH_MS);
}
