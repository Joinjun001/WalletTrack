/**
 * 사운드 알림: 큰 강제청산(바이낸스 선물 전체 마켓)과 BTCUSDT 선물 대량 체결이 나면 소리로 알린다.
 * 소리는 8비트 아르페지오(sounds.ts)이고 볼륨을 정할 수 있다. 롱 청산·매도는 내려가는 음, 숏 청산·매수는 올라가는 음.
 * 청산은 금액이 클수록($100K / $500K / $2M) 단계가 올라가 더 크고 낮게, 여러 번 울린다. 체결은 기준 대비 배수로 단계를 정한다.
 */

import { onLiveLiquidation } from './futuresPanel.ts';
import { track } from './analytics.ts';
import { liquidationSoundTier, tradeSoundTier } from './market.ts';
import type { SoundTier } from './market.ts';
import { playAlertSound } from './sounds.ts';

// 바이낸스 선물 시장 데이터 스트림은 /market 경로 (futuresPanel.ts 참고)
const TRADE_WS = 'wss://fstream.binance.com/market/ws/btcusdt@aggTrade';
const LIQ_SOUND_KEY = 'wallettrack.liqSoundUsd';
const TRADE_SOUND_KEY = 'wallettrack.tradeSoundUsd';
const PROMPT_KEY = 'wallettrack.soundPrompt'; // 처음 방문 때 물어본 결과 (accepted | declined)
const VOLUME_KEY = 'wallettrack.soundVolume'; // 0~100
const DEFAULT_VOLUME = 70;
const DEFAULT_LIQ_USD = 100_000;     // 처음 물어볼 때 '소리 켜기'를 누르면 쓰는 기준
const DEFAULT_TRADE_USD = 1_000_000;
const MIN_SOUND_GAP_MS = 150;      // 연달아 터질 때 소리가 뭉개지지 않게
const TRADE_MERGE_MS = 100;         // 큰 시장가 주문은 여러 체결로 쪼개져 오므로 같은 방향 체결을 잠깐 모아서 본다

let audio: AudioContext | null = null;
let master: GainNode | null = null; // 볼륨 → 압축기(여러 소리가 겹쳐도 찢어지지 않게) → 스피커
let lastSoundAt = 0;
let busyUntil = 0; // 3단계 이상 큰 소리가 울리는 동안은 같거나 작은 소리를 건너뛴다
let busyTier = 0;
let volume = DEFAULT_VOLUME;
let promptClosed = false; // 이번 방문에서 안내를 닫았는지
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
    master = audio.createGain();
    const compressor = audio.createDynamicsCompressor();
    master.connect(compressor).connect(audio.destination);
    applyVolume();
  }
  if (audio.state === 'suspended') audio.resume().then(onAudioState, () => {});
  onAudioState();
}

function onAudioState() {
  renderNote();
  renderPrompt();
}

function applyVolume() {
  // 귀로 듣기에 고르게 커지도록 제곱 곡선
  if (master) master.gain.value = (volume / 100) ** 2 * 1.5;
}

function play(rising: boolean, tier: SoundTier) {
  if (!audio || !master || audio.state !== 'running' || volume <= 0) return;
  const now = Date.now();
  if (now < busyUntil && tier <= busyTier) return;
  if (tier <= 2 && now - lastSoundAt < MIN_SOUND_GAP_MS) return;
  lastSoundAt = now;
  const seconds = playAlertSound(audio, master, rising, tier);
  if (tier >= 3) {
    busyUntil = now + seconds * 1000;
    busyTier = tier;
  }
}

/** 미리 듣기용: 막힘 없이 바로 울린다 */
function playNow(rising: boolean, tier: SoundTier): number {
  if (!audio || !master || audio.state !== 'running') return 0;
  return playAlertSound(audio, master, rising, tier);
}

