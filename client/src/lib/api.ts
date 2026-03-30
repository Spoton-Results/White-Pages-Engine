async function request<T>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: any) => request<T>("POST", url, body),
  patch: <T>(url: string, body: any) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: any) => request<T>("PUT", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
};
