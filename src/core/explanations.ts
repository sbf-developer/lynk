import type { Assessment, Verdict } from './types';

// Both variants are reviewed product copy. A model may select a variant, never invent a claim.
export const EXPLANATIONS = {
  blocklist: {
    brief:
      'This address is on the phishing list packaged with Lynk. Avoid sharing money, passwords, or wallet secrets here.',
    example:
      'A familiar-looking shop can still have the wrong owner. This address has been reported in the threat list, so Lynk stops the visit.',
  },
  lookalike: {
    brief:
      'The address resembles a familiar brand but does not match its reference domain. Similar spelling is a reason to double-check who owns the site.',
    example:
      'Think of a shop with an almost identical sign on a different street. A copied name or one changed letter does not prove it belongs to the real business.',
  },
  credentials: {
    brief:
      'This address includes text before an @ sign. That text is not the destination; the real website comes after the @ sign.',
    example:
      'In an address such as familiar-name@other-site, your browser visits other-site. The familiar name at the front can distract you from the actual destination.',
  },
  http: {
    brief:
      'This connection uses HTTP, so information sent to the website is not encrypted. An encrypted HTTPS connection would still not prove who operates the site.',
    example:
      'HTTP is like sending a postcard that others on the route might read. HTTPS protects the envelope, but does not prove the recipient is honest.',
  },
  ip: {
    brief:
      'This link uses a numerical network address instead of a recognizable website name. That can be legitimate, but it is harder to recognize who operates it.',
    example:
      'A numerical address is like being given coordinates instead of a business name. The location might be genuine, but you still need to check who is there.',
  },
  idn: {
    brief:
      'This address uses international characters. These are common on legitimate websites, but some characters can resemble letters in another alphabet.',
    example:
      'Some letters from different alphabets look almost identical. That can make two different website names appear the same at a glance.',
  },
  'recovery-phrase': {
    brief:
      'The page has a field labeled for a recovery phrase or private key. Someone with that secret can control your wallet. Do not share it with an unfamiliar website.',
    example:
      'Your recovery phrase is a master key to the wallet, not a login code for a website. Giving it away can give someone control of your funds.',
  },
} as const;
export type ExplanationCode = keyof typeof EXPLANATIONS;
export type ExplanationVariant = 'brief' | 'example';
export interface ExplanationEvidence {
  hostname: string;
  domain: string;
  verdict: Verdict;
  findings: Pick<Assessment['findings'][number], 'code' | 'title' | 'detail'>[];
}
export interface ExplanationChoice {
  code: ExplanationCode;
  variant: ExplanationVariant;
}
export function evidenceFrom(assessment: Assessment): ExplanationEvidence {
  return {
    hostname: assessment.hostname,
    domain: assessment.domain,
    verdict: assessment.verdict,
    findings: assessment.findings.map(({ code, title, detail }) => ({ code, title, detail })),
  };
}
export function explanationCodes(evidence: ExplanationEvidence): ExplanationCode[] {
  return [...new Set(evidence.findings.map((f) => f.code))].filter(
    (code): code is ExplanationCode => Object.hasOwn(EXPLANATIONS, code),
  );
}
export function defaultChoices(evidence: ExplanationEvidence): ExplanationChoice[] {
  return explanationCodes(evidence).map((code) => ({ code, variant: 'brief' }));
}
export function parseChoices(
  raw: string,
  evidence: ExplanationEvidence,
): ExplanationChoice[] | null {
  if (raw.length > 2000) return null;
  try {
    const value = JSON.parse(raw);
    const codes = explanationCodes(evidence);
    if (
      !value ||
      Object.keys(value).length !== 1 ||
      !Array.isArray(value.choices) ||
      value.choices.length !== codes.length
    )
      return null;
    const choices = value.choices as ExplanationChoice[];
    if (
      choices.some(
        (c) =>
          !c ||
          Object.keys(c).length !== 2 ||
          !codes.includes(c.code) ||
          !['brief', 'example'].includes(c.variant),
      )
    )
      return null;
    if (new Set(choices.map((c) => c.code)).size !== codes.length) return null;
    // Preserve the detector's evidence order, regardless of the model's chosen order.
    return codes.map((code) => choices.find((c) => c.code === code)!);
  } catch {
    return null;
  }
}
export function nextStep(evidence: ExplanationEvidence): string {
  return evidence.verdict === 'danger'
    ? 'Leave this site and find the project through a source you already trust. Review every wallet request separately.'
    : evidence.verdict === 'caution'
      ? 'Verify the real address through a source you already trust before sharing sensitive information.'
      : 'A URL check cannot verify the website’s content, wallet requests, or contracts. Review those separately.';
}
