/**
 * JagoTrack v2 — Google Apps Script Backend (Kode.gs)
 * Fitur: Server Login Lintas HP, Verifikasi OTP Email 6 Digit, Built-in OpenRouter AI Proxy, & 2-Way Sync
 * Deployment: Web App | Execute as: Me | Who has access: Anyone
 */

// Opsional: Tempelkan API Key OpenRouter (sk-or-v1-...) Anda di bawah ini agar JagoAI otomatis aktif di semua HP tanpa perlu Settings:
const OPENROUTER_API_KEY = '';

// Model OpenRouter (ID dicek di openrouter.ai/models). Ganti di sini bila ID berubah.
// Teks, skor kesehatan finansial, pemecahan kalimat transaksi -> NVIDIA Nemotron 3 Ultra
const OPENROUTER_TEXT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
// Foto struk belanja (gambar) -> inclusionAI Ling 3.2 Flash. Juga cadangan bila Nemotron gagal.
const OPENROUTER_VISION_MODEL = 'inclusionai/ling-3.2-flash:free';

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonOut_({ status: 'error', message: 'Permintaan tidak valid.' });
  }
  var action = payload.action || '';

  // Kunci skrip: mencegah dua perangkat menulis Sheet bersamaan (data bisa rusak/hilang).
  // Panggilan AI bisa memakan puluhan detik, jadi TIDAK memegang kunci agar sinkronisasi lain tidak terblokir.
  var needsLock = action !== 'askAI' && action !== 'ping';
  var lock = LockService.getScriptLock();
  if (needsLock) {
    try {
      lock.waitLock(25000);
    } catch (lockErr) {
      return jsonOut_({ status: 'error', message: 'Server sedang sibuk, coba lagi sebentar.' });
    }
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);

    if (action === 'ping') return jsonOut_({ status: 'ok', message: 'JagoTrack GAS v2 Live' });
    if (action === 'askAI') return handleAskAi_(ss, payload);
    if (action === 'sendOtp') return handleSendOtp_(ss, payload);
    if (action === 'register') return handleRegister_(ss, payload);
    if (action === 'login') return handleLogin_(ss, payload);
    if (action === 'loginWithOtp') return handleLoginWithOtp_(ss, payload);
    if (action === 'syncUserKey') return handleSyncUserKey_(ss, payload);
    if (action === 'updateProfile') return handleUpdateProfile_(ss, payload);
    if (action === 'changePassword') return handleChangePassword_(ss, payload);
    if (action === 'upgradePasswordHash') return handleUpgradeHash_(ss, payload);
    if (action === 'syncTwoWay') return handleSyncTwoWay_(ss, payload);
    if (action === 'getMarketPrices') return handleMarketPrices_(ss, payload);

    return jsonOut_({ status: 'error', message: 'Aksi tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut_({ status: 'error', message: err.toString() });
  } finally {
    if (needsLock) lock.releaseLock();
  }
}

function handleAskAi_(ss, p) {
  if (!verifyToken_(ss, String(p.userId || ''), p.sessionToken)) {
    return jsonOut_({ status: 'error', message: 'Sesi tidak valid. Silakan masuk ulang.' });
  }
  var apiKey = String(OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return jsonOut_({ status: 'error', message: 'OPENROUTER_API_KEY belum diisi di Kode.gs.' });
  }

  var hasImage = !!(p.imagePart && p.imagePart.data);
  // Foto struk -> Ling (vision). Teks -> Nemotron; bila gagal (limit gratis/error), Ling mengambil alih.
  var models = hasImage
    ? [OPENROUTER_VISION_MODEL]
    : [OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL];

  var content = hasImage
    ? [
        { type: 'text', text: p.prompt || '' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:' + (p.imagePart.mimeType || 'image/jpeg') + ';base64,' + p.imagePart.data
          }
        }
      ]
    : (p.prompt || '');

  var lastErr = 'Layanan AI tidak merespons.';
  for (var m = 0; m < models.length; m++) {
    try {
      var res = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'HTTP-Referer': 'https://jagotrack.app',
          'X-Title': 'JagoTrack'
        },
        payload: JSON.stringify({
          model: models[m],
          messages: [{ role: 'user', content: content }],
          temperature: 0.25
        })
      });
      var code = res.getResponseCode();
      var data = {};
      try { data = JSON.parse(res.getContentText() || '{}'); } catch (parseErr) {}
      if (code >= 200 && code < 300) {
        var replyText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if (replyText) return jsonOut_({ status: 'ok', reply: replyText, model: models[m] });
        lastErr = 'AI mengembalikan jawaban kosong.';
        continue;
      }
      lastErr = (data.error && data.error.message) ? data.error.message : ('OpenRouter HTTP ' + code);
    } catch (fetchErr) {
      lastErr = String(fetchErr);
    }
  }
  return jsonOut_({ status: 'error', message: lastErr });
}

