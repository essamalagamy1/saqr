// Saqr Edge Agent — Main Renderer Logic
let agentRunning = false;
let detectionsList = [];
let framesCounter = 0;
let sentCounter = 0;

// ===== Navigation =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById(`page-${page}`);
  const targetNav = document.querySelector(`[data-page="${page}"]`);
  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  if (page === 'cameras') {
    loadCameras();
    fetchServerCameras(true);
  }
  if (page === 'settings') loadSettings();
}

// ===== Agent State & Controls =====
async function toggleAgent() {
  if (agentRunning) {
    await rased.agent.stop();
    setAgentUI(false);
  } else {
    await rased.agent.start();
    setAgentUI(true);
  }
}

function setAgentUI(running) {
  agentRunning = running;
  const btn = document.getElementById('btnStartAgent');
  const icon = document.getElementById('agentBtnIcon');
  const text = document.getElementById('agentBtnText');
  const statusDot = document.getElementById('connectionStatus').querySelector('.status-dot');
  const statusText = document.getElementById('connectionStatus').querySelector('.status-text');

  if (running) {
    btn.className = 'btn btn-danger';
    icon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>';
    text.textContent = 'إيقاف المراقبة';
    statusDot.className = 'status-dot online';
    statusText.textContent = 'المراقبة نشطة (YOLOX)';
  } else {
    btn.className = 'btn btn-emerald';
    icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>';
    text.textContent = 'تشغيل المراقبة';
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'المراقبة متوقفة';
  }

  const emptyTitle = document.getElementById('feedEmptyTitle');
  const emptyHint = document.getElementById('feedEmptyHint');
  if (emptyTitle && emptyHint) {
    if (running) {
      emptyTitle.textContent = 'المراقبة نشطة وتعمل الآن';
      emptyHint.textContent = 'جاري سحب إطارات الكاميرات وتحليلها لحظياً... لا توجد مخالفات حالياً';
    } else {
      emptyTitle.textContent = 'المراقبة متوقفة مؤقتاً';
      emptyHint.textContent = 'اضغط على زر "تشغيل المراقبة" بالأعلى لبدء الرصد والتحليل';
    }
  }
}