function renderNote() {
  const note = document.getElementById('sound-alert-note');
  if (!note) return;
  const on = liqThreshold > 0 || tradeThreshold > 0;
  note.textContent = on && audio?.state !== 'running'
    ? '화면을 한 번 누르면 소리가 켜져요 (브라우저 정책)'
    : '이 페이지가 열려 있을 때만 울려요. 롱 청산·매도는 내려가는 음, 숏 청산·매수는 올라가는 음. 청산이 $100K·$500K·$2M을 넘을 때마다 더 크게 울려요';
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
  if (pending && pending.usd >= tradeThreshold) play(!pending.sell, tradeSoundTier(pending.usd, tradeThreshold));
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

type Kind = 'liquidation' | 'trade';

const SELECTS: Record<Kind, { id: string; key: string }> = {
  liquidation: { id: 'liq-sound-threshold', key: LIQ_SOUND_KEY },
  trade: { id: 'trade-sound-threshold', key: TRADE_SOUND_KEY }
};

function selectOf(kind: Kind) {
  return document.getElementById(SELECTS[kind].id) as HTMLSelectElement | null;
}

/** 목록에 있는 값만 쓴다 (예전에 저장한 값이 목록에서 빠졌으면 끈다) */
function setThreshold(kind: Kind, value: number, save: boolean) {
  const select = selectOf(kind);
  if (select && ![...select.options].some((o) => Number(o.value) === value)) value = 0;
  if (select) select.value = String(value);
  if (kind === 'liquidation') liqThreshold = value;
  else {
    tradeThreshold = value;
    syncTradeStream();
  }
  if (save) saveNumber(SELECTS[kind].key, value);
}

/** 짧은 미리 듣기: 내려가는 음, 올라가는 음 */
function playPreview() {
  const seconds = playNow(false, 1);
  setTimeout(() => playNow(true, 1), (seconds + 0.15) * 1000);
}

let previewTimers: number[] = [];

/** 청산 소리를 1단계부터 4단계까지 차례로 들려준다 */
function playTierPreview() {
  previewTimers.forEach(clearTimeout);
  previewTimers = [];
  const note = document.getElementById('sound-alert-note');
  const labels = ['1단계 ($100K 미만)', '2단계 ($100K~)', '3단계 ($500K~)', '4단계 ($2M~)'];
  let delay = 0;
  ([1, 2, 3, 4] as SoundTier[]).forEach((tier, i) => {
    previewTimers.push(window.setTimeout(() => {
      playNow(false, tier);
      if (note) note.textContent = `🔊 롱 청산 ${labels[i]}`;
    }, delay));
    delay += [500, 700, 1300, 0][i];
  });
  previewTimers.push(window.setTimeout(renderNote, delay + 2200));
}

function initVolumeControl() {
  const saved = loadNumber(VOLUME_KEY);
  volume = saved > 0 ? Math.min(100, saved) : DEFAULT_VOLUME;
  const slider = document.getElementById('sound-volume') as HTMLInputElement | null;
  if (slider) {
    slider.value = String(volume);
    slider.addEventListener('input', () => {
      volume = Number(slider.value) || 0;
      applyVolume();
    });
    slider.addEventListener('change', () => {
      saveNumber(VOLUME_KEY, Math.max(1, volume)); // 0은 '저장 안 됨'과 구분이 안 되므로 1로
      unlockAudio();
      setTimeout(() => playNow(false, 1), 100);
      track('sound_volume', { volume });
    });
  }
}

// ---------- 처음 들어왔을 때 묻기 ----------

/**
 * ask: 아직 고른 적이 없으면 켤지 묻는다.
 * resume: 켜 둔 사용자가 다시 왔을 때. 브라우저는 화면을 누르기 전엔 소리를 막으므로 한 번 눌러 달라고 안내한다.
 */
function promptMode(): 'ask' | 'resume' | null {
  if (liqThreshold > 0 || tradeThreshold > 0) return 'resume';
  try {
    return localStorage.getItem(PROMPT_KEY) ? null : 'ask';
  } catch {
    return 'ask';
  }
}

function renderPrompt() {
  const box = document.getElementById('sound-prompt');
  if (!box) return;
  const mode = promptMode();
  box.hidden = mode === null || promptClosed;
  if (box.hidden || !mode) return;
  box.dataset.mode = mode;
  const text = document.getElementById('sound-prompt-text');
  const allow = document.getElementById('sound-prompt-allow');
  const dismiss = document.getElementById('sound-prompt-dismiss');
  if (text) text.textContent = mode === 'ask'
    ? '🔊 큰 청산이나 대량 체결이 나면 소리로 알려드릴까요?'
    : '🔊 사운드 알림이 켜져 있어요. 소리를 들으려면 눌러 주세요';
  if (allow) allow.textContent = '소리 켜기';
  if (dismiss) dismiss.textContent = mode === 'ask' ? '괜찮아요' : '알림 끄기';
}

function savePromptChoice(choice: 'accepted' | 'declined') {
  try {
    localStorage.setItem(PROMPT_KEY, choice);
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만
  }
}

function initPrompt() {
  document.getElementById('sound-prompt-allow')?.addEventListener('click', () => {
    const mode = promptMode();
    if (mode === 'ask') {
      setThreshold('liquidation', DEFAULT_LIQ_USD, true);
      setThreshold('trade', DEFAULT_TRADE_USD, true);
    }
    savePromptChoice('accepted');
    unlockAudio();
    // resume()은 비동기라 바로 울리면 첫 소리가 묻힐 수 있다
    setTimeout(playPreview, 100);
    promptClosed = true;
    renderPrompt();
    renderNote();
    track('sound_prompt', { action: 'allow', mode: mode || '' });
  });

  document.getElementById('sound-prompt-dismiss')?.addEventListener('click', () => {
    const mode = promptMode();
    if (mode === 'resume') {
      setThreshold('liquidation', 0, true);
      setThreshold('trade', 0, true);
    }
    savePromptChoice('declined');
    promptClosed = true;
    renderPrompt();
    renderNote();
    track('sound_prompt', { action: 'dismiss', mode: mode || '' });
  });

  renderPrompt();
}

export function initSoundAlerts() {
  initVolumeControl();
  setThreshold('liquidation', loadNumber(LIQ_SOUND_KEY), false);
  setThreshold('trade', loadNumber(TRADE_SOUND_KEY), false);

  for (const kind of Object.keys(SELECTS) as Kind[]) {
    const select = selectOf(kind);
    select?.addEventListener('change', () => {
      const value = Number(select.value) || 0;
      setThreshold(kind, value, true);
      savePromptChoice(value > 0 ? 'accepted' : 'declined');
      unlockAudio();
      if (value > 0) setTimeout(() => playNow(true, 1), 100); // 켜자마자 어떤 소리인지 들려준다
      promptClosed = true;
      renderPrompt();
      renderNote();
      track('sound_alert_set', { kind, usd: value });
    });
  }

  document.getElementById('sound-alert-test')?.addEventListener('click', () => {
    unlockAudio();
    setTimeout(playTierPreview, 100);
    track('sound_preview');
  });

  // 설정이 켜진 채로 다시 방문하면 첫 조작 때 소리를 연다. 안내 밖을 눌렀으면 안내도 닫는다
  // (안내 안의 '알림 끄기'를 누르는 중에 먼저 닫히면 버튼이 눌리지 않는다)
  const unlockOnce = (e: Event) => {
    unlockAudio();
    if (promptMode() === 'resume' && !(e.target instanceof Element && e.target.closest('#sound-prompt'))) {
      promptClosed = true;
      renderPrompt();
    }
    if (audio?.state === 'running') {
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    }
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);

  onLiveLiquidation((position, usd) => {
    if (liqThreshold > 0 && usd >= liqThreshold) play(position === 'short', liquidationSoundTier(usd));
  });

  initPrompt();
  renderNote();
}