function ensureSheets_(ss) {
  var schemas = {
    Users: ['userId', 'nama', 'email', 'passwordHash', 'sessionToken', 'createdAt', 'apiKey'],
    OTP: ['email', 'code', 'expiresAt'],
    Accounts: ['accountId', 'userId', 'name', 'type', 'initialBalance', 'color', 'updatedAt'],
    Transactions: ['txId', 'userId', 'tanggal', 'tipe', 'kategori', 'nominal', 'catatan', 'accountId', 'toAccountId', 'savingMode', 'assetTicker', 'assetUnits', 'isOpeningAsset', 'updatedAt'],
    Wishlists: ['wishId', 'userId', 'nama', 'icon', 'target', 'saved', 'priority', 'updatedAt'],
    Budgets: ['budgetKey', 'userId', 'kategori', 'limit', 'updatedAt'],
    Recurring: ['recId', 'userId', 'nama', 'tipe', 'accountId', 'kategori', 'nominal', 'dayOfMonth', 'lastRunMonth', 'updatedAt']
  };
  Object.keys(schemas).forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(schemas[name]);
      sh.setFrozenRows(1);
    }
  });
}

function handleSendOtp_(ss, p) {
  var email = String(p.email || '').toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonOut_({ status: 'error', message: 'Masukkan alamat email yang valid.' });
  }

  if (MailApp.getRemainingDailyQuota() < 1) {
    return jsonOut_({ status: 'error', message: 'Kuota pengiriman email harian Google Apps Script telah habis.' });
  }

  var usersSh = ss.getSheetByName('Users');
  var userRows = usersSh.getDataRange().getValues();
  var exists = false;
  for (var i = 1; i < userRows.length; i++) {
    if (String(userRows[i][2]).toLowerCase().trim() === email) {
      exists = true;
      break;
    }
  }
  if (p.purpose === 'register' && exists) {
    return jsonOut_({ status: 'error', message: 'Email sudah terdaftar. Silakan masuk di tab Masuk Akun.' });
  }
  if (p.purpose === 'login' && !exists) {
    return jsonOut_({ status: 'error', message: 'Email belum terdaftar. Silakan buat akun di tab Daftar Baru.' });
  }

  var cdKey = 'otpcd_' + email;
  if (CacheService.getScriptCache().get(cdKey)) {
    return jsonOut_({ status: 'error', message: 'Tunggu 60 detik sebelum meminta OTP baru.' });
  }
  CacheService.getScriptCache().put(cdKey, '1', 60);
  // OTP dari UUID acak (lebih sulit ditebak daripada Math.random)
  var code = String(parseInt(Utilities.getUuid().replace(/-/g, '').substring(0, 8), 16) % 900000 + 100000);
  var expiresAt = Date.now() + 5 * 60 * 1000;

  var otpSh = ss.getSheetByName('OTP');
  var rows = otpSh.getDataRange().getValues();
  var updated = false;
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][0]).toLowerCase().trim() === email) {
      otpSh.getRange(r + 1, 2, 1, 2).setValues([["'" + code, expiresAt]]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    otpSh.appendRow([email, "'" + code, expiresAt]);
  }

  MailApp.sendEmail({
    to: email,
    subject: 'Kode Verifikasi OTP JagoTrack: ' + code,
    body: 'Kode OTP JagoTrack Anda adalah: ' + code + ' (Berlaku 5 menit).',
    name: 'JagoTrack Security'
  });

  return jsonOut_({
    status: 'ok',
    message: 'Kode OTP 6 digit telah dikirim ke ' + email + '. Silakan cek Kotak Masuk atau folder Spam.'
  });
}

