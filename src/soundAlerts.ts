/**
 * 관심 코인 사운드 알림.
 * - 강제청산 / 대형체결을 독립적으로 켜고 끌 수 있다.
 * - 관심 코인은 최대 5개까지 선택한다.
 * - BTC는 기존 btcStreams.ts의 다중 거래소 데이터를 그대로 사용한다.
 * - BTC 외 코인은 soundMarketStreams.ts에서 바이낸스·바이비트 실시간 데이터를 받는다.
 */

import { onBtcLiquidation, onBtcTrade } from './btcStreams.ts';
import { COINS } from './coins.ts';
import { track } from './analytics.ts';
import { prices } from './priceStore.ts';
import { liquidationSoundTier, tradeSoundTier } from './market.ts';
import type { SoundTier } from './market.ts';
import { playAlertSound } from './sounds.ts';
import {
  initSoundMarketStreams, onSoundMarketLiquidation, onSoundMarketTrade, setSoundMarketStreamConfig
} from './soundMarketStreams.ts';

const SETTINGS_KEY = 'wallettrack.soundSettingsV2';
const LEGACY_LIQ_KEY = 'wallettrack.liqSoundUsd';
const LEGACY_TRADE_KEY = 'wallettrack.tradeSoundUsd';
const LEGACY_VOLUME_KEY = 'wallettrack.soundVolume';
const PROMPT_KEY = 'wallettrack.soundPrompt';
const DEFAULT_VOLUME = 70;
const DEFAULT_LIQ_USD = 100_000;
const DEFAULT_TRADE_USD = 1_000_000;
const MAX_COINS = 5;
const MIN_SOUND_GAP_MS = 150;

interface SoundSettings {
  coins: string[];
  liquidation: { enabled: boolean; thresholdUsd: number };
  trade: { enabled: boolean; thresholdUsd: number };
  volume: number;
}

const DEFAULT_SETTINGS: SoundSettings = {
  coins: ['BTC'],
  liquidation: { enabled: true, thresholdUsd: DEFAULT_LIQ_USD },
  trade: { enabled: true, thresholdUsd: DEFAULT_TRADE_USD },
  volume: DEFAULT_VOLUME
};

let settings: SoundSettings = structuredClone(DEFAULT_SETTINGS);
let audio: AudioContext | null = null;
let master: GainNode | null = null;
let lastSoundAt = 0;
let busyUntil = 0;
let busyTier = 0;
let promptClosed = false;

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* 시크릿 모드: 이번 방문 동안만 */ }
}

function validThreshold(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeCoins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['BTC'];
  const allowed = new Set(COINS.map((coin) => coin.symbol));
  const coins = [...new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.toUpperCase()).filter((v) => allowed.has(v)))];
  return (coins.length ? coins : ['BTC']).slice(0, MAX_COINS);
}

function loadSettings(): SoundSettings {
  const raw = storageGet(SETTINGS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SoundSettings>;
      return {
        coins: normalizeCoins(parsed.coins),
        liquidation: {
          enabled: parsed.liquidation?.enabled !== false,
          thresholdUsd: validThreshold(parsed.liquidation?.thresholdUsd, DEFAULT_LIQ_USD)
        },
        trade: {
          enabled: parsed.trade?.enabled !== false,
          thresholdUsd: validThreshold(parsed.trade?.thresholdUsd, DEFAULT_TRADE_USD)
        },
        volume: Math.min(100, Math.max(0, Number(parsed.volume) || DEFAULT_VOLUME))
      };
    } catch {
      // 손상된 값이면 아래 legacy 마이그레이션으로 진행
    }
  }

  const legacyLiq = storageGet(LEGACY_LIQ_KEY);
  const legacyTrade = storageGet(LEGACY_TRADE_KEY);
  const legacyVolume = storageGet(LEGACY_VOLUME_KEY);
  const hasLegacy = legacyLiq !== null || legacyTrade !== null || legacyVolume !== null || storageGet(PROMPT_KEY) !== null;
  if (!hasLegacy) return structuredClone(DEFAULT_SETTINGS);

  const liq = Number(legacyLiq) || 0;
  const trade = Number(legacyTrade) || 0;
  return {
    coins: ['BTC'],
    liquidation: { enabled: liq > 0, thresholdUsd: liq > 0 ? liq : DEFAULT_LIQ_USD },
    trade: { enabled: trade > 0, thresholdUsd: trade > 0 ? trade : DEFAULT_TRADE_USD },
    volume: Math.min(100, Math.max(0, Number(legacyVolume) || DEFAULT_VOLUME))
  };
}

