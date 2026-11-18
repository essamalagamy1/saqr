const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

export async function loginDefaultUser(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'fitforless@rased.com',
        password: 'password123',
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const token = json.data?.tokens?.access_token;
      if (token && typeof window !== 'undefined') {
        localStorage.setItem('rased_token', token);
        if (json.data?.user) {
          localStorage.setItem('rased_user', JSON.stringify(json.data.user));
          localStorage.setItem('rased_company_id', json.data.user.company_id);
        }
      }
      return token || '';
    }
  } catch (err) {
    console.error('Failed to auto-login default user:', err);
  }
  return '';
}

export async function getValidToken(): Promise<string> {
  if (typeof window === 'undefined') return '';
  let token = localStorage.getItem('rased_token');
  if (!token || token.length < 20 || token === 'mock_jwt_token_for_demo') {
    token = await loginDefaultUser();
  }
  return token || '';
}

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = await getValidToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // If unauthorized (token expired or invalid), auto-login and retry once
  if (res.status === 401 && typeof window !== 'undefined') {
    token = await loginDefaultUser();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });
    }
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'حدث خطأ أثناء معالجة الطلب');
  }

  return data.data;
}

export const api = {
  get: <T>(endpoint: string) => fetchApi<T>(endpoint, { method: 'GET' }),
  post: <T>(endpoint: string, body: any) =>
    fetchApi<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: any) =>
    fetchApi<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body?: any) =>
    fetchApi<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(endpoint: string) => fetchApi<T>(endpoint, { method: 'DELETE' }),
};