function verifyOtpValid_(ss, email, code) {
  var otpSh = ss.getSheetByName('OTP');
  var rows = otpSh.getDataRange().getValues();
  var cleanInput = String(code || '').trim();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === email) {
      var savedCode = String(rows[i][1]).replace(/^'/, '').trim();
      var exp = Number(rows[i][2]) || 0;
      return savedCode === cleanInput && Date.now() <= exp;
    }
  }
  return false;
}

function deleteOtpRow_(ss, email) {
  var otpSh = ss.getSheetByName('OTP');
  var rows = otpSh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).toLowerCase().trim() === email) {
      otpSh.deleteRow(i + 1);
    }
  }
}

function consumeOtp_(ss, email, code) {
  var key = 'otp_' + email;
  if (tooManyAttempts_(key, 5)) return false;
  if (!verifyOtpValid_(ss, email, code)) { addAttempt_(key, 600); return false; }
  CacheService.getScriptCache().remove(key);
  deleteOtpRow_(ss, email);
  return true;
}

function handleRegister_(ss, p) {
  p = p || {};
  var u = p.user || p;
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  var email = String(u.email || '').toLowerCase().trim();
  if (!email) return jsonOut_({ status: 'error', message: 'Email wajib diisi.' });
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).toLowerCase().trim() === email) {
      return jsonOut_({ status: 'error', message: 'Email sudah terdaftar.' });
    }
  }
  var otpCode = p.otp || u.otp || '';
  var regKey = 'otp_' + email;
  if (tooManyAttempts_(regKey, 5) || !verifyOtpValid_(ss, email, otpCode)) {
    addAttempt_(regKey, 600);
    return jsonOut_({ status: 'error', message: 'Kode OTP salah atau sudah kedaluwarsa.' });
  }
  var userId = String(u.userId || ('USR-' + Date.now()));
  var token = Utilities.getUuid();
  var nama = String(u.nama || '').trim() || email.split('@')[0];
  var passwordHash = String(u.passwordHash || '');
  if (!passwordHash) return jsonOut_({ status: 'error', message: 'Kata sandi wajib diisi.' });
  var apiKey = String(u.apiKey || '');
  sh.appendRow([userId, nama, email, passwordHash, token, new Date().toISOString(), apiKey]);
  deleteOtpRow_(ss, email);
  return jsonOut_({ status: 'ok', user: { userId: userId, nama: nama, email: email, sessionToken: token, apiKey: apiKey } });
}

function handleLogin_(ss, p) {
  p = p || {};
  var u = p.user || p;
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  var email = String(u.email || '').toLowerCase().trim();
  var passHash = String(u.passwordHash || '').trim();
  var loginKey = 'login_' + email;
  if (tooManyAttempts_(loginKey, 8)) {
    return jsonOut_({ status: 'error', message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
  }
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).toLowerCase().trim() === email && String(rows[i][3]).trim() === passHash) {
      var token = issueToken_(sh, i + 1, rows[i][4]);
      return jsonOut_({
        status: 'ok',
        user: {
          userId: rows[i][0],
          nama: rows[i][1],
          email: rows[i][2],
          sessionToken: token,
          apiKey: rows[i][6] || ''
        }
      });
    }
  }
  addAttempt_(loginKey, 900);
  return jsonOut_({ status: 'error', message: 'Email atau kata sandi salah.' });
}

