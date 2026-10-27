import { request, el, text, showError, feedAge, timeAgo } from './shared';
import type { Assessment, Snapshot } from '../core/types';

function renderAssessment(assessment: Assessment | undefined, active: boolean) {
  const verdict = assessment?.verdict;
  const risk = verdict === 'danger' || verdict === 'caution';
  el('hero').dataset.tone = !active ? 'paused' : risk ? verdict : 'clear';
  text(
    'status-label',
    !active ? 'PROTECTION PAUSED' : risk ? 'SOMETHING NEEDS YOUR ATTENTION' : 'PROTECTION IS ON',
  );
  el('status-dot').dataset.tone = !active ? 'paused' : risk ? verdict : 'clear';
  text(
    'headline',
    !active
      ? 'Taking a pause.'
      : verdict === 'danger'
        ? 'Let’s take a step back.'
        : verdict === 'caution'
          ? 'A closer look helps.'
          : 'A little peace\nof mind.',
  );
  text(
    'hero-copy',
    !active
      ? 'Turn protection back on in settings.'
      : verdict === 'danger'
        ? 'Risk signals were found on this page.'
        : verdict === 'caution'
          ? 'Check the details before you go further.'
          : 'Quietly checking links. Keeping you informed.',
  );
  text('current-host', assessment?.hostname || 'Browser page');
  text(
    'site-pill',
    !active
      ? 'Paused'
      : verdict === 'danger'
        ? 'Risk detected'
        : verdict === 'caution'
          ? 'Review'
          : verdict === 'clear'
            ? 'No flags'
            : 'Not scanned',
  );
  el('site-pill').dataset.tone = risk ? verdict : 'clear';
  const findings = el('findings');
  findings.replaceChildren();
  findings.hidden = !risk;
  for (const finding of assessment?.findings ?? []) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = finding.title;
    p.append(strong, document.createElement('br'), document.createTextNode(finding.detail));
    findings.append(p);
  }
  if (risk && assessment) {
    const button = document.createElement('button');
    button.className = 'text-button';
    button.textContent = 'Explain this warning ↗';
    button.addEventListener('click', () => {
      void request('OPEN_EXPLANATION', { url: assessment.url }).catch(showError);
    });
    findings.append(button);
  }
}
async function load() {
  const data = await request<Snapshot>('SNAPSHOT');
  renderAssessment(data.current?.assessment, data.settings.enabled && data.nativeProtection);
  text('links-state', data.settings.enabled && data.nativeProtection ? 'On' : 'Off');
  text('wallet-state', data.settings.enabled && data.settings.pageGuard ? 'On' : 'Off');
  const age = feedAge(data.feed.retrievedAt);
  const stale = Date.now() - new Date(data.feed.retrievedAt).getTime() > 7 * 86400000;
  text(
    'feed-note',
    `${data.feed.domainCount.toLocaleString()} threat domains · ${age}${stale ? ' · Update recommended' : ''}`,
  );
  text('activity-count', String(data.activity.length));
  const list = el('activity-list');
  list.replaceChildren();
  if (!data.activity.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const heading = document.createElement('strong');
    heading.textContent = 'A quiet corner.';
    const copy = document.createElement('p');
    copy.textContent = data.settings.rememberActivity
      ? 'Warnings will appear here when Lynk spots something.'
      : 'Local warning history is turned off.';
    empty.append(heading, copy);
    list.append(empty);
  }
  for (const item of data.activity.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = item.hostname;
    const reason = document.createElement('p');
    reason.textContent = item.reason;
    const time = document.createElement('span');
    time.textContent = timeAgo(item.at);
    info.append(strong, reason);
    row.append(info, time);
    list.append(row);
  }
}
el('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
for (const selected of ['overview', 'activity'])
  el(`tab-${selected}`).addEventListener('click', () => {
    for (const name of ['overview', 'activity']) {
      el(name).hidden = name !== selected;
      el(`tab-${name}`).classList.toggle('selected', name === selected);
      el(`tab-${name}`).setAttribute('aria-selected', String(name === selected));
    }
  });
el('clear-activity').addEventListener('click', () => {
  void request('CLEAR_ACTIVITY').then(load).catch(showError);
});
el('check-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = el<HTMLInputElement>('check-url');
  const result = el('check-result');
  result.hidden = false;
  result.textContent = 'Checking locally…';
  void request<Assessment>('CHECK_URL', { url: input.value })
    .then((assessment) => {
      result.dataset.tone = assessment.verdict;
      const heading = document.createElement('strong');
      heading.textContent =
        assessment.verdict === 'unsupported'
          ? 'Enter an HTTP or HTTPS web address.'
          : assessment.verdict === 'clear'
            ? 'No known URL threats detected.'
            : assessment.verdict === 'danger'
              ? 'Risk detected. Avoid this link.'
              : 'Take a closer look.';
      const copy = document.createElement('p');
      copy.textContent =
        assessment.findings.map((f) => f.detail).join(' ') ||
        (assessment.verdict === 'clear'
          ? 'This check cannot verify a site’s content, contracts, or signature requests.'
          : 'Other address types cannot be scanned.');
      result.replaceChildren(heading, copy);
      if (assessment.verdict !== 'unsupported') {
        const button = document.createElement('button');
        button.className = 'text-button';
        button.textContent = 'Help me understand ↗';
        button.addEventListener('click', () => {
          void request('OPEN_EXPLANATION', { url: assessment.url }).catch(showError);
        });
        result.append(button);
      }
    })
    .catch(showError);
});
void load().catch(showError);
