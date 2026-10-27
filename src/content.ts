import { displayedLinkMismatch, parseWebUrl } from './core/engine';
import type { Assessment, PageSignals, Settings } from './core/types';

// Only field labels and attributes are inspected. Never read input/textarea values.
const secret =
  /\b(seed\s*(phrase|words)|recovery\s*(phrase|words)|secret\s*(recovery\s*)?phrase|private\s*key|mnemonic)\b/i;
let prefs: Settings | undefined;
let signature = '';
let dismissed = new Set<string>();
let overlay: HTMLElement | undefined;
const linkCache = new Map<string, Assessment | null>();
let pending = false;
function send<T>(message: unknown): Promise<T | undefined> {
  return chrome.runtime
    .sendMessage(message)
    .then((response) => (response?.ok ? (response.data as T) : undefined))
    .catch(() => undefined);
}
function fieldMetadata(field: Element): string {
  const labels =
    'labels' in field
      ? Array.from((field as HTMLInputElement).labels ?? [])
          .map((l) => l.textContent ?? '')
          .join(' ')
      : '';
  return [
    field.getAttribute('placeholder'),
    field.getAttribute('aria-label'),
    field.getAttribute('name'),
    field.id,
    labels,
  ]
    .join(' ')
    .slice(0, 1500);
}
function recoveryField(field: Element): boolean {
  return secret.test(fieldMetadata(field));
}
function showWarning(title: string, detail: string, domain: string, key: string, leave = true) {
  if (dismissed.has(key) || overlay?.isConnected) return;
  const host = document.createElement('div');
  host.setAttribute('data-lynk-warning', '');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:grid!important;place-items:start center!important;padding:24px!important;pointer-events:none!important}*{box-sizing:border-box}.card{pointer-events:auto;width:min(460px,calc(100vw - 32px));padding:25px;background:#fcfcf8;color:#192a23;border:1px solid #d9ddd4;border-radius:20px;box-shadow:0 16px 80px #13271e33;font:14px/1.6 system-ui,sans-serif}header{display:flex;justify-content:space-between;align-items:center;font-size:18px;font-weight:700}small{color:#8b4636;font:11px system-ui;letter-spacing:.08em}h2{font:600 23px/1.2 system-ui;margin:24px 0 12px}p{color:#5e6c62;overflow-wrap:anywhere}code{display:block;color:#8b4636;font:12px monospace;overflow-wrap:anywhere}footer{display:flex;gap:10px;margin-top:22px}button{font:600 13px system-ui;border:1px solid #d9ddd4;border-radius:10px;padding:12px 17px;cursor:pointer;background:#f0f1ea;color:#23382c}button:first-child{background:#1e3628;color:white;border-color:#1e3628}button:focus-visible{outline:3px solid #81ad57;outline-offset:3px}`;
  const card = document.createElement('section');
  card.className = 'card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-label', title);
  const header = document.createElement('header');
  header.textContent = '↗ lynk';
  const tag = document.createElement('small');
  tag.textContent = 'TAKE A CLOSER LOOK';
  header.append(tag);
  const heading = document.createElement('h2');
  heading.textContent = title;
  const code = document.createElement('code');
  code.textContent = domain;
  const copy = document.createElement('p');
  copy.textContent = detail;
  const footer = document.createElement('footer');
  const primary = document.createElement('button');
  primary.textContent = leave ? 'Leave this page' : 'Keep me here';
  primary.addEventListener('click', () => {
    host.remove();
    if (leave) location.replace('about:blank');
  });
  const close = document.createElement('button');
  close.textContent = 'Dismiss warning';
  close.addEventListener('click', () => {
    dismissed.add(key);
    host.remove();
  });
  footer.append(primary, close);
  card.append(header, heading, code, copy, footer);
  root.append(style, card);
  (document.documentElement ?? document).append(host);
  overlay = host;
}
async function scan() {
  pending = false;
  if (!document.documentElement) return;
  const recoveryFields = Array.from(document.querySelectorAll('input:not([type=hidden]),textarea'))
    .slice(0, 400)
    .some(recoveryField);
  const signals: PageSignals = { recoveryFields, walletContext: false, title: '' };
  const nextSignature = `${location.href}|${recoveryFields}`;
  if (nextSignature === signature) return;
  signature = nextSignature;
  const response = await send<{ settings: Settings; assessment?: Assessment }>({
    type: 'PAGE_SIGNALS',
    signals,
  });
  if (!response) return;
  prefs = response.settings;
  if (!prefs.enabled) {
    overlay?.remove();
    return;
  }
  if (!prefs.pageGuard && overlay?.isConnected) overlay.remove();
  const assessment = response.assessment;
  if (recoveryFields && prefs.pageGuard)
    showWarning(
      'Keep your recovery phrase private.',
      'This page asks for a recovery phrase or private key. A website with that secret can take your funds. Verify the source before you enter anything.',
      location.hostname,
      'recovery-phrase',
    );
  else if (assessment?.verdict === 'caution')
    showWarning(
      assessment.findings[0].title,
      assessment.findings.map((f) => f.detail).join(' '),
      assessment.hostname,
      'url-caution',
    );
}
function schedule() {
  if (!pending) {
    pending = true;
    setTimeout(() => void scan(), 500);
  }
}
function anchor(event: Event): HTMLAnchorElement | undefined {
  return event.composedPath().find((el) => el instanceof HTMLAnchorElement) as
    | HTMLAnchorElement
    | undefined;
}
function previewLink(event: Event) {
  const link = anchor(event);
  if (
    !link ||
    !parseWebUrl(link.href) ||
    linkCache.has(link.href) ||
    !prefs?.enabled ||
    !prefs.linkGuard
  )
    return;
  const href = link.href;
  if (linkCache.size > 100) linkCache.delete(linkCache.keys().next().value!);
  linkCache.set(href, null);
  void send<Assessment>({ type: 'CHECK_URL', url: href }).then((result) => {
    if (!result) return;
    linkCache.set(href, result);
    if (result.verdict === 'danger' || result.verdict === 'caution')
      link.setAttribute(
        'title',
        `Lynk: ${result.findings[0]?.title}. Destination: ${result.hostname}`,
      );
  });
}
document.addEventListener('pointerover', previewLink, { passive: true, capture: true });
document.addEventListener('focusin', previewLink, { passive: true, capture: true });
function guardLink(event: MouseEvent) {
  if (!prefs?.enabled || !prefs.linkGuard || !event.isTrusted) return;
  if (event.type === 'auxclick' && event.button !== 1) return;
  const link = anchor(event);
  if (!link || !parseWebUrl(link.href)) return;
  const mismatch = displayedLinkMismatch(link.textContent ?? '', link.href);
  const checked = linkCache.get(link.href);
  if (!mismatch && checked?.verdict !== 'danger') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const destination = new URL(link.href);
  showWarning(
    mismatch ? 'This link leads somewhere else.' : 'A risky link was stopped.',
    mismatch
      ? 'The web address shown in the link does not match its actual destination. Verify the address through a trusted source.'
      : checked!.findings.map((f) => f.detail).join(' '),
    destination.hostname,
    `link:${link.href}`,
    false,
  );
}
document.addEventListener('click', guardLink, true);
document.addEventListener('auxclick', guardLink, true);
document.addEventListener(
  'submit',
  (event) => {
    if (!prefs?.enabled || !prefs.pageGuard || dismissed.has('recovery-phrase')) return;
    if (
      event.target instanceof HTMLFormElement &&
      Array.from(event.target.querySelectorAll('input,textarea')).some(recoveryField)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showWarning(
        'Pause before sharing a secret.',
        'This form asks for a recovery phrase or private key. Do not submit it unless you have independently verified exactly what you are doing.',
        location.hostname,
        'recovery-phrase',
      );
    }
  },
  true,
);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'RESCAN') {
    signature = '';
    void scan();
  }
});
const observer = new MutationObserver(schedule);
observer.observe(document, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['placeholder', 'aria-label', 'name', 'id'],
});
document.addEventListener('DOMContentLoaded', schedule, { once: true });
void scan();
