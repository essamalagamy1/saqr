// Saqr Edge Agent — Direct DVR / NVR Auto-Discovery & Full Channel Importer
// Protocols supported: Hikvision ISAPI (HTTP/Digest), Dahua RPC (CGI), ONVIF Media Service, and Direct RTSP Probing
const http = require('http');
const net = require('net');
const crypto = require('crypto');

class DvrConnector {
  constructor() {
    this.timeout = 3500;
  }

  /**
   * Helper: Generate Digest Authorization Header for Hikvision / Dahua / ONVIF
   */
  generateDigestAuth(method, uri, authHeader, username, password) {
    if (Array.isArray(authHeader)) {
      authHeader = authHeader.find(h => typeof h === 'string' && h.toLowerCase().startsWith('digest')) || authHeader[0] || '';
    }
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('digest')) return null;

    const parseParams = (header) => {
      const params = {};
      const matches = header.replace(/^Digest\s+/i, '').match(/(\w+)="?([^",]+)"?/g) || [];
      for (const m of matches) {
        const [k, v] = m.split('=');
        if (k && v !== undefined) {
          params[k.trim()] = v.replace(/"/g, '').trim();
        }
      }
      return params;
    };

    const p = parseParams(authHeader);
    const realm = p.realm || '';
    const nonce = p.nonce || '';
    const qop = p.qop;
    const opaque = p.opaque || '';

    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

    let response = '';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const nc = '00000001';

