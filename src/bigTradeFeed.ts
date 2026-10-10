/**
 * 대형 체결 탭: 여러 거래소 대형 코인(BTC·ETH·XRP·SOL·DOGE) 체결 중 큰 주문을 실시간 피드로 보여 주고,
 * 기간별(1시간·하루·1주·1달) 매수·매도·순매수 합계를 코인마다 한 줄씩 낸다. 코인은 여러 개 고를 수 있고(최소 1개),
 * 큰 주문 기준은 코인별 최소 수량(bigTradeStats.ts BIG_TRADE_MIN, BTC 1개 가치 정도)의 1·5·10·50배다.
 * 합계 = 기록 서버가 모은 1분 합계(server/src/bigTrades.ts, until까지, 1분마다 다시 받음) + until 이후 브라우저가 실시간으로 받은 체결.
 * 그래서 페이지를 열자마자 기간 전체가 보이고 체결이 들어오는 즉시 바뀐다. 서버에 연결할 수 없으면 1시간만 페이지를 연 뒤부터 모은 값으로 보여 준다.
 */

import { onFeedTrade, setExtraTradeCoins } from './btcStreams.ts';
import { EXCHANGE_LABELS, FEED_COINS, isFeedCoin } from './exchangeFeeds.ts';
import type { FeedCoin, MergedTrade } from './exchangeFeeds.ts';
import { BIG_TRADE_MIN } from './bigTradeStats.ts';
import { prices } from './priceStore.ts';
import { usdQuote } from './binanceSpot.ts';
import { onUpbitTicker } from './krMarket.ts';
import { coinName } from './coins.ts';
import { formatKrwShort, formatUsdShort } from './market.ts';
import { setSelectedCoin } from './selectedCoin.ts';
import { track } from './analytics.ts';
import { getHistory } from './historyApi.ts';
import type { BigTradeSummary } from './historyApi.ts';

const STEPS = [1, 5, 10, 50];  // 코인별 최소 수량의 배수 (필터 버튼)
const WHALE_STEP = 10;         // 이 배수 이상은 강조
const SUMMARY_MS = 60 * 60 * 1000;
const MAX_STORED = 500;        // 코인마다
const MAX_SHOWN = 60;
const STEP_KEY = 'wallettrack.bigTradeBtc'; // 배수. 예전 BTC 필터 값(1·5·10·50)과 같아서 그대로 이어 쓴다
const COIN_KEY = 'wallettrack.bigTradeCoin'; // 고른 코인들 (쉼표). 예전에 하나만 저장한 값도 그대로 읽힌다
const FLOW_PERIODS = [1, 24, 168, 720]; // 시간
const SERVER_REFRESH_MS = 60_000;

interface Item extends MergedTrade {
  krw: number; // 받은 시점 시세로 환산 (모르면 0)
  usd: number;
}

let coins: FeedCoin[] = ['BTC']; // FEED_COINS 순서
const itemsByCoin = new Map<FeedCoin, Item[]>(); // 최신이 앞. BTC와 고른 코인만 쌓인다
let step = 1;
let flowHours = 1;
let serverRequest = 0;
let bases = new Map<FeedCoin, BigTradeSummary>(); // 고른 코인별 서버 합계 (지금 기간)
let serverFailed = false;
const krwPrices = new Map<string, number>(); // 업비트 원화 시세 (BTC 외 코인 환산용)

const minQty = (c: FeedCoin) => BIG_TRADE_MIN[c] * step;

/** 고른 코인들의 체결을 최신순으로 합친다 */
function selectedItems(): Item[] {
  return coins.flatMap((c) => itemsByCoin.get(c) ?? []).sort((a, b) => b.ts - a.ts);
}

const shown = (t: Item) => t.qty >= minQty(t.coin);