function handleLoginWithOtp_(ss, p) {
  var email = String(p.email || '').toLowerCase().trim();
  if (!consumeOtp_(ss, email, p.otp)) {
    return jsonOut_({ status: 'error', message: 'Kode OTP salah atau sudah kedaluwarsa.' });
  }
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).toLowerCase().trim() === email) {
      var token = issueToken_(sh, i + 1, rows[i][4]);
      return jsonOut_({
        status: 'ok',
        user: {
          userId: rows[i][0],
          nama: rows[i][1],
          email: rows[i][2],
          sessionToken: token,
          apiKey: rows[i][6] || ''
        }
      });
    }
  }
  return jsonOut_({ status: 'error', message: 'Akun tidak ditemukan.' });
}

function handleSyncUserKey_(ss, p) {
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.userId) && tokenMatches_(rows[i][4], p.sessionToken)) {
      sh.getRange(i + 1, 7).setValue(p.apiKey || '');
      return jsonOut_({ status: 'ok' });
    }
  }
  return jsonOut_({ status: 'error', message: 'Sesi tidak valid.' });
}

function handleUpdateProfile_(ss, p) {
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.userId) && tokenMatches_(rows[i][4], p.sessionToken)) {
      sh.getRange(i + 1, 2).setValue(p.nama || rows[i][1]);
      return jsonOut_({ status: 'ok' });
    }
  }
  return jsonOut_({ status: 'error', message: 'Sesi tidak valid.' });
}

function handleChangePassword_(ss, p) {
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.userId) && tokenMatches_(rows[i][4], p.sessionToken)) {
      if (String(rows[i][3]) !== String(p.oldPasswordHash)) {
        return jsonOut_({ status: 'error', message: 'Kata sandi lama salah.' });
      }
      sh.getRange(i + 1, 4).setValue(p.newPasswordHash);
      return jsonOut_({ status: 'ok' });
    }
  }
  return jsonOut_({ status: 'error', message: 'Sesi tidak valid.' });
}

function handleUpgradeHash_(ss, p) {
  var sh = ss.getSheetByName('Users');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.userId) && tokenMatches_(rows[i][4], p.sessionToken)) {
      sh.getRange(i + 1, 4).setValue(p.passwordHash);
      return jsonOut_({ status: 'ok' });
    }
  }
  return jsonOut_({ status: 'error' });
}

function handleSyncTwoWay_(ss, p) {
  var userId = String(p.userId || '');
  if (!verifyToken_(ss, userId, p.sessionToken)) {
    return jsonOut_({ status: 'error', message: 'Sesi tidak valid.' });
  }
  var deletedMap = {};
  (p.deleted || []).forEach(function(d) { deletedMap[d.type + ':' + d.id] = true; });

  var accs = mergeEntity_(ss.getSheetByName('Accounts'), userId, p.accounts || [], 'accountId', deletedMap, 'account', ['accountId','userId','name','type','initialBalance','color','updatedAt']);
  var txs = mergeEntity_(ss.getSheetByName('Transactions'), userId, p.transactions || [], 'txId', deletedMap, 'transaction', ['txId','userId','tanggal','tipe','kategori','nominal','catatan','accountId','toAccountId','savingMode','assetTicker','assetUnits','isOpeningAsset','updatedAt']);
  var wishes = mergeEntity_(ss.getSheetByName('Wishlists'), userId, p.wishlists || [], 'wishId', deletedMap, 'wishlist', ['wishId','userId','nama','icon','target','saved','priority','updatedAt']);
  var budgets = mergeEntity_(ss.getSheetByName('Budgets'), userId, p.budgets || [], 'budgetKey', deletedMap, 'budget', ['budgetKey','userId','kategori','limit','updatedAt']);
  var recs = mergeEntity_(ss.getSheetByName('Recurring'), userId, p.recurring || [], 'recId', deletedMap, 'recurring', ['recId','userId','nama','tipe','accountId','kategori','nominal','dayOfMonth','lastRunMonth','updatedAt']);

  return jsonOut_({ status: 'ok', data: { accounts: accs, transactions: txs, wishlists: wishes, budgets: budgets, recurring: recs } });
}

