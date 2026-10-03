import { initLiveStreamDashboard } from './btcWhaleTracker.ts';
import { initKrMarket } from './krMarket.ts';
import { initNetworkPanel } from './networkPanel.ts';

document.addEventListener('DOMContentLoaded', () => {
  initKrMarket();
  initNetworkPanel();
  initLiveStreamDashboard();
});
