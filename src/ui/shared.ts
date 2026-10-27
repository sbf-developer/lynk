export async function request<T>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok)
    throw new Error(
      result?.error ?? 'Lynk could not complete this check. Please reload the extension.',
    );
  return result.data as T;
}
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}
export function text(id: string, value: string) {
  el(id).textContent = value;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
export function showError(error: unknown) {
  const node = el('error');
  node.hidden = false;
  node.textContent = errorMessage(error);
}
export function feedAge(date: string): string {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)) + ' days old';
}
export function timeAgo(at: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return mins < 1
    ? 'Just now'
    : mins < 60
      ? `${mins}m ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`;
}
