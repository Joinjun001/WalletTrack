/**
 * Bitcoin Real-time Live Transaction & Exchange Hot Wallet Tracker
 * Extreme Speed WebSocket Engine with Exchange Address Matching
 */

import { analyzeTransaction, escapeHtml, fromMempoolTx, KNOWN_EXCHANGES } from './txAnalysis.ts';
import type { ExchangeWallet, MempoolTx, RawTx, TxDirection } from './txAnalysis.ts';
import { prices, updatePrices } from './priceStore.ts';
import { formatKrwShort, formatSignedPct } from './market.ts';
import { getHistory } from './historyApi.ts';
import { track, trackOnce } from './analytics.ts';
import type { WhaleRecord } from './historyApi.ts';
import { icon } from './icons.ts';

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

type LiveTxListener = (tx: LiveBtcTransaction) => void;
const liveTxListeners: LiveTxListener[] = [];

/** 실시간으로 새로 감지된 거래 (서버 기록은 포함하지 않는다). 고래 알림이 쓴다 */
export function onLiveTx(fn: LiveTxListener) {
  liveTxListeners.push(fn);
}

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
    if (!res.ok) {
      trackOnce('api_fail', `binance_spot:${res.status}`, { source: 'binance_spot', status: res.status });
      return null; // e.g. 451 in restricted regions
    }
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
      console.log('Bitcoin real-time price WebSocket connected');
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

/**
 * Initialize Dashboard Engine
 */
export async function initLiveStreamDashboard() {
  const feedContainer = document.getElementById('live-tx-feed');
  const countElem = document.getElementById('live-tx-count');
  const totalVolElem = document.getElementById('live-total-vol');

  // Fetch initial BTC Price
  // 상단 시세 바 표시는 krMarket.ts가 맡는다 (고른 코인 기준)
  await fetchBtcPrice();

  // Connect Real-Time Price Stream WebSocket
  connectPriceWebSocket();

  // Periodic REST fallback every 20s if WebSocket disconnected
  setInterval(() => {
    if (!priceWsConnected) fetchBtcPrice();
  }, 20000);

  // Filter Buttons
  document.querySelectorAll('.threshold-btn[data-threshold]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.threshold-btn[data-threshold]').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget as HTMLElement;
      target.classList.add('active');
      minBtcThreshold = parseFloat(target.dataset.threshold || '0.1');
      track('whale_filter', { btc: minBtcThreshold });
      renderFeed(feedContainer, countElem, totalVolElem);
    });
  });

  // Connect High Speed WebSocket
  connectWebSocket(feedContainer, countElem, totalVolElem);

  // 서버에 쌓인 최근 24시간 기록을 실시간 피드 뒤에 붙인다 (서버가 응답하지 않으면 건너뜀)
  loadWhaleHistory(feedContainer, countElem, totalVolElem);
}

async function loadWhaleHistory(container: HTMLElement | null, countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  const records = await getHistory<WhaleRecord[]>(`/whales?hours=24&minBtc=${MIN_STORED_BTC}&limit=${MAX_HISTORY_ITEMS}`);
  if (!records?.length) return;

  const seen = new Set(txHistory.map(t => t.hash));
  const added = records
    .filter(r => !seen.has(r.hash))
    .map(r => toLiveTx(r.hash, r.btcAmount, r.direction, (r.exchangeAddress && KNOWN_EXCHANGES[r.exchangeAddress]) || null, r.detectedAt));
  if (added.length === 0) return;

  totalVolumeObservedBtc += added.reduce((sum, t) => sum + t.btcAmount, 0);
  txHistory = [...txHistory, ...added].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_HISTORY_ITEMS);
  renderFeed(container, countElem, totalVolElem);
}

function toLiveTx(hash: string, btcAmount: number, direction: TxDirection, exchange: ExchangeWallet | null, timestamp: number): LiveBtcTransaction {
  return {
    id: hash.substring(0, 10),
    hash,
    btcAmount,
    direction,
    timestamp,
    exchangeName: exchange ? exchange.name : '미확인 지갑',
    exchangeIcon: exchange ? exchange.icon : 'Wallet',
    exchangeColor: exchange ? exchange.color : '#8A99AD',
    isKnownExchange: !!exchange,
    isWhale: btcAmount >= WHALE_BTC
  };
}

// 서버 수집기와 같은 출처. blockchain.info(wss://ws.blockchain.info/inv)는 2026-10 기준 502로 연결되지 않는다
const MEMPOOL_WS = 'wss://mempool.space/api/v1/ws';

/**
 * Connect to mempool.space WebSocket (새로 들어온 미확인 거래)
 */
function connectWebSocket(container: HTMLElement | null, countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  const statusDot = document.getElementById('ws-status-dot');

  try {
    ws = new WebSocket(MEMPOOL_WS);

    ws.onopen = () => {
      console.log('Bitcoin transaction WebSocket connected');
      if (statusDot) statusDot.className = 'dot pulsing green';

      // 멤풀에 새로 들어온 거래를 받는다
      ws?.send(JSON.stringify({ 'track-mempool': true }));
    };

    ws.onmessage = (event) => {
      try {
        const added: MempoolTx[] | undefined = JSON.parse(event.data)?.['mempool-transactions']?.added;
        if (!added) return;
        for (const tx of added) processTransaction(fromMempoolTx(tx), container, countElem, totalVolElem);
      } catch (e) {
        console.error('WS Parse Error:', e);
      }
    };

    ws.onerror = (err) => {
      console.warn('WS Error, reconnecting...', err);
      trackOnce('api_fail', 'mempool_ws', { source: 'mempool_ws', status: 0 });
      if (statusDot) statusDot.className = 'dot red';
    };

    ws.onclose = () => {
      console.warn('WS Closed, reconnecting instantly...');
      if (statusDot) statusDot.className = 'dot yellow';
      setTimeout(() => connectWebSocket(container, countElem, totalVolElem), 3000);
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
  if (txHistory.some(t => t.hash === hash)) return; // 서버 기록으로 이미 받은 거래

  const item = toLiveTx(hash, btcAmount, direction, exchange, Date.now());
  for (const fn of liveTxListeners) fn(item);

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
  deposit: `<span class="tag deposit">${icon('deposit')} 거래소 입금</span>`,
  withdrawal: `<span class="tag withdrawal">${icon('withdraw')} 거래소 출금</span>`,
  transfer: `<span class="tag transfer">${icon('transfer')} 전송</span>`
};

/** 1분 안이면 "방금 전", 그 외에는 감지 시각 (오늘이 아니면 날짜 포함) */
function timeLabel(timestamp: number): string {
  if (Date.now() - timestamp < 60_000) return '방금 전';
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

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
        <span class="exchange-badge">
          <span class="exchange-dot" style="background: ${escapeHtml(item.exchangeColor)};"></span>${escapeHtml(item.exchangeIcon)}
        </span>
        ${DIRECTION_TAGS[item.direction]}
        ${item.isWhale ? `<span class="whale-badge">${icon('whale')} 고래</span>` : ''}
        <span class="tx-time-ago">${timeLabel(item.timestamp)}</span>
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
