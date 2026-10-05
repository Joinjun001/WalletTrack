<p align="center">
  <img src="image/banner.png" alt="고래 지갑 추적기 — 비트코인 고래의 매수·매도, 김치 프리미엄, 강제청산을 한 화면에서 실시간으로" width="100%">
</p>

<p align="center">
  <a href="https://wallet-track-theta.vercel.app"><img src="https://img.shields.io/badge/live-wallet--track--theta.vercel.app-5563E0?style=flat-square" alt="라이브 사이트"></a>
  <img src="https://img.shields.io/badge/TypeScript-Vite-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript · Vite">
  <img src="https://img.shields.io/badge/PostgreSQL-Docker%20Compose-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL · Docker Compose">
  <img src="https://img.shields.io/badge/license-ISC-7A899C?style=flat-square" alt="ISC License">
</p>

<p align="center">
  <a href="#이게-뭔데">이게 뭔데</a> ·
  <a href="#화면">화면</a> ·
  <a href="#기능">기능</a> ·
  <a href="#어떻게-돌아가는데">어떻게 돌아가는데</a> ·
  <a href="#실행하기">실행하기</a> ·
  <a href="#자주-묻는-질문">자주 묻는 질문</a>
</p>

---

## 이게 뭔데

**고래 지갑 추적기(WalletTrack)** 는 한국 사용자를 위한 비트코인·코인 실시간 대시보드입니다. 여러 곳에 흩어져 있는 정보를 한 화면에 모았습니다.

- **고래 체결**: 5개 거래소에서 비트코인을 한 번에 1 BTC 이상 사고판 주문, 그리고 1시간·하루·1주·1달 매수·매도 합계
- **업비트 원화 마켓 전체**: 시세, 캔들 차트, 코인별 김치 프리미엄, 급등·급락
- **선물 지표와 강제청산**: 펀딩비, 미결제약정, 롱/숏 비율, 실시간 청산
- **온체인 고래 이동**: 거래소 지갑으로 들어가고 나가는 큰 비트코인 송금
- **비트코인 네트워크**: 수수료, 블록, 반감기, 난이도, 멤풀

사이드바에서 코인을 고르면 차트와 상단 시세 바가 함께 그 코인으로 바뀝니다. 데스크톱 브라우저(1440×900)를 기준으로 설계했고, 모바일에서도 깨지지 않게 맞춰 두었습니다.

**라이브 사이트**: https://wallet-track-theta.vercel.app

## 화면

![데스크톱 화면 (다크)](image/desktop.png)

![데스크톱 화면 (라이트)](image/desktop-light.png)

<img src="image/mobile.png" alt="모바일 화면" width="280">

> 스크린샷과 배너는 `npm run screenshots`로 다시 만듭니다. 화면을 바꾸면 같이 갱신합니다.

## 기능

### 코인 사이드바와 가격 차트

| 기능 | 설명 |
|---|---|
| 코인 목록 | 업비트 원화 마켓 전체. 한글·영문 이름·심볼 검색, 거래대금·상승·하락·김프 순 정렬. 누르면 차트와 상단 시세 바가 그 코인으로 |
| 코인별 김프 | 바이낸스 현물 달러 가격 기준. 김프 버튼을 다시 누르면 낮은 순(역프 먼저). 바이낸스에 없는 코인은 맨 아래 |
| 관심 코인 | 심볼 옆 별을 누르면 저장(이 브라우저에만). 검색창 옆 별 버튼으로 관심 코인만 보기 |
| 미니 캔들 | 코인마다 오늘 일봉(꼬리 = 저가~고가, 몸통 = 시가~현재가). 모든 코인을 시가 대비 ±15% 같은 눈금으로 그림 |
| 캔들 차트 | 1분·3분·5분·15분·30분·1시간·4시간·일·주·월봉과 거래량. 왼쪽 끝으로 옮기면 이전 캔들 200개씩 이어서 불러옴 |
| 캔들 정보 줄 | 커서를 올린 캔들(없으면 최신)의 시가·고가·저가·종가, 직전 캔들 대비 변동률, 거래량·원화 거래대금 |
| 차트 표시 | 캔들 구간별로 큰 강제청산(롱은 캔들 아래, 숏은 위)과 비트코인 온체인 거래소 입금·출금. 표시에 커서를 올리면 그 표시만 크게, 나머지는 흐리게 바뀌고 전체 내용이 뜸. 주봉·월봉에서는 끔 |

