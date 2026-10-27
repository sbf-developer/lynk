import {
  defaultChoices,
  explanationCodes,
  parseChoices,
  type ExplanationChoice,
  type ExplanationEvidence,
} from './explanations';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface ModelSession {
  prompt(input: string, options: Record<string, unknown>): Promise<string>;
  destroy(): void;
}
export interface LocalModelApi {
  availability(options: Record<string, unknown>): Promise<Availability>;
  create(options: Record<string, unknown>): Promise<ModelSession>;
}
const MODEL_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};
export function browserModel(): LocalModelApi | undefined {
  return (globalThis as unknown as { LanguageModel?: LocalModelApi }).LanguageModel;
}
export async function modelAvailability(api = browserModel()): Promise<Availability> {
  if (!api || typeof api.availability !== 'function' || typeof api.create !== 'function')
    return 'unavailable';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      api.availability(MODEL_OPTIONS),
      new Promise<Availability>((resolve) => {
        timer = setTimeout(() => resolve('unavailable'), 4000);
      }),
    ]);
    return ['available', 'downloadable', 'downloading'].includes(status) ? status : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
export interface LocalAiResult {
  choices: ExplanationChoice[];
  mode: 'ai' | 'fallback';
}
export async function chooseLocalExplanations(
  evidence: ExplanationEvidence,
  options: {
    api?: LocalModelApi;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    downloadTimeoutMs?: number;
    inferenceTimeoutMs?: number;
  } = {},
): Promise<LocalAiResult> {
  const fallback: LocalAiResult = { choices: defaultChoices(evidence), mode: 'fallback' };
  const codes = explanationCodes(evidence);
  const api = options.api ?? browserModel();
  if (!api || !codes.length || options.signal?.aborted) return fallback;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let timer = setTimeout(cancel, options.downloadTimeoutMs ?? 180000);
  let session: ModelSession | undefined;
  try {
    // No awaited support check here: create() is called directly within the user's click activation.
    const creating = api.create({
      ...MODEL_OPTIONS,
      topK: 1,
      temperature: 0,
      signal: controller.signal,
      initialPrompts: [
        {
          role: 'system',
          content:
            'You select educational wording for a beginner. You are not a phishing detector. For each provided risk code, choose brief for direct facts or example for a useful everyday analogy. Return only the constrained JSON. Include every code exactly once. Do not generate explanations, verdicts, advice, URLs, or reasoning.',
        },
      ],
      monitor(monitor: EventTarget) {
        monitor.addEventListener('downloadprogress', (event) => {
          const loaded = (event as Event & { loaded?: number }).loaded;
          if (typeof loaded === 'number' && Number.isFinite(loaded))
            options.onProgress?.(Math.min(1, Math.max(0, loaded)));
        });
      },
    });
    // Destroy a late session even when an implementation does not respect cancellation.
    void creating.then(
      (late) => {
        if (controller.signal.aborted) {
          try {
            late.destroy();
          } catch {
            /* Already disposed. */
          }
        }
      },
      () => {},
    );
    session = await abortable(creating, controller.signal);
    clearTimeout(timer);
    timer = setTimeout(cancel, options.inferenceTimeoutMs ?? 15000);
    // Only closed, extension-owned code names enter the model. Never hostnames, URLs, DOM or secrets.
    const output = await abortable(
      session.prompt(
        JSON.stringify({ riskCodes: codes, audience: 'first-time browser wallet user' }),
        {
          signal: controller.signal,
          responseConstraint: {
            type: 'object',
            additionalProperties: false,
            required: ['choices'],
            properties: {
              choices: {
                type: 'array',
                minItems: codes.length,
                maxItems: codes.length,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['code', 'variant'],
                  properties: {
                    code: { type: 'string', enum: codes },
                    variant: { type: 'string', enum: ['brief', 'example'] },
                  },
                },
              },
            },
          },
        },
      ),
      controller.signal,
    );
    const choices = parseChoices(output, evidence);
    return choices ? { choices, mode: 'ai' } : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    try {
      session?.destroy();
    } catch {
      /* Chrome may already have destroyed an aborted session. */
    }
    controller.abort();
  }
}
