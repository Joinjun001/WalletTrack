import dotenv from 'dotenv';
dotenv.config();

/**
 * Base Sepolia 또는 EVM 테스트넷(샌드박스) 환경에서 JSON-RPC를 통해 트랜잭션을 확인하는 함수
 */
export async function getEvmSandboxTransaction(txHash: string) {
  const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org';

  console.log(`🔍 [EVM Testnet/Sandbox] RPC Node: ${rpcUrl}`);
  console.log(`🔍 트랜잭션 Hash: ${txHash}`);

  // 1. eth_getTransactionByHash 호출
  const txRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionByHash',
      params: [txHash],
      id: 1,
    }),
  });

  const txData = await txRes.json();
  const tx = txData.result;

  if (!tx) {
    console.log('⚠️ 트랜잭션을 찾을 수 없습니다. (아직 블록에 생성되지 않았거나 없는 해시입니다.)');
    return;
  }

  // 2. eth_getTransactionReceipt 호출 (영수증 및 상태 확인)
  const receiptRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [txHash],
      id: 2,
    }),
  });

  const receiptData = await receiptRes.json();
  const receipt = receiptData.result;

  console.log(`\n================ 트랜잭션 상세 정보 ================`);
  console.log(`From:        ${tx.from}`);
  console.log(`To:          ${tx.to}`);
  console.log(`Value:       ${parseInt(tx.value, 16) / 1e18} ETH`);
  console.log(`Gas Price:   ${parseInt(tx.gasPrice, 16) / 1e9} Gwei`);
  console.log(`Nonce:       ${parseInt(tx.nonce, 16)}`);
  console.log(`Block #:     ${parseInt(tx.blockNumber, 16)}`);
  
  if (receipt) {
    console.log(`Status:      ${receipt.status === '0x1' ? '✅ 성공 (Success)' : '❌ 실패 (Failed)'}`);
    console.log(`Gas Used:    ${parseInt(receipt.gasUsed, 16)}`);
  }
  
  console.log(`Explorer Link: https://sepolia.basescan.org/tx/${txHash}`);
}

// 직접 테스트용 (해시값을 입력하여 실행)
if (require.main === module) {
  const sampleTxHash = process.argv[2] || '0x';
  if (sampleTxHash !== '0x') {
    getEvmSandboxTransaction(sampleTxHash).catch(console.error);
  } else {
    console.log('사용법: npx ts-node src/evmTxViewer.ts <TX_HASH>');
  }
}
