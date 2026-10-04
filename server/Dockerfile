# 빌드 컨텍스트는 저장소 루트 (웹과 같이 쓰는 src/ 파일이 필요하다). server/docker-compose.yml 참고
FROM node:24-alpine
WORKDIR /app

# 루트에 package.json이 없으면 공용 src/*.ts가 ESM으로 인식되지 않는다
RUN echo '{"type":"module"}' > package.json

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

COPY src/txAnalysis.ts src/market.ts src/coins.ts src/surge.ts src/
COPY server/src server/src
COPY server/db server/db

USER node
WORKDIR /app/server
# Node 24는 .ts 파일을 그대로 실행한다. 실행할 파일은 compose의 command로 정한다
CMD ["node", "src/api.ts"]
