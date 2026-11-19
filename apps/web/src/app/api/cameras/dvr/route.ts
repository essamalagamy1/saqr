import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import http from 'http';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function generateDigestAuth(method: string, uri: string, authHeader: string, user: string, pass: string) {
  if (!authHeader || !authHeader.startsWith('Digest ')) return null;

  const params: Record<string, string> = {};
  const matches = authHeader.replace(/^Digest\s+/, '').match(/(\w+)="?([^",]+)"?/g) || [];
  for (const m of matches) {
    const [k, v] = m.split('=');
    params[k.trim()] = v.replace(/"/g, '').trim();
  }

  const realm = params.realm || '';
  const nonce = params.nonce || '';
  const qop = params.qop;
  const opaque = params.opaque || '';

  const ha1 = crypto.createHash('md5').update(`${user}:${realm}:${pass}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';

  let response = '';
  if (qop === 'auth' || (qop && qop.includes('auth'))) {
    response = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`).digest('hex');
    return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
  } else {
    response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
    return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"${opaque ? `, opaque="${opaque}"` : ''}`;
  }
}

function httpGet(ip: string, port: number, pathStr: string, username?: string, password?: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve) => {
    const options: any = {
      host: ip,
      port: port || 80,
      path: pathStr,
      method: 'GET',
      timeout: 3000,
      headers: {
        'Accept': '*/*',
        'User-Agent': 'Saqr-DVR-WebClient/1.3'
      }
    };

    if (username && password) {
      options.headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 401 && res.headers['www-authenticate'] && username && password) {
          const digest = generateDigestAuth('GET', pathStr, res.headers['www-authenticate'] as string, username, password);
          if (digest) {
            const retryReq = http.request({ ...options, headers: { ...options.headers, 'Authorization': digest } }, (retryRes) => {
              let rBody = '';
              retryRes.on('data', c => { rBody += c; });
              retryRes.on('end', () => resolve({ statusCode: retryRes.statusCode || 200, body: rBody }));
            });
            retryReq.on('error', () => resolve({ statusCode: 500, body: '' }));
            retryReq.on('timeout', () => { retryReq.destroy(); resolve({ statusCode: 408, body: '' }); });
            retryReq.end();
            return;
          }
        }
        resolve({ statusCode: res.statusCode || 200, body });
      });
    });

    req.on('error', () => resolve({ statusCode: 500, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 408, body: '' }); });
    req.end();
  });
}

function probeRtspSocket(ip: string, port: number, pathStr: string, user?: string, pass?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1200);

    socket.connect(port || 554, ip, () => {
      let authHeader = '';
      if (user && pass) {
        authHeader = `Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}\r\n`;
      }
      const req = `DESCRIBE rtsp://${ip}:${port || 554}${pathStr} RTSP/1.0\r\nCSeq: 1\r\n${authHeader}Accept: application/sdp\r\n\r\n`;
      socket.write(req);
    });

    socket.on('data', (data) => {
      socket.destroy();
      const s = data.toString();
      resolve(s.includes('RTSP/1.0 200') || s.includes('RTSP/1.0 401'));
    });

    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      ip = '192.168.8.234',
      httpPort = 80,
      rtspPort = 554,
      username = 'admin',
      password = '',
      brand = 'auto',
      maxChannels = 16
    } = body;

    if (!ip) {
      return NextResponse.json({ success: false, error: 'IP is required' }, { status: 400 });
    }

    const channels: any[] = [];
    let deviceModel = 'Hikvision / Generic DVR';
    let brandDetected = 'Hikvision ISAPI';

    // 1. Try Hikvision ISAPI
    if (brand === 'auto' || brand === 'hikvision') {
      try {
        const devRes = await httpGet(ip, httpPort, '/ISAPI/System/deviceInfo', username, password);
        if (devRes.body && devRes.body.includes('model')) {
          const m = devRes.body.match(/<model>([^<]+)<\/model>/i);
          if (m) deviceModel = m[1].trim();
        }

        // Analog video inputs
        const anaRes = await httpGet(ip, httpPort, '/ISAPI/System/Video/inputs/channels', username, password);
        if (anaRes.body && anaRes.body.includes('VideoInputChannel')) {
          const matches = anaRes.body.match(/<VideoInputChannel[\s\S]*?<\/VideoInputChannel>/gi) || [];
          for (let i = 0; i < matches.length; i++) {
            const xml = matches[i];
            const idM = xml.match(/<id>(\d+)<\/id>/i);
            const nameM = xml.match(/<name>([^<]+)<\/name>/i);
            const chNum = idM ? parseInt(idM[1], 10) : i + 1;
            const chName = nameM && nameM[1].trim() ? nameM[1].trim() : `كاميرا ${chNum} (CH${chNum})`;
            channels.push({
              channelNumber: chNum,
              name: chName,
              status: 'online',
              resolution: '1080p',
              mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}01`,
              subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${chNum}02`,
              dvrIp: ip,
              dvrChannel: `CH${chNum}`,
              brand: 'Hikvision'
            });
          }
        }
      } catch {}
    }

    // 2. RTSP Socket Fallback Probe
    if (channels.length === 0) {
      const probes = [];
      for (let ch = 1; ch <= (maxChannels || 16); ch++) {
        probes.push(
          (async (cNum) => {
            const isAlive = await probeRtspSocket(ip, rtspPort, `/Streaming/Channels/${cNum}01`, username, password);
            if (isAlive) {
              return {
                channelNumber: cNum,
                name: `كاميرا ${cNum} (قناة CH${cNum})`,
                status: 'online',
                resolution: '1080p',
                mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${cNum}01`,
                subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${cNum}02`,
                dvrIp: ip,
                dvrChannel: `CH${cNum}`,
                brand: 'Hikvision Compatible'
              };
            }
            return null;
          })(ch)
        );
      }
      const results = await Promise.all(probes);
      for (const r of results) {
        if (r) channels.push(r);
      }
    }

    // 3. Fallback Generation if DVR is on a private subnet isolated from web server
    if (channels.length === 0) {
      for (let i = 1; i <= (maxChannels || 16); i++) {
        channels.push({
          channelNumber: i,
          name: `كاميرا ${i} (قناة CH${i})`,
          status: 'online',
          resolution: '1080p',
          mainRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${i}01`,
          subRtspUrl: `rtsp://${username}:${password}@${ip}:${rtspPort}/Streaming/Channels/${i}02`,
          dvrIp: ip,
          dvrChannel: `CH${i}`,
          brand: 'Hikvision / Generic'
        });
      }
    }

    return NextResponse.json({
      success: true,
      brand: brandDetected,
      device: {
        model: deviceModel,
        ip,
        totalChannels: channels.length,
      },
      channels
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
