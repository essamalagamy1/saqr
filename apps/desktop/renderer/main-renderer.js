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

  list.innerHTML = cameras.map(cam => `
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
        </div>
        <div class="camera-url">${escapeHtml(cam.rtspUrl || 'بدون مسار بث')}</div>
      </div>
      <div class="camera-actions">
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
  `).join('');
}

function showAddCameraModal() {
  document.getElementById('addCameraModal').style.display = 'flex';
  document.getElementById('cameraName').value = '';
  document.getElementById('cameraRtsp').value = '';
  document.getElementById('cameraBranch').value = '';
  document.getElementById('cameraTestResult').style.display = 'none';
}

function closeAddCameraModal() {
  document.getElementById('addCameraModal').style.display = 'none';
}

async function addCamera() {
  const name = document.getElementById('cameraName').value.trim();
  const rtspUrl = document.getElementById('cameraRtsp').value.trim();
  const branchId = document.getElementById('cameraBranch').value.trim();

  if (!name) { alert('يرجى تحديد اسم للكاميرا'); return; }
  if (!rtspUrl) { alert('يرجى إدخال عنوان RTSP للبث'); return; }

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
    for (const cam of result.data) {
      const rtsp = cam.rtsp_url || (cam.dvr_ip ? `rtsp://${cam.dvr_ip}:554` : '');
      await rased.cameras.add({
        id: cam.id,
        name: cam.name,
        rtspUrl: rtsp,
        branchId: cam.branch_id || '',
        enabled: cam.status === 'active' || cam.status === 'online',
      });
    }
    loadCameras();
    alert(`تمت مزامنة ${result.data.length} كاميرا بنجاح من الخادم السحابي!`);
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

// ===== Init =====
async function init() {
  const cameras = await rased.cameras.list();
  document.getElementById('cameraBadge').textContent = cameras.length;
  document.getElementById('statCameras').textContent = cameras.filter(c => c.enabled).length;

  const status = await rased.agent.status();
  setAgentUI(status.running);
}

init();
