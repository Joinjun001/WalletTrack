import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log("🤖 Pay.sh & x402 실습 프로젝트가 준비되었습니다!");
  
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.warn("⚠️  .env 파일에 PRIVATE_KEY가 설정되지 않았습니다.");
  } else {
    console.log("✅ 환경변수 로드 완료");
  }
}

main().catch(console.error);