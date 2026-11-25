import { getValidToken, loginDefaultUser } from '@/lib/api';

export async function trainingFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = await getValidToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    token = await loginDefaultUser();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(endpoint, {
        ...options,
        headers,
      });
    }
  }

  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'حدث خطأ أثناء معالجة طلب التدريب');
  }
  return data as T;
}

export async function fetchAuthorizedImageUrl(url: string): Promise<string> {
  const token = await getValidToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return '';
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
