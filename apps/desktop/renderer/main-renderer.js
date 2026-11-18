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

  if (page === 'cameras') loadCameras();
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
}

// ===== Cameras =====
async function loadCameras() {
  const cameras = await rased.cameras.list();
  const list = document.getElementById('cameraList');
  document.getElementById('cameraBadge').textContent = cameras.length;
  document.getElementById('statCameras').textContent = cameras.filter(c => c.enabled).length;

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

  // If user only entered IP or IP:port without a stream path, append default EZVIZ/Hikvision path
  if (!host.includes('/')) {
    if (!host.includes(':')) host += ':554';
    host += '/ch1/main';
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
  closeEditPasswordModal();
  loadCameras();
}

function showAddCameraModal() {
  document.getElementById('addCameraModal').style.display = 'flex';
  document.getElementById('cameraName').value = '';
  document.getElementById('cameraRtsp').value = '';
  document.getElementById('cameraAddUser').value = 'admin';
  document.getElementById('cameraAddPass').value = '';
  document.getElementById('cameraBranch').value = '';
  document.getElementById('cameraTestResult').style.display = 'none';
}

function closeAddCameraModal() {
  document.getElementById('addCameraModal').style.display = 'none';
}

async function addCamera() {
  const name = document.getElementById('cameraName').value.trim();
  let rtspUrl = document.getElementById('cameraRtsp').value.trim();
  const addUser = document.getElementById('cameraAddUser').value.trim();
  const addPass = document.getElementById('cameraAddPass').value.trim();
  const branchId = document.getElementById('cameraBranch').value.trim();

  if (!name) { alert('يرجى تحديد اسم للكاميرا'); return; }
  if (!rtspUrl) { alert('يرجى إدخال عنوان RTSP للبث'); return; }

  // Assemble credentials if user entered them separately
  if (addPass && !rtspUrl.includes('@')) {
    let host = rtspUrl.startsWith('rtsp://') ? rtspUrl.substring(7) : rtspUrl;
    rtspUrl = `rtsp://${encodeURIComponent(addUser || 'admin')}:${encodeURIComponent(addPass)}@${host}`;
  } else if (!rtspUrl.startsWith('rtsp://') && !rtspUrl.startsWith('http://')) {
    rtspUrl = 'rtsp://' + rtspUrl;
  }

  await rased.cameras.add({ name, rtspUrl, branchId, enabled: true });
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
  const rtspUrl = document.getElementById('cameraRtsp').value.trim();
  if (!rtspUrl) { alert('يرجى كتابة عنوان RTSP أولاً'); return; }

  const resultDiv = document.getElementById('cameraTestResult');
  resultDiv.style.display = 'block';
  resultDiv.className = 'test-result testing';
  resultDiv.textContent = 'جاري الاتصال بالبث وسحب إطار تجريبي...';

  const result = await rased.cameras.test(rtspUrl);
  if (result.success) {
    resultDiv.className = 'test-result success';
    resultDiv.textContent = `تم الاتصال بنجاح (زمن الاستجابة: ${result.data.latencyMs}ms | حجم الإطار: ${Math.round(result.data.frameSize / 1024)}KB)`;
  } else {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `فشل الاتصال بالكاميرا: ${result.error}`;
  }
}

async function fetchServerCameras() {
  const result = await rased.cameras.fetchFromServer();
  if (result.success && result.data && result.data.length > 0) {
    const existing = await rased.cameras.list();
    let newCount = 0;
    let updatedCount = 0;

    for (const cam of result.data) {
      const rtsp = cam.rtsp_url || (cam.dvr_ip ? `rtsp://${cam.dvr_ip}:554` : '');
      const isExisting = existing.some(c => c.id === cam.id || (c.rtspUrl && rtsp && c.rtspUrl.includes(cam.dvr_ip || '---')));
      
      await rased.cameras.add({
        id: cam.id,
        name: cam.name,
        rtspUrl: rtsp,
        branchId: cam.branch_id || '',
        enabled: cam.status === 'active' || cam.status === 'online',
      });

      if (isExisting) updatedCount++;
      else newCount++;
    }
    loadCameras();
    alert(`تمت مزامنة الكاميرات مع الخادم بنجاح! (تمت إضافة ${newCount} وتحديث ${updatedCount} كاميرا دون أي تكرار).`);
  } else {
    alert(result.error || 'لم يتم العثور على كاميرات مسجلة في حسابك على الخادم.');
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
  document.getElementById('statFrames').textContent = framesCounter;
  document.getElementById('statSent').textContent = sentCounter;

  detectionsList.unshift(event);
  if (detectionsList.length > 100) detectionsList.pop();

  document.getElementById('detectionBadge').textContent = detectionsList.length;
  document.getElementById('statDetections').textContent = detectionsList.length;

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
  document.getElementById('detectionBadge').textContent = '0';
  document.getElementById('statDetections').textContent = '0';
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

    document.getElementById('scannedCountBadge').textContent = discoveredCameras.length;
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
    // Check if camera is already in saved list (match IP or RTSP URL)
    const isAlreadyAdded = existingCameras.some(c => 
      (c.rtspUrl && c.rtspUrl.includes(cam.ip)) || 
      (c.name && c.name === cam.name)
    );

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
        <div>
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
    enabled: true,
  });

  if (btn) {
    btn.className = 'btn btn-secondary';
    btn.textContent = '✓ تمت الإضافة';
    btn.style.opacity = '0.8';
  }

  loadCameras();
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
      enabled: true,
    });
  }

  closeScanModal();
  loadCameras();
  alert(`تمت إضافة ${discoveredCameras.length} كاميرات إلى قائمة المراقبة بنجاح! إذا كانت الكاميرا تتطلب كود تحقق أو باسوورد، يمكنك إدخاله بالنقر على أيقونة المفتاح.`);
}

function closeScanModal() {
  document.getElementById('scanCamerasModal').style.display = 'none';
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
  document.getElementById('cameraBadge').textContent = cameras.length;
  document.getElementById('statCameras').textContent = cameras.filter(c => c.enabled).length;

  const status = await rased.agent.status();
  setAgentUI(status.running);

  try {
    const appVersion = await rased.updater.getVersion();
    if (document.getElementById('sidebarVersionText')) document.getElementById('sidebarVersionText').textContent = `v${appVersion}`;
    if (document.getElementById('settingsVersionText')) document.getElementById('settingsVersionText').textContent = `v${appVersion}`;
  } catch {}

  // Background check for updates without opening modal
  setTimeout(() => checkAppUpdates(false), 2500);
}

init();