가격과 등락률은 업비트 WebSocket으로 실시간 갱신하고, 목록 순서는 30초마다 다시 매깁니다.

### 상단 시세 바

| 항목 | 설명 |
|---|---|
| 원화 가격 | 지금 보고 있는 코인의 업비트 실시간 가격, 전일 대비(오전 9시 기준) |
| 달러 가격 | 바이낸스 가격과 24시간 변동 |
| 김치 프리미엄 | `업비트 원화 가격 ÷ (바이낸스 달러 가격 × 업비트 USDT 원화 가격) - 1`. 차이가 ±50%를 넘으면 같은 심볼의 다른 코인으로 보고 표시하지 않음 |
| 공포·탐욕 지수 | alternative.me |
| 테마 | 라이트·다크 모드(처음엔 시스템 설정을 따름). 전환할 때 화면이 서서히 바뀌지 않고 바로 바뀜 |
| 상승·하락 색 | 국내식(상승 빨강 / 하락 파랑)과 해외식(상승 초록 / 하락 빨강). 차트·사이드바·등락률·청산 색이 모두 따라감 |

### 탭

| 탭 | 내용 |
|---|---|
| 대형 체결 | 바이낸스 선물·현물 BTCUSDT, 바이비트 BTCUSDT, OKX BTC-USDT-SWAP, 업비트 KRW-BTC에서 한 번에 크게 매수·매도한 주문. 시장가로 주문한 쪽(테이커) 기준이고, 거래소별로 같은 방향 체결을 0.1초 동안 모아 주문 하나로 봅니다. `1 / 5 / 10 / 50 BTC` 필터, 10 BTC 이상 강조 |
| 고래 체결 합계 | 1 BTC 이상 매수·매도·순매수를 `1시간 / 하루 / 1주 / 1달`로. 기록 서버의 1분 합계에, 아직 저장되지 않은 최근 1~3분은 브라우저가 받은 체결을 더해 페이지를 열자마자 기간 전체가 보이고 바로바로 바뀝니다 |
| 급등·급락 | 업비트 원화 마켓 전체에서 최근 5분 최저가보다 ±2·3·5·10% 이상 오르거나 최고가보다 그만큼 내린 코인. 같은 코인·방향은 10분 동안 다시 올리지 않고, 24시간 거래대금 5억원 미만은 뺍니다. 탭을 열면 서버가 모은 최근 24시간 기록부터 보여 줍니다 |
| 선물·청산 | BTCUSDT 펀딩비(다음 정산까지), 미결제약정, 롱/숏 계정 비율. 실시간 강제청산($1K 이상)을 BTC(바이낸스·바이비트·OKX 합산) 또는 전체 코인(바이낸스)으로. 1·4·24시간 청산 통계와 코인별 TOP 5, 코인별 펀딩비 |
| 온체인 이동 | mempool.space의 비트코인 미확인 거래. 알려진 거래소 지갑 기준 입금·출금·전송 판정(거스름돈 제외), `0.1 / 0.5 / 1.0 / 3.0 BTC` 필터, 24시간 거래소 입금·출금·순유입 |
| 기록 추이 | 코인별 김치 프리미엄 추이, 선물 지표(펀딩비·미결제약정·롱 비율) 추이. 24시간·7일·30일 |

### 사이드 패널

| 패널 | 내용 |
|---|---|
| 비트코인 네트워크 | 추천 수수료, 최근 블록, 다음 반감기, 난이도 조정, 대기 중 거래(멤풀) |
| 오늘 시세 · 환산 계산기 | 보고 있는 코인의 고가·저가, BTC ↔ 사토시 ↔ 원 ↔ 달러 |
| 알림 | BTC 가격, 김프, 고래 체결. 브라우저 알림과 화면 토스트 |
| 사운드 알림 | BTC 강제청산(바이낸스·바이비트·OKX)과 BTC 대형 체결이 기준 금액을 넘으면 8비트 소리. 청산 $100K·$500K·$2M을 넘을 때마다 더 크고 낮게, 3단계는 2번·4단계는 3번 반복(체결은 기준의 3·10·30배). 처음 방문하면 켤지 묻습니다 |
| 용어 설명 · 의견 | 김프·펀딩비·미결제약정 같은 제목 옆 `?` 버튼으로 짧은 설명. 사이트 아래 의견 보내기, 익명 사용 기록(개인정보·IP 미저장, 끌 수 있음) |

