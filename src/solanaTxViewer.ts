import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

/**
 * Solana Devnet (샌드박스) 환경에서 특정 계정/지갑의 최근 트랜잭션 내역을 확인하는 함수
 */
export async function getSolanaSandboxTransactions(walletAddress: string, limit: number = 5) {
  // Solana Devnet (샌드박스 환경) 클러스터 연결
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const pubkey = new PublicKey(walletAddress);

  console.log(`🔍 [Solana Devnet] 지갑 주소: ${walletAddress}`);
  console.log(`Recent ${limit} transactions...`);

  // 1. 해당 계정의 최근 트랜잭션 시그니처 가져오기
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit });

  if (signatures.length === 0) {
    console.log('⚠️ 트랜잭션 내역이 없습니다.');
    return;
  }

  // 2. 각 트랜잭션 상세 정보 조회
  for (let i = 0; i < signatures.length; i++) {
    const sigInfo = signatures[i];
    const signature = sigInfo.signature;

    console.log(`\n----------------------------------------`);
    console.log(`[${i + 1}] Transaction Signature: ${signature}`);
    console.log(`   - Slot: ${sigInfo.slot}`);
    console.log(`   - Block Time: ${sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toLocaleString() : 'N/A'}`);
    console.log(`   - Error State: ${sigInfo.err ? JSON.stringify(sigInfo.err) : 'Success (No Error)'}`);
    console.log(`   - Solana Explorer (Devnet Sandbox): https://explorer.solana.com/tx/${signature}?cluster=devnet`);

    // 상세 트랜잭션 파싱 데이터 가져오기
    const txDetail = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (txDetail) {
      console.log(`   - Fee Paid: ${txDetail.meta?.fee ? txDetail.meta.fee / 1e9 : 0} SOL`);
      console.log(`   - Instructions count: ${txDetail.transaction.message.instructions.length}`);
    }
  }
}

// 직접 실행 테스트용 (원하는 지갑 주소로 변경 가능)
if (require.main === module) {
  // 예시: Solana Devnet 활성 테스트 지갑 주소
  const testAddress = process.argv[2] || '11111111111111111111111111111111';
  getSolanaSandboxTransactions(testAddress, 3).catch(console.error);
}