/** 6만, 3.5만, 3,500 (필터 버튼·안내 문구용) */
function shortQty(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만` : n.toLocaleString('ko-KR');
}

/** 1,000개 이상은 정수로 (XRP·DOGE, 한 달 합계) */
function formatQty(qty: number, c: FeedCoin): string {
  const digits = Math.abs(qty) >= 1000 ? 0 : 2;
  return `${qty.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${c}`;
}

/** "30 ETH 이상" 또는 여러 코인이면 "코인별 기준 이상" */
function minText(): string {
  return coins.length === 1 ? `${shortQty(BIG_TRADE_MIN[coins[0]])} ${coins[0]} 이상` : '코인별 기준 이상';
}

function unitText(local: boolean): string {
  return local ? `${minText()} · 페이지를 연 뒤부터 (기록 서버 연결 안 됨)` : `${minText()} · 5개 거래소`;
}

function itemHtml(t: Item): string {
  const time = new Date(t.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const value = [t.krw > 0 ? `≈${formatKrwShort(t.krw)}` : '', t.usd > 0 ? formatUsdShort(t.usd) : ''].filter(Boolean).join(' · ');
  return `
    <li class="big-item ${t.side}${t.qty >= BIG_TRADE_MIN[t.coin] * WHALE_STEP ? ' whale' : ''}" data-coin="${t.coin}" title="누르면 ${coinName(t.coin)} 차트로">
      <span class="big-side">${t.side === 'buy' ? '매수' : '매도'}</span>
      <span class="big-btc">${formatQty(t.qty, t.coin)}</span>
      <span class="big-value">${value}</span>
      <span class="big-exchange">${EXCHANGE_LABELS[t.exchange]}</span>
      <span class="liq-time">${time}</span>
    </li>`;
}

function emptyHtml(): string {
  const what = coins.length === 1 ? `${shortQty(minQty(coins[0]))} ${coins[0]} 이상` : `${coins.join('·')} 큰`;
  return `<li class="liq-empty">${what} 체결을 기다리는 중... (페이지를 연 뒤부터 모아요)</li>`;
}

function renderList() {
  const list = document.getElementById('big-feed');
  if (!list) return;
  const items = selectedItems().filter(shown).slice(0, MAX_SHOWN);
  list.innerHTML = items.length ? items.map(itemHtml).join('') : emptyHtml();
  renderCount();
}

function renderCount() {
  const count = document.getElementById('big-count');
  if (count) count.textContent = `${selectedItems().filter(shown).length}건`;
}

function setText(id: string, text: string) {
  const elem = document.getElementById(id);
  if (elem) elem.textContent = text;
}

const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

function rowHtml(c: FeedCoin, sums: { buy: number; sell: number } | null): string {
  if (!sums) return `<tr><td class="big-flow-coin">${c}</td><td class="num">-</td><td class="num">-</td><td class="num">-</td></tr>`;
  const net = sums.buy - sums.sell;
  return `
    <tr>
      <td class="big-flow-coin">${c}</td>
      <td class="num up">${formatQty(sums.buy, c)}</td>
      <td class="num down">${formatQty(sums.sell, c)}</td>
      <td class="num ${tone(net)}">${net >= 0 ? '+' : ''}${formatQty(net, c)}</td>
    </tr>`;
}

/** since 이후 브라우저가 받은 그 코인 체결 합계 (서버와 같은 기준: 코인별 최소 수량 이상) */
function liveSums(c: FeedCoin, since: number): { buy: number; sell: number } {
  let buy = 0;
  let sell = 0;
  for (const t of itemsByCoin.get(c) ?? []) {
    if (t.ts < since) continue; // 거래소마다 시각이 조금씩 달라 순서가 완전히 맞지는 않는다
    if (t.side === 'buy') buy += t.qty;
    else sell += t.qty;
  }
  return { buy, sell };
}

/** 코인별 서버 합계 + 그 이후 실시간 체결. 서버가 안 되면 1시간만 브라우저 값 */
function sumsOf(c: FeedCoin): { buy: number; sell: number } | null {
  const base = bases.get(c);
  if (base && base.hours === flowHours) {
    const live = liveSums(c, base.until);
    return { buy: base.buyBtc + live.buy, sell: base.sellBtc + live.sell };
  }
  if (serverFailed && flowHours === 1) return liveSums(c, Date.now() - SUMMARY_MS);
  return null;
}

function renderSummary() {
  const rows = document.getElementById('big-flow-rows');
  if (rows) rows.innerHTML = coins.map((c) => rowHtml(c, sumsOf(c))).join('');
}

/** 기록이 기간보다 짧은 거래소를 알려 준다 (예: "OKX 10/6 07:00부터") */
function coverageNote(s: BigTradeSummary): string {
  const start = Date.now() - s.hours * 3_600_000 + 3_600_000; // 1시간 정도 모자란 건 넘어간다
  const short: string[] = [];
  for (const [exchange, label] of Object.entries(EXCHANGE_LABELS)) {
    const since = s.since[exchange];
    if (since === undefined) short.push(`${label} 기록 없음`);
    else if (since > start) {
      const d = new Date(since);
      const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      short.push(`${label} ${d.getMonth() + 1}/${d.getDate()} ${time}부터`);
    }
  }
  // 아직 못 채운 날: "10/5 일부 거래소 채우는 중"
  const days = [...new Set(Object.values(s.missingDays ?? {}).flat())].sort();
  if (days.length) {
    const label = days.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`).join(', ');
    short.unshift(`${label} 일부 거래소 기록 채우는 중 (다음 날 반영)`);
  }
  return short.join(' · ');
}

