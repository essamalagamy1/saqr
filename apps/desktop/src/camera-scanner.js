// Saqr Edge Agent — Multi-Protocol Camera Scanner (SADP, ONVIF, RTSP Port Sweep, ISAPI)
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const http = require('http');

class CameraScanner {
  constructor() {
    this.isScanning = false;
  }

  /**
   * Detect all local active IPv4 subnets
   */
  getLocalSubnets() {
    const interfaces = os.networkInterfaces();
    const subnets = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      const lower = name.toLowerCase();
      if (
        lower.startsWith('docker') ||
        lower.startsWith('br-') ||
        lower.startsWith('veth') ||
        lower.startsWith('vmnet') ||
        lower.includes('virtual') ||
        lower.includes('vethernet') ||
        lower.includes('hyper-v') ||
        lower.includes('wsl')
      ) {
        continue;
      }
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) {
          if (a.address.startsWith('169.254.') || a.address.startsWith('127.')) {
            continue;
          }
          const parts = a.address.split('.');
          if (parts.length === 4) {
            subnets.push({
              ip: a.address,
              prefix: parts.slice(0, 3).join('.'),
              broadcast: `${parts.slice(0, 3).join('.')}.255`
            });
          }
        }
      }
    }
    return subnets;
  }

  /**
   * Detect number of camera channels supported by an NVR/DVR or camera
   */
  detectChannels(model, xmlText = '') {
    // 1. Try XML tags from SADP or ISAPI
    if (xmlText) {
      const digMatch = xmlText.match(/<(?:DigitalChannelNum|digitalChannelNum)>(\d+)<\//i);
      const anaMatch = xmlText.match(/<(?:AnalogChannelNum|analogChannelNum)>(\d+)<\//i);
      let count = 0;
      if (digMatch) count += parseInt(digMatch[1], 10) || 0;
      if (anaMatch) count += parseInt(anaMatch[1], 10) || 0;
      if (count > 0) return count;

      const chMatch = xmlText.match(/<(?:ChannelNum|TotalChannelNum|channelNum|channelNumber|videoInputPortNum)>(\d+)<\//i);
      if (chMatch) {
        const c = parseInt(chMatch[1], 10);
        if (c > 0) return c;
      }
    }

    // 2. Parse from Model string
    if (model) {
      const m = model.toUpperCase();
      // Hikvision NVR/DVR pattern (e.g. DS-7604 -> 4, DS-7608 -> 8, DS-7616 -> 16, DS-7632 -> 32, DS-7764 -> 64)
      const hikMatch = m.match(/(?:DS|IDS)-[A-Z0-9]*?(?:7[1236789]|86|96|77|76|78|79)(04|08|16|32|64)/);
      if (hikMatch) return parseInt(hikMatch[1], 10);

      // Dahua / Uniview / Generic NVR pattern: NVR4104 (4), NVR4108 (8), XVR5108 (8), NVR4116 (16), NVR4232 (32)
      const nvrMatch = m.match(/(?:NVR|XVR|DVR|HVR)[A-Z0-9-]*?(04|08|16|32|64)/);
      if (nvrMatch) return parseInt(nvrMatch[1], 10);

      // PoE port count: /8P -> 8, /4P -> 4, /16P -> 16, /32P -> 32
      const poeMatch = m.match(/\/(\d{1,2})P\b/);
      if (poeMatch) return parseInt(poeMatch[1], 10);

      // Explicit CH: "8CH", "16CH", "4CH"
      const explicitCh = m.match(/(\d{1,2})\s*CH\b/);
      if (explicitCh) return parseInt(explicitCh[1], 10);
    }

    return 1;
  }

  /**
   * Fast probe to check if device is Hikvision via ISAPI HTTP
   */
  probeHikvisionISAPI(ip, port = 80, timeout = 700) {
    return new Promise((resolve) => {
      const req = http.get({
        host: ip,
        port,
        path: '/ISAPI/System/deviceInfo',
        timeout,
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (body && (body.includes('DeviceInfo') || body.includes('model') || body.includes('DeviceDescription'))) {
            resolve(body);
          } else {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  /**
   * Run full discovery across SADP, ONVIF, RTSP Socket Sweep, and ISAPI Unicast Probes
   */
  async scanNetwork(progressCb = null) {
    if (this.isScanning) {
      throw new Error('عملية الفحص جارية بالفعل...');
    }
    this.isScanning = true;
    const found = new Map();

    const addDevice = (key, data) => {
      if (!found.has(key)) {
        found.set(key, data);
        if (progressCb) progressCb(Array.from(found.values()));
      } else {
        const cur = found.get(key);
        if (data.name && (!cur.name || cur.name.startsWith('كاميرا RTSP') || cur.totalChannels < data.totalChannels)) {
          found.set(key, { ...cur, ...data });
          if (progressCb) progressCb(Array.from(found.values()));
        }
      }
    };

    const addDeviceOrChannels = (ip, model, brand, xmlText = '', defaultPort = 554) => {
      const channels = this.detectChannels(model, xmlText);
      const isMulti = channels > 1;

      // If this IP was previously added as a single generic device, remove it to expand channels
      if (isMulti && found.has(ip)) {
        found.delete(ip);
      }

      for (let ch = 1; ch <= channels; ch++) {
        const key = isMulti ? `${ip}_ch${ch}` : ip;
        const name = isMulti
          ? `كاميرا ${ch} (قناة ${ch}) — ${model}`
          : `كاميرا ${model}`;

        // Hikvision NVR standard ISAPI RTSP path is /Streaming/Channels/{channel}01
        // Fallback for non-Hikvision multi-channel is /ch{channel}/main
        const isHik = brand.includes('Hikvision') || brand.includes('EZVIZ') || /DS-|IDS-/i.test(model);
        const rtspUrl = isMulti
          ? (isHik ? `rtsp://${ip}:${defaultPort}/Streaming/Channels/${ch}01` : `rtsp://${ip}:${defaultPort}/Streaming/Channels/${ch}01`)
          : `rtsp://${ip}:${defaultPort}/Streaming/Channels/101`;

        addDevice(key, {
          id: key,
          ip,
          port: defaultPort,
          channel: ch,
          totalChannels: channels,
          brand,
          name,
          rtspUrl,
          needsCredentials: true,
        });
      }
    };

    const subnets = this.getLocalSubnets();
    let sadpSocket = null;
    const sadpMsg = Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Probe><Uuid>A250CA24-A61F-4E7B-9F27-4638F064E7A9</Uuid><Types>inquiry</Types></Probe>'
    );

    try {
      // 1. Run SADP (Hikvision / EZVIZ)
      const sadpPromise = new Promise(resolve => {
        try {
          sadpSocket = dgram.createSocket('udp4');
          sadpSocket.bind(0, () => {
            try {
              sadpSocket.setBroadcast(true);

              const sendProbes = () => {
                try {
                  // Multicast
                  sadpSocket.send(sadpMsg, 37020, '239.255.255.250');
                  // Subnet broadcasts
                  for (const sub of subnets) {
                    if (sub.broadcast) {
                      sadpSocket.send(sadpMsg, 37020, sub.broadcast);
                    }
                  }
                } catch {}
              };

              // Send 3 probe bursts at 0ms, 300ms, and 600ms to overcome Wi-Fi packet drops
              sendProbes();
              setTimeout(sendProbes, 300);
              setTimeout(sendProbes, 600);
            } catch (err) {
              console.warn('[SCANNER] SADP init error:', err.message);
            }
          });

          sadpSocket.on('message', (msg, rinfo) => {
            try {
              const text = msg.toString('utf-8');
              const ipMatch = text.match(/<IPv4Address>([^<]+)<\/IPv4Address>/i);
              const modelMatch = text.match(/<(?:DeviceDescription|model)>([^<]+)<\//i);
              const ip = ipMatch ? ipMatch[1].trim() : rinfo.address;
              const model = modelMatch ? modelMatch[1].trim() : 'EZVIZ/Hikvision';

              addDeviceOrChannels(ip, model, 'Hikvision / EZVIZ', text, 554);
            } catch {}
          });

          setTimeout(() => {
            resolve();
          }, 2800);
        } catch {
          resolve();
        }
      });

      // 2. Run ONVIF WS-Discovery (Dahua, Uniview, Axis, Generic ONVIF)
      const onvifPromise = new Promise(resolve => {
        try {
          const socket = dgram.createSocket('udp4');
          socket.bind(0, () => {
            try {
              socket.setBroadcast(true);
              const onvifProbe = Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
                '<e:Header><w:MessageID>uuid:84ede3de-7dec-11d0-c360-f01234567890</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>' +
                '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>'
              );
              // Send to multicast
              socket.send(onvifProbe, 3702, '239.255.255.250');
              // Send to subnet broadcasts
              for (const sub of subnets) {
                if (sub.broadcast) {
                  socket.send(onvifProbe, 3702, sub.broadcast);
                }
              }
            } catch (err) {
              console.warn('[SCANNER] ONVIF send error:', err.message);
            }
          });

          socket.on('message', (msg, rinfo) => {
            const ip = rinfo.address;
            const alreadyHas = Array.from(found.keys()).some(k => k === ip || k.startsWith(`${ip}_`));
            if (!alreadyHas) {
              addDeviceOrChannels(ip, `ONVIF (${ip})`, 'ONVIF Camera', '', 554);
            }
          });

          setTimeout(() => {
            try { socket.close(); } catch {}
            resolve();
          }, 2400);
        } catch {
          resolve();
        }
      });

      // 3. Fast Parallel TCP Port 554 Sweep on Subnet
      const checkPort = (ip, port = 554, timeout = 350) => {
        return new Promise(resolve => {
          const s = new net.Socket();
          s.setTimeout(timeout);
          s.on('connect', () => { s.destroy(); resolve(true); });
          s.on('timeout', () => { s.destroy(); resolve(false); });
          s.on('error', () => { s.destroy(); resolve(false); });
          s.connect(port, ip);
        });
      };

      const sweepTasks = [];
      const uniquePrefixes = [...new Set(subnets.map(s => s.prefix))];

      for (const prefix of uniquePrefixes) {
        for (let i = 1; i <= 254; i++) {
          const targetIp = `${prefix}.${i}`;
          sweepTasks.push(async () => {
            const isOpen = await checkPort(targetIp);
            if (isOpen) {
              // Immediately send direct UNICAST SADP UDP probe to targetIp:37020
              // Unicast UDP is never dropped by Wi-Fi multicast filtering!
              if (sadpSocket) {
                try {
                  sadpSocket.send(sadpMsg, 37020, targetIp);
                } catch {}
              }

              // Check if device returns ISAPI deviceInfo XML via HTTP port 80 or 8000
              const isapiXml = await this.probeHikvisionISAPI(targetIp, 80).catch(() => null)
                || await this.probeHikvisionISAPI(targetIp, 8000).catch(() => null);

              if (isapiXml) {
                const modelMatch = isapiXml.match(/<(?:model|DeviceDescription)>([^<]+)<\//i);
                const model = modelMatch ? modelMatch[1].trim() : `Hikvision (${targetIp})`;
                addDeviceOrChannels(targetIp, model, 'Hikvision NVR/Camera', isapiXml, 554);
              } else {
                const alreadyHas = Array.from(found.keys()).some(k => k === targetIp || k.startsWith(`${targetIp}_`));
                if (!alreadyHas) {
                  addDeviceOrChannels(targetIp, `RTSP (${targetIp})`, 'RTSP Stream', '', 554);
                }
              }
            }
          });
        }
      }

      // Execute sweep concurrently in batches of 40
      const runSweep = async () => {
        for (let i = 0; i < sweepTasks.length; i += 40) {
          await Promise.all(sweepTasks.slice(i, i + 40).map(t => t()));
        }
      };

      // Wait for all discovery methods
      await Promise.all([sadpPromise, onvifPromise, runSweep()]);

      return Array.from(found.values());
    } finally {
      if (sadpSocket) {
        try { sadpSocket.close(); } catch {}
      }
      this.isScanning = false;
    }
  }
}

module.exports = CameraScanner;
