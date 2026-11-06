let csrf = '';
export async function partnerRequest<T = any>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/partners/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Unable to complete this request');
  if (result.csrf) csrf = result.csrf;
  return result;
}
