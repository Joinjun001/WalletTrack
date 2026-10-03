/**
 * Bitcoin Real-time Live Transaction & Exchange Hot Wallet Tracker
 * Extreme Speed WebSocket Engine with Exchange Address Matching
 */

import { analyzeTransaction, escapeHtml } from './txAnalysis.ts';
import type { RawTx, TxDirection } from './txAnalysis.ts';
import { prices, updatePrices } from './priceStore.ts';
import { formatKrwShort, formatSignedPct } from './market.ts';

export interface LiveBtcTransaction {
  id: string;
  hash: string;
  btcAmount: number;
  direction: TxDirection;
  timestamp: number;
  exchangeName: string;
  exchangeIcon: string;
  exchangeColor: string;
  isKnownExchange: boolean;
  isWhale: boolean; // >= WHALE_BTC
}

let ws: WebSocket | null = null;
let priceWs: WebSocket | null = null;
let priceWsConnected = false;
let minBtcThreshold = 0.1; // 속도감 및 감지 빈도를 높이기 위해 기본값을 0.1 BTC로 변경!
let txHistory: LiveBtcTransaction[] = [];
let totalVolumeObservedBtc = 0;
const MAX_FEED_ITEMS = 50;
const MAX_HISTORY_ITEMS = 300;
const MIN_STORED_BTC = 0.1; // 가장 낮은 필터값. 필터를 바꿔도 다시 보여줄 수 있게 이 이상은 모두 저장
const WHALE_BTC = 3.0;

/**
 * Fetch current Bitcoin price in USD (REST fallback / initial)
 */
export async function fetchBtcPrice(): Promise<number> {
  const price = (await fetchPriceFromBinance()) ?? (await fetchPriceFromMempool());
  if (price !== null) updatePrices({ usdBtc: price });
  return prices.usdBtc;
}

async function fetchPriceFromBinance(): Promise<number | null> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (!res.ok) return null; // e.g. 451 in restricted regions
    const data = await res.json();
    const price = parseFloat(data?.price);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchPriceFromMempool(): Promise<number | null> {
  try {
    const res = await fetch('https://mempool.space/api/v1/prices');
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.USD === 'number' && data.USD > 0 ? data.USD : null;
  } catch (e) {
    console.warn('Failed to fetch price fallback:', e);
    return null;
  }
}

export function formatUsd(num: number, withDecimals: boolean = true): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0
  }).format(num);
}

export function formatBtc(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' BTC';
}

/**
 * Connect to Binance Real-Time BTC Price Ticker WebSocket
 */
function connectPriceWebSocket() {
  try {
    priceWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

    priceWs.onopen = () => {
      console.log('⚡ High-Speed Bitcoin Real-Time Price WebSocket Connected');
      priceWsConnected = true;
    };

    priceWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const newPrice = parseFloat(data?.c);
        if (newPrice > 0) {
          const changePct = parseFloat(data.P);
          updatePrices({ usdBtc: newPrice, usdChangePct: isNaN(changePct) ? null : changePct });
        }
      } catch (e) {
        console.error('Price WS Parse Error:', e);
      }
    };

    priceWs.onerror = (err) => {
      console.warn('Price WS Error, attempting reconnect...', err);
      priceWsConnected = false;
    };

    priceWs.onclose = () => {
      console.warn('Price WS Closed, reconnecting in 2 seconds...');
      priceWsConnected = false;
      setTimeout(connectPriceWebSocket, 2000);
    };
  } catch (err) {
    console.error('Price WebSocket Init Error:', err);
  }
}

function renderUsdPrice() {
  const priceElem = document.getElementById('usd-btc-price');
  if (priceElem && prices.usdBtc > 0) priceElem.textContent = formatUsd(prices.usdBtc, true);
  const changeElem = document.getElementById('usd-change');
  if (changeElem && prices.usdChangePct !== null) {
    changeElem.textContent = formatSignedPct(prices.usdChangePct);
    changeElem.classList.toggle('up', prices.usdChangePct > 0);
    changeElem.classList.toggle('down', prices.usdChangePct < 0);
  }
}

/**
 * Initialize Dashboard Engine
 */
export async function initLiveStreamDashboard() {
  const feedContainer = document.getElementById('live-tx-feed');
  const countElem = document.getElementById('live-tx-count');
  const totalVolElem = document.getElementById('live-total-vol');

  // Fetch initial BTC Price
  await fetchBtcPrice();
  renderUsdPrice();

  // Connect Real-Time Price Stream WebSocket
  connectPriceWebSocket();
  setInterval(renderUsdPrice, 1000); // 틱마다 다시 그리지 않고 1초 단위로 표시

  // Periodic REST fallback every 20s if WebSocket disconnected
  setInterval(() => {
    if (!priceWsConnected) fetchBtcPrice();
  }, 20000);

  // Filter Buttons
  document.querySelectorAll('.threshold-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.threshold-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget as HTMLElement;
      target.classList.add('active');
      minBtcThreshold = parseFloat(target.dataset.threshold || '0.1');
      renderFeed(feedContainer, countElem, totalVolElem);
    });
  });

  // Connect High Speed WebSocket
  connectWebSocket(feedContainer, countElem, totalVolElem);
}

/**
 * Connect to Blockchain.info WebSocket (Instant Mempool Unconfirmed Transactions)
 */
