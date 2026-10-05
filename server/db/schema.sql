-- 수집기가 시작할 때마다 실행된다. 이미 있으면 건너뛰므로 여러 번 실행해도 안전하다.

-- 고래 거래 (mempool.space 미확인 거래, MIN_WHALE_BTC 이상)
CREATE TABLE IF NOT EXISTS whale_txs (
  hash             text PRIMARY KEY,
  btc_amount       double precision NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('deposit', 'withdrawal', 'transfer')),
  exchange_address text,                 -- src/txAnalysis.ts KNOWN_EXCHANGES 키 (거래소 이름·아이콘은 웹에서 찾는다)
  detected_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whale_txs_detected_at ON whale_txs (detected_at DESC);

-- 바이낸스 선물 강제청산 (전체 마켓)
CREATE TABLE IF NOT EXISTS liquidations (
  symbol      text NOT NULL,
  position    text NOT NULL CHECK (position IN ('long', 'short')),
  price       double precision NOT NULL,
  quantity    double precision NOT NULL,
  usd_value   double precision NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (symbol, occurred_at, position, quantity) -- 재연결 시 같은 주문이 다시 와도 한 번만 저장
);
CREATE INDEX IF NOT EXISTS liquidations_occurred_at ON liquidations (occurred_at DESC);

-- 선물 지표 (5분마다)
CREATE TABLE IF NOT EXISTS futures_stats (
  symbol        text NOT NULL,
  recorded_at   timestamptz NOT NULL,
  funding_rate  double precision,
  open_interest double precision,          -- 코인 수량
  mark_price    double precision,
  long_ratio    double precision,          -- 롱 계정 비율 (0~1)
  PRIMARY KEY (symbol, recorded_at)
);

-- 코인별 김치 프리미엄 (1분마다)
CREATE TABLE IF NOT EXISTS kimchi_premium (
  symbol      text NOT NULL,
  recorded_at timestamptz NOT NULL,
  krw_price   double precision NOT NULL,
  usd_price   double precision NOT NULL,
  usdt_krw    double precision NOT NULL,
  premium_pct double precision NOT NULL,
  PRIMARY KEY (symbol, recorded_at)
);

-- 업비트 원화 마켓 급등·급락 (src/surge.ts 판정, 기준 2·3·5·10%마다 따로 저장)
CREATE TABLE IF NOT EXISTS surge_events (
  market       text NOT NULL,              -- KRW-ETH
  threshold    real NOT NULL,              -- 판정 기준 (%)
  direction    text NOT NULL CHECK (direction IN ('up', 'down')),
  change_pct   double precision NOT NULL,  -- 5분 최저·최고가 대비 변화 (%)
  from_price   double precision NOT NULL,
  price        double precision NOT NULL,
  volume_krw   double precision NOT NULL,  -- 24시간 거래대금
  detected_at  timestamptz NOT NULL,
  PRIMARY KEY (market, threshold, direction, detected_at)
);
CREATE INDEX IF NOT EXISTS surge_events_threshold_time ON surge_events (threshold, detected_at DESC);

-- 대형 체결(1 BTC 이상, 주문 단위) 거래소·분별 합계 (bigTrades.ts). 고래 체결 탭의 하루·1주·1달 합계
CREATE TABLE IF NOT EXISTS big_trade_minutes (
  minute     timestamptz NOT NULL,
  exchange   text NOT NULL,              -- src/exchangeFeeds.ts Exchange
  buy_btc    double precision NOT NULL,  -- 시장가 매수
  sell_btc   double precision NOT NULL,
  buy_count  int NOT NULL,
  sell_count int NOT NULL,
  PRIMARY KEY (minute, exchange)
);

-- 실시간 수집을 시작한 시각 (수집기를 켤 때마다). 처음 시작 전인데 파일로 못 채운 날 = 비어 있는 날
CREATE TABLE IF NOT EXISTS big_trade_live (
  started_at timestamptz PRIMARY KEY
);

-- 거래소 과거 파일로 채운 날 (같은 날을 다시 받지 않게)
CREATE TABLE IF NOT EXISTS big_trade_filled (
  source text NOT NULL,
  day    date NOT NULL,
  PRIMARY KEY (source, day)
);

-- 웹 사용 기록 (익명). 브라우저마다 만든 무작위 ID만 쓰고 IP 등 개인정보는 저장하지 않는다
CREATE TABLE IF NOT EXISTS usage_events (
  id         bigserial PRIMARY KEY,
  visitor_id text NOT NULL,              -- 브라우저 localStorage의 무작위 ID (재방문 구분용)
  session_id text NOT NULL,              -- 탭을 열 때마다 새로 만드는 무작위 ID
  name       text NOT NULL,              -- page_view, tab_open, alert_add, error ...
  props      jsonb NOT NULL DEFAULT '{}',
  client_at  timestamptz,                -- 브라우저 기준 발생 시각 (모아서 보내므로 created_at과 다를 수 있다)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_created_at ON usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_name ON usage_events (name, created_at DESC);

-- 사이트의 "의견 보내기"로 받은 글 (보관 기간 제한 없음)
CREATE TABLE IF NOT EXISTS feedback (
  id         bigserial PRIMARY KEY,
  visitor_id text NOT NULL,
  category   text NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
  message    text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}', -- 보낸 시점의 탭, 기기 종류, 화면 크기
  created_at timestamptz NOT NULL DEFAULT now()
);
