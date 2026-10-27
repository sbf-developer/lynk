import {
  defaultChoices,
  EXPLANATIONS,
  nextStep,
  type ExplanationChoice,
  type ExplanationEvidence,
} from '../core/explanations';
import { chooseLocalExplanations, modelAvailability, type Availability } from '../core/local-ai';
import { el, request, showError, text } from './shared';
let evidence: ExplanationEvidence | undefined;
let availability: Availability = 'unavailable';
let running: AbortController | undefined;
function renderChoices(choices: ExplanationChoice[]) {
  const list = el('plain-explanations');
  list.replaceChildren();
  for (const choice of choices) {
    const p = document.createElement('p');
    p.textContent = EXPLANATIONS[choice.code][choice.variant];
    list.append(p);
  }
  if (!choices.length) {
    const p = document.createElement('p');
    p.textContent = evidence?.findings.length
      ? 'Read the findings above for this check. A simpler explanation is not available for every type of warning.'
      : 'No known URL warning signals were found in this check. That does not verify who operates the website or what a wallet request will do.';
    list.append(p);
  }
}
function ready() {
  const downloadable = availability === 'downloadable' || availability === 'downloading';
  el('consent-row').hidden = !downloadable;
  el<HTMLButtonElement>('local-ai').disabled =
    !evidence?.findings.length ||
    availability === 'unavailable' ||
    (downloadable && !el<HTMLInputElement>('download-consent').checked);
  text(
    'local-ai',
    availability === 'available'
      ? 'Choose examples with local AI'
      : downloadable
        ? 'Download & choose examples'
        : 'AI unavailable on this device',
  );
}
el('download-consent').addEventListener('change', ready);
el('cancel-ai').addEventListener('click', () => running?.abort());
window.addEventListener('pagehide', () => running?.abort());
el('local-ai').addEventListener('click', () => {
  if (!evidence || running || availability === 'unavailable') return;
  if (availability !== 'available' && !el<HTMLInputElement>('download-consent').checked) return;
  const controller = new AbortController();
  running = controller;
  el<HTMLButtonElement>('local-ai').disabled = true;
  el('cancel-ai').hidden = false;
  text(
    'ai-status',
    availability === 'available'
      ? 'Choosing helpful examples on your device…'
      : 'Chrome is preparing its local model. You can cancel at any time.',
  );
  // Called before any await so Chrome can observe the user's activation.
  void chooseLocalExplanations(evidence, {
    signal: controller.signal,
    onProgress(fraction) {
      text('ai-status', `Chrome model download: ${Math.round(fraction * 100)}%.`);
    },
  })
    .then((result) => {
      renderChoices(result.choices);
      text(
        'wording-source',
        result.mode === 'ai' ? 'AI-SELECTED · REVIEWED WORDING' : 'REVIEWED EXPLANATIONS',
      );
      text(
        'ai-status',
        result.mode === 'ai'
          ? 'Examples selected locally. The original findings and warning are unchanged.'
          : controller.signal.aborted
            ? 'Cancelled. The original explanations are still available.'
            : 'AI could not provide a valid selection. Lynk kept the reviewed explanations.',
      );
    })
    .catch(() => {
      text('ai-status', 'AI is unavailable. The original explanations remain available.');
    })
    .finally(() => {
      running = undefined;
      el('cancel-ai').hidden = true;
      void modelAvailability().then((status) => {
        availability = status;
        ready();
      });
    });
});
async function load() {
  const id = location.hash.slice(1);
  evidence = await request<ExplanationEvidence>('READ_EXPLANATION', { id });
  text('host', evidence.hostname || 'Web address');
  text(
    'verdict',
    evidence.verdict === 'danger'
      ? 'Risk detected'
      : evidence.verdict === 'caution'
        ? 'Review'
        : 'No URL flags',
  );
  el('verdict').dataset.tone = evidence.verdict;
  const list = el('evidence');
  for (const finding of evidence.findings) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = finding.title;
    p.append(strong, document.createElement('br'), document.createTextNode(finding.detail));
    list.append(p);
  }
  if (!evidence.findings.length)
    text(
      'evidence',
      'No known URL warning signals found. Site content and wallet requests are outside this check.',
    );
  renderChoices(defaultChoices(evidence));
  text('next-step', nextStep(evidence));
  ready();
}
void load().catch(showError);
void modelAvailability().then((status) => {
  availability = status;
  text(
    'ai-status',
    status === 'available'
      ? 'Chrome’s local model is ready. It runs only when you press the button.'
      : status === 'unavailable'
        ? 'Local AI is not available in this browser or on this device. The complete explanations above work without it.'
        : 'This browser supports local AI, but Chrome may need to download a model first. No download starts until you agree and press the button.',
  );
  ready();
});
