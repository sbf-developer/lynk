# Research and threat model

Researched 27–28 October 2026. Primary sources informed the choices below. This document describes the implementation’s actual boundaries, not a guarantee of protection.

## How phishing becomes a wallet drain

A common campaign clones a recognizable app, distributes a deceptive link, and asks the visitor to authorize spending or sign structured data. Visual similarity and HTTPS do not establish who operates the site. A token allowance can grant ongoing spending rights; a typed signature can authorize an action without an immediate gas-paying transaction. This makes a domain guard useful before interaction, but insufficient as a transaction verifier.

Sources: [MetaMask on token approvals and drainer flows](https://metamask.io/en-GB/news/what-are-token-approvals), [MetaMask basic security guidance](https://support.metamask.io/stay-safe/safety-in-web3/basic-safety-and-security-tips-for-metamask), and [the EIP-712 structured-signing standard](https://eips.ethereum.org/EIPS/eip-712).

## Defenses selected

1. **A real, attributable threat list.** MetaMask maintains reported Web3 phishing domains. Lynk pins one immutable revision and bundles normalized domains, provenance, checksum, and the original license. It does not invent malicious classifications. Blocklist membership is checked on label boundaries, including descendants.
2. **Browser-native interception.** Grouped `requestDomains` rules use redirect actions for top-level documents and block actions for embedded requests. This avoids depending on a constantly running worker. The warning page is packaged and web accessible, as Chrome requires for extension redirects. Grouping produces 440 rules for the initial 109,938-domain snapshot, well below static rule quotas.
3. **Separate uncertain signals.** Levenshtein distance with adjacent transpositions, selected ASCII/Unicode confusables, differing suffixes, and embedded brand domains provide explainable warnings. Public-suffix parsing includes private suffixes, so hosted tenants such as `metamask.github.io` do not inherit the identity of the host platform. Curated brand references and upstream fuzzy exemptions reduce noise. Internationalized domains alone receive caution, not a phishing claim.
4. **Protect secrets without collecting them.** Page code checks field metadata for recovery phrases and private keys. It never reads values or examines wallet accounts. Ordinary submission is interrupted until the warning is dismissed, but a malicious page’s custom code cannot be reliably stopped by this mechanism.
5. **Deceptive link text.** When a displayed web address and its actual link target have different registered domains, the click receives an explanation. Hover checks provide additional destination intelligence without navigating to the target.
6. **Local data, explicit overrides.** Durable history is optional and bounded. A continuation reads only a worker-owned tab assessment, never a query-string target. Overrides apply to an exact origin and tab; known third-party threats stay blocked.

Sources: [MetaMask list policy](https://github.com/MetaMask/eth-phishing-detect), [blocklist, allowlist and fuzzy-list distinctions](https://github.com/MetaMask/eth-phishing-detect/blob/main/doc/lists-ref.md), [Chrome declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [Chrome webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [tldts](https://github.com/remusao/tldts), and [Punycode.js](https://github.com/mathiasbynens/punycode.js).

## Why no wallet-provider monkey patch

Page-world hooks around `window.ethereum` can be replaced or bypassed by the page, interfere with multiple injected wallets, and create a misleading claim that transactions are being stopped. Supporting EIP-6963 discovery, legacy `send` variants, hardware flows, WalletConnect, and non-EVM wallets requires a separate, carefully reviewed integration. An isolated extension cannot inspect the protected UI of another wallet extension.

Lynk therefore does not claim transaction or signature interception. Transaction simulation belongs in a wallet-native integration or a separately specified system with explicit privacy choices. MetaMask’s own alerts analyze transaction and signature data using security providers; this is a different capability and may share data with those providers. See [MetaMask’s security-alert documentation](https://support.metamask.io/configure/wallet/security-alerts).

## Trust boundaries

| Boundary                 | Treatment                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page → content script    | DOM is untrusted. Dynamic text is inserted with `textContent`; no page HTML is evaluated. Warning UI uses a closed shadow root for style isolation. Hostile pages can still remove the host element. |
| Content script → worker  | Chrome-provided sender identity and URL are used. Privileged state changes require an exact packaged UI page URL. No external messaging surface is declared.                                         |
| Web page → warning page  | No continuation URL is accepted from a URL parameter or fragment. `frame-ancestors 'none'` prevents embedding the warning UI for clickjacking.                                                       |
| Worker → storage         | Local and session storage are restricted to trusted extension contexts. Ordinary page messages cannot toggle settings, erase history, or grant passes.                                               |
| Third-party feed → build | HTTPS fetch from an immutable revision, bounded domain count, hostname normalization, checksum, upstream license, committed snapshot for review. No downloaded executable code.                      |
| Runtime → network        | Local packaged JSON only. Native rules contain domain matches, not reputation-service URL uploads.                                                                                                   |

Sources: [Chrome content-script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome extension security guidance](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure).

## Known gaps and false positives

- List omissions, delays, stale releases, and incorrect upstream reports are possible. The UI exposes snapshot age. This version does not silently retrieve updates.
- Heuristic navigation checks use asynchronous navigation events; they cannot promise that no request, script, or tracking has run before the warning.
- URL heuristics are not exhaustive homograph detection. The confusable table is intentionally small and tested. Non-listed regional domains, similar legitimate brands, and unusual development environments can be flagged.
- A compromised real domain or a malicious contract behind an innocent-looking URL may pass every URL check.
- Recovery fields can be absent, mislabeled, hidden in inaccessible DOM, drawn on a canvas, or submitted programmatically. A page may remove or mimic the in-page warning. Trust the extension’s own popup and packaged warning page over content supplied by a site.
- Hover results are cached and bounded per document; links can change after inspection. Independent navigation checks continue to apply. Modified/context-menu/keyboard actions and script-driven navigation may bypass link-click warnings.
- No inspection of downloads, email inboxes, clipboard, DNS reputation, domain age, certificate ownership, site screenshots, on-chain contracts, or existing allowances.
- A pass permits the chosen top-level origin, including its paths, while the pass is active. Expired native session rules are cleaned by an alarm; browser scheduling can delay idle cleanup. Every subsequent observed navigation checks expiry and leaving the origin clears the pass.
- A direct manually opened warning page without a fresh recorded assessment has no continuation action.
- Chrome site-access restrictions, revoked host permissions, unsupported browsers, internal pages, and optional incognito settings affect coverage.

## Verification strategy

Pure tests exercise parsing, boundary matching, private suffixes, brand typos, Unicode, structural cues, bypassing fuzzy checks, and safe examples. Browser tests load the actual built MV3 extension, map every hostname to loopback, and verify a known listed domain cannot contact the fixture server before a warning. They also check pass scope and cleanup, recovery-field metadata, UI settings, local manual checks, and misleading link text.

The test suite is evidence for these paths, not a full security audit. Before a public consumer launch, obtain independent extension security review, a false-positive evaluation corpus, and a defined threat-feed release/update policy. Additional transaction-level protection requires a wallet-native design and testing scope.
