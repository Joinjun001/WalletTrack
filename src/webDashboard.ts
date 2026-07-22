import { Connection, PublicKey } from '@solana/web3.js';

// DOM 요소 획득
const tabSolana = document.getElementById('tab-solana') as HTMLButtonElement;
const tabEvm = document.getElementById('tab-evm') as HTMLButtonElement;
const panelSolana = document.getElementById('panel-solana') as HTMLElement;
const panelEvm = document.getElementById('panel-evm') as HTMLElement;

const solanaInput = document.getElementById('solana-input') as HTMLInputElement;
const btnSearchSolana = document.getElementById('btn-search-solana') as HTMLButtonElement;
const solanaResults = document.getElementById('solana-results') as HTMLElement;

const evmInput = document.getElementById('evm-input') as HTMLInputElement;
const btnSearchEvm = document.getElementById('btn-search-evm') as HTMLButtonElement;
const evmResults = document.getElementById('evm-results') as HTMLElement;

// Tab 전환 이벤트
tabSolana.addEventListener('click', () => {
  tabSolana.classList.add('active');
  tabEvm.classList.remove('active');
  panelSolana.classList.remove('hidden');
  panelEvm.classList.add('hidden');
});

tabEvm.addEventListener('click', () => {
  tabEvm.classList.add('active');
  tabSolana.classList.remove('active');
  panelEvm.classList.remove('hidden');
  panelSolana.classList.add('hidden');
});

// Quick Chips 클릭 처리
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', (e) => {
    const addr = (e.target as HTMLElement).getAttribute('data-sol-addr');
    if (addr) {
      solanaInput.value = addr;
      fetchSolanaTransactions(addr);
    }
  });
});

// 1. Solana Devnet 트랜잭션 조회 함수
async function fetchSolanaTransactions(address: string) {
  if (!address.trim()) return;

  solanaResults.innerHTML = `
    <div class="placeholder-state">
      <div class="loader"></div>
      <p style="margin-top: 10px;">Solana Devnet에서 [${address.slice(0, 8)}...] 트랜잭션을 불러오는 중...</p>
    </div>
  `;

  try {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const pubkey = new PublicKey(address.trim());

    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 5 });

    if (signatures.length === 0) {
      solanaResults.innerHTML = `
        <div class="placeholder-state">
          <p>⚠️ 이 지갑 주소의 최근 Devnet 트랜잭션 내역이 없습니다.</p>
        </div>
      `;
      return;
    }

    solanaResults.innerHTML = ''; // 기존 결과 초기화

    for (let i = 0; i < signatures.length; i++) {
      const sigInfo = signatures[i];
      const timeStr = sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toLocaleString() : 'Unknown Time';
      const statusClass = sigInfo.err ? 'fail' : 'success';
      const statusText = sigInfo.err ? '❌ 실패' : '✅ 성공';

      const card = document.createElement('div');
      card.className = 'tx-card';
      card.innerHTML = `
        <div class="tx-header">
          <span class="tx-sig">#${i + 1} ${sigInfo.signature.slice(0, 16)}...${sigInfo.signature.slice(-12)}</span>
          <span class="tx-status ${statusClass}">${statusText}</span>
        </div>
        <div class="tx-details">
          <span><strong>Block Slot:</strong> ${sigInfo.slot}</span>
          <span><strong>시간:</strong> ${timeStr}</span>
        </div>
        <a class="explorer-link" href="https://explorer.solana.com/tx/${sigInfo.signature}?cluster=devnet" target="_blank" rel="noopener noreferrer">
          🔗 Solana Explorer (Devnet) 보기 &rarr;
        </a>
      `;
      solanaResults.appendChild(card);
    }
  } catch (err: any) {
    solanaResults.innerHTML = `
      <div class="placeholder-state" style="color: #f87171;">
        <p>❌ 오류 발생: ${err.message || '유효하지 않은 지갑 주소이거나 네트워크 오류입니다.'}</p>
      </div>
    `;
  }
}

// 2. EVM Sepolia 트랜잭션 분석 함수
async function fetchEvmTransaction(txHash: string) {
  if (!txHash.trim()) return;

  evmResults.innerHTML = `
    <div class="placeholder-state">
      <div class="loader"></div>
      <p style="margin-top: 10px;">Base Sepolia RPC에서 트랜잭션 조회 중...</p>
    </div>
  `;

  try {
    const rpcUrl = 'https://sepolia.base.org';
    const cleanHash = txHash.trim();

    // eth_getTransactionByHash
    const txRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [cleanHash], id: 1 })
    });
    const txData = (await txRes.json()).result;

    if (!txData) {
      evmResults.innerHTML = `
        <div class="placeholder-state">
          <p>⚠️ 트랜잭션을 찾을 수 없습니다. (올바른 Tx Hash인지 확인하세요)</p>
        </div>
      `;
      return;
    }

    // eth_getTransactionReceipt
    const receiptRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [cleanHash], id: 2 })
    });
    const receiptData = (await receiptRes.json()).result;

    const isSuccess = receiptData?.status === '0x1';
    const valueEth = (parseInt(txData.value, 16) / 1e18).toFixed(6);

    evmResults.innerHTML = `
      <div class="tx-card">
        <div class="tx-header">
          <span class="tx-sig">Tx Hash: ${cleanHash.slice(0, 12)}...${cleanHash.slice(-10)}</span>
          <span class="tx-status ${isSuccess ? 'success' : 'fail'}">
            ${isSuccess ? '✅ 성공' : '❌ 실패'}
          </span>
        </div>
        <div class="tx-details">
          <span><strong>From:</strong> ${txData.from.slice(0, 8)}...${txData.from.slice(-6)}</span>
          <span><strong>To:</strong> ${txData.to ? `${txData.to.slice(0, 8)}...${txData.to.slice(-6)}` : 'Contract Creation'}</span>
          <span><strong>Value:</strong> ${valueEth} ETH</span>
          <span><strong>Block #:</strong> ${parseInt(txData.blockNumber, 16)}</span>
        </div>
        <a class="explorer-link" href="https://sepolia.basescan.org/tx/${cleanHash}" target="_blank" rel="noopener noreferrer">
          🔗 Basescan Explorer 보기 &rarr;
        </a>
      </div>
    `;
  } catch (err: any) {
    evmResults.innerHTML = `
      <div class="placeholder-state" style="color: #f87171;">
        <p>❌ 오류 발생: ${err.message || '네트워크 오류가 발생했습니다.'}</p>
      </div>
    `;
  }
}

// 이벤트 리스너 등록
btnSearchSolana.addEventListener('click', () => {
  fetchSolanaTransactions(solanaInput.value);
});

solanaInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') fetchSolanaTransactions(solanaInput.value);
});

btnSearchEvm.addEventListener('click', () => {
  fetchEvmTransaction(evmInput.value);
});

evmInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') fetchEvmTransaction(evmInput.value);
});

// 초기 로딩 시 시스템 프로그램으로 한번 검색
fetchSolanaTransactions(solanaInput.value);
