/**
 * Pure transaction analysis (no DOM) — testable with node:test
 */

export interface ExchangeWallet {
  address: string;
  name: string;
  icon: string;
  color: string;
}

// deposit: 거래소 지갑으로 들어감 / withdrawal: 거래소 지갑에서 나감 / transfer: 그 외(미확인 지갑 간 이동, 거래소 간 이동)
export type TxDirection = 'deposit' | 'withdrawal' | 'transfer';

// blockchain.info `utx` message shape (only the fields we use)
export interface RawOutput {
  addr?: string;
  value?: number;
}

export interface RawInput {
  prev_out?: RawOutput;
}

export interface RawTx {
  hash: string;
  inputs?: RawInput[];
  out?: RawOutput[];
}

export interface TxAnalysis {
  hash: string;
  btcAmount: number;
  direction: TxDirection;
  exchange: ExchangeWallet | null;
}

// Known exchange wallets. 주소 체크섬은 검증했지만 소유 주체는 공개 라벨 기준이라 틀릴 수 있다.
export const KNOWN_EXCHANGES: Record<string, ExchangeWallet> = {
  // Binance
  '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', name: 'Binance Cold #1', icon: '🟡 Binance', color: '#F3BA2F' },
  '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s': { address: '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s', name: 'Binance Hot Wallet', icon: '🟡 Binance', color: '#F3BA2F' },
  'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h': { address: 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h', name: 'Binance Reserve', icon: '🟡 Binance', color: '#F3BA2F' },

  // Bitfinex
  'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97': { address: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', name: 'Bitfinex Cold Wallet', icon: '🟩 Bitfinex', color: '#00C684' },

  // Coinbase
  '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ': { address: '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ', name: 'Coinbase Prime', icon: '🔵 Coinbase', color: '#0052FF' }
};

const SATS_PER_BTC = 1e8;

function sumSats(outputs: RawOutput[]): number {
  return outputs.reduce((sum, o) => sum + (o.value || 0), 0);
}

function findExchange(addrs: (string | undefined)[], exchanges: Record<string, ExchangeWallet>): ExchangeWallet | null {
  for (const addr of addrs) {
    if (addr && exchanges[addr]) return exchanges[addr];
  }
  return null;
}

/**
 * 거래 하나를 분석한다.
 * - 금액: 입력 주소로 되돌아가는 출력(거스름돈)은 뺀다. 남는 금액이 0이면(전부 거스름돈) 전체 출력 합.
 *   거래소 입금이면 거래소 주소로 간 출력만 센다.
 * - 방향: 거래소가 입력에만 있으면 출금, 출력에만 있으면 입금, 그 외는 전송.
 */
export function analyzeTransaction(tx: RawTx, exchanges: Record<string, ExchangeWallet> = KNOWN_EXCHANGES): TxAnalysis {
  const inputs = tx.inputs || [];
  const outputs = tx.out || [];

  const inputAddrs = inputs.map(i => i.prev_out?.addr);
  const inputAddrSet = new Set(inputAddrs.filter((a): a is string => !!a));

  const nonChange = outputs.filter(o => !o.addr || !inputAddrSet.has(o.addr));
  const sentOutputs = sumSats(nonChange) > 0 ? nonChange : outputs; // 0원짜리 OP_RETURN만 남는 경우 포함

  const fromExchange = findExchange(inputAddrs, exchanges);
  const toExchange = findExchange(sentOutputs.map(o => o.addr), exchanges);

  let direction: TxDirection = 'transfer';
  let amountOutputs = sentOutputs;
  if (fromExchange && !toExchange) {
    direction = 'withdrawal';
  } else if (toExchange && !fromExchange) {
    direction = 'deposit';
    amountOutputs = sentOutputs.filter(o => o.addr && exchanges[o.addr]);
  }

  return {
    hash: tx.hash,
    btcAmount: sumSats(amountOutputs) / SATS_PER_BTC,
    direction,
    exchange: fromExchange || toExchange
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
