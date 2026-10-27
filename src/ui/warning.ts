import { request, el, text, showError } from './shared';
import type { TabState } from '../core/types';
el('leave').addEventListener('click', () => location.replace('about:blank'));
el('explain').addEventListener('click', () => {
  void request('OPEN_EXPLANATION').catch(showError);
});
el('accept-risk').addEventListener('change', () => {
  el<HTMLButtonElement>('continue').disabled = !el<HTMLInputElement>('accept-risk').checked;
});
el('continue').addEventListener('click', () => {
  el<HTMLButtonElement>('continue').disabled = true;
  void request('CONTINUE_ONCE').catch((error) => {
    showError(error);
    el<HTMLButtonElement>('continue').disabled = false;
  });
});
async function load() {
  const { state } = await request<{ state?: TabState }>('ALERT');
  // Never accept a destination from a page-controlled query string or fragment.
  if (!state || Date.now() - state.at > 15 * 60000 || state.assessment.verdict === 'clear') {
    text('blocked-host', 'Reported or suspicious destination');
    text(
      'intro',
      'This destination was stopped. Its original address is unavailable, so it cannot be reopened from this warning.',
    );
    el('advanced').hidden = true;
    return;
  }
  const { assessment } = state;
  el<HTMLButtonElement>('explain').disabled = false;
  text('blocked-host', assessment.hostname);
  const list = el('warning-detail');
  for (const finding of assessment.findings) {
    const row = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = finding.title;
    row.append(strong, document.createElement('br'), document.createTextNode(finding.detail));
    list.append(row);
  }
  if (assessment.suggestedUrl) {
    const official = el<HTMLAnchorElement>('official');
    official.hidden = false;
    official.href = assessment.suggestedUrl;
  }
  const url = new URL(assessment.url);
  if (url.username || url.password) el('advanced').hidden = true;
}
void load().catch(showError);
