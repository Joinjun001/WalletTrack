# ⚡ 고래 지갑 추적기 (Bitcoin Real-Time Whale Tracker)

고래 지갑 추적기는 **비트코인(BTC) 실시간 트랜잭션 수신**, **고래(Whale) 이동 감지**, **원화 시세·김치 프리미엄**, **캔들 차트**, **주요 코인 시세**, **선물 지표·강제청산**, **네트워크 현황**을 한 화면에 보여 주는 한국 사용자용 실시간 대시보드입니다.

🔗 **Vercel 라이브 데모**: [https://wallet-track-e2ze8d2py-joinjun001s-projects.vercel.app](https://wallet-track-e2ze8d2py-joinjun001s-projects.vercel.app/)

---

## 📸 프로젝트 화면 (Screenshot)

![고래 지갑 추적기 스크린샷](image/image1.png)

<img src="image/mobile.png" alt="모바일 화면" width="280">

---

## ✨ 핵심 기능

### 1. 실시간 비트코인 트랜잭션 감지
- **WebSocket 연동 (`wss://ws.blockchain.info/inv`)**: 비트코인 블록체인에서 생성되는 미확인(Unconfirmed) Mempool 트랜잭션을 딜레이 없이 실시간으로 수신합니다.
- **거래소 지갑 태깅 (입금/출금)**: 바이낸스(Binance), 코인베이스(Coinbase), 비트파이넥스(Bitfinex)의 공개 라벨 지갑을 감지합니다. 거래소 지갑으로 들어가면 📥 **거래소 입금**(빨강), 거래소 지갑에서 나오면 📤 **거래소 출금**(초록), 그 외는 ↔️ **전송**(회색)으로 표시합니다.
- **실제 이동 금액 계산**: 보낸 주소로 되돌아오는 거스름돈(change) 출력은 금액에서 뺍니다. 거래소 입금은 거래소 주소로 간 금액만 셉니다.
- **고래(Whale) 임계값 필터링**: `≥ 0.1 BTC`, `≥ 0.5 BTC`, `≥ 1.0 BTC`, `🐋 ≥ 3.0 BTC` 버튼으로 원하시는 규모의 트랜잭션만 즉시 필터링할 수 있습니다. 필터를 바꿔도 0.1 BTC 이상 최근 거래 기록은 유지됩니다.

### 2. 원화 시세 & 시장 지표 (상단 바)
- **업비트 원화 시세 (`wss://api.upbit.com/websocket/v1`)**: KRW-BTC 실시간 가격과 전일 대비 등락률(오전 9시 기준)
- **김치 프리미엄**: `업비트 원화 가격 ÷ (해외 달러 가격 × 업비트 USDT 원화 가격) - 1`. 환율 대신 업비트 USDT 가격을 쓰므로 테더 프리미엄만큼 오차가 있습니다.
- **BTC/USD 24시간 변동률**, **공포·탐욕 지수** (alternative.me, 1시간마다 갱신)

### 3. 네트워크 현황 (사이드 패널, mempool.space, 30초마다 갱신)
- **추천 수수료** (빠름 / 30분 / 1시간, sat/vB)
- **최근 블록** (높이, 채굴 풀, 거래 수, 경과 시간)
- **다음 반감기 카운트다운** (남은 블록, 10분/블록 기준 예상 일수)
- **오늘 고가/저가** (업비트 원화)
- 모바일에서는 패널이 피드 위의 가로 스크롤 카드로 바뀝니다.

### 4. 가격 차트
- **업비트 원화 캔들 차트** (TradingView lightweight-charts): 1분 / 15분 / 1시간 / 일봉, 거래량 막대
- 과거 캔들은 업비트 REST, 현재 캔들은 실시간 시세로 갱신 (시간축은 한국 시간)
- 코인 시세 표에서 코인을 누르면 해당 코인 차트로 바뀝니다.

### 5. 코인 시세 탭
- 비트코인, 이더리움, 리플, 솔라나, 도지코인, 에이다, 트론, 체인링크, 아발란체, 수이
- 업비트 원화 가격, 전일 대비, 24시간 거래대금 + 바이낸스 달러 가격으로 계산한 **코인별 김치 프리미엄** (모두 WebSocket 실시간)

### 6. 선물·청산 탭 (바이낸스 USDⓈ-M)
- **BTCUSDT 펀딩비**와 다음 정산까지 남은 시간, **미결제약정**(BTC / 달러), **롱/숏 계정 비율**(5분) — 30초마다 갱신
- **실시간 강제청산 피드** (`wss://fstream.binance.com/market/ws/!forceOrder@arr`): 전체 선물 마켓의 $1K 이상 청산, 페이지를 연 뒤부터의 롱/숏 청산 합계

### 7. 환산 계산기 & 가격 알림 (사이드 패널)
- BTC ↔ 사토시 ↔ 원화 ↔ 달러 환산, 시세가 바뀌면 자동 재계산
- BTC 원화 목표가 알림: 등록 시점 가격보다 높으면 "이상", 낮으면 "이하"로 도달 시 브라우저 알림 + 화면 토스트 (알림 목록은 브라우저에 저장)

### 8. 실시간 비트코인 달러 시세
- **초단위 시세 스트리밍 (`wss://stream.binance.com:9443/ws/btcusdt@ticker`)**: 1초 미만(틱 단위)으로 바이낸스 기준 비트코인 가격 변경을 감지합니다.
- **실시간 Visual Glow 애니메이션**:
  - 가격 상승 시 🟢 초록색 글로우 펄스 이펙트 (`price-up`)
  - 가격 하락 시 🔴 빨간색 글로우 펄스 이펙트 (`price-down`)
- **실시간 스트리밍 배지**: 상단 헤더에 `🔴 LIVE` 상태 배지를 통해 WebSocket 연결 여부를 직관적으로 보여줍니다.

---

## 🛠 기술 스택 (Tech Stack)

- **Frontend**: Vite, TypeScript, Vanilla CSS (Glassmorphism Modern Dark UI), lightweight-charts (캔들 차트)
- **Fonts**: Google Fonts (Outfit, JetBrains Mono)
- **Real-Time Engine**: WebSocket (Blockchain.info Mempool API, Binance Market Ticker API, Upbit Ticker), 시세 REST 폴백 (Binance → mempool.space)
- **Data APIs**: mempool.space (수수료·블록), alternative.me (공포·탐욕 지수), 업비트 캔들, 바이낸스 현물·선물 (시세, 펀딩비, 미결제약정, 롱/숏 비율, 강제청산) — 모두 키 없이 브라우저에서 직접 호출
- **Deployment**: Vercel

---

## 🚀 시작하기 (Quick Start)

### 1. 저장소 클론 및 패키지 설치
```bash
git clone https://github.com/Joinjun001/WalletTrack.git
cd WalletTrack
npm install
```

### 2. 개발 서버 실행
```bash
npm run dev
```
웹 브라우저에서 `http://localhost:5173` 으로 접속하여 실시간 대시보드를 확인합니다.

---

## 📜 스크립트 명령어 (Scripts)

| 명령 (Command) | 설명 (Description) |
|---|---|
| `npm run dev` | Vite 기반 로컬 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 번들 생성 (`dist/`) |
| `npm run preview` | 프로덕션 빌드 미리보기 |
| `npm test` | 트랜잭션 분석 로직 단위 테스트 (`node:test`) |
| `npm run typecheck` | TypeScript 타입 검사 |

---

## 📁 프로젝트 구조 (Project Structure)

```
WalletTrack/
├── index.html                # 메인 대시보드 HTML
├── image/
│   ├── image1.png            # 데스크톱 스크린샷
│   └── mobile.png            # 모바일 스크린샷
├── src/
│   ├── main.ts               # 진입점: 탭 전환 & 각 패널 초기화
│   ├── btcWhaleTracker.ts    # 고래 피드 (blockchain.info) & Binance 달러 시세
│   ├── krMarket.ts           # 업비트 원화 시세(WebSocket 공유), 김치 프리미엄, 공포·탐욕 지수
│   ├── priceChart.ts         # 업비트 캔들 차트
│   ├── coins.ts              # 시세 표에 보여 줄 코인 목록
│   ├── coinTable.ts          # 코인 시세·김프 표
│   ├── futuresPanel.ts       # 바이낸스 선물 지표 & 강제청산 피드
│   ├── tools.ts              # 환산 계산기 & 가격 알림
│   ├── networkPanel.ts       # 수수료, 최근 블록, 반감기 (mempool.space)
│   ├── priceStore.ts         # 패널 간 공유 시세 상태
│   ├── market.ts             # 김프/반감기/포맷/캔들/알림 판정 순수 로직
│   ├── txAnalysis.ts         # 금액/입출금 판정 순수 로직 & 거래소 지갑 목록
│   └── style.css             # Glassmorphism 디자인 시스템 & 반응형 레이아웃
├── tests/
│   ├── market.test.ts        # 시세/네트워크 계산 테스트
│   └── txAnalysis.test.ts    # 분석 로직 테스트
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 📄 라이선스 (License)

ISC License
