import { request, el, text, showError, feedAge } from './shared';
import { DEFAULT_SETTINGS, type Settings, type Snapshot } from '../core/types';
import { modelAvailability } from '../core/local-ai';
let savedTimer: ReturnType<typeof setTimeout>;
function saved() {
  el('saved').hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el('saved').hidden = true;
  }, 2000);
}
function render(settings: Settings) {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
    el<HTMLInputElement>(key).checked = settings[key];
  el('paused').hidden = settings.enabled;
}
async function load() {
  const data = await request<Snapshot>('SNAPSHOT');
  render(data.settings);
  text('domain-count', data.feed.domainCount.toLocaleString());
  text(
    'feed-date',
    new Date(data.feed.retrievedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  );
  text('network-state', data.nativeProtection ? `${data.ruleCount} rules active` : 'Paused');
  const old = Date.now() - new Date(data.feed.retrievedAt).getTime() > 7 * 86400000;
  text(
    'freshness',
    `Snapshot is ${feedAge(data.feed.retrievedAt)}.${old ? ' Update recommended: older lists miss recently reported scams.' : ' Newly created threats may not yet be listed.'}`,
  );
}
for (const key of Object.keys(DEFAULT_SETTINGS)) {
  const input = el<HTMLInputElement>(key);
  input.addEventListener('change', () => {
    input.disabled = true;
    void request<Settings>('UPDATE_SETTINGS', { patch: { [key]: input.checked } })
      .then(async (settings) => {
        render(settings);
        saved();
        await load();
      })
      .catch((error) => {
        input.checked = !input.checked;
        showError(error);
      })
      .finally(() => {
        input.disabled = false;
      });
  });
}
el('clear').addEventListener('click', () => {
  void request('CLEAR_ACTIVITY').then(saved).catch(showError);
});
el('check-ai').addEventListener('click', () => {
  el<HTMLButtonElement>('check-ai').disabled = true;
  text('device-ai-status', 'Checking support without starting a download…');
  void modelAvailability()
    .then((status) => {
      text(
        'device-ai-status',
        status === 'available'
          ? 'Ready: Chrome’s local model is available. Open “Help me understand” on a checked link to use it.'
          : status === 'unavailable'
            ? 'Unavailable in this browser or on this device. All protection and reviewed explanations still work.'
            : 'Supported, but Chrome needs to prepare or download its model. Nothing is downloaded from this settings check.',
      );
    })
    .finally(() => {
      el<HTMLButtonElement>('check-ai').disabled = false;
    });
});
void load().catch(showError);
