# Local model research and implementation decision

Researched 28 October 2026 using the primary sources below. Scope: an already-trained local model that an ordinary extension user can use without managing a server, while preserving lightweight automatic protection.

## Decision

Ship optional **Chrome built-in local-model explanation selection**, with complete non-AI explanations available to everyone. Do not use a general-purpose small LLM as a security verdict engine, and do not describe it as a validated phishing classifier.

This is a product/engineering judgment: the reviewed model cards and runtime documentation establish on-device capability, not measured protection against wallet-drainer phishing. We have no held-out security evaluation demonstrating better recall without unacceptable false positives. Fluent wording or a model’s claimed confidence would not supply that evidence.

## Options compared

| Option                                         | Integration and footprint                                                                                                                                                                       | Quality / deployment consideration                                                                                                                                    | Decision                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Chrome built-in foundation model / Gemini Nano | Browser supplies the pretrained model and API. No third-party inference library, weight files, local server, or new host permissions added to Lynk.                                             | Hardware, browser version, policy and storage can make it unavailable. Browser manages model versions and caching.                                                    | Selected for explicit, optional explanation requests.                                  |
| SmolLM2 135M Instruct                          | Small pretrained open model; a self-managed path would still need an inference runtime, model assets, caching, and lifecycle work.                                                              | Model card reports limited instruction-following performance; its authors caution against treating outputs as definitive. No phishing accuracy claim was established. | Too little evidence to entrust security decisions to it; no consumer download shipped. |
| SmolLM2 360M Instruct with WebLLM              | WebLLM’s q4f16 configuration estimates about 376 MB GPU memory; actual browser memory and download size are different quantities. Requires compatible GPU features and packaged runtime assets. | Larger than the smallest model, but still no demonstrated wallet-phishing evaluation for this application.                                                            | Candidate for future measured experiments, not a default browser workload.             |
| Qwen3 0.6B with WebLLM                         | WebLLM’s q4f16 configuration estimates about 1,403 MB GPU memory at its configured context. A self-managed download adds storage, startup and GPU cost.                                         | It is a general instruction/reasoning model; that does not establish domain-security reliability. More operational cost for ordinary users.                           | Not added to the extension.                                                            |
| Local desktop model server                     | Can run larger models with user-managed runtimes.                                                                                                                                               | Separate installation, server availability, local-network API and permission concerns make it a poor default for nontechnical users.                                  | Out of scope for the consumer flow.                                                    |

Sources: [SmolLM2 135M model card](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct), [SmolLM2 360M model card](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct), [Qwen3 0.6B model card](https://huggingface.co/Qwen/Qwen3-0.6B), [WebLLM runtime configurations and memory estimates](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts), [WebLLM basic usage](https://webllm.mlc.ai/docs/user/basic_usage.html). Memory estimates are runtime configuration estimates, not our measurements, latency benchmarks, or weight download sizes.

## Why the browser-native route is conditional

Chrome documents Prompt API support in extensions from Chrome 138. Its model API provides availability checks, explicit creation, progress events, structured output, cancellation, and session disposal. It currently runs in document contexts rather than web workers, so Lynk uses a dedicated explanation page instead of a service worker or a short-lived popup. The browser controls model delivery/version; Lynk cannot pin those weights. Source: [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api).

At research time, Google lists 22 GB free profile-volume storage plus either an eligible GPU with more than 4 GB VRAM or a CPU configuration with at least 16 GB RAM and four cores. Eligibility and policy vary. The model itself is smaller than that disk prerequisite. The feature therefore cannot be a requirement for basic protection. See [Chrome’s current requirements and model lifecycle](https://developer.chrome.com/docs/ai/get-started).

Self-managed WebLLM/ONNX deployment is possible, but is not just adding a small JavaScript package. Runtime code/WASM must be packaged in a way compatible with Manifest V3, assets need integrity/versioning and licenses, and downloading/caching must be explicit. See [Chrome’s remote-hosted-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).

## Implemented boundary

1. Existing deterministic checks produce the verdict and findings exactly as before.
2. A private explanation page gets a bounded, short-lived record through trusted extension messaging. Paths, queries and fragments are stripped; only a random record ID appears in its URL.
3. Reviewed explanations and a fixed next step appear immediately without a model.
4. Availability probing never calls `create()`. On-demand creation runs in the user’s click activation. Downloadable/downloading states require explicit checkbox consent. Progress, cancel, three-minute preparation timeout and 15-second inference timeout are provided.
5. The prompt contains only whitelisted risk-code names and a fixed audience label. No webpage text, domain strings, addresses, keys or typed values are included, avoiding page-content prompt injection in this path.
6. The model selects `brief` or `example` for each existing code, using structured output. Runtime validation requires all existing known codes exactly once, no extra fields, valid variants, and bounded output. Detector order is restored.
7. The UI displays the selected **reviewed text**, never free-form model output. A model cannot create facts, give additional financial/security advice, change a verdict, hide a detected finding, disable protection or grant a pass. Original evidence and the fixed next step remain visible.
8. Errors, refusals, malformed output, timeouts and cancellation preserve the non-AI explanation. Every session is destroyed, including sessions arriving after cancellation. Chrome may separately retain its shared model/cache.

This intentionally limits the model’s benefit to presentation. The security capability is unchanged. Calling this “AI phishing detection” or presenting a purported thinking trace would be misleading. Users see observed signals and helpful explanations, not private model reasoning.

## Verification and limits

- A real installed Chrome capability probe exposed `LanguageModel` but returned `unavailable` for the requested English text configuration. This is a measured availability result, not an inference benchmark. The development device also had far less free storage than Chrome’s published requirement, but the API does not identify the sole cause of unavailability.
- Unit tests cover selection validation, omission/duplication, injection isolation, no-create support probes, timeout/cancel fallback, and late-session disposal.
- Browser tests use a controlled `LanguageModel` substitute for ready/downloadable/unavailable/error responses. They test the real extension UI, consent, unchanged warnings, and cleanup. They do **not** measure Gemini Nano accuracy, speed, memory, download size, or real-model inference quality.
- No new production dependency or permission is added. The API is invoked only on the explanation page after an explicit click.
- Before expanding into page classification, use a held-out, deduplicated phishing/benign dataset, a fixed false-positive budget, prompt-injection cases, real low-end device benchmarks and independent security review. No such capability is claimed in this release.
