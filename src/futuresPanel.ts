/**
 * 바이낸스 BTCUSDT 무기한 선물 지표(펀딩비, 미결제약정, 롱/숏 비율)와 전체 마켓 실시간 강제청산 피드
 */

import { escapeHtml } from './txAnalysis.ts';
import { formatCountdown, formatFundingRate, formatUsdShort, liquidatedPosition } from './market.ts';

const FAPI = 'https://fapi.binance.com';
// 바이낸스 선물 시장 데이터 스트림은 /market 경로 (예전 /ws 경로는 연결만 되고 데이터가 오지 않는다)
const LIQUIDATION_WS = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const REFRESH_MS = 30 * 1000;
const MIN_LIQUIDATION_USD = 1_000; // 목록에는 이 이상만 (합계는 전부 포함)
const MAX_LIQUIDATION_ITEMS = 40;

let nextFundingTime = 0;
let longLiquidatedUsd = 0;
let shortLiquidatedUsd = 0;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${FAPI}${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch (e) {
    console.warn(`Binance futures ${path} failed:`, e);
    return null;
  }
}

function setText(id: string, text: string, tone?: number) {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.textContent = text;
  if (tone !== undefined) {
    elem.classList.toggle('up', tone > 0);
    elem.classList.toggle('down', tone < 0);
  }
}

async function refresh() {
  const [premium, oi, ratio] = await Promise.all([
    getJson<{ markPrice: string; lastFundingRate: string; nextFundingTime: number }>('/fapi/v1/premiumIndex?symbol=BTCUSDT'),
    getJson<{ openInterest: string }>('/fapi/v1/openInterest?symbol=BTCUSDT'),
    getJson<{ longAccount: string; shortAccount: string }[]>('/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1')
  ]);

  const status = document.getElementById('futures-status');
  if (status) status.hidden = !!(premium || oi || ratio);

  const mark = premium ? parseFloat(premium.markPrice) : 0;
  if (premium) {
    const rate = parseFloat(premium.lastFundingRate);
    // 펀딩비 양수 = 롱이 숏에게 지불 (롱 과열)
    setText('fut-funding', formatFundingRate(rate), rate);
    nextFundingTime = premium.nextFundingTime;
    renderCountdown();
  }

  if (oi) {
    const btc = parseFloat(oi.openInterest);
    setText('fut-oi', `${Math.round(btc).toLocaleString('ko-KR')} BTC`);
    if (mark > 0) setText('fut-oi-usd', formatUsdShort(btc * mark));
  }

  const latest = ratio?.[0];
  if (latest) {
    const longPct = parseFloat(latest.longAccount) * 100;
    const shortPct = parseFloat(latest.shortAccount) * 100;
    setText('fut-long-pct', `롱 ${longPct.toFixed(1)}%`);
    setText('fut-short-pct', `숏 ${shortPct.toFixed(1)}%`);
    const bar = document.getElementById('fut-ls-bar');
    if (bar) bar.style.width = `${longPct}%`;
  }
}

function renderCountdown() {
  if (nextFundingTime > 0) setText('fut-funding-countdown', `다음 정산까지 ${formatCountdown(nextFundingTime - Date.now())}`);
}

interface ForceOrder {
  o: { s: string; S: string; ap: string; z: string; T: number };
}

function onLiquidation(order: ForceOrder['o']) {
  const usd = parseFloat(order.ap) * parseFloat(order.z);
  if (!(usd > 0)) return;
  const position = liquidatedPosition(order.S);
  if (position === 'long') longLiquidatedUsd += usd;
  else shortLiquidatedUsd += usd;
  setText('liq-long-total', formatUsdShort(longLiquidatedUsd));
  setText('liq-short-total', formatUsdShort(shortLiquidatedUsd));

  if (usd < MIN_LIQUIDATION_USD) return;
  const list = document.getElementById('liq-feed');
  if (!list) return;
  list.querySelector('.liq-empty')?.remove();

  const item = document.createElement('li');
  item.className = `liq-item ${position}${usd >= 1e6 ? ' big' : ''}`;
  const time = new Date(order.T).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  item.innerHTML = `
    <span class="liq-symbol">${escapeHtml(order.s.replace(/USDT$/, ''))}</span>
    <span class="liq-side">${position === 'long' ? '롱 청산' : '숏 청산'}</span>
    <span class="liq-usd">${formatUsdShort(usd)}</span>
    <span class="liq-time">${time}</span>`;
  list.prepend(item);
  while (list.children.length > MAX_LIQUIDATION_ITEMS) list.lastElementChild?.remove();
}

function connectLiquidationWebSocket() {
  const ws = new WebSocket(LIQUIDATION_WS);
  ws.onmessage = (event) => {
    try {
      const msg: ForceOrder = JSON.parse(event.data);
      if (msg?.o) onLiquidation(msg.o);
    } catch (e) {
      console.error('Liquidation WS Parse Error:', e);
    }
  };
  ws.onclose = () => setTimeout(connectLiquidationWebSocket, 3000);
}

export function initFuturesPanel() {
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderCountdown, 1000);
  connectLiquidationWebSocket();
}
