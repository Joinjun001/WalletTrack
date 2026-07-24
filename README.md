# ⚡ WalletTrack: Bitcoin Real-Time Whale Tracker & Multi-Chain Explorer

WalletTrack은 **비트코인(BTC) 실시간 트랜잭션 수신**, **고래(Whale) 이동 감지**, **실시간 비트코인 시세 스트리밍**, 그리고 **Solana 및 EVM 블록체인 탐색 기능**을 제공하는 초고속 Web3 대시보드 및 트랜잭션 트래커입니다.

---

## ✨ 핵심 기능 (Features)

### 1. 🟡 비트코인 초고속 실시간 Mempool 감지
- **WebSocket 연동 (`wss://ws.blockchain.info/inv`)**: 비트코인 블록체인에서 생성되는 미확인(Unconfirmed) Mempool 트랜잭션을 딜레이 없이 실시간으로 수신합니다.
- **주요 글로벌 거래소 핫월렛 태깅**: 바이낸스(Binance), 코인베이스(Coinbase), 비트파이넥스(Bitfinex), 로빈후드(Robinhood), OKX, 크라켄(Kraken) 등 알려진 주요 지갑을 실시간 매칭하여 매수/매도 라벨을 표시합니다.
- **고래(Whale) 임계값 필터링**: `≥ 0.1 BTC`, `≥ 0.5 BTC`, `≥ 1.0 BTC`, `🐋 ≥ 3.0 BTC` 버튼으로 원하시는 규모의 트랜잭션만 즉시 필터링할 수 있습니다.

### 2. ⚡ 바이낸스 WebSocket 실시간 BTC/USD 시세
- **초단위 시세 스트리밍 (`wss://stream.binance.com:9443/ws/btcusdt@ticker`)**: 1초 미만(틱 단위)으로 비트코인 가격 변경을 감지합니다.
- **실시간 Visual Glow 애니메이션**:
  - 가격 상승 시 🟢 초록색 글로우 펄스 이펙트 (`price-up`)
  - 가격 하락 시 🔴 빨간색 글로우 펄스 이펙트 (`price-down`)
- **실시간 스트리밍 배지**: 상단 헤더에 `🔴 LIVE` 상태 배지를 통해 WebSocket 연결 여부를 직관적으로 보여줍니다.

### 3. 🟣 Solana Devnet 샌드박스 탐색기 (`src/solanaTxViewer.ts`)
- `@solana/web3.js` 라이브러리를 활용하여 Solana Devnet 상의 지갑 트랜잭션 시그니처, 수수료, 블록 타임, 파싱된 명령어 내역을 조회합니다.

### 4. 🔷 EVM Testnet (Base Sepolia) 탐색기 (`src/evmTxViewer.ts`)
- JSON-RPC 프로토콜(`eth_getTransactionByHash`, `eth_getTransactionReceipt`)을 사용하여 EVM 트랜잭션의 송수신 주소, ETH 전송량, Gas 사용량 및 성공여부를 분석합니다.

---

## 🛠 기술 스택 (Tech Stack)

- **Frontend**: Vite, TypeScript, Vanilla CSS (Glassmorphism Modern Dark UI)
- **Fonts**: Google Fonts (Outfit, JetBrains Mono)
- **Real-Time Data**: WebSocket (Blockchain.info Mempool API, Binance Market Ticker API)
- **Blockchain SDK & Tools**: `@solana/web3.js`, `@x402/core`, `@x402/evm`, `tsx`

---

## 🚀 시작하기 (Quick Start)

### 1. 저장소 클론 및 패키지 설치
```bash
git clone https://github.com/Joinjun001/SolanaHackathon.git
cd WalletTrack
npm install
```

### 2. 환경 변수 설정 (`.env`)
프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 필요한 설정을 입력합니다:
```env
PRIVATE_KEY=your_private_key_here
RPC_URL=https://sepolia.base.org
```

### 3. 개발 서버 실행 (Vite Web Application)
```bash
npm run dev
```
웹 브라우저에서 `http://localhost:5173` 으로 접속하여 실시간 대시보드를 확인합니다.

---

## 📜 스크립트 명령어 (Scripts)

| 명령 (Command) | 설명 (Description) |
|---|---|
| `npm run dev` | Vite 기반 개발 로컬 서버 실행 |
| `npm run build` | 프로덕션 빌드 번들 생성 (`dist/`) |
| `npm run solana:tx` | Solana Devnet 지갑 트랜잭션 CLI 조회 스크립트 실행 |
| `npm run evm:tx` | EVM Testnet 트랜잭션 Hash CLI 분석 스크립트 실행 |

---

## 📁 프로젝트 구조 (Project Structure)

```
WalletTrack/
├── index.html                # 메인 HTML (실시간 BTC 라이브 스트림 & 대시보드)
├── src/
│   ├── btcWhaleTracker.ts    # 비트코인 Mempool & Binance 시세 WebSocket 엔진
│   ├── solanaTxViewer.ts     # Solana Devnet 트랜잭션 CLI 파서
│   ├── evmTxViewer.ts        # EVM JSON-RPC 트랜잭션 CLI 파서
│   └── style.css             # Glassmorphism 디자인 시스템 & 애니메이션
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 📄 라이선스 (License)

ISC License