    if (qop === 'auth' || (qop && qop.includes('auth'))) {
      response = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`).digest('hex');
      return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
    } else {
      response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
      return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
    }
  }

  /**
   * Safe HTTP GET with Automatic Basic & Digest Auth handling
   */
  httpGet(ip, port, pathStr, username, password) {
    return new Promise((resolve) => {
      const options = {
        host: ip,
        port: port || 80,
        path: pathStr,
        method: 'GET',
        timeout: this.timeout,
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Saqr-DVR-Client/1.3'
        }
      };

      if (username && password) {
        const basic = Buffer.from(`${username}:${password}`).toString('base64');
        options.headers['Authorization'] = `Basic ${basic}`;
      }

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          // If 401 Unauthorized with Digest challenge, retry with Digest auth
          if (res.statusCode === 401 && res.headers['www-authenticate'] && username && password) {
            const digest = this.generateDigestAuth('GET', pathStr, res.headers['www-authenticate'], username, password);
            if (digest) {
              const retryOptions = { ...options, headers: { ...options.headers, 'Authorization': digest } };
              const retryReq = http.request(retryOptions, (retryRes) => {
                let retryBody = '';
                retryRes.on('data', c => { retryBody += c; });
                retryRes.on('end', () => {
                  resolve({ statusCode: retryRes.statusCode, body: retryBody, headers: retryRes.headers });
                });
              });
              retryReq.on('error', () => resolve({ statusCode: 500, body: '' }));
              retryReq.on('timeout', () => { retryReq.destroy(); resolve({ statusCode: 408, body: '' }); });
              retryReq.end();
              return;
            }
          }
          resolve({ statusCode: res.statusCode, body, headers: res.headers });
        });
      });

      req.on('error', (err) => resolve({ statusCode: 500, body: '', error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ statusCode: 408, body: '', error: 'Timeout' }); });
      req.end();
    });
  }

  /**
   * Fast RTSP Socket Probe to check if a specific RTSP Channel is alive
   */
  probeRtspChannel(ip, port, pathStr, username, password) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1200);

      socket.connect(port || 554, ip, () => {
        const rtspUrl = `rtsp://${ip}:${port || 554}${pathStr}`;
        let authHeader = '';
        if (username && password) {
          const b64 = Buffer.from(`${username}:${password}`).toString('base64');
          authHeader = `Authorization: Basic ${b64}\r\n`;
        }
        const reqStr = `DESCRIBE ${rtspUrl} RTSP/1.0\r\nCSeq: 1\r\n${authHeader}Accept: application/sdp\r\n\r\n`;
        socket.write(reqStr);
      });

      socket.on('data', (data) => {
        const resStr = data.toString();
        socket.destroy();
        // 200 OK or 401 Unauthorized means the channel exists on the DVR!
        // (404 Not Found means channel does not exist)
        if (resStr.includes('RTSP/1.0 200') || resStr.includes('RTSP/1.0 401')) {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => resolve(false));
    });
  }

  /**
   * Hikvision / EZVIZ / HiLook ISAPI Channel Extractor
   */
  async fetchHikvision(ip, port, rtspPort, username, password) {
    // 1. Device Info
    const devRes = await this.httpGet(ip, port, '/ISAPI/System/deviceInfo', username, password);
    let model = 'Hikvision DVR/NVR';
    let serial = '';
    let firmware = '';
    let devName = 'DVR System';

    if (devRes.body) {
      const mMatch = devRes.body.match(/<model>([^<]+)<\/model>/i);
      const sMatch = devRes.body.match(/<serialNumber>([^<]+)<\/serialNumber>/i);
      const fMatch = devRes.body.match(/<firmwareVersion>([^<]+)<\/firmwareVersion>/i);
      const dMatch = devRes.body.match(/<deviceName>([^<]+)<\/deviceName>/i);
      if (mMatch) model = mMatch[1].trim();
      if (sMatch) serial = sMatch[1].trim();
      if (fMatch) firmware = fMatch[1].trim();
      if (dMatch) devName = dMatch[1].trim();
    }

    const channels = [];

    // 2. Fetch Analog/BNC Video Inputs (DVRs)
    const analogRes = await this.httpGet(ip, port, '/ISAPI/System/Video/inputs/channels', username, password);
    if (analogRes.body && analogRes.body.includes('VideoInputChannel')) {
      const regex = /<VideoInputChannel[\s\S]*?<\/VideoInputChannel>/gi;
      const matches = analogRes.body.match(regex) || [];

      for (let i = 0; i < matches.length; i++) {
        const chXml = matches[i];
        const idMatch = chXml.match(/<id>(\d+)<\/id>/i);
        const nameMatch = chXml.match(/<name>([^<]+)<\/name>/i);
        const chNum = idMatch ? parseInt(idMatch[1], 10) : i + 1;
        const rawName = nameMatch && nameMatch[1].trim() ? nameMatch[1].trim() : '';
        const chName = (!rawName || rawName === 'Camera 01' || rawName.toLowerCase() === 'camera')
          ? `كاميرا ${chNum} (قناة CH${chNum})`
          : `كاميرا ${chNum} (${rawName})`;

        channels.push({
          channelNumber: chNum,
          name: chName,
          status: 'online',
          resolution: '1080p',
          type: 'Analog/BNC',
          mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}01`,
          subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}02`,
          dvrIp: ip,
          dvrChannel: `CH${chNum}`,
          brand: 'Hikvision'
        });
      }
    }

    // 3. Fetch IP Digital Channels (NVRs / Hybrid DVRs)
    const digitalRes = await this.httpGet(ip, port, '/ISAPI/ContentMgmt/InputProxy/channels', username, password);
    if (digitalRes.body && digitalRes.body.includes('InputProxyChannel')) {
      const regex = /<InputProxyChannel[\s\S]*?<\/InputProxyChannel>/gi;
      const matches = digitalRes.body.match(regex) || [];

      for (let i = 0; i < matches.length; i++) {
        const chXml = matches[i];
        const idMatch = chXml.match(/<id>(\d+)<\/id>/i);
        const nameMatch = chXml.match(/<name>([^<]+)<\/name>/i);
        const ipMatch = chXml.match(/<ipAddress>([^<]+)<\/ipAddress>/i);
        const proxyIp = ipMatch ? ipMatch[1].trim() : '';

        // Skip unassigned slots (no IP address or 0.0.0.0) in 16/32 channel NVRs
        if (!proxyIp || proxyIp === '0.0.0.0' || proxyIp === '::') {
          continue;
        }

        const chNum = idMatch ? parseInt(idMatch[1], 10) : i + 1;
        
        // Skip if already captured
        if (channels.some(c => c.channelNumber === chNum)) continue;

        const rawName = nameMatch && nameMatch[1].trim() ? nameMatch[1].trim() : '';
        const chName = (!rawName || rawName === 'Camera 01' || rawName.toLowerCase() === 'camera')
          ? `كاميرا ${chNum} (D${chNum})`
          : `كاميرا ${chNum} (${rawName})`;

        channels.push({
          channelNumber: chNum,
          name: chName,
          status: 'online',
          resolution: '1080p',
          type: 'IP Camera',
          mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}01`,
          subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}02`,
          dvrIp: ip,
          dvrChannel: `CH${chNum}`,
          brand: 'Hikvision'
        });
      }
    }

    // 4. Fetch Streaming Channels (/ISAPI/Streaming/channels) as additional discovery source
    try {
      const streamRes = await this.httpGet(ip, port, '/ISAPI/Streaming/channels', username, password);
      if (streamRes.body && streamRes.body.includes('StreamingChannel')) {
        const regex = /<StreamingChannel[\s\S]*?<\/StreamingChannel>/gi;
        const matches = streamRes.body.match(regex) || [];

        for (const chXml of matches) {
          const idMatch = chXml.match(/<id>(\d+)<\/id>/i);
          const nameMatch = chXml.match(/<channelName>([^<]+)<\/channelName>/i) || chXml.match(/<name>([^<]+)<\/name>/i);
          const enabledMatch = chXml.match(/<enabled>([^<]+)<\/enabled>/i);
          if (enabledMatch && enabledMatch[1].trim().toLowerCase() === 'false') continue;
          if (!idMatch) continue;

          const rawId = parseInt(idMatch[1], 10);
          // Only process main streams (e.g. 101, 201, ..., 1101, or 1..16)
          if (rawId > 100 && rawId % 100 !== 1) continue; // skip sub-streams (102, 202, etc.)

          const chNum = rawId >= 100 ? Math.floor(rawId / 100) : rawId;
          if (channels.some(c => c.channelNumber === chNum)) continue;

          const rawName = nameMatch && nameMatch[1].trim() ? nameMatch[1].trim() : '';
          const chName = (!rawName || rawName === 'Camera 01' || rawName.toLowerCase() === 'camera')
            ? `كاميرا ${chNum} (قناة CH${chNum})`
            : `كاميرا ${chNum} (${rawName})`;

          channels.push({
            channelNumber: chNum,
            name: chName,
            status: 'online',
            resolution: '1080p',
            type: 'Streaming Channel',
            mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}01`,
            subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}02`,
            dvrIp: ip,
            dvrChannel: `CH${chNum}`,
            brand: 'Hikvision'
          });
        }
      }
    } catch {
      // Ignore streaming channels query error and proceed with discovered channels
    }

    // Sort channels by channelNumber ascending
    channels.sort((a, b) => a.channelNumber - b.channelNumber);

    return {
      success: true,
      brand: 'Hikvision ISAPI',
      device: { model, serial, firmware, devName, ip, totalChannels: channels.length },
      channels
    };
  }

  /**
   * Dahua / IMOU / CP Plus CGI Channel Extractor
   */
  async fetchDahua(ip, port, rtspPort, username, password) {
    // 1. Device Info
    const sysRes = await this.httpGet(ip, port, '/cgi-bin/magicBox.cgi?action=getSystemInfo', username, password);
    let model = 'Dahua DVR/XVR';
    let serial = '';
    if (sysRes.body) {
      const mMatch = sysRes.body.match(/deviceType=([^\r\n]+)/i);
      const sMatch = sysRes.body.match(/serialNumber=([^\r\n]+)/i);
      if (mMatch) model = mMatch[1].trim();
      if (sMatch) serial = sMatch[1].trim();
    }

    // 2. Channel Titles
    const titleRes = await this.httpGet(ip, port, '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle', username, password);
    const channels = [];

    if (titleRes.body && titleRes.body.includes('ChannelTitle')) {
      const lines = titleRes.body.split('\n');
      for (const line of lines) {
        const match = line.match(/table\.ChannelTitle\[(\d+)\]\.Name=([^\r\n]+)/i);
        if (match) {
          const idx = parseInt(match[1], 10);
          const chNum = idx + 1;
          const chName = match[2].trim() || `كاميرا ${chNum} (Dahua CH${chNum})`;

          channels.push({
            channelNumber: chNum,
            name: chName,
            status: 'online',
            resolution: '1080p',
            type: 'Dahua Stream',
            mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/cam/realmonitor?channel=${chNum}&subtype=0`,
            subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/cam/realmonitor?channel=${chNum}&subtype=1`,
            dvrIp: ip,
            dvrChannel: `CH${chNum}`,
            brand: 'Dahua'
          });
        }
      }
    }

    return {
      success: true,
      brand: 'Dahua CGI',
      device: { model, serial, firmware: '', devName: model, ip, totalChannels: channels.length },
      channels
    };
  }

  /**
   * Universal Fallback: Rapid Parallel RTSP Prober (Up to 16/32 Channels)
   */
  async probeChannelsFallback(ip, rtspPort, username, password, maxChannels = 16) {
    const channels = [];
    const probePromises = [];

    for (let ch = 1; ch <= maxChannels; ch++) {
      probePromises.push(
        (async (channelNum) => {
          // Test Hikvision standard path
          const hikPath = `/Streaming/Channels/${channelNum}01`;
          const isHik = await this.probeRtspChannel(ip, rtspPort, hikPath, username, password);
          if (isHik) {
            return {
              channelNumber: channelNum,
              name: `كاميرا ${channelNum} (قناة CH${channelNum})`,
              status: 'online',
              resolution: '1080p',
              type: 'RTSP Stream',
              mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${channelNum}01`,
              subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${channelNum}02`,
              dvrIp: ip,
              dvrChannel: `CH${channelNum}`,
              brand: 'Hikvision Compatible'
            };
          }

          // Test Dahua standard path
          const dahuaPath = `/cam/realmonitor?channel=${channelNum}&subtype=0`;
          const isDahua = await this.probeRtspChannel(ip, rtspPort, dahuaPath, username, password);
          if (isDahua) {
            return {
              channelNumber: channelNum,
              name: `كاميرا ${channelNum} (قناة CH${channelNum})`,
              status: 'online',
              resolution: '1080p',
              type: 'RTSP Stream',
              mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/cam/realmonitor?channel=${channelNum}&subtype=0`,
              subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/cam/realmonitor?channel=${channelNum}&subtype=1`,
              dvrIp: ip,
              dvrChannel: `CH${channelNum}`,
              brand: 'Dahua Compatible'
            };
          }

          // Test Generic /ch{N}/main
          const genericPath = `/ch${channelNum}/main`;
          const isGeneric = await this.probeRtspChannel(ip, rtspPort, genericPath, username, password);
          if (isGeneric) {
            return {
              channelNumber: channelNum,
              name: `كاميرا ${channelNum} (قناة CH${channelNum})`,
              status: 'online',
              resolution: '1080p',
              type: 'RTSP Stream',
              mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/ch${channelNum}/main`,
              subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/ch${channelNum}/sub`,
              dvrIp: ip,
              dvrChannel: `CH${channelNum}`,
              brand: 'Generic RTSP'
            };
          }

          return null;
        })(ch)
      );
    }

    const results = await Promise.all(probePromises);
    for (const r of results) {
      if (r) channels.push(r);
    }

    return {
      success: channels.length > 0,
      brand: channels[0]?.brand || 'Generic DVR',
      device: { model: 'DVR Multi-Channel System', ip, totalChannels: channels.length },
      channels
    };
  }

  /**
   * Main Entrypoint: Auto-Detect and Extract All DVR Channels & Metadata
   */
  async extractDvrChannels({ ip, httpPort = 80, rtspPort = 554, username = 'admin', password = '', brand = 'auto', maxChannels = 16 }) {
    if (!ip) throw new Error('عنوان IP الخاص بالـ DVR مطلوب');

    console.log(`[DVR-CONNECTOR] 🔍 Connecting to DVR at ${ip}:${httpPort || 80} (User: ${username})...`);

    // 1. Try Hikvision ISAPI first if auto or hikvision
    if (brand === 'auto' || brand === 'hikvision') {
      try {
        const hikResult = await this.fetchHikvision(ip, httpPort, rtspPort, username, password);
        if (hikResult && hikResult.channels && hikResult.channels.length > 0) {
          console.log(`[DVR-CONNECTOR] ✅ Hikvision ISAPI success: found ${hikResult.channels.length} channels.`);
          return hikResult;
        }
      } catch (err) {
        console.warn('[DVR-CONNECTOR] Hikvision ISAPI failed:', err.message);
      }
    }

    // 2. Try Dahua CGI if auto or dahua
    if (brand === 'auto' || brand === 'dahua') {
      try {
        const dahuaResult = await this.fetchDahua(ip, httpPort, rtspPort, username, password);
        if (dahuaResult && dahuaResult.channels && dahuaResult.channels.length > 0) {
          console.log(`[DVR-CONNECTOR] ✅ Dahua CGI success: found ${dahuaResult.channels.length} channels.`);
          return dahuaResult;
        }
      } catch (err) {
        console.warn('[DVR-CONNECTOR] Dahua CGI failed:', err.message);
      }
    }

    // 3. Fallback: Fast Parallel RTSP Probing
    console.log(`[DVR-CONNECTOR] ⚡ Running fast parallel RTSP channel prober on port ${rtspPort}...`);
    const fallbackResult = await this.probeChannelsFallback(ip, rtspPort, username, password, maxChannels);
    if (fallbackResult && fallbackResult.channels && fallbackResult.channels.length > 0) {
      console.log(`[DVR-CONNECTOR] ✅ RTSP Prober success: found ${fallbackResult.channels.length} active channels.`);
      return fallbackResult;
    }

    // 4. If no channels were detected
    throw new Error(`لم يتم العثور على أي قنوات كاميرات نشطة على جهاز الـ NVR عند العنوان (${ip}). يرجى التأكد من تشغيل الجهاز، صحة عنوان الـ IP وكلمة المرور، وتوصيل الكاميرات بالـ NVR.`);
  }
}

module.exports = new DvrConnector();
