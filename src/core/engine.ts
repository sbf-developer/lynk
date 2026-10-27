import { parse } from 'tldts';
import { toUnicode } from 'punycode/';
import { BRANDS } from './brands';
import type { Assessment, Feed, Finding, PageSignals } from './types';

export function parseWebUrl(input: string, allowBare = false): URL | null {
  if (typeof input !== 'string' || input.length > 8192 || !input.trim()) return null;
  let value = input.trim();
  if (allowBare && value.startsWith('//')) value = `https:${value}`;
  else if (
    allowBare &&
    !/^https?:\/\//i.test(value) &&
    /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  )
    value = `https://${value}`;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname ? url : null;
  } catch {
    return null;
  }
}
export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
export function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}
export function findListed(host: string, domains: Set<string>): string | undefined {
  let candidate = host;
  while (candidate.includes('.')) {
    if (domains.has(candidate)) return candidate;
    candidate = candidate.slice(candidate.indexOf('.') + 1);
  }
  return undefined;
}
export function editDistance(a: string, b: string): number {
  const rows = Array.from(
    { length: a.length + 1 },
    (_, i) => [i, ...Array(b.length).fill(0)] as number[],
  );
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  і: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  т: 't',
  в: 'b',
  н: 'h',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  α: 'a',
  ο: 'o',
  ρ: 'p',
  ι: 'i',
  ν: 'v',
  τ: 't',
};
const skeleton = (s: string) =>
  Array.from(
    toUnicode(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(),
    (c) => CONFUSABLES[c] ?? c,
  )
    .join('')
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/-/g, '');
export function createEngine(feed: Pick<Feed, 'domains' | 'allowlist'>) {
  const blocked = new Set(feed.domains);
  const fuzzyExempt = new Set(feed.allowlist);
  return function assess(input: string, lookalikes = true, allowBare = false): Assessment {
    const url = parseWebUrl(input, allowBare);
    if (!url)
      return {
        url: input,
        hostname: '',
        domain: '',
        verdict: 'unsupported',
        score: 0,
        findings: [],
      };
    const hostname = normalizedHost(url);
    const parsed = parse(hostname, { allowPrivateDomains: true });
    const domain = parsed.domain ?? hostname;
    const label = parsed.domainWithoutSuffix ?? hostname;
    const findings: Finding[] = [];
    let suggestedUrl: string | undefined;
    const add = (code: string, title: string, detail: string, weight: number) =>
      findings.push({ code, title, detail, weight });
    const listed = findListed(hostname, blocked);
    if (listed)
      add(
        'blocklist',
        'Reported phishing domain',
        `${listed} appears in the packaged MetaMask phishing list. This includes its subdomains.`,
        100,
      );
    if (url.username || url.password)
      add(
        'credentials',
        'The address hides its real destination',
        `Text before @ is not the website. The actual host is ${hostname}.`,
        85,
      );
    if (url.protocol === 'http:' && !parsed.isIp && hostname !== 'localhost')
      add(
        'http',
        'Connection is not encrypted',
        'HTTP does not protect information sent to this site. HTTPS alone would not prove it is legitimate.',
        35,
      );
    if (parsed.isIp && hostname !== '127.0.0.1' && hostname !== '[::1]')
      add(
        'ip',
        'A numerical address',
        'This link uses an IP address instead of a recognizable domain. Check who provided it.',
        35,
      );
    if (hostname.split('.').some((l) => l.startsWith('xn--')))
      add(
        'idn',
        'Internationalized domain',
        'This address contains encoded international characters. They can be legitimate, but can also imitate familiar letters.',
        40,
      );
    if (lookalikes && !findListed(hostname, fuzzyExempt)) {
      for (const brand of BRANDS) {
        if (brand.domains.some((d) => hostMatches(hostname, d))) continue;
        const embedded = brand.domains.some(
          (d) => hostname.startsWith(`${d}.`) || hostname.includes(`.${d}.`),
        );
        const same = label === brand.label;
        const typo =
          brand.label.length >= 5 &&
          (skeleton(label) === skeleton(brand.label) ||
            (label.length <= brand.label.length + 2 && editDistance(label, brand.label) <= 1));
        const decorated = label.split('-').includes(brand.label) && label !== brand.label;
        const subdomain = (parsed.subdomain ?? '').split('.').includes(brand.label);
        if (embedded || same || typo || decorated || subdomain) {
          add(
            'lookalike',
            `Looks similar to ${brand.name}`,
            `The registered domain is ${domain}. ${brand.name}'s reference domain is ${brand.domains[0]}. Similar spelling does not establish identity.`,
            embedded || same || decorated ? 90 : typo ? 85 : 70,
          );
          suggestedUrl = `https://${brand.domains[0]}/`;
          break;
        }
      }
    }
    const score = Math.min(
      100,
      findings.reduce((n, f) => n + f.weight, 0),
    );
    return {
      url: url.href,
      hostname,
      domain,
      verdict: score >= 80 ? 'danger' : score >= 30 ? 'caution' : 'clear',
      score,
      findings,
      suggestedUrl,
      source: listed ? 'MetaMask / eth-phishing-detect' : undefined,
    };
  };
}

export function pageFindings(signals: PageSignals): Finding[] {
  if (signals.recoveryFields)
    return [
      {
        code: 'recovery-phrase',
        title: 'Recovery phrase requested',
        detail:
          'This page has a field labeled for a recovery phrase or private key. Anyone with that secret can control your funds. Never enter it into an unfamiliar website.',
        weight: 100,
      },
    ];
  return [];
}
export function mergeFindings(assessment: Assessment, more: Finding[]): Assessment {
  const findings = [...assessment.findings];
  for (const finding of more)
    if (!findings.some((f) => f.code === finding.code)) findings.push(finding);
  const score = Math.min(
    100,
    findings.reduce((n, f) => n + f.weight, 0),
  );
  return {
    ...assessment,
    findings,
    score,
    verdict: score >= 80 ? 'danger' : score >= 30 ? 'caution' : 'clear',
  };
}
export function displayedLinkMismatch(text: string, href: string): boolean {
  const label = text.trim().replace(/\/$/, '');
  if (
    !/^(https?:\/\/|www\.)[^\s]+$/i.test(label) &&
    !/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(label)
  )
    return false;
  const shown = parseWebUrl(label, true);
  const target = parseWebUrl(href);
  if (!shown || !target) return false;
  const domain = (u: URL) =>
    parse(normalizedHost(u), { allowPrivateDomains: true }).domain ?? normalizedHost(u);
  return domain(shown) !== domain(target);
}
