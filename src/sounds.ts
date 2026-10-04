/**
 * 사운드 알림 소리 (파일 없이 Web Audio로 합성). 사용자가 소리 종류를 고르고,
 * 단계(1~4)가 올라갈수록 같은 소리가 더 크고 낮고 길어지며, 3단계부터 쿵 하는 저음, 4단계는 폭발음과 반복 경보가 겹친다.
 * rising = 숏 청산·시장가 매수(올라가는 음), 아니면 롱 청산·시장가 매도(내려가는 음).
 */

import type { SoundTier } from './market.ts';

export type SoundStyle = 'chirp' | 'coin' | 'drum' | 'laser' | 'bell' | 'retro';

export const SOUND_STYLES: { id: SoundStyle; label: string }[] = [
  { id: 'chirp', label: '기본 (삐)' },
  { id: 'coin', label: '동전' },
  { id: 'drum', label: '드럼' },
  { id: 'laser', label: '레이저' },
  { id: 'bell', label: '종' },
  { id: 'retro', label: '8비트' }
];

export function isSoundStyle(value: unknown): value is SoundStyle {
  return SOUND_STYLES.some((s) => s.id === value);
}

interface ToneOptions {
  type: OscillatorType;
  from: number;    // 시작 주파수
  to?: number;     // 끝 주파수 (없으면 그대로)
  start: number;   // 오디오 시각 (초)
  duration: number;
  volume: number;
  attack?: number;
}

function tone(ctx: AudioContext, out: AudioNode, o: ToneOptions) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, o.start);
  if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(o.to, o.start + o.duration);
  const attack = o.attack ?? 0.008;
  gain.gain.setValueAtTime(0.0001, o.start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.volume), o.start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration);
  osc.connect(gain).connect(out);
  osc.start(o.start);
  osc.stop(o.start + o.duration + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;

function whiteNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** 잡음을 필터에 통과시킨 소리 (스네어, 폭발) */
function noise(ctx: AudioContext, out: AudioNode, o: { start: number; duration: number; volume: number; filter: BiquadFilterType; from: number; to: number }) {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.from, o.start);
  filter.frequency.exponentialRampToValueAtTime(o.to, o.start + o.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, o.start);
  gain.gain.exponentialRampToValueAtTime(o.volume, o.start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration);
  src.connect(filter).connect(gain).connect(out);
  src.start(o.start);
  src.stop(o.start + o.duration + 0.05);
}

/** 쿵: 사인파를 빠르게 낮추는 킥 드럼 소리 */
function boom(ctx: AudioContext, out: AudioNode, start: number, volume: number, duration: number) {
  tone(ctx, out, { type: 'sine', from: 140, to: 38, start, duration, volume, attack: 0.004 });
}

/** 종: FM 합성 (변조 깊이가 줄어들며 금속성 배음이 사라진다) */
function bell(ctx: AudioContext, out: AudioNode, freq: number, start: number, volume: number, duration: number) {
  const carrier = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const gain = ctx.createGain();
  carrier.frequency.value = freq;
  mod.frequency.value = freq * 3.5;
  modGain.gain.setValueAtTime(freq * 2.5, start);
  modGain.gain.exponentialRampToValueAtTime(1, start + duration);
  mod.connect(modGain).connect(carrier.frequency);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  carrier.connect(gain).connect(out);
  mod.start(start);
  carrier.start(start);
  mod.stop(start + duration + 0.05);
  carrier.stop(start + duration + 0.05);
}

/**
 * 소리 한 번. pitch는 단계가 높을수록 낮아지는 배율(무게감), length는 길어지는 배율.
 * 반환값은 소리 길이(초): 반복할 때 간격으로 쓴다.
 */
