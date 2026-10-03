# ⚡ 고래 지갑 추적기 (Bitcoin Real-Time Whale Tracker)

고래 지갑 추적기는 **비트코인 고래 거래 감지**, **업비트 원화 시세·차트(원화 마켓 전체)**, **김치 프리미엄**, **바이낸스 선물 지표·강제청산**, **비트코인 네트워크 현황**을 한 화면에 보여 주는 한국 사용자용 실시간 대시보드입니다. 데스크톱 브라우저 기준으로 설계했습니다.

🔗 **라이브 사이트**: [https://wallet-track-theta.vercel.app](https://wallet-track-theta.vercel.app)

---

## 📸 프로젝트 화면 (Screenshot)

![데스크톱 화면 (다크)](image/desktop.png)

![데스크톱 화면 (라이트)](image/desktop-light.png)

<img src="image/mobile.png" alt="모바일 화면" width="280">

> 스크린샷은 `npm run screenshots`로 다시 찍습니다. 화면을 바꾸면 같이 갱신해 주세요.

---

## ✨ 핵심 기능

### 1. 코인 사이드바 & 가격 차트
- **업비트 원화 마켓 전체**를 왼쪽 사이드바에 보여 주고, 한글·영문 이름·심볼로 **검색**, **거래대금 / 상승 / 하락** 순으로 정렬합니다. 누르면 가운데 차트가 그 코인으로 바뀝니다.
- 가격·등락률은 업비트 WebSocket으로 실시간 갱신합니다 (줄 순서는 30초마다 다시 매김).
- **캔들 차트** (TradingView lightweight-charts): 1분 / 15분 / 1시간 / 일봉, 거래량 막대. 차트를 왼쪽 끝 가까이 옮기면 **이전 캔들 200개씩 이어서** 불러옵니다.

### 2. 상단 시세 바
- 업비트 KRW-BTC 실시간 가격과 전일 대비(오전 9시 기준), BTC/USD 24시간 변동
- **김치 프리미엄**: `업비트 원화 가격 ÷ (해외 달러 가격 × 업비트 USDT 원화 가격) - 1`. 환율 대신 업비트 USDT 가격을 씁니다.
- **공포·탐욕 지수** (alternative.me)
- ☀️/🌙 **라이트·다크 모드** 전환 (처음엔 시스템 설정을 따름)

### 3. 🐋 고래 피드 탭
- mempool.space WebSocket으로 비트코인 미확인 거래를 실시간 수신, `≥ 0.1 / 0.5 / 1.0 / 3.0 BTC` 필터
- 알려진 거래소 지갑 기준 **입금 / 출금 / 전송** 판정, 거스름돈 출력 제외
- 24시간 거래소 입금·출금·순유입 (기록 서버)

### 4. 💥 선물·청산 탭 (바이낸스 USDⓈ-M)
- 요약 띠: **BTCUSDT 펀딩비**(다음 정산까지), **미결제약정**, **롱/숏 계정 비율**
- **실시간 강제청산 피드** (전체 선물 마켓, $1K 이상)와 롱/숏 청산 합계
- **청산 통계**: 1/4/24시간 롱·숏 합계, 24시간 코인별 TOP 5
- **코인별 펀딩비** 표

### 5. 📈 기록 추이 탭
- 코인별 **김치 프리미엄 추이**, **선물 지표 추이**(펀딩비·미결제약정·롱 비율) — 24시간 / 7일 / 30일
- 기록 서버 DB를 씁니다. 수집기를 켜기 전 기간은 거래소 과거 데이터로 채워 둡니다 (김프 90일, 선물 30일, 1시간 간격).

### 6. 사이드 패널
- **비트코인 네트워크**: 추천 수수료, 최근 블록, 다음 반감기, 난이도 조정, 대기 중 거래(멤풀) — mempool.space
- **오늘 시세**(고가·저가), **환산 계산기**(BTC ↔ 사토시 ↔ 원 ↔ $)
- **알림**: BTC 가격, 김프, 고래 거래 (브라우저 알림 + 화면 토스트)
- **🔊 사운드 알림**: 큰 강제청산·BTCUSDT 대량 체결이 나면 소리 (기준 금액 선택). 처음 방문하면 켤지 묻습니다.

### 7. 용어 설명 & 의견
- 김프, 펀딩비, 미결제약정, 반감기 등 어려운 용어 제목 옆 **`?` 버튼**을 누르면 짧은 설명이 뜹니다.
- 사이트 아래 **의견 보내기**, 익명 사용 기록(개인정보·IP 미저장, 끌 수 있음)

### 8. 기록 서버 (`server/`)
- 수집기가 고래 거래, 강제청산, 선물 지표, 김프를 24시간 모아 PostgreSQL에 저장하고, 읽기 전용 API로 지난 기록을 제공합니다.
- 업비트 REST 시세·캔들은 이 서버를 거쳐 받습니다 (업비트가 브라우저 요청을 출처별로 강하게 제한하기 때문).
- Docker Compose로 실행합니다. 배포·운영 방법은 [server/README.md](server/README.md)를 참고하세요.

---

## 🛠 기술 스택 (Tech Stack)

- **Frontend**: Vite, TypeScript, Vanilla CSS (Glassmorphism Modern Dark UI), lightweight-charts (캔들 차트)
- **Fonts**: Google Fonts (Outfit, JetBrains Mono)
- **Real-Time Engine**: WebSocket (mempool.space, 업비트 원화 마켓 전체 시세, 바이낸스 현물·선물 시세·강제청산·체결)
- **Data APIs**: mempool.space (수수료·블록·난이도), alternative.me (공포·탐욕 지수), 업비트 캔들·시세(기록 서버 중계), 바이낸스 현물·선물 (시세, 펀딩비, 미결제약정, 롱/숏 비율) — API 키 없음
- **Backend**: Node.js (TypeScript), PostgreSQL, Docker Compose, nginx
- **Deployment**: 웹 Vercel (`main` 푸시 시 자동 배포), 서버 OCI

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
| `npm test` | 시세·거래 분석 로직 단위 테스트 (`node:test`) |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run screenshots` | 빌드 후 README 스크린샷(`image/`) 다시 찍기 (처음 한 번 `npx playwright install chromium`) |

---

## 📁 프로젝트 구조 (Project Structure)

```
WalletTrack/
├── index.html                # 메인 대시보드 HTML
├── CLAUDE.md                 # 작업 규칙 (같은 문제 전체 점검, 화면 변경 시 문서·스크린샷 갱신)
├── image/                    # README 스크린샷 (npm run screenshots)
├── scripts/
│   └── screenshots.mjs       # 스크린샷 자동 촬영 (Playwright)
├── src/
│   ├── main.ts               # 진입점: 탭 전환 & 각 패널 초기화
│   ├── coinSidebar.ts        # 왼쪽 코인 사이드바 (업비트 원화 마켓 전체, 검색·정렬)
│   ├── priceChart.ts         # 업비트 캔들 차트 (과거 캔들 이어 불러오기)
│   ├── krMarket.ts           # 업비트 시세 WebSocket(공유), 김치 프리미엄, 공포·탐욕 지수
│   ├── btcWhaleTracker.ts    # 고래 피드 (mempool.space) & 달러 시세
│   ├── futuresPanel.ts       # 바이낸스 선물 지표 & 강제청산 피드
│   ├── historyApi.ts         # 기록 서버 호출 & 업비트 중계 호출(getUpbit)
│   ├── historyCharts.ts      # 기록 추이 차트 (김프, 선물 지표)
│   ├── historyStats.ts       # 청산 통계, 거래소 흐름
│   ├── networkPanel.ts       # 수수료, 최근 블록, 반감기, 난이도, 멤풀
│   ├── tools.ts              # 환산 계산기 & 가격·김프·고래 알림
│   ├── soundAlerts.ts        # 청산·대량 체결 사운드 알림
│   ├── help.ts               # 용어 설명 ? 버튼
│   ├── theme.ts              # 라이트·다크 모드
│   ├── analytics.ts, feedback.ts  # 익명 사용 기록, 의견 보내기
│   ├── coins.ts              # 주요 코인 목록 & 코인 이름
│   ├── priceStore.ts         # 패널 간 공유 시세 상태
│   ├── market.ts             # 김프/포맷/캔들/알림 판정 순수 로직 (서버와 공유)
│   ├── txAnalysis.ts         # 금액/입출금 판정 순수 로직 & 거래소 지갑 목록 (서버와 공유)
│   └── style.css             # 디자인 (CSS 변수로 라이트·다크 테마)
├── server/                   # 수집기 & 기록 API & 업비트 중계 (Docker Compose, server/README.md)
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
