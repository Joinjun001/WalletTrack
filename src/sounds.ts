/**
 * 사운드 알림 소리 (파일 없이 Web Audio로 합성). 8비트 아르페지오(도·미·솔) 한 가지를 쓰고,
 * 단계(1~4)가 올라갈수록 같은 8비트 소리가 더 크고 낮고 길어지며, 3단계는 2번, 4단계는 3번 반복한다 (다른 소리는 섞지 않는다).
 * rising = 숏 청산·시장가 매수(올라가는 음), 아니면 롱 청산·시장가 매도(내려가는 음).
 */

import type { SoundTier } from './market.ts';

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

/**
 * 소리 한 번. pitch는 단계가 높을수록 낮아지는 배율(무게감), length는 길어지는 배율.
 * 반환값은 소리 길이(초): 반복할 때 간격으로 쓴다.
 */
function playBase(ctx: AudioContext, out: AudioNode, rising: boolean, start: number, volume: number, pitch: number, length: number): number {
  // 도·미·솔 아르페지오 (내려갈 땐 거꾸로)
  const notes = rising ? [523, 659, 784] : [784, 659, 523];
  const step = 0.065 * length;
  notes.forEach((f, i) => tone(ctx, out, { type: 'square', from: f * pitch, start: start + i * step, duration: step * 0.95, volume: volume * 0.55, attack: 0.003 }));
  return step * notes.length;
}

/** 단계별 연출: 크기·음높이·길이·반복 횟수 */
const TIERS: Record<SoundTier, { volume: number; pitch: number; length: number; repeat: number }> = {
  1: { volume: 0.12, pitch: 1, length: 1, repeat: 1 },
  2: { volume: 0.17, pitch: 0.94, length: 1.15, repeat: 1 },
  3: { volume: 0.23, pitch: 0.84, length: 1.3, repeat: 2 },
  4: { volume: 0.3, pitch: 0.75, length: 1.4, repeat: 3 }
};

/** 단계에 맞춰 소리를 낸다. 끝나는 데 걸리는 시간(초)을 돌려준다 */
export function playAlertSound(ctx: AudioContext, out: AudioNode, rising: boolean, tier: SoundTier): number {
  const t = TIERS[tier];
  let at = ctx.currentTime + 0.01;
  let end = at;
  for (let i = 0; i < t.repeat; i++) {
    end = at + playBase(ctx, out, rising, at, t.volume, t.pitch, t.length);
    at = end + 0.06;
  }
  return end - ctx.currentTime;
}