function saveSettings() {
  storageSet(SETTINGS_KEY, JSON.stringify(settings));
  // 구버전 코드로 되돌려도 최소한 BTC 설정이 자연스럽게 남도록 legacy 값도 같이 유지한다.
  storageSet(LEGACY_LIQ_KEY, String(settings.liquidation.enabled ? settings.liquidation.thresholdUsd : 0));
  storageSet(LEGACY_TRADE_KEY, String(settings.trade.enabled ? settings.trade.thresholdUsd : 0));
  storageSet(LEGACY_VOLUME_KEY, String(Math.max(1, settings.volume)));
}

function updateStreamConfig() {
  setSoundMarketStreamConfig({
    symbols: settings.coins,
    trades: settings.trade.enabled,
    liquidations: settings.liquidation.enabled
  });
}

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
  if (master) master.gain.value = (settings.volume / 100) ** 2 * 1.5;
}

function play(rising: boolean, tier: SoundTier) {
  if (!audio || !master || audio.state !== 'running' || settings.volume <= 0) return;
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

function playNow(rising: boolean, tier: SoundTier): number {
  if (!audio || !master || audio.state !== 'running') return 0;
  return playAlertSound(audio, master, rising, tier);
}

function selected(symbol: string): boolean {
  return settings.coins.includes(symbol);
}

function showLastEvent(text: string) {
  const elem = document.getElementById('sound-last-event');
  if (elem) elem.textContent = text;
}

function formatUsdShort(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function renderNote() {
  const note = document.getElementById('sound-alert-note');
  if (!note) return;
  const activeKinds = [settings.liquidation.enabled ? '강제청산' : '', settings.trade.enabled ? '대형체결' : ''].filter(Boolean);
  if (activeKinds.length === 0) {
    note.textContent = '사운드 알림이 꺼져 있어요.';
    return;
  }
  if (audio?.state !== 'running') {
    note.textContent = '화면을 한 번 누르면 소리가 켜져요 (브라우저 정책).';
    return;
  }
  note.textContent = `${settings.coins.join(' · ')} · ${activeKinds.join(' + ')} · 이 페이지가 열려 있을 때만 울려요.`;
}

function renderTypeControls() {
  const liqToggle = document.getElementById('liq-sound-enabled') as HTMLInputElement | null;
  const tradeToggle = document.getElementById('trade-sound-enabled') as HTMLInputElement | null;
  const liqSelect = document.getElementById('liq-sound-threshold') as HTMLSelectElement | null;
  const tradeSelect = document.getElementById('trade-sound-threshold') as HTMLSelectElement | null;
  if (liqToggle) liqToggle.checked = settings.liquidation.enabled;
  if (tradeToggle) tradeToggle.checked = settings.trade.enabled;
  if (liqSelect) {
    liqSelect.value = String(settings.liquidation.thresholdUsd);
    liqSelect.disabled = !settings.liquidation.enabled;
  }
  if (tradeSelect) {
    tradeSelect.value = String(settings.trade.thresholdUsd);
    tradeSelect.disabled = !settings.trade.enabled;
  }
}

function renderCoinControls() {
  const container = document.getElementById('sound-coin-options');
  if (!container) return;
  const atLimit = settings.coins.length >= MAX_COINS;
  container.innerHTML = COINS.map((coin) => {
    const checked = settings.coins.includes(coin.symbol);
    return `<label class="sound-coin-chip${checked ? ' active' : ''}" title="${coin.name}">
      <input type="checkbox" value="${coin.symbol}" ${checked ? 'checked' : ''} ${!checked && atLimit ? 'disabled' : ''}>
      <span>${coin.symbol}</span>
    </label>`;
  }).join('');

  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const symbol = input.value;
      if (input.checked) {
        if (!settings.coins.includes(symbol) && settings.coins.length < MAX_COINS) settings.coins.push(symbol);
      } else {
        settings.coins = settings.coins.filter((coin) => coin !== symbol);
        if (settings.coins.length === 0) settings.coins = ['BTC'];
      }
      saveSettings();
      updateStreamConfig();
      renderCoinControls();
      renderNote();
      track('sound_coins_set', { coins: settings.coins.join(','), count: settings.coins.length });
    });
  });

  const count = document.getElementById('sound-coin-count');
  if (count) count.textContent = `${settings.coins.length}/${MAX_COINS}`;
}

