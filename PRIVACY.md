# Lynk privacy

Lynk 0.1.0 processes browsing checks locally. It has no developer-operated server and sends no browsing data, analytics, wallet information, or field values to third parties.

- **Permanent local data:** settings and, when enabled, up to 50 warning hostnames, reason labels, and timestamps. No paths, queries, or fragments appear in warning history.
- **Session data:** current per-tab assessment, including the full URL needed to explain and reopen a warning, plus temporary override origin and expiry. Restricted to trusted extension contexts. Cleared on browser-session end; closed tabs and navigation to non-web pages also remove their state. Warning pages retain their blocked destination until you leave them.
- **Page inspection:** input/textarea labels, IDs, names, placeholders and ARIA labels; anchor destinations and visible link text. Typed field values are never accessed by Lynk. No wallet provider is hooked or queried.
- **Network activity:** the running extension fetches its own packaged files only. Feed refresh is a developer build task that contacts GitHub. Clicking external documentation/reference links opens those websites normally, under their privacy policies.

Clear warning history in settings. Turning history off also deletes existing entries. Uninstalling removes Chrome-managed extension storage. Browser protection can be paused; this does not delete preferences. No data is synced to a developer service. Your browser may manage its own browsing history independently of this extension.

This implementation does not sell, transmit, or use browsing information for advertising. Report issues through the project repository without posting recovery phrases, private keys, sensitive URLs, or account credentials.
