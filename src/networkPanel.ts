/**
 * Bitcoin network panel: recommended fees, latest block, halving countdown (mempool.space)
 */

import { halvingInfo, timeAgoKo } from './market.ts';

const MEMPOOL_API = 'https://mempool.space/api';
const REFRESH_MS = 30 * 1000;

interface Fees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
}

interface Block {
  height: number;
  timestamp: number; // seconds
  tx_count: number;
  extras?: { pool?: { name?: string } };
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${MEMPOOL_API}${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch (e) {
    console.warn(`mempool.space ${path} failed:`, e);
    return null;
  }
}

function setText(id: string, text: string) {
  const elem = document.getElementById(id);
  if (elem) elem.textContent = text;
}

async function refresh() {
  const [fees, blocks] = await Promise.all([
    getJson<Fees>('/v1/fees/recommended'),
    getJson<Block[]>('/v1/blocks')
  ]);

  if (fees) {
    setText('fee-fast', String(fees.fastestFee));
    setText('fee-half', String(fees.halfHourFee));
    setText('fee-hour', String(fees.hourFee));
  }

  const tip = blocks?.[0];
  if (tip) {
    setText('block-height', `#${tip.height.toLocaleString('ko-KR')}`);
    setText('block-pool', tip.extras?.pool?.name || '알 수 없음');
    setText('block-txs', `${tip.tx_count.toLocaleString('ko-KR')}건`);
    setText('block-time', timeAgoKo(Math.max(0, Date.now() / 1000 - tip.timestamp)));

    const halving = halvingInfo(tip.height);
    setText('halving-days', `D-${halving.estimatedDays}`);
    setText('halving-blocks', `${halving.remainingBlocks.toLocaleString('ko-KR')} 블록 남음`);
  }
}

export function initNetworkPanel() {
  refresh();
  setInterval(refresh, REFRESH_MS);
}