## 어떻게 돌아가는데

실시간 데이터는 브라우저가 거래소에서 직접 받고, 지난 기록은 기록 서버가 계속 모아 두었다가 내려줍니다.

```mermaid
flowchart LR
  subgraph 거래소·블록체인
    EX[바이낸스 · 바이비트 · OKX · 업비트]
    MP[mempool.space]
  end
  subgraph 기록 서버 OCI
    C[수집기<br/>collector] --> DB[(PostgreSQL)]
    DB --> API[기록 API<br/>+ 업비트 중계]
  end
  EX -- WebSocket --> C
  MP -- WebSocket --> C
  EX -- WebSocket 실시간 --> W[웹 Vercel]
  MP -- WebSocket 실시간 --> W
  API -- 지난 기록 · 캔들 --> W
```

| 데이터 | 출처 | 기록 서버 | 보관 |
|---|---|---|---|
| 대형 체결(1 BTC 이상) | 5개 거래소 체결 스트림 | 거래소·1분 합계. 지난 30일은 거래소 공개 일별 체결 파일(바이낸스·바이비트)과 업비트 체결 조회(7일)로 채움, 6시간마다 못 채운 날 재확인 | 180일 |
| 강제청산 | 바이낸스 선물 전체 마켓 | 건별 | 180일 |
| 선물 지표 | 바이낸스 선물 (펀딩비·미결제약정·롱/숏) | 5분마다. 과거 30일은 1시간 간격으로 채움 | 180일 |
| 김치 프리미엄 | 업비트 + 바이낸스 현물 | 1분마다. 과거 90일은 1시간 간격으로 채움 | 180일 |
| 급등·급락 | 업비트 원화 마켓 전체 시세 | 웹과 같은 판정(`src/surge.ts`) | 180일 |
| 온체인 고래 | mempool.space 미확인 거래 | 0.1 BTC 이상, 웹과 같은 판정(`src/txAnalysis.ts`) | 180일 |
| 업비트 시세·캔들 | 업비트 REST | 서버가 대신 받아 잠깐 캐시(업비트가 브라우저 요청을 출처별로 강하게 제한) | 저장 안 함 |

서버는 체결 해석·김프 계산·급등 판정 같은 로직을 웹과 같은 파일(`src/*.ts`)로 씁니다. 배포·운영 방법은 [server/README.md](server/README.md)에 있습니다.

### 기술 스택

| 부분 | 사용 |
|---|---|
| 웹 | Vite, TypeScript(프레임워크 없음), CSS 변수 테마, lightweight-charts, SVG 아이콘 |
| 서버 | Node.js(TypeScript 그대로 실행), PostgreSQL 17, Docker Compose, nginx |
| 배포 | 웹 Vercel(`main` 푸시 시 자동), 서버 OCI |
| 외부 데이터 | 업비트, 바이낸스 현물·선물, 바이비트, OKX, mempool.space, alternative.me (모두 API 키 없음) |

## 실행하기

