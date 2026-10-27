import { describe, expect, it } from 'vitest';
import {
  createEngine,
  displayedLinkMismatch,
  editDistance,
  findListed,
  mergeFindings,
  pageFindings,
  parseWebUrl,
} from '../src/core/engine';
const assess = createEngine({
  domains: ['scam.example', 'blocked.metamask.io'],
  allowlist: ['opensea.gr'],
});
describe('URL classification', () => {
  it.each(['https://scam.example/', 'https://sub.scam.example/path', 'https://SCAM.EXAMPLE./'])(
    'detects reported hosts and subdomains: %s',
    (input) => {
      expect(assess(input).findings[0]?.code).toBe('blocklist');
      expect(assess(input).verdict).toBe('danger');
    },
  );
  it.each([
    'https://scam.example.evil.org',
    'https://notscam.example.org',
    'https://example.org/scam.example',
  ])('does not match a blocklist substring: %s', (input) => {
    expect(assess(input).findings.some((f) => f.code === 'blocklist')).toBe(false);
  });
  it('does not let a reference domain override a known threat', () => {
    expect(assess('https://blocked.metamask.io').verdict).toBe('danger');
  });
  it.each([
    'https://metamaks.io',
    'https://metamask-login.org',
    'https://metamask.io.evil.org',
    'https://metamask.xyz',
    'https://c0inbase.com',
    'https://unlswap.org',
  ])('catches lookalikes: %s', (input) => {
    expect(assess(input).verdict).toBe('danger');
    expect(assess(input).suggestedUrl).toMatch(/^https:\/\//);
  });
  it.each([
    'https://metamask.io',
    'https://app.uniswap.org',
    'https://opensea.gr',
    'https://example.org',
    'https://github.com/a/metamask',
    'https://docs.google.com',
  ])('avoids warning on reference sites and unrelated URLs: %s', (input) => {
    expect(assess(input).verdict).toBe('clear');
  });
  it('uses the public suffix list for multi-level domains', () => {
    expect(assess('https://metamask.co.uk').domain).toBe('metamask.co.uk');
    expect(assess('https://metamask.co.uk').verdict).toBe('danger');
  });
  it('treats private suffix tenants as separate sites', () => {
    expect(assess('https://metamask.github.io').domain).toBe('metamask.github.io');
    expect(assess('https://metamask.github.io').verdict).toBe('danger');
  });
  it('flags credentials pointing at a different host', () => {
    const a = assess('https://metamask.io@evil.example/');
    expect(a.hostname).toBe('evil.example');
    expect(a.findings[0].code).toBe('credentials');
  });
  it('distinguishes HTTP, IP addresses and encoded domains from confirmed phishing', () => {
    for (const input of [
      'http://example.org',
      'https://192.0.2.1/',
      'https://xn--e1afmkfd.xn--p1ai/',
    ])
      expect(assess(input).verdict).toBe('caution');
  });
  it('handles localhost without IP panic', () => {
    expect(assess('http://localhost:3000').verdict).toBe('clear');
  });
  it('still blocks known threats when lookalike checks are disabled', () => {
    expect(assess('https://scam.example', false).verdict).toBe('danger');
    expect(assess('https://metamaks.io', false).verdict).toBe('clear');
  });
  it('normalizes dot and case before public suffix checks', () => {
    expect(assess('https://METAMASK.XYZ./').verdict).toBe('danger');
  });
  it('offers no safety guarantee in the clear verdict', () => {
    expect(assess('https://unknown-project.example').verdict).toBe('clear');
    expect(assess('https://unknown-project.example').source).toBeUndefined();
  });
});
describe('untrusted input', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/test',
    'chrome://extensions',
    '',
    'https://',
    'a'.repeat(9000),
  ])('rejects unsupported or malformed input', (input) => {
    expect(assess(input).verdict).toBe('unsupported');
  });
  it('accepts bare domains only for the explicit manual checker', () => {
    expect(parseWebUrl('example.org')).toBeNull();
    expect(assess('example.org', true, true).hostname).toBe('example.org');
  });
  it('accepts a bare hostname and port without treating it as a custom scheme', () => {
    expect(assess('example.org:8443/path', true, true).hostname).toBe('example.org');
    expect(assess('javascript:alert(1)', true, true).verdict).toBe('unsupported');
  });
  it('does not match superstrings or parents of blocklist entries', () => {
    expect(findListed('example', new Set(['sub.example']))).toBeUndefined();
  });
});
describe('page and link signals', () => {
  it('detects recovery phrase metadata without requiring field values', () => {
    expect(pageFindings({ recoveryFields: true, walletContext: false, title: '' })[0]?.code).toBe(
      'recovery-phrase',
    );
  });
  it('does not classify a wallet button or title alone as malicious', () => {
    expect(
      pageFindings({ recoveryFields: false, walletContext: true, title: 'MetaMask guide' }),
    ).toEqual([]);
  });
  it('deduplicates page findings', () => {
    const finding = pageFindings({ recoveryFields: true, walletContext: false, title: '' });
    const once = mergeFindings(assess('https://example.org'), finding);
    expect(mergeFindings(once, finding).findings).toHaveLength(1);
  });
  it.each([
    ['https://metamask.io', 'https://evil.org'],
    ['www.google.com', 'https://google.com.evil.org'],
    ['metamask.io', 'https://evil.org'],
  ])('recognizes deceptive displayed links', (label, target) => {
    expect(displayedLinkMismatch(label, target)).toBe(true);
  });
  it.each([
    ['Read about MetaMask', 'https://blog.example.org'],
    ['https://google.com', 'https://accounts.google.com'],
    ['https://example.org/', 'https://example.org/page'],
  ])('does not warn on normal descriptive or same-domain links', (label, target) => {
    expect(displayedLinkMismatch(label, target)).toBe(false);
  });
  it('recognizes transposed letters', () => {
    expect(editDistance('metamaks', 'metamask')).toBe(1);
  });
  it('recognizes Unicode characters that imitate a protected brand', () => {
    expect(assess('https://metamаsk.io').verdict).toBe('danger');
    expect(assess('https://cоinbase.com').verdict).toBe('danger');
  });
});