// ===== Cameras =====
async function loadCameras() {
  const cameras = await rased.cameras.list();
  const list = document.getElementById('cameraList');
  const camBadge = document.getElementById('cameraBadge');
  if (camBadge) camBadge.textContent = cameras.length;
  const statCams = document.getElementById('statCameras');
  if (statCams) statCams.textContent = cameras.filter(c => c.enabled).length;

  if (cameras.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg class="empty-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
          <circle cx="12" cy="13" r="3"/>
        </svg>
        <p>لم يتم تسجيل أي كاميرا حتى الآن</p>
        <p class="empty-hint">قم بسحب الكاميرات من الخادم أو أدخل مسار RTSP للكاميرا مباشرة</p>
      </div>`;
    return;
  }

  list.innerHTML = cameras.map(cam => {
    const hasCreds = /rtsp:\/\/[^@:]+:[^@]+@/i.test(cam.rtspUrl || '');
    const isLocalCam = (cam.rtspUrl || '').includes('192.168.') || (cam.rtspUrl || '').includes('10.');
    const needsPassword = !hasCreds && isLocalCam;

    return `
    <div class="camera-card ${cam.enabled ? '' : 'disabled'}">
      <div class="camera-status-indicator ${cam.enabled ? 'active' : 'inactive'}">
        <span class="status-ping"></span>
      </div>
      <div class="camera-info">
        <div class="camera-title-row">
          <span class="camera-name">${escapeHtml(cam.name)}</span>
          <span class="camera-chip ${cam.enabled ? 'chip-active' : 'chip-inactive'}">
            ${cam.enabled ? 'نشطة • معالجة YOLOX' : 'معطلة مؤقتاً'}
          </span>
          ${needsPassword ? `
            <span class="camera-chip chip-warning">
              تتطلب كود التحقق / كلمة المرور
            </span>` : ''}
        </div>
        <div class="camera-url">${escapeHtml(maskPasswordInUrl(cam.rtspUrl) || 'بدون مسار بث')}</div>
      </div>
      <div class="camera-actions">
        <!-- Expand NVR Channels (16 Channels) Button -->
        <button class="btn-icon" onclick="promptExpandNvr('${cam.id}')" title="توسيع قنوات المسجل NVR (16 / 8 / 4 قنوات)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" style="color: #f59e0b;">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
        </button>

        <!-- Edit Credentials / Password Button -->
        <button class="btn-icon ${needsPassword ? 'warning-glow' : ''}" onclick="openEditPasswordModal('${cam.id}')" title="إضافة / تعديل كلمة المرور أو كود التحقق">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="7.5" cy="15.5" r="5.5"/>
            <path d="m21 2-9.6 9.6"/>
            <path d="m15.5 7.5 3 3L22 7l-3-3"/>
          </svg>
        </button>

        <label class="switch-toggle" title="${cam.enabled ? 'إيقاف معالجة الكاميرا' : 'تفعيل معالجة الكاميرا'}">
          <input type="checkbox" ${cam.enabled ? 'checked' : ''} onchange="toggleCamera('${cam.id}')">
          <span class="switch-slider"></span>
        </label>
        <button class="btn-icon danger" onclick="removeCamera('${cam.id}')" title="حذف الكاميرا">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18"/>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  }).join('');
}

function maskPasswordInUrl(url) {
  if (!url) return '';
  return url.replace(/^(rtsp:\/\/[^@:]+:)([^@]+)(@)/i, '$1••••$3');
}

// ===== Edit Password / Credentials Modal =====
let currentEditCam = null;

async function openEditPasswordModal(id) {
  const cameras = await rased.cameras.list();
  const cam = cameras.find(c => c.id === id);
  if (!cam) return;

  currentEditCam = cam;
  document.getElementById('editCamId').value = cam.id;
  document.getElementById('editCamName').value = cam.name;
  document.getElementById('editTestResult').style.display = 'none';

  // Parse RTSP URL: rtsp://[user:pass@]host[:port][/path]
  let url = (cam.rtspUrl || '').trim();
  let user = 'admin';
  let pass = '';
  let host = url;

  if (url.startsWith('rtsp://')) {
    url = url.substring(7);
  }

  if (url.includes('@')) {
    const parts = url.split('@');
    const auth = parts[0];
    host = parts[1];
    if (auth.includes(':')) {
      const authParts = auth.split(':');
      user = decodeURIComponent(authParts[0]);
      pass = decodeURIComponent(authParts[1]);
    } else {
      user = decodeURIComponent(auth);
    }
  }

  document.getElementById('editCamUser').value = user || 'admin';
  document.getElementById('editCamPass').value = pass || '';
  document.getElementById('editCamHost').value = host || '';
  document.getElementById('editPasswordModal').style.display = 'flex';
}

function closeEditPasswordModal() {
  document.getElementById('editPasswordModal').style.display = 'none';
  currentEditCam = null;
}

function buildRtspFromInputs() {
  let host = document.getElementById('editCamHost').value.trim();
  const user = document.getElementById('editCamUser').value.trim();
  const pass = document.getElementById('editCamPass').value.trim();

  if (!host) return '';
  if (host.startsWith('rtsp://')) host = host.substring(7);

  // If user only entered IP or IP:port without a stream path, append default Hikvision/EZVIZ ISAPI path
  if (!host.includes('/')) {
    if (!host.includes(':')) host += ':554';
    host += '/Streaming/Channels/101';
  }

  if (pass) {
    return `rtsp://${encodeURIComponent(user || 'admin')}:${encodeURIComponent(pass)}@${host}`;
  }
  return `rtsp://${host}`;
}

async function testEditPasswordConnection() {
  const rtspUrl = buildRtspFromInputs();
  if (!rtspUrl) { alert('يرجى التأكد من كتابة عنوان الكاميرا'); return; }

  const resultDiv = document.getElementById('editTestResult');
  resultDiv.style.display = 'block';
  resultDiv.className = 'test-result testing';
  resultDiv.textContent = 'جاري اختبار الاتصال بالبث وسحب إطار حي...';

  const result = await rased.cameras.test(rtspUrl);
  if (result.success) {
    resultDiv.className = 'test-result success';
    resultDiv.textContent = `تم الاتصال بنجاح! كلمة السر ومسار البث صالحين (الاستجابة: ${result.data.latencyMs}ms)`;
    if (result.data.workingUrl) {
      const cleanHost = result.data.workingUrl.replace(/^rtsp[s]?:\/\/[^@]+@/i, '').replace(/^rtsp[s]?:\/\//i, '');
      document.getElementById('editCamHost').value = cleanHost;
    }
  } else {
    resultDiv.className = 'test-result error';
    resultDiv.innerHTML = escapeHtml(result.error || 'فشل الاتصال').replace(/\n/g, '<br>');
  }
}

async function saveEditPassword() {
  const id = document.getElementById('editCamId').value;
  const rtspUrl = buildRtspFromInputs();

  if (!rtspUrl) {
    alert('يرجى إدخال عنوان الكاميرا بشكل سليم');
    return;
  }

  await rased.cameras.update(id, { rtspUrl });

  // If this camera is part of an NVR (shares IP with other cameras),
  // automatically update other channels on the same IP if they don't have credentials
  try {
    const user = document.getElementById('editCamUser').value.trim();
    const pass = document.getElementById('editCamPass').value;
    if (user && pass) {
      const hostMatch = rtspUrl.match(/^rtsp[s]?:\/\/[^@]+@([^\/:]+)/i);
      const camIp = hostMatch ? hostMatch[1] : null;
      if (camIp) {
        const allCams = await rased.cameras.list();
        let syncedCount = 0;
        for (const other of allCams) {
          if (other.id !== id && other.rtspUrl && other.rtspUrl.includes(camIp)) {
            let targetUrl = other.rtspUrl;
            // If current camera uses /Streaming/Channels/, ensure other channels use the corresponding /Streaming/Channels/{ch}01
            const otherCh = other.channel || (other.name ? (other.name.match(/قناة\s*(\d+)/) || [])[1] : null) || 1;
            if (rtspUrl.includes('/Streaming/Channels/') && targetUrl.includes('/ch') && !targetUrl.includes('/Streaming/Channels/')) {
              targetUrl = targetUrl.replace(/\/ch\d+\/main/i, `/Streaming/Channels/${otherCh}01`);
            }
            const hasCreds = /rtsp[s]?:\/\/[^@]+@/i.test(targetUrl);
            const updatedOtherUrl = hasCreds
              ? targetUrl.replace(/rtsp[s]?:\/\/[^@]+@/i, `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`)
              : targetUrl.replace(/^(rtsp[s]?:\/\/)(.*)$/i, `$1${encodeURIComponent(user)}:${encodeURIComponent(pass)}@$2`);
            await rased.cameras.update(other.id, { rtspUrl: updatedOtherUrl });
            syncedCount++;
          }
        }
        if (syncedCount > 0) {
          console.log(`[AUTH] Automatically applied credentials to ${syncedCount} other channels on ${camIp}`);
        }
      }
    }
  } catch (err) {
    console.warn('[AUTH] Error syncing credentials to other NVR channels:', err);
  }

  closeEditPasswordModal();
  loadCameras();
  rased.cameras.syncAllToCloud().catch(() => {});
}

async function loadBranchesDropdown() {
  const select = document.getElementById('cameraBranch');
  if (!select) return;
  select.innerHTML = '<option value="">جاري تحميل الفروع من حسابك...</option>';
  try {
    const res = await rased.branches.list();
    if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
      select.innerHTML = res.data.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    } else {
      select.innerHTML = '<option value="">فرع القاهرة الجديدة (الافتراضي)</option>';
    }
  } catch (err) {
    console.warn('Failed to load branches:', err);
    select.innerHTML = '<option value="">فرع القاهرة الجديدة (الافتراضي)</option>';
  }
}

function showAddCameraModal() {
  document.getElementById('addCameraModal').style.display = 'flex';
  document.getElementById('cameraName').value = '';
  document.getElementById('cameraRtsp').value = '';
  document.getElementById('cameraAddUser').value = 'admin';
  document.getElementById('cameraAddPass').value = '';
  document.getElementById('cameraTestResult').style.display = 'none';
  loadBranchesDropdown();
}

function closeAddCameraModal() {
  document.getElementById('addCameraModal').style.display = 'none';
}

async function addCamera() {
  const name = document.getElementById('cameraName').value.trim();
  let rtspUrl = document.getElementById('cameraRtsp').value.trim();
  const addUser = document.getElementById('cameraAddUser').value.trim();
  const addPass = document.getElementById('cameraAddPass').value.trim();
  const branchSelect = document.getElementById('cameraBranch');
  const branchId = branchSelect ? branchSelect.value.trim() : '';
  const branchName = branchSelect && branchSelect.selectedIndex >= 0 ? branchSelect.options[branchSelect.selectedIndex].text : '';

  if (!name) { alert('يرجى تحديد اسم للكاميرا'); return; }
  if (!rtspUrl) { alert('يرجى إدخال عنوان RTSP للبث'); return; }

  // Assemble credentials if user entered them separately
  if (addPass && !rtspUrl.includes('@')) {
    let host = rtspUrl.startsWith('rtsp://') ? rtspUrl.substring(7) : rtspUrl;
    rtspUrl = `rtsp://${encodeURIComponent(addUser || 'admin')}:${encodeURIComponent(addPass)}@${host}`;
  } else if (!rtspUrl.startsWith('rtsp://') && !rtspUrl.startsWith('http://')) {
    rtspUrl = 'rtsp://' + rtspUrl;
  }

  await rased.cameras.add({ name, rtspUrl, branchId, branchName, enabled: true });
  closeAddCameraModal();
  loadCameras();
}

async function removeCamera(id) {
  if (confirm('هل أنت متأكد من حذف هذه الكاميرا من قائمة المراقبة؟')) {
    await rased.cameras.remove(id);
    loadCameras();
  }
}

async function toggleCamera(id) {
  await rased.cameras.toggle(id);
  loadCameras();
}

async function testCameraConnection() {
  let rtspUrl = document.getElementById('cameraRtsp').value.trim();
  if (!rtspUrl) { alert('يرجى كتابة عنوان RTSP أولاً'); return; }

  // Inject credentials from the form fields if not already in the URL
  const addUser = document.getElementById('cameraAddUser').value.trim();
  const addPass = document.getElementById('cameraAddPass').value.trim();
  if (addPass && !rtspUrl.includes('@')) {
    let host = rtspUrl.startsWith('rtsp://') ? rtspUrl.substring(7) : rtspUrl;
    rtspUrl = `rtsp://${encodeURIComponent(addUser || 'admin')}:${encodeURIComponent(addPass)}@${host}`;
  }

  const resultDiv = document.getElementById('cameraTestResult');
  resultDiv.style.display = 'block';
  resultDiv.className = 'test-result testing';
  resultDiv.textContent = 'جاري الاتصال بالبث وسحب إطار تجريبي...';

  const result = await rased.cameras.test(rtspUrl);
  if (result.success) {
    resultDiv.className = 'test-result success';
    resultDiv.textContent = `تم الاتصال بنجاح! كلمة المرور ومسار البث صالحين (الاستجابة: ${result.data.latencyMs}ms)`;
    // Auto-fill the working path back into the URL field
    if (result.data.workingUrl) {
      const m = result.data.workingUrl.match(/^rtsp[s]?:\/\/[^\/]+(\/.*)/i);
      if (m) {
        const ipMatch = rtspUrl.match(/@?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]+)/);
        const portHost = ipMatch ? ipMatch[1] : document.getElementById('cameraRtsp').value.match(/([0-9.]+:[0-9]+)/)?.[1] || '';
        if (portHost) {
          document.getElementById('cameraRtsp').value = `rtsp://${portHost}${m[1]}`;
        }
      }
    }
  } else {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `فشل الاتصال بالكاميرا: ${result.error}`;
  }
}