function connectWebSocket(container: HTMLElement | null, countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  const statusDot = document.getElementById('ws-status-dot');

  try {
    ws = new WebSocket('wss://ws.blockchain.info/inv');

    ws.onopen = () => {
      console.log('⚡ High-Speed Bitcoin Transaction WebSocket Connected');
      if (statusDot) statusDot.className = 'dot pulsing green';

      // Subscribe to all unconfirmed mempool transactions immediately
      ws?.send(JSON.stringify({ op: 'unconfirmed_sub' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.op === 'utx' && data.x) {
          // Instant processing without delay
          processTransaction(data.x, container, countElem, totalVolElem);
        }
      } catch (e) {
        console.error('WS Parse Error:', e);
      }
    };

    ws.onerror = (err) => {
      console.warn('WS Error, reconnecting...', err);
      if (statusDot) statusDot.className = 'dot red';
    };

    ws.onclose = () => {
      console.warn('WS Closed, reconnecting instantly...');
      if (statusDot) statusDot.className = 'dot yellow';
      setTimeout(() => connectWebSocket(container, countElem, totalVolElem), 1500);
    };
  } catch (err) {
    console.error('WebSocket Init Error:', err);
  }
}

/**
 * Fast Process incoming transaction
 */
function processTransaction(txData: RawTx, container: HTMLElement | null, countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  const { hash, btcAmount, direction, exchange } = analyzeTransaction(txData);
  if (btcAmount < MIN_STORED_BTC) return; // Filter small micro-txs for speed & relevance

  const item: LiveBtcTransaction = {
    id: hash.substring(0, 10),
    hash,
    btcAmount,
    direction,
    timestamp: Date.now(),
    exchangeName: exchange ? exchange.name : '미확인 지갑',
    exchangeIcon: exchange ? exchange.icon : '🏛️ Wallet',
    exchangeColor: exchange ? exchange.color : '#8A99AD',
    isKnownExchange: !!exchange,
    isWhale: btcAmount >= WHALE_BTC
  };

  txHistory.unshift(item);
  if (txHistory.length > MAX_HISTORY_ITEMS) {
    txHistory.pop();
  }

  totalVolumeObservedBtc += btcAmount;

  if (btcAmount >= minBtcThreshold) {
    prependItemToUi(container, item);
  }
  updateCounters(countElem, totalVolElem);
}

function updateCounters(countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  const visibleCount = txHistory.filter(t => t.btcAmount >= minBtcThreshold).length;
  if (countElem) countElem.textContent = `${visibleCount} 건 감지`;
  if (totalVolElem) totalVolElem.textContent = formatBtc(totalVolumeObservedBtc);
}

const DIRECTION_TAGS: Record<TxDirection, string> = {
  deposit: '<span class="tag deposit">📥 거래소 입금</span>',
  withdrawal: '<span class="tag withdrawal">📤 거래소 출금</span>',
  transfer: '<span class="tag transfer">↔️ 전송</span>'
};

/**
 * Prepend card UI to stream container
 */
function prependItemToUi(container: HTMLElement | null, item: LiveBtcTransaction) {
  if (!container) return;

  const placeholder = container.querySelector('.empty-feed');
  if (placeholder) placeholder.remove();

  const card = document.createElement('div');
  card.className = `live-tx-card ${item.direction} ${item.isWhale ? 'whale-alert' : ''}`;

  // 원화/달러 환산은 카드를 그리는 시점의 시세 기준
  const krwText = prices.krwBtc > 0 ? `≈ ${formatKrwShort(item.btcAmount * prices.krwBtc)}` : '';
  const usdText = prices.usdBtc > 0 ? formatUsd(item.btcAmount * prices.usdBtc, false) : '';

  card.innerHTML = `
    <div class="tx-left">
      <div class="tx-type-row">
        <span class="exchange-badge" style="border-color: ${escapeHtml(item.exchangeColor)};">
          ${escapeHtml(item.exchangeIcon)}
        </span>
        ${DIRECTION_TAGS[item.direction]}
        ${item.isWhale ? `<span class="whale-badge">🐋 WHALE!</span>` : ''}
        <span class="tx-time-ago">방금 전</span>
      </div>
      <div class="tx-hash-row">
        <span>지갑/거래소: <strong>${escapeHtml(item.exchangeName)}</strong></span>
        <code style="margin-left: 0.5rem; opacity: 0.8;">(${escapeHtml(item.hash.substring(0, 10))}...)</code>
      </div>
    </div>
    
    <div class="tx-right">
      <div class="tx-amount-btc">
        ${formatBtc(item.btcAmount)}
      </div>
      <div class="tx-amount-krw">${krwText}</div>
      <div class="tx-amount-usd">${usdText}</div>
    </div>
  `;

  container.insertBefore(card, container.firstChild);

  while (container.children.length > MAX_FEED_ITEMS) {
    container.removeChild(container.lastChild!);
  }
}

/**
 * Re-render list on filter change
 */
function renderFeed(container: HTMLElement | null, countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  if (!container) return;
  container.innerHTML = '';

  const filtered = txHistory.filter(t => t.btcAmount >= minBtcThreshold);

  if (filtered.length === 0) {
    updateCounters(countElem, totalVolElem);
    container.innerHTML = `
      <div class="empty-feed">
        <div class="loading-spinner"></div>
        <p>실시간 트랜잭션 수신 대기 중... (현재 필터: ${minBtcThreshold} BTC 이상)</p>
      </div>
    `;
    return;
  }

  // txHistory is newest-first; prepend oldest-first so newest ends on top
  filtered.slice(0, MAX_FEED_ITEMS).reverse().forEach(item => prependItemToUi(container, item));

  updateCounters(countElem, totalVolElem);
}
