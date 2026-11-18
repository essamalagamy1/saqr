// Saqr Edge Agent — API Client
const fetch = require('node-fetch');

class ApiClient {
  constructor(serverUrl, accessToken = null) {
    let clean = (serverUrl || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    this.serverUrl = clean;
    this.accessToken = accessToken;
  }

  get baseUrl() {
    let url = this.serverUrl.replace(/\/+$/, '');
    if (url.endsWith('/api/v1')) {
      return url;
    }
    return `${url}/api/v1`;
  }

  get headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.accessToken) {
      h['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return h;
  }

  async login(email, password) {
    let url = `${this.baseUrl}/auth/login`;
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(async (err) => {
      // If port 3000 failed or was unreachable, fallback to port 8080
      if (this.serverUrl.includes(':3000')) {
        const fallbackUrl = this.serverUrl.replace(':3000', ':8080');
        return fetch(`${fallbackUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
      }
      throw err;
    });

    if (res.status === 404 && this.serverUrl.includes(':3000')) {
      const fallbackUrl = this.serverUrl.replace(':3000', ':8080');
      res = await fetch(`${fallbackUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        this.serverUrl = fallbackUrl;
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || `Login failed (${res.status})`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || 'Login failed');
    }

    const token = data.data.tokens?.access_token || data.data.access_token;
    const refreshToken = data.data.tokens?.refresh_token || data.data.refresh_token;

    this.accessToken = token;
    return {
      accessToken: token,
      refreshToken: refreshToken,
      user: data.data.user,
      companyId: data.data.user?.company_id,
    };
  }

  async getCameras() {
    const res = await fetch(`${this.baseUrl}/cameras/`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Failed to fetch cameras (${res.status})`);
    const data = await res.json();
    return data.data || [];
  }

  async postDetection(detection) {
    const res = await fetch(`${this.baseUrl}/detections/ingest`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(detection),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Detection post failed (${res.status})`);
    }
    return await res.json();
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.serverUrl}/health`, { timeout: 5000 });
      return res.ok;
    } catch {
      try {
        const res = await fetch(`${this.baseUrl}/cameras/`, {
          headers: this.headers,
          timeout: 5000,
        });
        return res.ok;
      } catch {
        return false;
      }
    }
  }
}

module.exports = ApiClient;