function initVolumeControl() {
  const slider = document.getElementById('sound-volume') as HTMLInputElement | null;
  if (!slider) return;
  slider.value = String(settings.volume);
  slider.addEventListener('input', () => {
    settings.volume = Number(slider.value) || 0;
    applyVolume();
  });
  slider.addEventListener('change', () => {
    saveSettings();
    unlockAudio();
    setTimeout(() => playNow(false, 1), 100);
    track('sound_volume', { volume: settings.volume });
  });
}

function playPreview() {
  const seconds = playNow(false, 1);
  setTimeout(() => playNow(true, 1), (seconds + 0.15) * 1000);
}

let previewTimers: number[] = [];
function playTierPreview() {
  previewTimers.forEach(clearTimeout);
  previewTimers = [];
  const note = document.getElementById('sound-alert-note');
  const labels = ['1단계 ($100K 미만)', '2단계 ($100K~)', '3단계 ($500K~)', '4단계 ($2M~)'];
  let delay = 0;
  ([1, 2, 3, 4] as SoundTier[]).forEach((tier, i) => {
    previewTimers.push(window.setTimeout(() => {
      playNow(false, tier);
      if (note) note.textContent = `롱 청산 ${labels[i]}`;
    }, delay));
    delay += [500, 700, 1300, 0][i];
  });
  previewTimers.push(window.setTimeout(renderNote, delay + 2200));
}

function promptMode(): 'ask' | 'resume' | null {
  const choice = storageGet(PROMPT_KEY);
  if (!choice) return 'ask';
  if (settings.liquidation.enabled || settings.trade.enabled) return 'resume';
  return null;
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
    ? '관심 코인의 큰 청산이나 대형 체결이 나면 소리로 알려드릴까요?'
    : '사운드 알림이 켜져 있어요. 소리를 들으려면 눌러 주세요';
  if (allow) allow.textContent = '소리 켜기';
  if (dismiss) dismiss.textContent = mode === 'ask' ? '괜찮아요' : '알림 끄기';
}

function savePromptChoice(choice: 'accepted' | 'declined') {
  storageSet(PROMPT_KEY, choice);
}

function setAllEnabled(enabled: boolean) {
  settings.liquidation.enabled = enabled;
  settings.trade.enabled = enabled;
  saveSettings();
  updateStreamConfig();
  renderTypeControls();
  renderNote();
}

function initPrompt() {
  document.getElementById('sound-prompt-allow')?.addEventListener('click', () => {
    setAllEnabled(true);
    savePromptChoice('accepted');
    unlockAudio();
    setTimeout(playPreview, 100);
    promptClosed = true;
    renderPrompt();
    track('sound_prompt', { action: 'allow' });
  });

  document.getElementById('sound-prompt-dismiss')?.addEventListener('click', () => {
    setAllEnabled(false);
    savePromptChoice('declined');
    promptClosed = true;
    renderPrompt();
    track('sound_prompt', { action: 'dismiss' });
  });

  renderPrompt();
}

