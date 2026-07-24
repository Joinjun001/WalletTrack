/**
 * Bitcoin Real-time Live Transaction & Exchange Hot Wallet Tracker
 * Extreme Speed WebSocket Engine with Exchange Address Matching
 */

export interface ExchangeWallet {
  address: string;
  name: string;
  icon: string;
  color: string;
}

export interface LiveBtcTransaction {
  id: string;
  hash: string;
  btcAmount: number;
  usdAmount: number;
  type: 'buy' | 'sell'; // buy (Deposit/Incoming), sell (Withdrawal/Outgoing)
  timestamp: number;
  exchangeName: string;
  exchangeIcon: string;
  exchangeColor: string;
  isKnownExchange: boolean;
  isWhale: boolean; // > 3 BTC
}

// Known Global Exchange Hot/Cold Wallets Database
export const KNOWN_EXCHANGES: Record<string, ExchangeWallet> = {
  // Binance
  '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', name: 'Binance Cold #1', icon: '🟡 Binance', color: '#F3BA2F' },
  '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s': { address: '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s', name: 'Binance Hot Wallet', icon: '🟡 Binance', color: '#F3BA2F' },
  'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h': { address: 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h', name: 'Binance Reserve', icon: '🟡 Binance', color: '#F3BA2F' },

  // Bitfinex
  'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97': { address: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', name: 'Bitfinex Cold Wallet', icon: '🟩 Bitfinex', color: '#00C684' },

  // Robinhood
  'bc1ql49ydapnjafl5t2cp9zpqgxhfv4hhd2rtv0wwptvq9wvc2t4d8aqchw2up': { address: 'bc1ql49ydapnjafl5t2cp9zpqgxhfv4hhd2rtv0wwptvq9wvc2t4d8aqchw2up', name: 'Robinhood Custody', icon: '🟢 Robinhood', color: '#00C805' },

  // Coinbase
  '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ': { address: '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ', name: 'Coinbase Prime', icon: '🔵 Coinbase', color: '#0052FF' },

  // OKX
  'bc1qk269y69gqawsqawz9g3n53y08pxf2yvqv33w24': { address: 'bc1qk269y69gqawsqawz9g3n53y08pxf2yvqv33w24', name: 'OKX Hot Wallet', icon: '⬛ OKX', color: '#FFFFFF' },

  // Kraken
  '3Fp4hkU92xBY2z2zSsgK4wXMgS29a70bc1': { address: '3Fp4hkU92xBY2z2zSsgK4wXMgS29a70bc1', name: 'Kraken Hot Wallet', icon: '🟣 Kraken', color: '#5741D9' }
};

let ws: WebSocket | null = null;
let priceWs: WebSocket | null = null;
let priceWsConnected = false;
let currentBtcPriceUsd = 65000;
let lastBtcPriceUsd = 0;
let minBtcThreshold = 0.1; // 속도감 및 감지 빈도를 높이기 위해 기본값을 0.1 BTC로 변경!
let txHistory: LiveBtcTransaction[] = [];
let totalVolumeObservedBtc = 0;
const MAX_FEED_ITEMS = 50;

/**
 * Fetch current Bitcoin price in USD (REST fallback / initial)
 */
export async function fetchBtcPrice(): Promise<number> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (res.ok) {
      const data = await res.json();
      if (data && data.price) {
        currentBtcPriceUsd = parseFloat(data.price);
        return currentBtcPriceUsd;
      }
    }
  } catch (err) {
    // Fallback to mempool.space if Binance REST fails
    try {
      const res2 = await fetch('https://mempool.space/api/v1/prices');
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2 && data2.USD) {
          currentBtcPriceUsd = data2.USD;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch price fallback:', e);
    }
  }
  return currentBtcPriceUsd;
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
function connectPriceWebSocket(priceElem: HTMLElement | null) {
  const liveBadge = document.getElementById('price-live-badge');

  try {
    priceWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

    priceWs.onopen = () => {
      console.log('⚡ High-Speed Bitcoin Real-Time Price WebSocket Connected');
      priceWsConnected = true;
      if (liveBadge) liveBadge.classList.add('active');
    };

    priceWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.c) {
          const newPrice = parseFloat(data.c);
          if (!isNaN(newPrice) && newPrice > 0) {
            updatePriceUi(priceElem, newPrice);
          }
        }
      } catch (e) {
        console.error('Price WS Parse Error:', e);
      }
    };

    priceWs.onerror = (err) => {
      console.warn('Price WS Error, attempting reconnect...', err);
      priceWsConnected = false;
      if (liveBadge) liveBadge.classList.remove('active');
    };

    priceWs.onclose = () => {
      console.warn('Price WS Closed, reconnecting in 2 seconds...');
      priceWsConnected = false;
      if (liveBadge) liveBadge.classList.remove('active');
      setTimeout(() => connectPriceWebSocket(priceElem), 2000);
    };
  } catch (err) {
    console.error('Price WebSocket Init Error:', err);
  }
}

/**
 * Real-time update BTC Price UI with instant up/down visual feedback
 */
function updatePriceUi(priceElem: HTMLElement | null, newPrice: number) {
  if (priceElem) {
    if (lastBtcPriceUsd > 0) {
      if (newPrice > lastBtcPriceUsd) {
        priceElem.classList.remove('price-down');
        priceElem.classList.add('price-up');
        setTimeout(() => priceElem.classList.remove('price-up'), 600);
      } else if (newPrice < lastBtcPriceUsd) {
        priceElem.classList.remove('price-up');
        priceElem.classList.add('price-down');
        setTimeout(() => priceElem.classList.remove('price-down'), 600);
      }
    }
    priceElem.textContent = formatUsd(newPrice, true);
  }
  lastBtcPriceUsd = newPrice;
  currentBtcPriceUsd = newPrice;
}

