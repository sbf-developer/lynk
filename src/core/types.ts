export type Verdict = 'clear' | 'caution' | 'danger' | 'unsupported';
export interface Finding {
  code: string;
  title: string;
  detail: string;
  weight: number;
}
export interface Assessment {
  url: string;
  hostname: string;
  domain: string;
  verdict: Verdict;
  score: number;
  findings: Finding[];
  suggestedUrl?: string;
  source?: string;
}
export interface Feed {
  domains: string[];
  allowlist: string[];
  retrievedAt: string;
  revision: string;
  domainCount: number;
  source: string;
}
export interface Settings {
  enabled: boolean;
  lookalikes: boolean;
  pageGuard: boolean;
  linkGuard: boolean;
  rememberActivity: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  lookalikes: true,
  pageGuard: true,
  linkGuard: true,
  rememberActivity: true,
};
export interface Activity {
  id: string;
  hostname: string;
  verdict: Verdict;
  reason: string;
  at: number;
}
export interface PageSignals {
  recoveryFields: boolean;
  walletContext: boolean;
  title: string;
}
export interface TabState {
  assessment: Assessment;
  at: number;
  bypassed?: boolean;
}
export interface Snapshot {
  settings: Settings;
  current?: TabState;
  activity: Activity[];
  feed: Omit<Feed, 'domains' | 'allowlist'>;
  ruleCount: number;
  nativeProtection: boolean;
}
