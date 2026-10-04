import { initLiveStreamDashboard } from './btcWhaleTracker.ts';
import { initAnalytics, track } from './analytics.ts';
import { initFeedback } from './feedback.ts';
import { initKrMarket } from './krMarket.ts';
import { initNetworkPanel } from './networkPanel.ts';
import { initPriceChart } from './priceChart.ts';
import { initCoinSidebar } from './coinSidebar.ts';
import { initFuturesPanel } from './futuresPanel.ts';
import { initTools } from './tools.ts';
import { initHistoryCharts } from './historyCharts.ts';
import { initHistoryStats } from './historyStats.ts';
import { initSoundAlerts } from './soundAlerts.ts';
import { initTheme } from './theme.ts';
import { initHelp } from './help.ts';
import { initSurgeFeed } from './surgeFeed.ts';
import { initBtcStreams } from './btcStreams.ts';
import { initBigTradeFeed } from './bigTradeFeed.ts';

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
      track('tab_open', { tab: btn.dataset.tab || '' });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  initTheme();
  initHelp();
  initTabs();
  // 업비트 시세 구독자(차트, 코인 사이드바)를 먼저 등록한 뒤 업비트 연결을 연다
  initPriceChart();
  initCoinSidebar();
  initSurgeFeed();
  initKrMarket();
  initNetworkPanel();
  initFuturesPanel();
  initTools();
  initSoundAlerts();
  initBigTradeFeed();
  initBtcStreams(); // 체결·청산 구독자(피드, 알림, 사운드)를 등록한 뒤 연결한다
  initLiveStreamDashboard();
  initHistoryStats();
  initHistoryCharts();
  initFeedback();
});
