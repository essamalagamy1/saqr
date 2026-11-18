// Rased Setup Wizard Logic
let loginData = null;

function normalizeUrl(url) {
  let clean = url.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    if (/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i.test(clean) || clean.includes(':')) {
      clean = 'http://' + clean;
    } else {
      clean = 'https://' + clean;
    }
  }
  return clean.replace(/\/+$/, '');
}

function goToStep2() {
  const rawUrl = document.getElementById('serverUrl').value.trim();
  if (!rawUrl) {
    showError('serverError', 'يرجى إدخال دومين أو عنوان الخادم');
    return;
  }

  const serverUrl = normalizeUrl(rawUrl);
  try {
    new URL(serverUrl);
  } catch {
    showError('serverError', 'عنوان غير صالح. أدخل نطاق سليم مثل rased.example.com أو IP محلي');
    return;
  }

  hideError('serverError');
  document.getElementById('serverUrl').value = serverUrl;
  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = 'block';
  document.getElementById('step-indicator-1').classList.remove('active');
  document.getElementById('step-indicator-1').classList.add('done');
  document.getElementById('step-indicator-2').classList.add('active');
}

function goBackToStep1() {
  document.getElementById('step-2').style.display = 'none';
  document.getElementById('step-1').style.display = 'block';
  document.getElementById('step-indicator-2').classList.remove('active');
  document.getElementById('step-indicator-1').classList.remove('done');
  document.getElementById('step-indicator-1').classList.add('active');
}

async function testConnection() {
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showError('loginError', 'يرجى إدخال البريد الإلكتروني وكلمة المرور');
    return;
  }

  document.getElementById('testBtnText').style.display = 'none';
  document.getElementById('testBtnLoader').style.display = 'inline-block';
  document.getElementById('btnTestConnection').disabled = true;
  hideError('loginError');

  try {
    const result = await rased.connection.test(serverUrl, email, password);
    if (result.success) {
      loginData = result.data;

      document.getElementById('step-2').style.display = 'none';
      document.getElementById('step-3').style.display = 'block';
      document.getElementById('step-indicator-2').classList.remove('active');
      document.getElementById('step-indicator-2').classList.add('done');
      document.getElementById('step-indicator-3').classList.add('active');

      document.getElementById('confirmServer').textContent = serverUrl;
      document.getElementById('confirmEmail').textContent = email;
      document.getElementById('confirmCompany').textContent =
        loginData.user?.company_name || loginData.companyId || '-';
    } else {
      showError('loginError', result.error || 'تعذر الاتصال بالخادم، تحقق من صحة العنوان والبيانات');
    }
  } catch (err) {
    showError('loginError', 'خطأ في الاتصال: ' + (err.message || 'فشل الاتصال'));
  } finally {
    document.getElementById('testBtnText').style.display = 'inline';
    document.getElementById('testBtnLoader').style.display = 'none';
    document.getElementById('btnTestConnection').disabled = false;
  }
}

async function completeSetup() {
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const email = document.getElementById('email').value.trim();
  const autoStart = document.getElementById('autoStart').checked;

  await rased.config.set('autoStart', autoStart);

  await rased.setup.complete({
    serverUrl,
    email,
    accessToken: loginData.accessToken,
    refreshToken: loginData.refreshToken,
    companyId: loginData.companyId,
  });
}

function togglePassword() {
  const input = document.getElementById('password');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (document.getElementById('step-1').style.display !== 'none') {
      goToStep2();
    } else if (document.getElementById('step-2').style.display !== 'none') {
      testConnection();
    }
  }
});
