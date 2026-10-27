import { createEngine, mergeFindings, pageFindings, parseWebUrl } from './core/engine';
import { evidenceFrom, type ExplanationEvidence } from './core/explanations';
import {
  DEFAULT_SETTINGS,
  type Activity,
  type Assessment,
  type Feed,
  type PageSignals,
  type Settings,
  type TabState,
} from './core/types';
interface Pass {
  origin: string;
  expires: number;
  ruleId: number;
}

const boot = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  const [feed, saved] = await Promise.all([
    fetch(chrome.runtime.getURL('data/threats.json')).then((r) => r.json()) as Promise<Feed>,
    chrome.storage.local.get('settings'),
  ]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(saved.settings as Partial<Settings> | undefined),
  } as Settings;
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: settings.enabled ? ['threats'] : [],
    disableRulesetIds: settings.enabled ? [] : ['threats'],
  });
  return { feed, assess: createEngine(feed) };
})();
const navigating = new Map<number, Promise<void>>();
const destinations = new Map<number, string>();
let mutations: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutations.then(fn, fn);
  mutations = next.catch(() => {});
  return next;
}
async function settings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(data.settings as Partial<Settings> | undefined) };
}
const stateKey = (tabId: number) => `tab:${tabId}`;
async function getState(tabId: number): Promise<TabState | undefined> {
  return (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] as
    | TabState
    | undefined;
}
async function badge(tabId: number, assessment?: Assessment, paused = false) {
  const text = paused
    ? 'OFF'
    : assessment?.verdict === 'danger'
      ? '!'
      : assessment?.verdict === 'caution'
        ? '?'
        : '';
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: paused ? '#6d756f' : assessment?.verdict === 'danger' ? '#bb4d3c' : '#9b721e',
    }),
    chrome.action.setTitle({
      tabId,
      title: paused
        ? 'Lynk · Protection paused'
        : `Lynk · ${assessment?.verdict === 'danger' ? 'Risk detected' : assessment?.verdict === 'caution' ? 'Take a closer look' : 'No known URL threats detected'}`,
    }),
  ]);
}
async function record(assessment: Assessment) {
  if (assessment.verdict !== 'danger' && assessment.verdict !== 'caution') return;
  await serialized(async () => {
    if (!(await settings()).rememberActivity) return;
    const data = await chrome.storage.local.get('activity');
    const activity: Activity[] = Array.isArray(data.activity) ? data.activity : [];
    const reason = assessment.findings[0]?.title ?? 'Suspicious link';
    if (
      activity[0]?.hostname === assessment.hostname &&
      activity[0]?.reason === reason &&
      Date.now() - activity[0].at < 60000
    )
      return;
    activity.unshift({
      id: crypto.randomUUID(),
      hostname: assessment.hostname,
      verdict: assessment.verdict,
      reason,
      at: Date.now(),
    });
    await chrome.storage.local.set({ activity: activity.slice(0, 50) });
  });
}
async function bypassFor(tabId: number, url: URL) {
  const key = `pass:${tabId}`;
  const data = (await chrome.storage.session.get(key))[key] as Pass | undefined;
  if (!data) return false;
  if (data.origin === url.origin && data.expires > Date.now()) return true;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [data.ruleId] });
  await chrome.storage.session.remove(key);
  return false;
}
async function navigate(tabId: number, raw: string) {
  const url = parseWebUrl(raw);
  if (!url) {
    const pass = (await chrome.storage.session.get(`pass:${tabId}`))[`pass:${tabId}`] as
      | Pass
      | undefined;
    if (pass)
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [pass.ruleId] });
    await chrome.storage.session.remove([`pass:${tabId}`, stateKey(tabId)]);
    await badge(tabId, undefined, !(await settings()).enabled);
    return;
  }
  const { assess } = await boot;
  if (destinations.get(tabId) !== raw) return;
  const prefs = await settings();
  if (!prefs.enabled) {
    await badge(tabId, undefined, true);
    return;
  }
  const assessment = assess(raw, prefs.lookalikes);
  const bypassed = await bypassFor(tabId, url);
  await chrome.storage.session.set({
    [stateKey(tabId)]: { assessment, at: Date.now(), bypassed } satisfies TabState,
  });
  await badge(tabId, assessment);
  if (assessment.verdict !== 'clear') await record(assessment);
  if (assessment.verdict === 'danger' && !bypassed && destinations.get(tabId) === raw) {
    // Known domains are intercepted by DNR before load. Unknown lookalikes are best-effort navigation checks.
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL('warning.html') });
  }
}
function scheduleNavigation(tabId: number, url: string) {
  if (url.split(/[?#]/)[0] === chrome.runtime.getURL('warning.html')) return;
  destinations.set(tabId, url);
  const previous = navigating.get(tabId) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => navigate(tabId, url));
  navigating.set(tabId, operation);
  void operation
    .catch(() => {})
    .finally(() => {
      if (navigating.get(tabId) === operation) navigating.delete(tabId);
    });
}
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) scheduleNavigation(details.tabId, details.url);
});
// A server redirect can commit a different host without another onBeforeNavigate event.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && destinations.get(details.tabId) !== details.url)
    scheduleNavigation(details.tabId, details.url);
});
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) scheduleNavigation(details.tabId, details.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  destinations.delete(tabId);
  void (async () => {
    const key = `pass:${tabId}`;
    const pass = (await chrome.storage.session.get(key))[key] as Pass | undefined;
    if (pass)
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [pass.ruleId] });
    await chrome.storage.session.remove([stateKey(tabId), key]);
  })().catch(() => {});
});
// Session allow rules have a bounded lifetime, including when a tab remains open.
chrome.alarms.create('expire-passes', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'expire-passes') return;
  void serialized(async () => {
    const all = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(all)) {
      const pass = value as Pass;
      if (key.startsWith('pass:') && pass.expires <= Date.now()) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [pass.ruleId] });
        await chrome.storage.session.remove(key);
      }
      if (key.startsWith('explain:') && pass.expires <= Date.now())
        await chrome.storage.session.remove(key);
    }
  }).catch(() => {});
});

