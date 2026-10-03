# WalletTrack 서버 (수집기 + 기록 API)

웹은 실시간 데이터를 거래소에서 직접 받고, 이 서버는 그 데이터를 **계속 모아 DB에 쌓아 두었다가** 웹이 처음 열릴 때 지난 기록을 내려준다.

```
mempool.space / 바이낸스 / 업비트
        │
   collector ──► PostgreSQL ◄── api ◄── nginx 또는 caddy (HTTPS) ◄── 웹 (Vercel)
```

| 서비스 | 하는 일 |
|---|---|
| `collector` | 고래 거래(≥0.1 BTC), 바이낸스 선물 강제청산, 선물 지표(5분), 코인별 김프(1분) 저장, 180일 지난 기록 삭제 |
| `api` | 기록 조회 REST API (읽기 전용) |
| `db` | PostgreSQL 17 (외부 포트 없음) |
| `caddy` | (선택, `--profile caddy`) 80/443을 쓰는 웹 서버가 없을 때 HTTPS 처리 |

현재 운영 서버(OCI 오사카, `bittrack.duckdns.org`)에는 다른 사이트용 nginx가 이미 80 포트를 쓰고 있으므로 **nginx 방식**을 쓴다.

거래 분석·김프 계산은 웹과 같은 코드(`../src/txAnalysis.ts`, `../src/market.ts`)를 쓴다.

## API

| 경로 | 설명 |
|---|---|
| `GET /api/health` | 테이블별 마지막 저장 시각 (수집이 멈췄는지 확인용) |
| `GET /api/whales?hours=24&minBtc=0.1&limit=300` | 고래 거래, 최신순 |
| `GET /api/liquidations?hours=24&minUsd=1000&limit=40` | 강제청산, 최신순 |
| `GET /api/liquidations/summary?hours=24` | 롱/숏 청산 합계 |
| `GET /api/futures?symbol=BTCUSDT&hours=24` | 펀딩비·미결제약정·롱 비율 추이 |
| `GET /api/kimchi?symbol=BTC&hours=24` | 김프 추이 |
| `GET /api/liquidations/by-symbol?hours=24&limit=10` | 코인별 청산 합계 순위 |
| `GET /api/whales/flow?hours=24` | 고래 거래 입금·출금·전송 합계 |
| `GET /api/upbit/candles?unit=minutes/15&market=KRW-BTC&count=200[&to=...]` | 업비트 캔들 중계 (`to` 이전 200개, 차트 과거 불러오기) |
| `GET /api/upbit/tickers` | 업비트 원화 마켓 전체 시세 중계 |
| `GET /api/upbit/markets` | 업비트 원화 마켓 목록·한글 이름 중계 |
| `POST /api/events` | 웹 익명 사용 기록 (1분에 120번까지) |
| `POST /api/feedback` | 사이트 "의견 보내기" (10분에 5번까지) |

사용 기록은 브라우저마다 만든 무작위 ID로만 구분하고 IP 등 개인정보는 저장하지 않는다 (`usage_events`, 180일 보관). 의견은 `feedback`에 기한 없이 보관한다. 분석 쿼리는 `db/usage-queries.sql`.

시각은 모두 밀리초 타임스탬프. 기간이 길면(1일 초과) 평균을 내서 점 개수를 줄인다.

업비트 중계(`upbitProxy.ts`): 업비트는 브라우저 요청(Origin 헤더)을 출처별로 아주 적게만 받아서 웹이 직접 부르면 429로 막힌다. 서버가 대신 받아 3초(지난 캔들은 10분, 마켓 목록은 1시간) 캐시한다.

## 배포 (OCI A1, Ubuntu 기준)

### 0. 준비

- 도메인: [DuckDNS](https://www.duckdns.org)에서 서브도메인을 만들고 **current ip**에 인스턴스 공인 IP를 넣는다.
- OCI 콘솔 → VCN → Security List에서 TCP 80, 443 인바운드 허용.

### 1. 이 서버에서 거래소 API가 열리는지 확인

```bash
curl -s -o /dev/null -w "binance spot %{http_code}\n" https://api.binance.com/api/v3/ping
curl -s -o /dev/null -w "binance futures %{http_code}\n" https://fapi.binance.com/fapi/v1/ping
curl -s -o /dev/null -w "upbit %{http_code}\n" "https://api.upbit.com/v1/ticker?markets=KRW-BTC"
```

모두 200이어야 한다. 바이낸스가 451이면 그 리전에서는 선물·김프 수집이 안 된다.

### 2. Docker 설치

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 다시 로그인하면 sudo 없이 docker 사용
```

### 3. 서버 방화벽 열기

OCI Ubuntu 이미지는 iptables가 80/443을 막고 있다 (Security List와 별개). 이미 열려 있으면 건너뛴다.

```bash
sudo iptables -L INPUT -n --line-numbers | grep -E "dpt:(80|443)"   # 이미 있는지 확인
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### 4. 실행

```bash
git clone https://github.com/Joinjun001/WalletTrack.git
cd WalletTrack/server
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sudo ss -ltnp | grep ':8080 '        # 다른 서비스가 8080을 쓰고 있으면 docker-compose.yml의 "127.0.0.1:8080"과 nginx proxy_pass 포트를 바꾼다
docker compose up -d --build
curl -s localhost:8080/api/health    # {"ok":true,...}
```

### 5. HTTPS 연결

**nginx가 이미 있는 경우 (현재 서버)** — 기존 사이트 설정은 건드리지 않고 도메인용 설정만 추가한다.

```bash
sudo tee /etc/nginx/sites-available/bittrack >/dev/null <<'NGINX'
server {
    listen 80;
    server_name bittrack.duckdns.org;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
sudo ln -s /etc/nginx/sites-available/bittrack /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bittrack.duckdns.org   # 443 설정과 자동 갱신까지 추가된다
```

**80/443을 쓰는 웹 서버가 없는 경우** — `.env`의 `API_DOMAIN`을 확인하고 `docker compose --profile caddy up -d --build`.

### 6. 확인

```bash
docker compose ps
docker compose logs -f collector     # "연결됨", 10분마다 "최근 10분 저장: ..."
curl https://bittrack.duckdns.org/api/health
```

## 운영

```bash
# 코드 업데이트 반영
git pull && docker compose up -d --build

# DB 접속
docker compose exec db psql -U wallettrack

# 과거 기록 채우기 (처음 설치했거나 수집이 오래 멈췄을 때 한 번): 가장 오래된 기록 이전의
# 김프(1시간 간격, 기본 90일)와 선물 지표(1시간 간격, 바이낸스 제한으로 30일)를 거래소 과거 데이터로 채운다
docker compose run --rm --build collector node src/backfill.ts 90

# 사용 기록·의견 요약 보기
docker compose exec -T db psql -U wallettrack < db/usage-queries.sql

# 백업: mkdir -p ~/backup 후 crontab -e 에 아래 줄 추가 (매일 3시, 7일치 보관)
0 3 * * * cd ~/WalletTrack/server && docker compose exec -T db pg_dump -U wallettrack wallettrack | gzip > ~/backup/wallettrack-$(date +\%F).sql.gz && find ~/backup -name 'wallettrack-*.sql.gz' -mtime +7 -delete
```

## 로컬에서 DB 없이 시험

`DATABASE_URL`이 없으면 저장하지 않고 쿼리를 로그로만 출력한다 (Node 22.6 이상).

```bash
cd server && npm install
npm run collector
```