function initTypeControls() {
  const bindToggle = (kind: 'liquidation' | 'trade', id: string) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    input?.addEventListener('change', () => {
      settings[kind].enabled = input.checked;
      saveSettings();
      savePromptChoice(settings.liquidation.enabled || settings.trade.enabled ? 'accepted' : 'declined');
      updateStreamConfig();
      renderTypeControls();
      renderNote();
      if (input.checked) {
        unlockAudio();
        setTimeout(() => playNow(true, 1), 100);
      }
      track('sound_type_set', { kind, enabled: input.checked });
    });
  };
  bindToggle('liquidation', 'liq-sound-enabled');
  bindToggle('trade', 'trade-sound-enabled');

  const bindThreshold = (kind: 'liquidation' | 'trade', id: string) => {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      settings[kind].thresholdUsd = Number(select.value) || (kind === 'liquidation' ? DEFAULT_LIQ_USD : DEFAULT_TRADE_USD);
      saveSettings();
      track('sound_alert_set', { kind, usd: settings[kind].thresholdUsd });
    });
  };
  bindThreshold('liquidation', 'liq-sound-threshold');
  bindThreshold('trade', 'trade-sound-threshold');
}

function registerSoundEvents() {
  // BTC는 기존 다중 거래소 경로를 보존한다.
  onBtcLiquidation((event) => {
    if (!selected('BTC') || !settings.liquidation.enabled || event.usd < settings.liquidation.thresholdUsd) return;
    play(event.position === 'short', liquidationSoundTier(event.usd));
    showLastEvent(`BTC ${event.position === 'long' ? '롱' : '숏'} 청산 · ${formatUsdShort(event.usd)}`);
  });
  onBtcTrade((event) => {
    if (!selected('BTC') || !settings.trade.enabled) return;
    // 기존 BTC 체결은 수량만 있으므로 현재 BTC 가격으로 달러 환산한다.
    // usdBtc가 아직 없을 수 있어 그 경우는 해당 초기 체결만 건너뛴다.
    if (!(prices.usdBtc > 0)) return;
    const usd = event.qty * prices.usdBtc;
    if (usd < settings.trade.thresholdUsd) return;
    play(event.side === 'buy', tradeSoundTier(usd, settings.trade.thresholdUsd));
    showLastEvent(`BTC 대형 ${event.side === 'buy' ? '매수' : '매도'} · ${formatUsdShort(usd)}`);
  });

  onSoundMarketLiquidation((event) => {
    if (!selected(event.symbol) || !settings.liquidation.enabled || event.usd < settings.liquidation.thresholdUsd) return;
    play(event.position === 'short', liquidationSoundTier(event.usd));
    showLastEvent(`${event.symbol} ${event.position === 'long' ? '롱' : '숏'} 청산 · ${formatUsdShort(event.usd)}`);
  });
  onSoundMarketTrade((event) => {
    if (!selected(event.symbol) || !settings.trade.enabled || event.usd < settings.trade.thresholdUsd) return;
    play(event.side === 'buy', tradeSoundTier(event.usd, settings.trade.thresholdUsd));
    showLastEvent(`${event.symbol} 대형 ${event.side === 'buy' ? '매수' : '매도'} · ${formatUsdShort(event.usd)}`);
  });
}

export function initSoundAlerts() {
  settings = loadSettings();
  saveSettings();
  renderTypeControls();
  renderCoinControls();
  initVolumeControl();
  initTypeControls();
  updateStreamConfig();
  initSoundMarketStreams();
  registerSoundEvents();

  document.getElementById('sound-alert-test')?.addEventListener('click', () => {
    unlockAudio();
    setTimeout(playTierPreview, 100);
    track('sound_preview');
  });

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


  initPrompt();
  renderNote();
}
