/**
 * 사이트 아래 "의견 보내기" 창과 익명 수집 켜기/끄기. 의견은 기록 서버(server/)의 feedback 테이블에 저장된다.
 */

import { HISTORY_API } from './historyApi.ts';
import { analyticsBlockedByBrowser, getVisitorId, isAnalyticsEnabled, setAnalyticsEnabled, track } from './analytics.ts';
import { showToast } from './tools.ts';

const MAX_LENGTH = 1000;

function currentTab(): string {
  return document.querySelector<HTMLElement>('.tab-btn.active')?.dataset.tab || '';
}

async function send(category: string, message: string): Promise<'ok' | 'limited' | 'failed'> {
  try {
    const res = await fetch(`${HISTORY_API}/feedback`, {
      method: 'POST',
      // text/plain이면 CORS 사전 요청 없이 보낼 수 있다
      body: JSON.stringify({
        v: getVisitorId(),
        category,
        message,
        context: { tab: currentTab(), vw: innerWidth, vh: innerHeight, mobile: matchMedia('(max-width: 768px)').matches }
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (res.status === 429) return 'limited';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

function initFeedbackDialog() {
  const dialog = document.getElementById('feedback-dialog') as HTMLDialogElement | null;
  const form = document.getElementById('feedback-form') as HTMLFormElement | null;
  const category = document.getElementById('feedback-category') as HTMLSelectElement | null;
  const message = document.getElementById('feedback-message') as HTMLTextAreaElement | null;
  const count = document.getElementById('feedback-count');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!dialog || !form || !category || !message || !submit) return;

  const updateCount = () => {
    if (count) count.textContent = `${message.value.length}/${MAX_LENGTH}`;
  };

  document.getElementById('feedback-open')?.addEventListener('click', () => {
    dialog.showModal();
    message.focus();
    track('feedback_open', { tab: currentTab() });
  });
  document.getElementById('feedback-cancel')?.addEventListener('click', () => dialog.close());
  message.addEventListener('input', updateCount);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = message.value.trim();
    if (!text) return;
    submit.disabled = true;
    const result = await send(category.value, text);
    submit.disabled = false;
    if (result === 'ok') {
      track('feedback_sent', { category: category.value, length: text.length });
      form.reset();
      updateCount();
      dialog.close();
      showToast('고마워요! 의견이 전달됐어요');
    } else {
      showToast(result === 'limited' ? '의견을 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.' : '의견을 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  });
  updateCount();
}

function initAnalyticsToggle() {
  const button = document.getElementById('analytics-toggle');
  if (!button) return;
  if (analyticsBlockedByBrowser()) {
    button.replaceWith('(브라우저의 추적 거부 설정으로 수집하지 않아요)');
    return;
  }
  const render = () => {
    button.textContent = isAnalyticsEnabled() ? '수집 끄기' : '수집 켜기';
  };
  button.addEventListener('click', () => {
    setAnalyticsEnabled(!isAnalyticsEnabled());
    render();
    showToast(isAnalyticsEnabled() ? '익명 사용 기록 수집을 켰어요' : '익명 사용 기록 수집을 껐어요');
  });
  render();
}

export function initFeedback() {
  initFeedbackDialog();
  initAnalyticsToggle();
}
