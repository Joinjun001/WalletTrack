import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTransaction, escapeHtml, fromMempoolTx } from '../src/txAnalysis.ts';
import type { ExchangeWallet } from '../src/txAnalysis.ts';

const EX = 'exchangeAddr';
const exchanges: Record<string, ExchangeWallet> = {
  [EX]: { address: EX, name: 'Test Exchange', icon: 'T', color: '#000' }
};
const BTC = 1e8;

test('change output back to the sender is not counted', () => {
  const r = analyzeTransaction({
    hash: 'h',
    inputs: [{ prev_out: { addr: 'alice', value: 5 * BTC } }],
    out: [{ addr: 'bob', value: 1 * BTC }, { addr: 'alice', value: 3.9 * BTC }]
  }, exchanges);
  assert.equal(r.btcAmount, 1);
  assert.equal(r.direction, 'transfer');
  assert.equal(r.exchange, null);
});

test('all outputs are change -> total output is used', () => {
  const r = analyzeTransaction({
    hash: 'h',
    inputs: [{ prev_out: { addr: 'alice', value: 2 * BTC } }],
    out: [{ addr: 'alice', value: 1.9 * BTC }]
  }, exchanges);
  assert.equal(r.btcAmount, 1.9);
});

test('only a 0-value OP_RETURN besides change -> total output is used', () => {
  const r = analyzeTransaction({
    hash: 'h',
    inputs: [{ prev_out: { addr: 'alice', value: 2 * BTC } }],
    out: [{ addr: 'alice', value: 1.5 * BTC }, { value: 0 }]
  }, exchanges);
  assert.equal(r.btcAmount, 1.5);
});

test('exchange address in inputs (prev_out) -> withdrawal', () => {
  const r = analyzeTransaction({
    hash: 'h',
    inputs: [{ prev_out: { addr: EX, value: 10 * BTC } }],
    out: [{ addr: 'user', value: 2 * BTC }, { addr: EX, value: 7.9 * BTC }]
  }, exchanges);
  assert.equal(r.direction, 'withdrawal');
  assert.equal(r.btcAmount, 2);
  assert.equal(r.exchange?.name, 'Test Exchange');
});

test('exchange address in outputs -> deposit counts only the exchange output', () => {
  const r = analyzeTransaction({
    hash: 'h',
    inputs: [{ prev_out: { addr: 'user', value: 4 * BTC } }],
    out: [{ addr: EX, value: 3 * BTC }, { addr: 'other', value: 0.5 * BTC }]
  }, exchanges);
  assert.equal(r.direction, 'deposit');
  assert.equal(r.btcAmount, 3);
});

test('exchange on both sides -> transfer', () => {
  const r = analyzeTransaction({
    hash: 'h',
    inputs: [{ prev_out: { addr: EX, value: 4 * BTC } }],
    out: [{ addr: EX, value: 3.9 * BTC }]
  }, exchanges);
  assert.equal(r.direction, 'transfer');
});

test('missing fields do not throw', () => {
  const r = analyzeTransaction({ hash: 'h' }, exchanges);
  assert.equal(r.btcAmount, 0);
  assert.equal(r.direction, 'transfer');
});

test('escapeHtml escapes markup', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
});

test('mempool.space tx is converted and analyzed like a blockchain.info tx', () => {
  const raw = fromMempoolTx({
    txid: 'abc',
    vin: [{ prevout: { scriptpubkey_address: 'sender', value: 3 * BTC } }, { prevout: null }],
    vout: [
      { scriptpubkey_address: EX, value: 2 * BTC },
      { scriptpubkey_address: 'sender', value: 0.9 * BTC },
      { value: 0 } // OP_RETURN
    ]
  });
  assert.equal(raw.hash, 'abc');
  assert.equal(raw.inputs?.[1].prev_out, undefined);
  const result = analyzeTransaction(raw, exchanges);
  assert.equal(result.direction, 'deposit');
  assert.equal(result.btcAmount, 2);
});