async function fetchServerCameras(silent = false) {
  try {
    const result = await rased.cameras.fetchFromServer();
    if (result.success && result.data && result.data.length > 0) {
      const existing = await rased.cameras.list();
      let newCount = 0;
      let updatedCount = 0;

      for (const cam of result.data) {
        const rtsp = cam.rtsp_url || (cam.dvr_ip ? `rtsp://${cam.dvr_ip}:554/Streaming/Channels/101` : '');
        const cleanRtsp = rtsp.replace(/^rtsp[s]?:\/\/[^@]+@/i, 'rtsp://').trim().toLowerCase();
        
        const isExisting = existing.some(c => {
          if (c.id === cam.id) return true;
          const cClean = (c.rtspUrl || '').replace(/^rtsp[s]?:\/\/[^@]+@/i, 'rtsp://').trim().toLowerCase();
          return cClean && cleanRtsp && cClean === cleanRtsp;
        });
        
        await rased.cameras.add({
          id: cam.id,
          name: cam.name,
          rtspUrl: rtsp,
          channel: cam.dvr_channel ? parseInt(cam.dvr_channel.replace(/\D/g, ''), 10) || undefined : undefined,
          dvrIp: cam.dvr_ip || '',
          dvrChannel: cam.dvr_channel || '',
          branchId: cam.branch_id || '',
          enabled: cam.status === 'active' || cam.status === 'online',
        });

        if (isExisting) updatedCount++;
        else newCount++;
      }
      loadCameras();
      if (!silent) {
        alert(`تمت مزامنة الكاميرات مع الخادم بنجاح! (تم سحب ${newCount} كاميرا جديدة وتحديث ${updatedCount}).`);
      }
    } else if (!silent) {
      alert(result.error || 'لم يتم العثور على كاميرات مسجلة في حسابك على الخادم.');
    }
  } catch (err) {
    if (!silent) alert('تعذر مزامنة الكاميرات: ' + err.message);
  }
}