/** 여러 코인이면 코인 이름을 앞에 붙이고, 내용이 같은 코인은 묶는다 ("ETH·XRP: OKX 10/10 17:58부터") */
function coverageNotes(): string {
  const byNote = new Map<string, FeedCoin[]>();
  for (const c of coins) {
    const base = bases.get(c);
    const note = base ? coverageNote(base) : '';
    if (note) byNote.set(note, [...(byNote.get(note) ?? []), c]);
  }
  return [...byNote].map(([note, list]) => (coins.length > 1 ? `${list.join('·')}: ${note}` : note)).join(' / ');
}

/** 고른 코인들의 지금 기간 서버 합계를 받는다 (1분마다 다시) */
async function loadServerSummary() {
  const request = ++serverRequest;
  const hours = flowHours;
  const list = [...coins];
  const results = await Promise.all(list.map((c) => getHistory<BigTradeSummary>(`/big-trades/summary?hours=${hours}&symbol=${c}`)));
  if (request !== serverRequest) return; // 그 사이 코인·기간이 바뀌었다
  bases = new Map();
  results.forEach((s, i) => s && bases.set(list[i], s));
  serverFailed = results.every((s) => !s);
  setText('big-flow-unit', unitText(serverFailed && hours === 1));
  setText('big-flow-note', serverFailed ? '기록 서버에 연결할 수 없어요' : coverageNotes());
  renderSummary();
}

function resetSummary() {
  bases = new Map();
  serverRequest++; // 받는 중인 예전 요청은 버린다
  setText('big-flow-note', '');
  renderSummary();
  loadServerSummary();
}