function mergeEntity_(sh, userId, clientItems, idKey, deletedMap, delType, cols) {
  var values = sh.getDataRange().getValues();
  var otherRows = [];
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(row[1]) !== userId) {
      otherRows.push(row);
    } else {
      var obj = {};
      cols.forEach(function(c, idx) { obj[c] = row[idx]; });
      var idVal = String(obj[idKey]);
      if (!deletedMap[delType + ':' + idVal]) map[idVal] = obj;
    }
  }
  clientItems.forEach(function(item) {
    item.userId = userId;
    var idVal = String(item[idKey]);
    if (deletedMap[delType + ':' + idVal]) return;
    var existing = map[idVal];
    if (!existing || Number(item.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      map[idVal] = item;
    }
  });
  var merged = Object.keys(map).map(function(k) { return map[k]; });
  var outRows = [cols].concat(otherRows).concat(merged.map(function(obj) {
    return cols.map(function(c) { return safeCell_(obj[c] !== undefined ? obj[c] : ''); });
  }));
  sh.clearContents();
  sh.getRange(1, 1, outRows.length, cols.length).setValues(outRows);
  return merged;
}

function handleMarketPrices_(ss, p) {
  if (!verifyToken_(ss, String(p.userId || ''), p.sessionToken)) {
    return jsonOut_({ status: 'error', message: 'Sesi tidak valid. Silakan masuk ulang.' });
  }
  var tickers = (p.tickers || []).map(function(t) { return String(t || '').toUpperCase(); })
    .filter(function(t) { return /^[A-Z0-9._-]{1,20}$/.test(t); })
    .slice(0, 30);
  var sh = ss.getSheetByName('MarketCache') || ss.insertSheet('MarketCache');
  var prices = {};
  tickers.forEach(function(tk, idx) {
    var symbol = tk.length === 4 ? 'IDX:' + tk : tk;
    sh.getRange(idx + 1, 1).setValue(tk);
    sh.getRange(idx + 1, 2).setFormula('=IFERROR(GOOGLEFINANCE("' + symbol + '","price"),0)');
  });
  SpreadsheetApp.flush();
  tickers.forEach(function(tk, idx) {
    prices[tk] = Number(sh.getRange(idx + 1, 2).getValue()) || 0;
  });
  return jsonOut_({ status: 'ok', prices: prices });
}

// Satu akun boleh login di beberapa HP: token disimpan sebagai daftar (maks 5) dipisah koma
function tokenMatches_(cell, token) {
  token = String(token || '').trim();
  if (!token) return false;
  return String(cell || '').split(',').indexOf(token) !== -1;
}

function issueToken_(sh, rowIndex, currentCell) {
  var token = Utilities.getUuid();
  var list = String(currentCell || '').split(',').filter(function(t) { return t; });
  list.push(token);
  if (list.length > 5) list = list.slice(list.length - 5);
  sh.getRange(rowIndex, 5).setValue(list.join(','));
  return token;
}

function verifyToken_(ss, userId, token) {
  var rows = ss.getSheetByName('Users').getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === userId && tokenMatches_(rows[i][4], token)) return true;
  }
  return false;
}

// Pembatas percobaan (anti tebak OTP / kata sandi)
function tooManyAttempts_(key, max) {
  var n = Number(CacheService.getScriptCache().get(key) || 0);
  return n >= max;
}
function addAttempt_(key, seconds) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), seconds);
}

// Cegah formula injection: teks diawali = + - @ diperlakukan sebagai teks biasa oleh Sheets
function safeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v))) return "'" + v;
  return v;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}