```bash
git clone https://github.com/Joinjun001/WalletTrack.git
cd WalletTrack
npm install
npm run dev          # http://localhost:5173
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 배포용 빌드 (`dist/`) |
| `npm run preview` | 빌드 미리보기 |
| `npm test` | 단위 테스트 (`node:test`) |
| `npm run typecheck` | 타입 검사 |
| `npm run screenshots` | 빌드 후 README 스크린샷·배너(`image/`) 다시 만들기 (처음 한 번 `npx playwright install chromium`) |

기록 서버는 `server/`에서 `docker compose up -d --build`로 띄웁니다. 자세한 내용은 [server/README.md](server/README.md)를 보세요.

### 프로젝트 구조

```
WalletTrack/
├── index.html                # 대시보드 HTML (SVG 아이콘 묶음 포함)
├── public/favicon.svg        # 고래 로고
├── image/                    # README 스크린샷·배너 (npm run screenshots)
├── scripts/
│   ├── screenshots.mjs       # 스크린샷·배너 자동 촬영 (Playwright)
│   └── banner.html           # README 배너 원본
├── src/
│   ├── main.ts               # 진입점: 탭 전환, 패널 초기화
│   ├── coinSidebar.ts        # 코인 사이드바 (검색·정렬·김프·관심 코인)
│   ├── selectedCoin.ts       # 지금 보고 있는 코인
│   ├── priceChart.ts         # 캔들 차트 (과거 캔들, 청산·고래 표시, 정보 줄)
│   ├── krMarket.ts           # 업비트 시세 WebSocket, 상단 시세 바, 공포·탐욕 지수
│   ├── binanceSpot.ts        # 바이낸스 현물 코인별 달러 시세 (김프)
│   ├── surge.ts              # 급등·급락 판정 (서버와 공유)
│   ├── surgeFeed.ts          # 급등·급락 탭
│   ├── btcStreams.ts         # BTC 체결·청산 거래소 연결
│   ├── exchangeFeeds.ts      # 거래소 메시지 해석, 체결 묶기 (서버와 공유)
│   ├── bigTradeFeed.ts       # 대형 체결 탭 (피드, 기간별 합계)
│   ├── bigTradeStats.ts      # 대형 체결 1분 합계, 과거 체결 파일 해석 (서버와 공유)
│   ├── btcWhaleTracker.ts    # 온체인 이동 탭 & BTC 달러 시세
│   ├── futuresPanel.ts       # 선물 지표 & 강제청산 피드
│   ├── historyApi.ts         # 기록 서버·업비트 중계 호출
│   ├── historyCharts.ts      # 기록 추이 차트
│   ├── historyStats.ts       # 청산 통계, 거래소 흐름
│   ├── networkPanel.ts       # 수수료·블록·반감기·난이도·멤풀
│   ├── tools.ts              # 환산 계산기, 가격·김프·고래 알림
│   ├── soundAlerts.ts        # 사운드 알림
│   ├── sounds.ts             # 알림 소리 합성 (Web Audio)
│   ├── help.ts               # 용어 설명 ? 버튼
│   ├── icons.ts              # 선 아이콘 (SVG 묶음 참조)
│   ├── theme.ts              # 라이트·다크, 상승·하락 색
│   ├── analytics.ts, feedback.ts  # 익명 사용 기록, 의견 보내기
│   ├── coins.ts, priceStore.ts    # 코인 목록, 공유 시세 상태
│   ├── market.ts             # 김프·포맷·캔들·알림 순수 로직 (서버와 공유)
│   ├── txAnalysis.ts         # 입출금 판정 & 거래소 지갑 목록 (서버와 공유)
│   └── style.css             # 디자인 (CSS 변수로 라이트·다크 테마)
├── server/                   # 수집기 & 기록 API & 업비트 중계 (server/README.md)
├── tests/                    # market, exchangeFeeds, bigTradeStats, surge, txAnalysis, securityHeaders
├── vercel.json               # 웹 보안 헤더 (CSP 등)
└── CLAUDE.md                 # 작업 규칙
```

## 자주 묻는 질문

**김치 프리미엄은 어떻게 계산하나요?**
환율 대신 업비트 USDT 원화 가격을 씁니다. `업비트 원화 가격 ÷ (바이낸스 달러 가격 × 업비트 USDT 가격) - 1`이라 테더 프리미엄만큼 오차가 있습니다.

**대형 체결의 "매수·매도"는 무슨 기준인가요?**
시장가로 주문한 쪽(테이커)입니다. 큰 시장가 주문은 여러 체결로 쪼개져 오므로, 거래소별로 같은 방향 체결을 0.1초 동안 모아 주문 하나로 봅니다.

**고래 체결 합계 아래에 "채우는 중"이나 "OKX ○/○부터"가 보여요.**
거래소는 일별 체결 파일을 다음 날 올리므로, 하루가 지나야 채워지는 구간이 있습니다. OKX는 과거 파일을 받지 않아 수집을 시작한 뒤부터 들어갑니다. 기록이 기간보다 짧은 거래소는 그렇게 표시합니다.

**기록 추이·청산 통계가 짧게 보여요.**
서버에 쌓인 만큼만 보입니다. 김프 90일, 선물 지표 30일은 거래소 과거 데이터로 채워 두었습니다.

**온체인 "입금·출금"은 정확한가요?**
알려진 거래소 지갑 주소 목록(`src/txAnalysis.ts`)으로 판정합니다. 목록에 없는 지갑끼리의 이동은 "전송"으로 표시합니다.

**개인정보를 모으나요?**
기능 사용 기록만 익명으로 모으고, 개인정보와 IP는 저장하지 않습니다. 사이트 아래 "수집 끄기"로 끌 수 있습니다.

## License

ISC
