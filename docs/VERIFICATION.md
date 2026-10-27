# Verification

Verified locally on 28 October 2026 with Node.js 22.13.1, Windows, and a Playwright Chromium executable. The exact browser version can differ from the browser downloaded in CI.

- Strict TypeScript: passed.
- Threat-engine and local-AI boundary unit suites: 70 tests passed.
- Actual MV3 extension browser suite: 14 tests passed.
- Production build: 109,938 pinned reported domains, 440 grouped native rules.
- `npm audit`: zero known vulnerabilities, including development tools, at verification time.
- Popup, warning page, and settings screenshots inspected visually.

Browser tests send all requested hostnames to a local loopback fixture. No live phishing infrastructure is visited. One test checks that a listed main-frame request never arrives at the fixture server. Other tests check tab-scoped continuation and cleanup, new lookalikes, local URL checking, settings, recovery metadata without value transmission, deceptive link text, privileged-message rejection from a content-script world, and blocking known malicious subresources.

The AI tests use a controlled API substitute for selection, unavailable devices, explicit download consent, invalid output, cancellation and timeouts. A real installed Chrome probe exposed the built-in API and reported `unavailable`. No real-model inference accuracy, speed or memory benchmark was possible here. The feature remains an optional preview; it changes presentation only. See [the local-model research](LOCAL_AI_RESEARCH.md).

The local v0.2.0 ZIP was approximately 2.70 MB, about 8 kB larger than v0.1.0 in this build, with no new production dependency or permission. These are compressed artifact sizes, not installed memory usage or Chrome model download sizes.

The final v0.2.1 clean package is approximately 1.51 MB. The size reduction comes from excluding Chrome-generated compiled rule caches found in the earlier local build directory. It still contains all 109,938 source threat domains and 440 rules. Builds now start from a verified project-local output directory, and packaging explicitly excludes Chrome’s reserved `_metadata` directory.

The final v0.2.1 review also verified lookalike checks after server redirects, whole-label hostname comparisons, left/middle-click protection, paused-link behavior, and clearing disabled wallet findings. The interface uses system fonts, a vector logo rendered at every toolbar size, stronger text contrast and distinct paused/risk glyphs. Screenshots of the popup, warning, settings and explanation pages were inspected.

CI repeats formatting, type checking, unit tests, the production build, and extension browser tests on Linux, then creates a packaged extension ZIP. Results are available in the repository’s Actions tab. Passing tests demonstrate the tested paths; this is not an independent security audit.