async function syncAllCamerasToCloud() {
  try {
    const res = await rased.cameras.syncAllToCloud();
    if (res.success) {
      alert(`تمت مزامنة الكاميرات مع المنصة بنجاح! (${res.count} كاميرا تمت مزامنتها مع السيرفر).`);
    } else {
      alert(res.error || 'فشلت المزامنة مع الخادم. تأكد من صحة إعدادات الخادم وتسجيل الدخول.');
    }
  } catch (err) {
    alert('تعذر المزامنة: ' + err.message);
  }
}

// ===== Settings =====
async function loadSettings() {
  const config = await rased.config.getAll();
  document.getElementById('settingsServerUrl').value = config.serverUrl || '';
  document.getElementById('settingsEmail').value = config.email || '';
  document.getElementById('settingsInterval').value = config.detectionInterval || 3;
  document.getElementById('settingsAutoStart').checked = !!config.autoStart;
  document.getElementById('settingsMinimizeTray').checked = config.minimizeToTray !== false;
}

async function saveServerUrl() {
  let url = document.getElementById('settingsServerUrl').value.trim();
  if (!url) { alert('يرجى إدخال عنوان الخادم أو الدومين'); return; }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i.test(url) || url.includes(':')) {
      url = 'http://' + url;
    } else {
      url = 'https://' + url;
    }
  }
  url = url.replace(/\/+$/, '');
  await rased.config.set('serverUrl', url);
  document.getElementById('settingsServerUrl').value = url;
  alert('تم تحديث وحفظ رابط الخادم بنجاح. ستتصل كافة الطلبات بهذا الرابط الجديد.');
}

async function resetSetup() {
  if (confirm('تحذير: هل ترغب في تسجيل الخروج ومسح التكوين والبدء من معالج التثبيت؟')) {
    await rased.config.set('setupComplete', false);
    await rased.config.set('serverUrl', '');
    await rased.config.set('accessToken', '');
    await rased.config.set('refreshToken', '');
    await rased.config.set('cameras', []);
    rased.window.close();
  }
}

document.addEventListener('change', async (e) => {
  if (e.target.id === 'settingsInterval') {
    const val = parseInt(e.target.value) || 3;
    await rased.config.set('detectionInterval', val);
  }
  if (e.target.id === 'settingsAutoStart') {
    await rased.config.set('autoStart', e.target.checked);
  }
  if (e.target.id === 'settingsMinimizeTray') {
    await rased.config.set('minimizeToTray', e.target.checked);
  }
});

// ===== Feed & Detections =====
function addDetectionToFeed(event) {
  framesCounter++;
  sentCounter++;
  const elFrames = document.getElementById('statFrames');
  if (elFrames) elFrames.textContent = framesCounter;
  const elSent = document.getElementById('statSent');
  if (elSent) elSent.textContent = sentCounter;

  detectionsList.unshift(event);
  if (detectionsList.length > 100) detectionsList.pop();

  const elDetBadge = document.getElementById('detectionBadge');
  if (elDetBadge) elDetBadge.textContent = detectionsList.length;
  const elStatDet = document.getElementById('statDetections');
  if (elStatDet) elStatDet.textContent = detectionsList.length;

  updateDetectionFeed();
  updateDetectionLog();
}

