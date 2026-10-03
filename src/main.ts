import { initLiveStreamDashboard } from './btcWhaleTracker.ts';
import { initKrMarket } from './krMarket.ts';
import { initNetworkPanel } from './networkPanel.ts';
import { initPriceChart } from './priceChart.ts';
import { initCoinTable } from './coinTable.ts';
import { initFuturesPanel } from './futuresPanel.ts';
import { initTools } from './tools.ts';

function initTabs() {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      document.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== btn.dataset.tab;
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  // 업비트 시세 구독자(차트, 코인 표)를 먼저 등록한 뒤 업비트 연결을 연다
  initPriceChart();
  initCoinTable();
  initKrMarket();
  initNetworkPanel();
  initFuturesPanel();
  initTools();
  initLiveStreamDashboard();
});