function trustedUi(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  return ['popup.html', 'settings.html', 'warning.html', 'explain.html'].some(
    (page) => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(page),
  );
}
function warningUi(sender: chrome.runtime.MessageSender): boolean {
  return (
    trustedUi(sender) &&
    sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('warning.html') &&
    sender.tab?.id !== undefined
  );
}
function validSignals(value: unknown): value is PageSignals {
  if (!value || typeof value !== 'object') return false;
  const s = value as PageSignals;
  return (
    typeof s.recoveryFields === 'boolean' &&
    typeof s.walletContext === 'boolean' &&
    typeof s.title === 'string' &&
    s.title.length <= 300
  );
}
async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!message || typeof message !== 'object' || sender.id !== chrome.runtime.id)
    throw new Error('Invalid request.');
  const msg = message as Record<string, unknown>;
  const { feed, assess } = await boot;
  const prefs = await settings();
  const ui = trustedUi(sender);
  switch (msg.type) {
    case 'OPEN_EXPLANATION': {
      if (!ui) throw new Error('Extension page required.');
      let assessment: Assessment | undefined;
      if (typeof msg.url === 'string' && msg.url.length <= 8192)
        assessment = assess(msg.url, prefs.lookalikes, true);
      else if (warningUi(sender)) {
        await navigating.get(sender.tab!.id!);
        assessment = (await getState(sender.tab!.id!))?.assessment;
      }
      if (!assessment || assessment.verdict === 'unsupported')
        throw new Error('Check a web address first.');
      const all = await chrome.storage.session.get(null);
      const entries = Object.entries(all).filter(([key]) => key.startsWith('explain:'));
      const stale = entries
        .filter(([, value]) => (value as { expires: number }).expires <= Date.now())
        .map(([key]) => key);
      const remaining = entries.filter(([key]) => !stale.includes(key));
      if (remaining.length >= 10)
        stale.push(...remaining.slice(0, remaining.length - 9).map(([key]) => key));
      if (stale.length) await chrome.storage.session.remove(stale);
      const id = crypto.randomUUID();
      await chrome.storage.session.set({
        [`explain:${id}`]: { evidence: evidenceFrom(assessment), expires: Date.now() + 15 * 60000 },
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`explain.html#${id}`) });
      return true;
    }
    case 'READ_EXPLANATION': {
      if (
        !ui ||
        sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('explain.html') ||
        typeof msg.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(msg.id)
      )
        throw new Error('Explanation page required.');
      const key = `explain:${msg.id}`;
      const entry = (await chrome.storage.session.get(key))[key] as
        | { evidence: ExplanationEvidence; expires: number }
        | undefined;
      if (!entry || entry.expires <= Date.now()) {
        await chrome.storage.session.remove(key);
        throw new Error('This explanation has expired. Check the link again from Lynk’s toolbar.');
      }
      return entry.evidence;
    }
    case 'CHECK_URL': {
      if (typeof msg.url !== 'string' || msg.url.length > 8192) throw new Error('Invalid URL.');
      if (!ui && !parseWebUrl(sender.url ?? '')) throw new Error('Unsupported sender.');
      if (!ui && (!prefs.enabled || !prefs.linkGuard)) return null;
      return assess(msg.url, prefs.lookalikes, ui);
    }
    case 'PAGE_SIGNALS': {
      if (ui || !prefs.enabled || sender.tab?.id === undefined || !parseWebUrl(sender.url ?? ''))
        return { settings: prefs };
      const tabId = sender.tab.id;
      const assessment = assess(sender.url!, prefs.lookalikes);
      const findings =
        prefs.pageGuard && validSignals(msg.signals) ? pageFindings(msg.signals) : [];
      if (findings.length) {
        const live = await chrome.tabs.get(tabId);
        if (!parseWebUrl(live.url ?? '') || (sender.frameId === 0 && live.url !== sender.url))
          return { settings: prefs };
        const state = await getState(tabId);
        const top = state?.assessment ?? assessment;
        const merged = mergeFindings(top, findings);
        await chrome.storage.session.set({
          [stateKey(tabId)]: { assessment: merged, at: Date.now() } satisfies TabState,
        });
        await badge(tabId, merged);
        await record(merged);
      }
      return { settings: prefs, assessment: mergeFindings(assessment, findings) };
    }
    case 'SNAPSHOT': {
      if (!ui) throw new Error('Extension page required.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let current = tab?.id !== undefined ? await getState(tab.id) : undefined;
      if (tab?.url && parseWebUrl(tab.url) && (!current || current.assessment.url !== tab.url))
        current = { assessment: assess(tab.url, prefs.lookalikes), at: Date.now() };
      const { domains: _domains, allowlist: _allowlist, ...meta } = feed;
      const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
      return {
        settings: prefs,
        current,
        feed: meta,
        activity: (await chrome.storage.local.get('activity')).activity ?? [],
        ruleCount: Math.ceil(feed.domains.length / 500) * 2,
        nativeProtection: enabled.includes('threats'),
      };
    }
    case 'ALERT': {
      if (!warningUi(sender)) throw new Error('Warning page required.');
      await navigating.get(sender.tab!.id!);
      return {
        state: await getState(sender.tab!.id!),
        feed: { retrievedAt: feed.retrievedAt, source: feed.source },
      };
    }
    case 'CONTINUE_ONCE': {
      if (!warningUi(sender)) throw new Error('Warning page required.');
      return serialized(async () => {
        const tabId = sender.tab!.id!;
        const state = await getState(tabId);
        const url = parseWebUrl(state?.assessment.url ?? '');
        if (!url || !state || Date.now() - state.at > 15 * 60000 || url.username || url.password)
          throw new Error('This warning has expired. Open the original link again to review it.');
        const ruleId = 1000000 + tabId;
        const escaped = url.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [ruleId],
          addRules: [
            {
              id: ruleId,
              priority: 100,
              action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
              condition: {
                regexFilter: `^${escaped}/`,
                tabIds: [tabId],
                resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
              },
            },
          ],
        });
        await chrome.storage.session.set({
          [`pass:${tabId}`]: { origin: url.origin, expires: Date.now() + 10 * 60000, ruleId },
        });
        await chrome.tabs.update(tabId, { url: url.href });
        return true;
      });
    }
    case 'UPDATE_SETTINGS': {
      if (!ui || !msg.patch || typeof msg.patch !== 'object')
        throw new Error('Extension page required.');
      const patch = msg.patch as Record<string, unknown>;
      if (
        Object.keys(patch).some(
          (key) => !Object.hasOwn(DEFAULT_SETTINGS, key) || typeof patch[key] !== 'boolean',
        )
      )
        throw new Error('Invalid settings.');
      return serialized(async () => {
        const next = { ...(await settings()), ...patch } as Settings;
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: next.enabled ? ['threats'] : [],
          disableRulesetIds: next.enabled ? [] : ['threats'],
        });
        await chrome.storage.local.set({ settings: next });
        if (!next.rememberActivity) await chrome.storage.local.remove('activity');
        for (const tab of await chrome.tabs.query({})) {
          if (tab.id === undefined) continue;
          const state = await getState(tab.id);
          let current = state?.assessment;
          if (state) {
            current = mergeFindings(
              assess(state.assessment.url, next.lookalikes),
              next.pageGuard
                ? state.assessment.findings.filter((f) => f.code === 'recovery-phrase')
                : [],
            );
            await chrome.storage.session.set({
              [stateKey(tab.id)]: { ...state, assessment: current },
            });
          }
          await badge(tab.id, current, !next.enabled).catch(() => {});
        }
        for (const tab of await chrome.tabs.query({}))
          if (tab.id !== undefined)
            void chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' }).catch(() => {});
        return next;
      });
    }
    case 'CLEAR_ACTIVITY': {
      if (!ui) throw new Error('Extension page required.');
      await serialized(() => chrome.storage.local.remove('activity'));
      return true;
    }
    default:
      throw new Error('Unknown request.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void handle(message, sender).then(
    (data) => respond({ ok: true, data }),
    (error) =>
      respond({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }),
  );
  return true;
});
