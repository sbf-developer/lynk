# Verification

Verified locally on 28 October 2026 with Node.js 22.13.1, Windows, and a Playwright Chromium executable. The exact browser version can differ from the browser downloaded in CI.

- Strict TypeScript: passed.
- Threat-engine unit suite: 48 tests passed.
- Actual MV3 extension browser suite: 7 tests passed.
- Production build: 109,938 pinned reported domains, 440 grouped native rules.
- `npm audit`: zero known vulnerabilities, including development tools, at verification time.
- Popup, warning page, and settings screenshots inspected visually.

Browser tests send all requested hostnames to a local loopback fixture. No live phishing infrastructure is visited. One test checks that a listed main-frame request never arrives at the fixture server. Other tests check tab-scoped continuation and cleanup, new lookalikes, local URL checking, settings, recovery metadata without value transmission, deceptive link text, privileged-message rejection from a content-script world, and blocking known malicious subresources.

CI repeats type checking, unit tests, the production build, and extension browser tests on Linux, then creates a packaged extension ZIP. Results are available in the repository’s Actions tab. Passing tests demonstrate the tested paths; this is not an independent security audit.
