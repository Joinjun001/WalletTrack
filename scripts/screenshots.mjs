/**
 * README 스크린샷 갱신: 빌드된 사이트(dist)를 미리보기로 띄우고 데스크톱(다크·라이트)과 모바일 화면, README 배너(scripts/banner.html)를 image/에 저장한다.
 * 실행: npm run screenshots  (처음 한 번은 npx playwright install chromium 필요)
 *
 * 화면은 실제 거래소·기록 서버 데이터로 채워지므로 숫자는 찍을 때마다 다르다.
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const SHOTS = [
  { file: 'image/desktop.png', width: 1440, height: 900, scheme: 'dark' },
  { file: 'image/desktop-light.png', width: 1440, height: 900, scheme: 'light' },
  { file: 'image/mobile.png', width: 390, height: 844, scheme: 'dark' }
];
const DATA_WAIT_MS = 6000; // 시세·차트·기록이 채워질 때까지

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // 아직 안 떴다
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`미리보기 서버가 뜨지 않았어요 (${URL})`);
}

// detached: npx 안에서 뜬 vite까지 프로세스 그룹째 끄려고 (npx만 끄면 vite가 남는다)
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, colorScheme: shot.scheme });
    // 처음 방문 안내(사운드 알림)는 가리지 않게 닫아 둔 상태로 찍는다
    await page.addInitScript(() => localStorage.setItem('wallettrack.soundPrompt', 'declined'));
    await page.goto(URL);
    await page.waitForTimeout(DATA_WAIT_MS);
    await page.screenshot({ path: shot.file });
    await page.close();
    console.log(`저장: ${shot.file}`);
  }
  // README 배너 (scripts/banner.html)
  const banner = await browser.newPage({ viewport: { width: 1280, height: 360 }, deviceScaleFactor: 2 });
  await banner.goto(import.meta.resolve('./banner.html'));
  await banner.waitForTimeout(1500); // 글꼴
  await banner.screenshot({ path: 'image/banner.png' });
  await banner.close();
  console.log('저장: image/banner.png');

  await browser.close();
} finally {
  process.kill(-preview.pid);
}
