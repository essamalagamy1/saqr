// Saqr Edge Agent — Multi-Protocol Camera Scanner (SADP, ONVIF, RTSP Port Sweep)
const os = require('os');
const net = require('net');
const dgram = require('dgram');

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
   * Run full discovery across SADP, ONVIF and RTSP Socket Sweep
   */
  async scanNetwork(progressCb = null) {
    if (this.isScanning) {
      throw new Error('عملية الفحص جارية بالفعل...');
    }
    this.isScanning = true;
    const found = new Map();

    const addDevice = (ip, data) => {
      if (!found.has(ip)) {
        found.set(ip, data);
        if (progressCb) progressCb(Array.from(found.values()));
      } else {
        // Upgrade info if we got more specific model name
        const cur = found.get(ip);
        if (data.name && (!cur.name || cur.name.startsWith('كاميرا RTSP'))) {
          found.set(ip, { ...cur, ...data });
          if (progressCb) progressCb(Array.from(found.values()));
        }
      }
    };

    const subnets = this.getLocalSubnets();

    try {
      // 1. Run SADP (Hikvision / EZVIZ)
      const sadpPromise = new Promise(resolve => {
        try {
          const socket = dgram.createSocket('udp4');
          socket.bind(0, () => {
            try {
              socket.setBroadcast(true);
              const sadpMsg = Buffer.from(
                '<?xml version="1.0" encoding="utf-8"?>' +
                '<Probe><Uuid>A250CA24-A61F-4E7B-9F27-4638F064E7A9</Uuid><Types>inquiry</Types></Probe>'
              );
              // Send to multicast
              socket.send(sadpMsg, 37020, '239.255.255.250');
              // Send to subnet broadcasts
              for (const sub of subnets) {
                if (sub.broadcast) {
                  socket.send(sadpMsg, 37020, sub.broadcast);
                }
              }
            } catch (err) {
              console.warn('[SCANNER] SADP send error:', err.message);
            }
          });

          socket.on('message', (msg, rinfo) => {
            try {
              const text = msg.toString('utf-8');
              const ipMatch = text.match(/<IPv4Address>([^<]+)<\/IPv4Address>/i);
              const modelMatch = text.match(/<DeviceDescription>([^<]+)<\/DeviceDescription>/i);
              const ip = ipMatch ? ipMatch[1].trim() : rinfo.address;
              const model = modelMatch ? modelMatch[1].trim() : 'EZVIZ/Hikvision';

              addDevice(ip, {
                ip,
                port: 554,
                brand: 'EZVIZ / Hikvision',
                name: `كاميرا ${model}`,
                rtspUrl: `rtsp://${ip}:554/ch1/main`,
                needsCredentials: true,
              });
            } catch {}
          });

          setTimeout(() => {
            try { socket.close(); } catch {}
            resolve();
          }, 1800);
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
            addDevice(ip, {
              ip,
              port: 554,
              brand: 'ONVIF Camera',
              name: `كاميرا ONVIF (${ip})`,
              rtspUrl: `rtsp://${ip}:554/ch1/main`,
              needsCredentials: true,
            });
          });

          setTimeout(() => {
            try { socket.close(); } catch {}
            resolve();
          }, 1800);
        } catch {
          resolve();
        }
      });

      // 3. Fast Parallel TCP Port 554 Sweep on Subnet
      const subnets = this.getLocalSubnets();
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
              addDevice(targetIp, {
                ip: targetIp,
                port: 554,
                brand: 'RTSP Stream',
                name: `كاميرا RTSP (${targetIp})`,
                rtspUrl: `rtsp://${targetIp}:554/ch1/main`,
                needsCredentials: true,
              });
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

      // Wait for all three discovery methods
      await Promise.all([sadpPromise, onvifPromise, runSweep()]);

      return Array.from(found.values());
    } finally {
      this.isScanning = false;
    }
  }
}

module.exports = CameraScanner;