/**
 * Initialize Dashboard Engine
 */
export async function initLiveStreamDashboard() {
  const priceElem = document.getElementById('live-btc-price');
  const feedContainer = document.getElementById('live-tx-feed');
  const countElem = document.getElementById('live-tx-count');
  const totalVolElem = document.getElementById('live-total-vol');

  // Fetch initial BTC Price
  const initialPrice = await fetchBtcPrice();
  if (priceElem) {
    priceElem.textContent = formatUsd(initialPrice, true);
    lastBtcPriceUsd = initialPrice;
  }

  // Connect Real-Time Price Stream WebSocket
  connectPriceWebSocket(priceElem);

  // Periodic REST fallback every 20s if WebSocket disconnected
  setInterval(async () => {
    if (!priceWsConnected) {
      const p = await fetchBtcPrice();
      updatePriceUi(priceElem, p);
    }
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
function processTransaction(txData: any, container: HTMLElement | null, countElem: HTMLElement | null, totalVolElem: HTMLElement | null) {
  const hash = txData.hash;
  const outputs = txData.out || [];
  const inputs = txData.inputs || [];

  let totalSats = 0;
  let matchedExchange: ExchangeWallet | null = null;

  // Check outputs for matched exchange wallet
  for (const out of outputs) {
    const val = out.value || 0;
    totalSats += val;
    const addr = out.addr || out.scriptpubkey_address;
    if (addr && KNOWN_EXCHANGES[addr]) {
      matchedExchange = KNOWN_EXCHANGES[addr];
    }
  }

  // Check inputs if not found in outputs
  if (!matchedExchange) {
    for (const inp of inputs) {
      const prevout = inp.prevout;
      const addr = prevout?.addr || prevout?.scriptpubkey_address;
      if (addr && KNOWN_EXCHANGES[addr]) {
        matchedExchange = KNOWN_EXCHANGES[addr];
      }
    }
  }

  const btcAmount = totalSats / 1e8;
  if (btcAmount < minBtcThreshold) return; // Filter small micro-txs for speed & relevance

  const usdAmount = btcAmount * currentBtcPriceUsd;

  // Simple buy/sell heuristic based on outputs topology
  const type: 'buy' | 'sell' = outputs.length <= 2 ? 'buy' : 'sell';
  const isWhale = btcAmount >= 3.0; // 3 BTC 이상을 고래로 설정하여 더 자주 알림 감지

  const exchangeName = matchedExchange ? matchedExchange.name : 'Unknown Exchange / Whale';
  const exchangeIcon = matchedExchange ? matchedExchange.icon : '🏛️ Hot Wallet';
  const exchangeColor = matchedExchange ? matchedExchange.color : '#8A99AD';
  const isKnownExchange = !!matchedExchange;

  const item: LiveBtcTransaction = {
    id: hash.substring(0, 10),
    hash,
    btcAmount,
    usdAmount,
    type,
    timestamp: Date.now(),
    exchangeName,
    exchangeIcon,
    exchangeColor,
    isKnownExchange,
    isWhale
  };

  txHistory.unshift(item);
  if (txHistory.length > MAX_FEED_ITEMS) {
    txHistory.pop();
  }

  totalVolumeObservedBtc += btcAmount;

  // Prepend UI Card immediately
  prependItemToUi(container, item);

  // Update counters
  if (countElem) countElem.textContent = `${txHistory.length} 건 감지`;
  if (totalVolElem) totalVolElem.textContent = formatBtc(totalVolumeObservedBtc);
}

/**
 * Prepend card UI to stream container
 */
function prependItemToUi(container: HTMLElement | null, item: LiveBtcTransaction) {
  if (!container) return;

  const placeholder = container.querySelector('.empty-feed');
  if (placeholder) placeholder.remove();

  const card = document.createElement('div');
  card.className = `live-tx-card ${item.type} ${item.isWhale ? 'whale-alert' : ''}`;

  const isBuy = item.type === 'buy';
  const typeTag = isBuy 
    ? `<span class="tag buy">🟢 매수 (BUY)</span>` 
    : `<span class="tag sell">🔴 매도 (SELL)</span>`;

  card.innerHTML = `
    <div class="tx-left">
      <div class="tx-type-row">
        <span class="exchange-badge" style="border-color: ${item.exchangeColor};">
          ${item.exchangeIcon}
        </span>
        ${typeTag}
        ${item.isWhale ? `<span class="whale-badge">🐋 WHALE!</span>` : ''}
        <span class="tx-time-ago">방금 전</span>
      </div>
      <div class="tx-hash-row">
        <span>지갑/거래소: <strong>${item.exchangeName}</strong></span>
        <code style="margin-left: 0.5rem; opacity: 0.8;">(${item.hash.substring(0, 10)}...)</code>
      </div>
    </div>
    
    <div class="tx-right">
      <div class="tx-amount-btc ${item.type}">
        ${isBuy ? '+' : '-'}${formatBtc(item.btcAmount)}
      </div>
      <div class="tx-amount-usd">
        ≈ ${formatUsd(item.usdAmount)}
      </div>
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
    container.innerHTML = `
      <div class="empty-feed">
        <div class="loading-spinner"></div>
        <p>실시간 트랜잭션 수신 대기 중... (현재 필터: ${minBtcThreshold} BTC 이상)</p>
      </div>
    `;
    return;
  }

  filtered.forEach(item => prependItemToUi(container, item));

  if (countElem) countElem.textContent = `${filtered.length} 건 감지`;
}