function playBase(ctx: AudioContext, out: AudioNode, style: SoundStyle, rising: boolean, start: number, volume: number, pitch: number, length: number): number {
  switch (style) {
    case 'chirp': {
      const d = 0.16 * length;
      const [from, to] = rising ? [660, 990] : [520, 330];
      tone(ctx, out, { type: 'triangle', from: from * pitch, to: to * pitch, start, duration: d, volume });
      return d;
    }
    case 'coin': {
      // 높은 음 두 개 (게임 동전). 내려갈 땐 순서를 뒤집는다
      const [a, b] = rising ? [988, 1319] : [1319, 880];
      tone(ctx, out, { type: 'square', from: a * pitch, start, duration: 0.07, volume: volume * 0.55 });
      tone(ctx, out, { type: 'square', from: b * pitch, start: start + 0.07, duration: 0.3 * length, volume: volume * 0.55 });
      return 0.07 + 0.3 * length;
    }
    case 'drum': {
      boom(ctx, out, start, volume * 1.6, 0.22 * length);
      if (rising) {
        // 킥 + 스네어
        noise(ctx, out, { start: start + 0.11, duration: 0.14 * length, volume: volume * 0.8, filter: 'highpass', from: 1800, to: 1200 });
      } else {
        // 킥 + 낮은 탐
        tone(ctx, out, { type: 'sine', from: 220 * pitch, to: 110 * pitch, start: start + 0.11, duration: 0.25 * length, volume: volume * 1.2 });
      }
      return 0.3 * length;
    }
    case 'laser': {
      const d = 0.22 * length;
      const [from, to] = rising ? [300, 2200] : [2200, 180];
      tone(ctx, out, { type: 'sawtooth', from: from * pitch, to: to * pitch, start, duration: d, volume: volume * 0.6 });
      return d;
    }
    case 'bell': {
      const d = 0.9 * length;
      bell(ctx, out, (rising ? 1047 : 659) * pitch, start, volume, d);
      return Math.min(d, 0.35);
    }
    case 'retro': {
      // 도·미·솔 아르페지오 (내려갈 땐 거꾸로)
      const notes = rising ? [523, 659, 784] : [784, 659, 523];
      const step = 0.065 * length;
      notes.forEach((f, i) => tone(ctx, out, { type: 'square', from: f * pitch, start: start + i * step, duration: step * 0.95, volume: volume * 0.55, attack: 0.003 }));
      return step * notes.length;
    }
  }
}

/** 단계별 연출: 크기·음높이·길이·반복 횟수, 저음 쿵, 폭발음 */
const TIERS: Record<SoundTier, { volume: number; pitch: number; length: number; repeat: number; boom: number; blast: boolean }> = {
  1: { volume: 0.12, pitch: 1, length: 1, repeat: 1, boom: 0, blast: false },
  2: { volume: 0.18, pitch: 0.94, length: 1.25, repeat: 1, boom: 0, blast: false },
  3: { volume: 0.24, pitch: 0.84, length: 1.5, repeat: 2, boom: 0.5, blast: false },
  4: { volume: 0.3, pitch: 0.75, length: 1.7, repeat: 3, boom: 0.8, blast: true }
};

/** 단계에 맞춰 소리를 낸다. 끝나는 데 걸리는 시간(초)을 돌려준다 */
export function playAlertSound(ctx: AudioContext, out: AudioNode, style: SoundStyle, rising: boolean, tier: SoundTier): number {
  const t = TIERS[tier];
  const start = ctx.currentTime + 0.01;
  let end = start;
  if (t.boom > 0) boom(ctx, out, start, t.boom, tier === 4 ? 1.1 : 0.6);
  if (t.blast) {
    // 폭발: 거친 잡음이 점점 먹먹해진다
    noise(ctx, out, { start, duration: 1.4, volume: 0.35, filter: 'lowpass', from: 4000, to: 120 });
    tone(ctx, out, { type: 'sawtooth', from: 90, to: 30, start, duration: 0.9, volume: 0.12 });
  }
  let at = start + (t.boom > 0 ? 0.04 : 0);
  for (let i = 0; i < t.repeat; i++) {
    const length = playBase(ctx, out, style, rising, at, t.volume, t.pitch, t.length);
    end = at + length;
    at = end + 0.06;
  }
  return end - ctx.currentTime;
}
