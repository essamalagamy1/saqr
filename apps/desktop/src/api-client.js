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

  async getBranches() {
    const res = await fetch(`${this.baseUrl}/branches/`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Failed to fetch branches (${res.status})`);
    const data = await res.json();
    return data.data || [];
  }

  async addCamera(camera) {
    let dvrIp = camera.dvrIp || '';
    let dvrChannel = camera.channel ? `CH${camera.channel}` : (camera.dvrChannel || 'CH1');
    const rtsp = camera.rtspUrl || camera.rtsp_url || '';

    const ipMatch = rtsp.match(/@?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
    if (ipMatch && !dvrIp) {
      dvrIp = ipMatch[1];
    }

    const chMatch = rtsp.match(/\/ch(\d+)\//i) || rtsp.match(/\/Streaming\/Channels\/(\d+)01/i) || rtsp.match(/\/(\d{1,2})01\b/i);
    if (chMatch) {
      dvrChannel = `CH${parseInt(chMatch[1], 10)}`;
    }

    const payload = {
      name: camera.name,
      branch_id: camera.branchId || camera.branch_id || '',
      rtsp_url: rtsp,
      dvr_ip: dvrIp,
      dvr_channel: dvrChannel,
      protocol: camera.protocol || 'rtsp',
      status: camera.enabled !== false ? 'active' : 'disconnected',
    };

    const res = await fetch(`${this.baseUrl}/cameras/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.message || `Failed to sync camera to server (${res.status})`);
    }

    const data = await res.json();
    return data.data;
  }

  async deleteCamera(id) {
    try {
      const res = await fetch(`${this.baseUrl}/cameras/${id}`, {
        method: 'DELETE',
        headers: this.headers,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async uploadCameraFrame(cameraId, cameraIp, cameraChannel, frameBuffer) {
    if (!frameBuffer || frameBuffer.length === 0) return;
    try {
      let cleanServer = this.serverUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
      if (cleanServer.includes(':8080')) {
        cleanServer = cleanServer.replace(':8080', ':3000');
      }
      const url = `${cleanServer}/api/cameras/stream`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-camera-id': cameraId || '',
          'x-camera-ip': cameraIp || '',
          'x-camera-channel': cameraChannel || 'CH1',
        },
        body: frameBuffer,
        timeout: 5000,
      });
    } catch {
      // Non-blocking upload
    }
  }

  /**
   * Upload a detection snapshot frame and return the hosted URL.
   * @param {string} snapshotId - unique ID for this detection snapshot
   * @param {Buffer} frameBuffer - raw JPEG bytes
   * @returns {Promise<string|null>} hosted snapshot URL or null on failure
   */
  async uploadSnapshot(snapshotId, frameBuffer) {
    if (!frameBuffer || frameBuffer.length < 500) return null;
    try {
      let cleanServer = this.serverUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
      if (cleanServer.includes(':8080')) {
        cleanServer = cleanServer.replace(':8080', ':3000');
      }
      const url = `${cleanServer}/api/cameras/snapshot`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-snapshot-id': snapshotId,
        },
        body: frameBuffer,
        timeout: 8000,
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.url || null;
    } catch {
      return null;
    }
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