function selectFlowPeriod(hours: number) {
  flowHours = hours;
  document.querySelectorAll<HTMLButtonElement>('.flow-period-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.flowHours) === hours));
  resetSummary();
}

/** 필터 버튼 글자: 코인 하나면 "≥ 30 ETH", 여러 개면 "기준 ×5" (마우스를 올리면 코인별 수량) */
function renderStepButtons() {
  document.querySelectorAll<HTMLButtonElement>('.big-btn').forEach((btn) => {
    const s = Number(btn.dataset.big);
    btn.classList.toggle('active', s === step);
    const label = btn.querySelector('.big-btn-label');
    if (label) label.textContent = coins.length === 1 ? `≥ ${shortQty(BIG_TRADE_MIN[coins[0]] * s)} ${coins[0]}` : `기준 ×${s}`;
    btn.title = coins.map((c) => `${shortQty(BIG_TRADE_MIN[c] * s)} ${c}`).join(' · ') + ' 이상';
  });
}

function selectCoins(next: FeedCoin[]) {
  coins = FEED_COINS.filter((c) => next.includes(c));
  // BTC는 항상 받으므로 남겨 두고, 고르지 않은 코인은 연결을 끊으면서 비운다
  for (const c of itemsByCoin.keys()) if (c !== 'BTC' && !coins.includes(c)) itemsByCoin.delete(c);
  setExtraTradeCoins(coins);
  document.querySelectorAll<HTMLButtonElement>('.big-coin-btn').forEach((b) => {
    const on = coins.includes(b.dataset.coin as FeedCoin);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  setText('big-feed-unit', `${coins.join('·')} · 바이낸스 선물·현물 · 바이비트 · OKX · 업비트`);
  setText('big-flow-unit', unitText(false));
  renderStepButtons();
  renderList();
  resetSummary();
}

function krwPrice(c: FeedCoin): number {
  return c === 'BTC' ? prices.krwBtc : krwPrices.get(`KRW-${c}`) ?? 0;
}

function usdPrice(c: FeedCoin): number {
  return c === 'BTC' ? prices.usdBtc : usdQuote(c)?.price ?? 0;
}

function onTrade(t: MergedTrade) {
  if (t.qty < BIG_TRADE_MIN[t.coin] || (t.coin !== 'BTC' && !coins.includes(t.coin))) return;
  const item: Item = { ...t, krw: t.qty * krwPrice(t.coin), usd: t.qty * usdPrice(t.coin) };
  let list = itemsByCoin.get(t.coin);
  if (!list) itemsByCoin.set(t.coin, (list = []));
  list.unshift(item);
  if (list.length > MAX_STORED) list.length = MAX_STORED;
  if (!coins.includes(t.coin)) return;
  renderSummary();
  if (!shown(item)) return;

  const feed = document.getElementById('big-feed');
  if (!feed) return;
  feed.querySelector('.liq-empty')?.remove();
  feed.insertAdjacentHTML('afterbegin', itemHtml(item));
  while (feed.children.length > MAX_SHOWN) feed.lastElementChild?.remove();
  renderCount();
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

export function initBigTradeFeed() {
  try {
    const savedStep = Number(localStorage.getItem(STEP_KEY));
    if (STEPS.includes(savedStep)) step = savedStep;
    const savedCoins = (localStorage.getItem(COIN_KEY) ?? '').split(',').filter(isFeedCoin);
    if (savedCoins.length) coins = savedCoins;
  } catch {
    // 저장된 값이 없으면 기본값
  }
  onUpbitTicker((market, t) => krwPrices.set(market, t.trade_price));

  document.querySelectorAll<HTMLButtonElement>('.big-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.big);
      if (!STEPS.includes(next) || next === step) return;
      step = next;
      save(STEP_KEY, String(next));
      renderStepButtons();
      renderList();
      track('big_trade_filter', { step: next, coins: coins.join(',') });
    });
  });

  // 누를 때마다 켜고 끈다. 마지막 하나는 끌 수 없다
  document.querySelectorAll<HTMLButtonElement>('.big-coin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.coin;
      if (!isFeedCoin(c)) return;
      const next = coins.includes(c) ? coins.filter((x) => x !== c) : [...coins, c];
      if (next.length === 0) return;
      selectCoins(next);
      save(COIN_KEY, coins.join(','));
      track('big_trade_coin', { coins: coins.join(',') });
    });
  });

  document.getElementById('big-feed')?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.big-item');
    if (!item || !isFeedCoin(item.dataset.coin)) return;
    setSelectedCoin(item.dataset.coin);
    document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelectorAll<HTMLButtonElement>('.flow-period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hours = Number(btn.dataset.flowHours);
      if (!FLOW_PERIODS.includes(hours) || hours === flowHours) return;
      selectFlowPeriod(hours);
      track('big_trade_period', { hours });
    });
  });

  selectCoins(coins);
  onFeedTrade(onTrade);
  setInterval(renderSummary, 30_000); // 서버가 안 될 때: 1시간이 지난 체결을 합계에서 뺀다
  setInterval(loadServerSummary, SERVER_REFRESH_MS);
}
