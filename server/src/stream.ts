/**
 * 끊기면 다시 붙는 WebSocket. 일정 시간 데이터가 없으면 연결이 죽은 것으로 보고 다시 연결한다.
 */

import { log } from './config.ts';

interface StreamOptions {
  url: string;
  idleMs: number;
  onOpen?: (ws: WebSocket) => void;
  onMessage: (data: string) => void | Promise<void>;
}

export function keepStream(name: string, { url, idleMs, onOpen, onMessage }: StreamOptions) {
  let failures = 0;

  const connect = () => {
    const ws = new WebSocket(url);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        log(`${name}: ${idleMs / 1000}초 동안 데이터가 없어 다시 연결`);
        ws.close();
      }, idleMs);
    };
    resetIdle(); // 연결 자체가 멈춘 경우도 잡는다

    ws.onopen = () => {
      failures = 0;
      log(`${name}: 연결됨`);
      onOpen?.(ws);
    };
    ws.onmessage = (event) => {
      resetIdle();
      Promise.resolve(onMessage(String(event.data))).catch((e) => log(`${name}: 처리 실패`, e));
    };
    ws.onclose = () => {
      clearTimeout(idleTimer);
      const delay = Math.min(60_000, 1000 * 2 ** failures++);
      log(`${name}: 연결 끊김, ${delay / 1000}초 후 재연결`);
      setTimeout(connect, delay);
    };
  };

  connect();
}
