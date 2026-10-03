/**
 * 사운드 알림: 큰 강제청산(바이낸스 선물 전체 마켓)과 BTCUSDT 선물 대량 체결이 나면 소리로 알린다.
 * 소리는 파일 없이 Web Audio로 만든다. 롱 청산·매도는 내려가는 음, 숏 청산·매수는 올라가는 음.
 */

import { onLiveLiquidation } from './futuresPanel.ts';
import { track } from './analytics.ts';

// 바이낸스 선물 시장 데이터 스트림은 /market 경로 (futuresPanel.ts 참고)
const TRADE_WS = 'wss://fstream.binance.com/market/ws/btcusdt@aggTrade';
const LIQ_SOUND_KEY = 'wallettrack.liqSoundUsd';
const TRADE_SOUND_KEY = 'wallettrack.tradeSoundUsd';
const MIN_SOUND_GAP_MS = 150;      // 연달아 터질 때 소리가 뭉개지지 않게
const TRADE_MERGE_MS = 100;         // 큰 시장가 주문은 여러 체결로 쪼개져 오므로 같은 방향 체결을 잠깐 모아서 본다

let audio: AudioContext | null = null;
let lastSoundAt = 0;
let liqThreshold = 0;
let tradeThreshold = 0;

function loadNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

/** 브라우저는 사용자가 화면을 누르기 전에는 소리를 막는다. 첫 조작 때 오디오를 연다 */
function unlockAudio() {
  if (!audio) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
  }
  if (audio.state === 'suspended') audio.resume();
  renderNote();
}

/** 금액이 클수록 조금 더 크고 길게 */
function beep(rising: boolean, usd: number, threshold: number) {
  if (!audio || audio.state !== 'running') return;
  const now = Date.now();
  if (now - lastSoundAt < MIN_SOUND_GAP_MS) return;
  lastSoundAt = now;

  const scale = Math.min(3, Math.max(1, Math.log10(usd / threshold) + 1)); // 기준의 1배 → 1, 100배 이상 → 3
  const t = audio.currentTime;
  const duration = 0.12 + 0.06 * scale;
  const [from, to] = rising ? [660, 990] : [520, 330];

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08 * scale, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function renderNote() {
  const note = document.getElementById('sound-alert-note');
  if (!note) return;
  const on = liqThreshold > 0 || tradeThreshold > 0;
  note.textContent = on && audio?.state !== 'running'
    ? '화면을 한 번 누르면 소리가 켜져요 (브라우저 정책)'
    : '이 페이지가 열려 있을 때만 울려요. 롱 청산·매도는 낮은 음, 숏 청산·매수는 높은 음';
}

// ---------- 대량 체결 ----------

interface AggTrade {
  p: string;  // 가격
  q: string;  // 수량
  T: number;  // 체결 시각
  m: boolean; // true = 매수자가 메이커 → 시장가 매도
}

let tradeWs: WebSocket | null = null;
let pending: { sell: boolean; usd: number } | null = null;
let flushTimer = 0;

function flushTrade() {
  if (pending && pending.usd >= tradeThreshold) beep(!pending.sell, pending.usd, tradeThreshold);
  pending = null;
  flushTimer = 0;
}

function onTrade(trade: AggTrade) {
  const usd = parseFloat(trade.p) * parseFloat(trade.q);
  if (!(usd > 0)) return;
  if (pending && pending.sell !== trade.m) flushTrade();
  pending = pending ? { sell: trade.m, usd: pending.usd + usd } : { sell: trade.m, usd };
  if (!flushTimer) flushTimer = window.setTimeout(flushTrade, TRADE_MERGE_MS);
}

/** 대량 체결 소리가 켜져 있을 때만 연결한다 (체결 스트림은 메시지가 많다) */
function syncTradeStream() {
  if (tradeThreshold > 0 && !tradeWs) {
    const ws = new WebSocket(TRADE_WS);
    tradeWs = ws;
    ws.onmessage = (event) => {
      try {
        onTrade(JSON.parse(event.data));
      } catch (e) {
        console.error('Trade WS Parse Error:', e);
      }
    };
    ws.onclose = () => {
      if (tradeWs !== ws) return;
      tradeWs = null;
      setTimeout(syncTradeStream, 3000);
    };
  } else if (!(tradeThreshold > 0) && tradeWs) {
    const ws = tradeWs;
    tradeWs = null;
    ws.close();
  }
}

// ---------- 화면 ----------

function initSelect(id: string, key: string, current: number, apply: (value: number) => void, kind: string) {
  const select = document.getElementById(id) as HTMLSelectElement | null;
  if (!select) return;
  if ([...select.options].some((o) => Number(o.value) === current)) select.value = String(current);
  else apply(0);
  select.addEventListener('change', () => {
    const value = Number(select.value) || 0;
    apply(value);
    saveNumber(key, value);
    unlockAudio();
    if (value > 0) beep(true, value, value); // 켜자마자 어떤 소리인지 들려준다
    renderNote();
    track('sound_alert_set', { kind, usd: value });
  });
}

export function initSoundAlerts() {
  liqThreshold = loadNumber(LIQ_SOUND_KEY);
  tradeThreshold = loadNumber(TRADE_SOUND_KEY);

  initSelect('liq-sound-threshold', LIQ_SOUND_KEY, liqThreshold, (v) => { liqThreshold = v; }, 'liquidation');
  initSelect('trade-sound-threshold', TRADE_SOUND_KEY, tradeThreshold, (v) => { tradeThreshold = v; syncTradeStream(); }, 'trade');

  document.getElementById('sound-alert-test')?.addEventListener('click', () => {
    unlockAudio();
    lastSoundAt = 0;
    beep(false, 1, 1);
    setTimeout(() => { lastSoundAt = 0; beep(true, 1, 1); }, 350);
  });

  // 설정이 켜진 채로 다시 방문하면 첫 조작 때 소리를 연다
  const unlockOnce = () => {
    unlockAudio();
    if (audio?.state === 'running') {
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    }
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);

  onLiveLiquidation((position, usd) => {
    if (liqThreshold > 0 && usd >= liqThreshold) beep(position === 'short', usd, liqThreshold);
  });

  syncTradeStream();
  renderNote();
}