function updateDetectionFeed() {
  const feed = document.getElementById('detectionFeed');
  if (detectionsList.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <svg class="empty-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
        </svg>
        <p>لا توجد تنبيهات مرصودة حالياً</p>
      </div>`;
    return;
  }

  feed.innerHTML = detectionsList.slice(0, 10).map(d => `
    <div class="detection-item ${d.severity || 'low'}">
      <div class="detection-time">${formatTime(d.timestamp)}</div>
      <div class="detection-info">
        <span class="detection-type">${escapeHtml(d.type || 'كشف حركة')}</span>
        <span class="detection-camera">${escapeHtml(d.camera_name || 'كاميرا غير معروفة')}</span>
      </div>
      <div class="detection-confidence">${Math.round((d.confidence || 0) * 100)}%</div>
    </div>
  `).join('');
}

function updateDetectionLog() {
  const log = document.getElementById('detectionLog');
  if (detectionsList.length === 0) {
    log.innerHTML = `
      <div class="empty-state">
        <svg class="empty-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
        </svg>
        <p>لا توجد اكتشافات مسجلة</p>
      </div>`;
    return;
  }

  log.innerHTML = detectionsList.map(d => `
    <div class="detection-log-item ${d.severity || 'low'}">
      <div class="log-time">${formatTime(d.timestamp)}</div>
      <div class="log-camera">${escapeHtml(d.camera_name || '-')}</div>
      <div class="log-type">${escapeHtml(d.type || 'Unknown')}</div>
      <div class="log-confidence">${Math.round((d.confidence || 0) * 100)}%</div>
    </div>
  `).join('');
}

function clearDetections() {
  detectionsList = [];
  updateDetectionFeed();
  updateDetectionLog();
  const b1 = document.getElementById('detectionBadge');
  if (b1) b1.textContent = '0';
  const b2 = document.getElementById('statDetections');
  if (b2) b2.textContent = '0';
}

function formatTime(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ===== Listen to IPC =====
rased.on('agent:detection', (event) => {
  addDetectionToFeed(event);
});

rased.on('agent:status', (data) => {
  setAgentUI(data.running);
});

// ===== Camera Network Auto-Scan =====
let discoveredCameras = [];

async function startNetworkScan() {
  const modal = document.getElementById('scanCamerasModal');
  const statusBox = document.getElementById('scanStatusBox');
  const spinner = document.getElementById('scanSpinner');
  const statusTitle = document.getElementById('scanStatusTitle');
  const statusSubtitle = document.getElementById('scanStatusSubtitle');
  const resultsList = document.getElementById('scanResultsList');
  const emptyState = document.getElementById('scanEmptyState');
  const btnAddAll = document.getElementById('btnAddAllScanned');
  const btnRescan = document.getElementById('btnRescan');

  modal.style.display = 'flex';
  statusBox.style.display = 'flex';
  statusBox.style.background = 'rgba(2, 132, 199, 0.08)';
  statusBox.style.borderColor = 'rgba(2, 132, 199, 0.25)';
  spinner.style.display = 'inline-block';
  statusTitle.textContent = 'جاري فحص الشبكة المحلية بحثاً عن الكاميرات...';
  statusSubtitle.textContent = 'يتم الاستعلام عبر بروتوكولات SADP (EZVIZ/Hikvision) و ONVIF ومسح منافذ RTSP';
  resultsList.innerHTML = '';
  emptyState.style.display = 'none';
  btnAddAll.style.display = 'none';
  btnRescan.disabled = true;

  try {
    const response = await rased.cameras.scanNetwork();
    btnRescan.disabled = false;
    spinner.style.display = 'none';

    if (!response.success) {
      statusBox.style.background = 'rgba(239, 68, 68, 0.1)';
      statusBox.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      statusTitle.textContent = 'تعذر إتمام الفحص';
      statusSubtitle.textContent = response.error || 'حدث خطأ أثناء فحص الشبكة';
      return;
    }

    discoveredCameras = response.cameras || [];

    if (discoveredCameras.length === 0) {
      statusBox.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    // Success with cameras found
    statusBox.style.background = 'rgba(16, 185, 129, 0.1)';
    statusBox.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    statusTitle.textContent = `تم العثور على (${discoveredCameras.length}) كاميرا على شبكتك المحلية!`;
    statusSubtitle.textContent = 'يمكنك إضافة الكاميرات المختارة للمراقبة فوراً';

    const badge = document.getElementById('scannedCountBadge');
    if (badge) badge.textContent = discoveredCameras.length;
    btnAddAll.style.display = 'inline-flex';

    renderDiscoveredCamerasList();
  } catch (err) {
    btnRescan.disabled = false;
    spinner.style.display = 'none';
    statusBox.style.background = 'rgba(239, 68, 68, 0.1)';
    statusBox.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    statusTitle.textContent = 'خطأ أثناء الفحص';
    statusSubtitle.textContent = err.message || 'حدث خطأ غير متوقع';
  }
}

async function renderDiscoveredCamerasList() {
  const resultsList = document.getElementById('scanResultsList');
  const existingCameras = await rased.cameras.list();

  resultsList.innerHTML = discoveredCameras.map((cam, idx) => {
    // Check if camera is already in saved list (match specific channel or exact URL/name)
    const isAlreadyAdded = existingCameras.some(c => {
      if (c.name && c.name === cam.name) return true;
      if (c.rtspUrl && cam.rtspUrl) {
        if (c.rtspUrl === cam.rtspUrl) return true;
        if (c.rtspUrl.includes(cam.ip)) {
          if (cam.channel) {
            return c.rtspUrl.includes(`/ch${cam.channel}/`) || c.rtspUrl.includes(`/${cam.channel}01`) || c.rtspUrl.includes(`channel=${cam.channel}`);
          }
          return true;
        }
      }
      return false;
    });

    const isHikEzviz = (cam.brand || '').includes('EZVIZ') || (cam.brand || '').includes('Hikvision');
    const badgeClass = isHikEzviz ? 'scan-badge-brand' : 'scan-badge-onvif';

    return `
      <div class="scan-camera-item" id="scanned-cam-${idx}">
        <div class="scan-item-info">
          <div class="scan-item-icon">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
              <circle cx="12" cy="13" r="3"/>
            </svg>
          </div>
          <div class="scan-item-details">
            <div class="scan-item-title">
              <span>${escapeHtml(cam.name)}</span>
              <span class="${badgeClass}">${escapeHtml(cam.brand)}</span>
            </div>
            <div class="scan-item-url">${escapeHtml(cam.rtspUrl)}</div>
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          ${(!cam.channel || cam.totalChannels === 1) ? `
            <button class="btn btn-secondary" onclick="expandToNvrChannels(${idx}, 16)" id="btnExpandNvr-${idx}" style="font-size: 11px; padding: 5px 10px; border-color: rgba(245, 158, 11, 0.6); color: #f59e0b; font-weight: bold;" title="إضافة كافة القنوات الـ 16 لهذا المسجل">
              + NVR (16 قناة)
            </button>
          ` : ''}
          ${isAlreadyAdded ? `
            <button class="btn btn-secondary" style="font-size: 11px; padding: 6px 10px; cursor: default; opacity: 0.8;" disabled>
              ✓ مضافة بالفعل
            </button>
          ` : `
            <button class="btn btn-primary" onclick="addSingleScannedCamera(${idx})" id="btnAddScanned-${idx}" style="font-size: 11px; padding: 6px 12px;">
              + إضافة للمراقبة
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

async function promptExpandNvr(id) {
  const cameras = await rased.cameras.list();
  const cam = cameras.find(c => c.id === id);
  if (!cam) return;

  const url = cam.rtspUrl || '';
  let host = url.replace(/^rtsp[s]?:\/\//i, '');
  let creds = '';
  if (host.includes('@')) {
    const parts = host.split('@');
    creds = parts[0];
    host = parts[1];
  }
  const ip = host.split('/')[0].split(':')[0];

  const choice = prompt(
    `توسيع مسجل الفيديو (${ip}) إلى قنوات الكاميرات:\n\nأدخل عدد القنوات المطلوبة (16 أو 8 أو 4 أو 32):`,
    '16'
  );
  if (!choice) return;

  const count = parseInt(choice, 10);
  if (isNaN(count) || count < 2 || count > 64) {
    alert('يرجى إدخال عدد قنوات صالح بين 2 و 64 (مثلاً 16).');
    return;
  }

  const isDahua = url.includes('realmonitor') || url.includes('channel=');

  for (let ch = 1; ch <= count; ch++) {
    const chPath = isDahua
      ? `/cam/realmonitor?channel=${ch}&subtype=0`
      : `/Streaming/Channels/${ch}01`;

    const chUrl = creds ? `rtsp://${creds}@${ip}:554${chPath}` : `rtsp://${ip}:554${chPath}`;

    await rased.cameras.add({
      name: `كاميرا ${ch} (قناة ${ch}) — ${ip}`,
      rtspUrl: chUrl,
      channel: ch,
      dvrIp: ip,
      dvrChannel: `CH${ch}`,
      enabled: true,
    });
  }

  await loadCameras();
  rased.cameras.syncAllToCloud().catch(() => {});
  alert(`تم بنجاح إضافة كافة قنوات المسجل الـ ${count} لجهاز (${ip}) ومزامنتها!`);
}

async function expandToNvrChannels(index, count = 16) {
  const cam = discoveredCameras[index];
  if (!cam) return;

  const btn = document.getElementById(`btnExpandNvr-${index}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = `جاري إضافة ${count} قنوات...`;
  }

  // Preserve credentials if present
  let creds = '';
  if (cam.rtspUrl && cam.rtspUrl.includes('@')) {
    const m = cam.rtspUrl.match(/^rtsp[s]?:\/\/([^@]+)@/i);
    if (m) creds = m[1];
  }

  for (let ch = 1; ch <= count; ch++) {
    const chPath = `/Streaming/Channels/${ch}01`;
    const chUrl = creds ? `rtsp://${creds}@${cam.ip}:554${chPath}` : `rtsp://${cam.ip}:554${chPath}`;
    
    await rased.cameras.add({
      name: `كاميرا ${ch} (قناة ${ch}) — ${cam.ip}`,
      rtspUrl: chUrl,
      channel: ch,
      dvrIp: cam.ip,
      dvrChannel: `CH${ch}`,
      enabled: true,
    });
  }

  if (btn) {
    btn.className = 'btn btn-secondary';
    btn.textContent = `✓ تمت إضافة ${count} قنوات`;
    btn.style.opacity = '0.8';
  }

  loadCameras();
  rased.cameras.syncAllToCloud().catch(() => {});
  alert(`تمت إضافة كافة قنوات الـ NVR الـ (${count} قنوات) لجهاز (${cam.ip}) بنجاح ومزامنتها!`);
}

async function addSingleScannedCamera(index) {
  const cam = discoveredCameras[index];
  if (!cam) return;

  const btn = document.getElementById(`btnAddScanned-${index}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري الإضافة...';
  }

  await rased.cameras.add({
    name: cam.name,
    rtspUrl: cam.rtspUrl,
    channel: cam.channel,
    dvrIp: cam.ip,
    enabled: true,
  });

  if (btn) {
    btn.className = 'btn btn-secondary';
    btn.textContent = '✓ تمت الإضافة';
    btn.style.opacity = '0.8';
  }

  loadCameras();
  rased.cameras.syncAllToCloud().catch(() => {});
}

async function addAllDiscoveredCameras() {
  const btn = document.getElementById('btnAddAllScanned');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري إضافة الكاميرات...';
  }

  for (let i = 0; i < discoveredCameras.length; i++) {
    const cam = discoveredCameras[i];
    await rased.cameras.add({
      name: cam.name,
      rtspUrl: cam.rtspUrl,
      channel: cam.channel,
      dvrIp: cam.ip,
      enabled: true,
    });
  }

  closeScanModal();
  loadCameras();
  rased.cameras.syncAllToCloud().catch(() => {});
  alert(`تمت إضافة ${discoveredCameras.length} كاميرات إلى قائمة المراقبة ومزامنتها بنجاح! إذا كانت الكاميرا تتطلب كود تحقق أو باسوورد، يمكنك إدخاله بالنقر على أيقونة المفتاح.`);
}

function closeScanModal() {
  document.getElementById('scanCamerasModal').style.display = 'none';
}

// ===== DVR / NVR Direct Connect & Channel Importer =====
let fetchedDvrChannels = [];

async function showDvrModal() {
  const modal = document.getElementById('dvrConnectModal');
  modal.style.display = 'flex';
  document.getElementById('dvrChannelsResultBox').style.display = 'none';
  document.getElementById('btnImportDvrChannels').style.display = 'none';

  // Populate branches select
  const branchSelect = document.getElementById('dvrBranchSelect');
  branchSelect.innerHTML = '<option value="">جاري تحميل الفروع...</option>';
  try {
    const res = await rased.branches.list();
    if (res && res.success && res.data && res.data.length > 0) {
      branchSelect.innerHTML = res.data.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    } else {
      branchSelect.innerHTML = '<option value="default">الفرع الرئيسي</option>';
    }
  } catch {
    branchSelect.innerHTML = '<option value="default">الفرع الرئيسي</option>';
  }
}

function closeDvrModal() {
  document.getElementById('dvrConnectModal').style.display = 'none';
}

async function connectAndFetchDvrChannels() {
  const ip = document.getElementById('dvrIpInput').value.trim();
  const brand = document.getElementById('dvrBrandSelect').value;
  const username = document.getElementById('dvrUsernameInput').value.trim() || 'admin';
  const password = document.getElementById('dvrPasswordInput').value;
  const httpPort = parseInt(document.getElementById('dvrHttpPortInput').value, 10) || 80;
  const rtspPort = parseInt(document.getElementById('dvrRtspPortInput').value, 10) || 554;

  if (!ip) {
    alert('يرجى إدخال عنوان IP الخاص بجهاز الـ DVR');
    return;
  }

  const spinner = document.getElementById('dvrFetchSpinner');
  const btnText = document.getElementById('dvrFetchBtnText');
  const btn = document.getElementById('btnConnectDvr');

  spinner.style.display = 'inline-block';
  btnText.textContent = 'جاري الاتصال بالـ DVR وسحب القنوات...';
  btn.disabled = true;

  try {
    const res = await rased.dvr.connectAndFetch({
      ip,
      httpPort,
      rtspPort,
      username,
      password,
      brand,
      maxChannels: 16
    });

    if (res && res.success && res.channels && res.channels.length > 0) {
      fetchedDvrChannels = res.channels;
      renderDvrChannels(res);
    } else {
      alert('لم يتم العثور على قنوات متصلة أو لم يستجب الـ DVR. تأكد من صحة الـ IP وكلمة المرور.');
    }
  } catch (err) {
    alert('فشل في الاتصال بالـ DVR: ' + (err.message || 'خطأ غير معروف'));
  } finally {
    spinner.style.display = 'none';
    btnText.textContent = '🔍 فحص واستخراج قنوات الكاميرات (Fetch Channels)';
    btn.disabled = false;
  }
}

function renderDvrChannels(res) {
  const resultBox = document.getElementById('dvrChannelsResultBox');
  const list = document.getElementById('dvrChannelsList');
  const badge = document.getElementById('dvrDeviceBadge');
  const modelText = document.getElementById('dvrDeviceModel');
  const btnImport = document.getElementById('btnImportDvrChannels');

  resultBox.style.display = 'block';
  btnImport.style.display = 'inline-flex';

  badge.textContent = `${res.channels.length} قناة مستخرجة`;
  modelText.textContent = `${res.device.model || 'DVR'} (${res.brand})`;

  list.innerHTML = res.channels.map((ch, idx) => `
    <div style="display: flex; align-items: center; justify-content: space-between; background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 10px 12px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" class="dvr-channel-checkbox" id="dvr-ch-check-${idx}" data-idx="${idx}" checked onchange="updateDvrSelectedCount()">
        <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); display: flex; align-items: center; justify-content: center; color: #38bdf8; font-weight: 700; font-size: 11px;">
          ${ch.channelNumber}
        </div>
        <div>
          <div style="font-weight: 700; font-size: 12px; color: #fff;">${escapeHtml(ch.name)}</div>
          <div style="font-size: 10px; font-family: monospace; color: #64748b;" dir="ltr">${escapeHtml(ch.mainRtspUrl)}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 10px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 1px 6px; border-radius: 12px; font-weight: 600;">
          ${escapeHtml(ch.resolution || '1080p')}
        </span>
        <span style="font-size: 10px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); padding: 1px 6px; border-radius: 12px;">
          Dual Stream
        </span>
      </div>
    </div>
  `).join('');

  updateDvrSelectedCount();
}

function toggleSelectAllDvrChannels(checked) {
  document.querySelectorAll('.dvr-channel-checkbox').forEach(cb => {
    cb.checked = checked;
  });
  updateDvrSelectedCount();
}

function updateDvrSelectedCount() {
  const selected = document.querySelectorAll('.dvr-channel-checkbox:checked').length;
  document.getElementById('dvrSelectedCountText').textContent = selected;
}

async function importSelectedDvrChannels() {
  const checkboxes = document.querySelectorAll('.dvr-channel-checkbox:checked');
  if (checkboxes.length === 0) {
    alert('يرجى اختيار كاميرا واحدة على الأقل للاستيراد');
    return;
  }

  const branchSelect = document.getElementById('dvrBranchSelect');
  const branchId = branchSelect.value;
  const branchName = branchSelect.options[branchSelect.selectedIndex]?.text || 'الفرع الرئيسي';

  const btnImport = document.getElementById('btnImportDvrChannels');
  btnImport.disabled = true;
  btnImport.textContent = `جاري استيراد وتفعيل ${checkboxes.length} كاميرا...`;

  let added = 0;
  for (const cb of checkboxes) {
    const idx = parseInt(cb.getAttribute('data-idx'), 10);
    const ch = fetchedDvrChannels[idx];
    if (ch) {
      await rased.cameras.add({
        name: ch.name,
        rtspUrl: ch.mainRtspUrl,
        subRtspUrl: ch.subRtspUrl,
        branchId,
        branchName,
        dvrIp: ch.dvrIp,
        dvrChannel: ch.dvrChannel,
        channel: ch.channelNumber,
        brand: ch.brand || 'DVR'
      });
      added++;
    }
  }

  closeDvrModal();
  loadCameras();
  rased.cameras.syncAllToCloud().catch(() => {});
  alert(`✅ تم استيراد وتفعيل ${added} كاميرا من جهاز الـ DVR بنجاح ومزامنتها مع منصة صقر! الكاميرات الآن تعمل وتستقبل التحليل الذكي.`);
}

// ===== Auto-Updater =====
let currentAppUpdate = null;

async function openUpdateModal() {
  document.getElementById('updateAppModal').style.display = 'flex';
  checkAppUpdates(true);
}

function closeUpdateModal() {
  document.getElementById('updateAppModal').style.display = 'none';
}

async function checkAppUpdates(isUserInitiated = false) {
  const checkingBox = document.getElementById('updateCheckingBox');
  const upToDateBox = document.getElementById('updateUpToDateBox');
  const availableBox = document.getElementById('updateAvailableBox');
  const errorBox = document.getElementById('updateErrorBox');
  const btnApply = document.getElementById('btnApplyUpdate');
  const navBadge = document.getElementById('updateNavBadge');
  const progressContainer = document.getElementById('updateProgressContainer');

  if (isUserInitiated) {
    checkingBox.style.display = 'block';
    upToDateBox.style.display = 'none';
    availableBox.style.display = 'none';
    errorBox.style.display = 'none';
    btnApply.style.display = 'none';
    progressContainer.style.display = 'none';
  }

  try {
    const res = await rased.updater.check();

    if (!res.success) {
      if (isUserInitiated) {
        checkingBox.style.display = 'none';
        errorBox.style.display = 'block';
        document.getElementById('updateErrorMsg').textContent = res.error || 'فشل الاتصال بالخادم';
      }
      return;
    }

    const data = res.data;
    currentAppUpdate = data;

    // Update version badges across UI
    const curVer = data.currentVersion ? `v${data.currentVersion}` : 'v1.0.0';
    if (document.getElementById('sidebarVersionText')) document.getElementById('sidebarVersionText').textContent = curVer;
    if (document.getElementById('settingsVersionText')) document.getElementById('settingsVersionText').textContent = curVer;
    if (document.getElementById('uptodateVersionTag')) document.getElementById('uptodateVersionTag').textContent = curVer;

    if (data.hasUpdate) {
      // Show badge in sidebar
      if (navBadge) navBadge.style.display = 'inline-block';

      if (isUserInitiated) {
        checkingBox.style.display = 'none';
        availableBox.style.display = 'block';
        document.getElementById('remoteVersionTag').textContent = `v${data.latestVersion}`;
        document.getElementById('currentVersionTag').textContent = curVer;

        const changelogList = document.getElementById('changelogList');
        if (data.changelog && data.changelog.length > 0) {
          changelogList.innerHTML = data.changelog.map(item => `<li>${escapeHtml(item)}</li>`).join('');
        } else {
          changelogList.innerHTML = '<li>تحسينات في الأداء وسرعة الاستجابة</li>';
        }

        btnApply.style.display = 'inline-block';
      }
    } else {
      if (navBadge) navBadge.style.display = 'none';

      if (isUserInitiated) {
        checkingBox.style.display = 'none';
        upToDateBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (isUserInitiated) {
      checkingBox.style.display = 'none';
      errorBox.style.display = 'block';
      document.getElementById('updateErrorMsg').textContent = err.message || 'خطأ غير متوقع';
    }
  }
}

async function applyAppUpdate() {
  if (!currentAppUpdate || !currentAppUpdate.asarUrl) {
    alert('رابط التحديث غير متوفر');
    return;
  }

  const btnApply = document.getElementById('btnApplyUpdate');
  const progressContainer = document.getElementById('updateProgressContainer');
  const progressBar = document.getElementById('updateProgressBar');
  const progressPercent = document.getElementById('updateProgressPercent');
  const progressStatus = document.getElementById('updateProgressStatus');

  btnApply.disabled = true;
  btnApply.textContent = 'جاري التحميل...';
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressStatus.textContent = 'جاري تحميل ملفات التحديث من الخادم...';

  try {
    const res = await rased.updater.apply(currentAppUpdate.asarUrl);

    if (res.success) {
      progressBar.style.width = '100%';
      progressPercent.textContent = '100%';
      progressStatus.textContent = res.data?.message || 'تم التحميل بنجاح! جاري إعادة التشغيل لتطبيق التحديث...';
      btnApply.textContent = '✓ جاري إعادة التشغيل...';
    } else {
      btnApply.disabled = false;
      btnApply.textContent = 'إعادة المحاولة';
      progressStatus.textContent = 'فشل تطبيق التحديث: ' + res.error;
    }
  } catch (err) {
    btnApply.disabled = false;
    btnApply.textContent = 'إعادة المحاولة';
    progressStatus.textContent = 'خطأ: ' + err.message;
  }
}

// Progress listener from IPC
rased.on('updater:progress', (p) => {
  const progressBar = document.getElementById('updateProgressBar');
  const progressPercent = document.getElementById('updateProgressPercent');
  const progressBytes = document.getElementById('updateProgressBytes');

  if (progressBar) progressBar.style.width = `${p.percent}%`;
  if (progressPercent) progressPercent.textContent = `${p.percent}%`;
  if (progressBytes) progressBytes.textContent = `${p.downloadedMB} / ${p.totalMB} MB`;
});

// ===== Init =====
async function init() {
  const cameras = await rased.cameras.list();
  const camBadge = document.getElementById('cameraBadge');
  if (camBadge) camBadge.textContent = cameras.length;
  const statCams = document.getElementById('statCameras');
  if (statCams) statCams.textContent = cameras.filter(c => c.enabled).length;

  const status = await rased.agent.status();
  setAgentUI(status.running);

  try {
    const appVersion = await rased.updater.getVersion();
    if (document.getElementById('sidebarVersionText')) document.getElementById('sidebarVersionText').textContent = `v${appVersion}`;
    if (document.getElementById('settingsVersionText')) document.getElementById('settingsVersionText').textContent = `v${appVersion}`;
  } catch {}

  // Auto-sync cameras from server in background on launch
  setTimeout(() => fetchServerCameras(true), 1500);

  // Background check for updates without opening modal
  setTimeout(() => checkAppUpdates(false), 2500);
}

init();
