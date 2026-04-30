/* ===== NABDH نبض - app.js v5 - Profiles + People Search + DM + Live Map ===== */

const API = '';
let socket = null;
let map = null;
let mapMarkers = {};
let peopleMarkers = {};  // userId/socketId → marker
let userMarker = null, userCircle = null;
let allAlerts = [], allRates = [], allMedicines = [], allVoice = [], allSkills = [], allMarket = [];
let nearbyUsers = [];
let currentSection = 'home';
let selectedReportType = 'danger';
let selectedMarketType = 'sell';
let medFilter = 'all', marketFilter = 'all', marketCatFilter = 'all';
let rateChart = null;
let userLat = null, userLng = null;
let userLocationName = 'غير محدد';
let geoSearchTimers = {};
let chatOpen = false, chatRoom = null, chatUser = null;
let myName = localStorage.getItem('nabdh_name') || '';
let myUserId = localStorage.getItem('nabdh_uid') || generateUID();
let myProfile = JSON.parse(localStorage.getItem('nabdh_profile') || 'null');
let locationWatcher = null;
let locationUpdateTimer = null;
let heatLayer = null;
let mapHeatVisible = false;
let peopleLayerVisible = true;
let peopleSearchType = 'all';
let activeDMConversation = null;
let dmUnreadCount = 0;
let _sectionHistory = [];   // تاريخ التنقل بين الأقسام
let _historyPushing = false; // منع التكرار
let userCity  = '';   // اسم مدينة المستخدم
let userState = '';   // اسم ولاية المستخدم
let userAreaName = ''; // اسم حي/منطقة المستخدم

function generateUID() {
  const uid = 'u_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  localStorage.setItem('nabdh_uid', uid);
  return uid;
}

/* ============================================================
   INIT
============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  updateSplash('جاري التحميل...');
  if (!myName) setTimeout(showNameModal, 2000);
  // تقليل وقت الـ splash من 2.8 ثانية إلى 1.2 ثانية
  setTimeout(() => {
    document.getElementById('splash').classList.add('fade-out');
    setTimeout(() => {
      document.getElementById('splash').style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
      initApp();
    }, 400);
  }, 1200);
  startAutoLocation();
  addHeroParticles();
  loadMyProfile();
});

async function initApp() {
  connectSocket();
  // تحميل البيانات بشكل متوازٍ - لا يتوقف التطبيق إذا فشلت أي منها
  await Promise.allSettled([loadStats(), loadAlerts(), loadExchange(), loadMedicines(), loadVoice(), loadSkills(), loadMarket()]);
  initMap();
  loadConversations();
  // افتح القسم المحدد في الـ hash إن وجد
  const hash = window.location.hash.replace('#', '');
  const validSections = ['home','map','report','people','messages','profile','blood','power','prayer','medicine','voice','skills','exchange','market','hospitals','news','rides','weather','water','study','help','polls','dashboard'];
  if (hash && validSections.includes(hash) && hash !== 'home') {
    goSection(hash, false);
  }
  setInterval(() => {
    loadStats();
    if (currentSection === 'exchange') loadExchange();
    if (currentSection === 'map' || currentSection === 'home') loadNearbyAlerts();
    if (currentSection === 'messages') loadConversations();
  }, 30000);
}

function updateSplash(msg) {
  const el = document.getElementById('splashMsg');
  if (el) el.textContent = msg;
}

function addHeroParticles() {
  const hero = document.querySelector('.hero-particles');
  if (!hero) return;
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'hero-particle';
    p.style.cssText = `left:${Math.random()*100}%;bottom:0;animation-duration:${4+Math.random()*6}s;animation-delay:${Math.random()*5}s;width:${1+Math.random()*3}px;height:${1+Math.random()*3}px;opacity:${.3+Math.random()*.7};`;
    hero.appendChild(p);
  }
}

/* ============================================================
   GPS / LOCATION
============================================================ */
function startAutoLocation() {
  if (!navigator.geolocation) { setLocationDisplay('الجهاز لا يدعم GPS'); return; }
  setLocationDisplay('⏳ جاري التحديد...');
  navigator.geolocation.getCurrentPosition(
    pos => handleLocationUpdate(pos, true),
    () => {
      setLocationDisplay('📍 تعذّر التحديد التلقائي');
      setTimeout(() => navigator.geolocation.getCurrentPosition(
        pos => handleLocationUpdate(pos, true),
        () => {},
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
      ), 5000);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
  if (locationWatcher !== null) navigator.geolocation.clearWatch(locationWatcher);
  locationWatcher = navigator.geolocation.watchPosition(
    pos => handleLocationUpdate(pos, false),
    () => {},
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
  );
  if (locationUpdateTimer) clearInterval(locationUpdateTimer);
  locationUpdateTimer = setInterval(() => {
    navigator.geolocation.getCurrentPosition(
      pos => handleLocationUpdate(pos, false),
      () => {},
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }, 60000);
}

async function handleLocationUpdate(pos, showMsg) {
  const newLat = pos.coords.latitude;
  const newLng = pos.coords.longitude;
  if (userLat && userLng && !showMsg) {
    const moved = haversine(userLat, userLng, newLat, newLng) * 1000;
    if (moved < 50) return;
  }
  userLat = newLat;
  userLng = newLng;
  const name = await reverseGeocode(userLat, userLng);
  userLocationName = name;
  setLocationDisplay('📍 ' + name);
  updateSplash('تم تحديد موقعك ✓');
  if (map) updateUserMapMarker();
  if (socket) {
    const showOnMap = myProfile ? (myProfile.showOnMap !== false) : true;
    socket.emit('user_location', {
      lat: userLat, lng: userLng,
      name: myName || 'مستخدم',
      area: name,
      userId: myUserId,
      showOnMap,
      avatar: myProfile?.avatar || '',
      phone: myProfile?.phone || '',
    });
  }
  autoFillAllLocationFields(name, userLat, userLng);
  loadNearbyAlerts();
  loadNearbyUsers();
  loadNearbyPeople();
  if (showMsg) showToast('✅ موقعك: ' + name, 'success');
}

function autoFillAllLocationFields(name, lat, lng) {
  const fields = [
    { inp:'exSourceInput',   lat:'exSourceLat', lng:'exSourceLng' },
    { inp:'medAreaInput',    lat:'medLat',      lng:'medLng' },
    { inp:'voiceAreaInput',  lat:'voiceLat',    lng:'voiceLng' },
    { inp:'skillAreaInput',  lat:'skillLat',    lng:'skillLng' },
    { inp:'mAreaInput',      lat:'mLat',        lng:'mLng' },
    { inp:'reportAreaInput', lat:'reportLat',   lng:'reportLng' },
  ];
  for (const f of fields) {
    const i = document.getElementById(f.inp);
    const la = document.getElementById(f.lat);
    const lo = document.getElementById(f.lng);
    if (i && !i.value) i.value = name;
    if (la && !la.value) la.value = lat;
    if (lo && !lo.value) lo.value = lng;
  }
  ['exLocStatus','medLocStatus','voiceLocStatus','skillLocStatus','mLocStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el && (el.textContent.includes('اضغط') || el.textContent.includes('أو') || el.textContent.includes('تلقائياً'))) el.textContent = '✅ ' + name;
  });
  const rt = document.getElementById('reportLocText');
  if (rt) rt.textContent = '✅ ' + name;
  const rd = document.getElementById('reportLocDot');
  if (rd) rd.className = 'loc-dot loc-ok';
}

function requestLocation(silent = false) {
  if (!navigator.geolocation) { setLocationDisplay('الجهاز لا يدعم GPS'); return; }
  setLocationDisplay('⏳ جاري التحديد...');
  navigator.geolocation.getCurrentPosition(
    pos => handleLocationUpdate(pos, !silent),
    () => {
      setLocationDisplay('📍 الموقع غير متاح');
      if (!silent) showToast('⚠️ يمكنك إدخال موقعك يدوياً', 'error');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`);
    const d = await r.json();
    const a = d.address || {};
    return a.suburb || a.quarter || a.city_district || a.neighbourhood ||
           a.city || a.town || a.village || a.county || a.state || a.country ||
           lat.toFixed(3) + ',' + lng.toFixed(3);
  } catch {
    return lat.toFixed(3) + ',' + lng.toFixed(3);
  }
}

function setLocationDisplay(txt) {
  const t = txt.replace('📍 ', '');
  const el1 = document.getElementById('locationBarText');
  const el2 = document.getElementById('menuLocText');
  const el3 = document.getElementById('heroBadge');
  if (el1) el1.textContent = txt;
  if (el2) el2.textContent = t;
  if (el3) el3.textContent = '📍 ' + t + ' • مباشر';
}

async function attachGPS(inputId, latId, lngId, statusId, dotId) {
  const statusEl = document.getElementById(statusId);
  const dotEl = dotId ? document.getElementById(dotId) : null;
  if (statusEl) statusEl.textContent = '⏳ جاري التحديد...';
  if (dotEl) dotEl.className = 'loc-dot loc-loading';
  if (userLat && userLng) {
    fillGPSFields(inputId, latId, lngId, statusId, dotId, userLat, userLng, userLocationName);
    return;
  }
  if (!navigator.geolocation) { if (statusEl) statusEl.textContent = '❌ GPS غير متاح'; return; }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      const name = await reverseGeocode(userLat, userLng);
      userLocationName = name;
      fillGPSFields(inputId, latId, lngId, statusId, dotId, userLat, userLng, name);
      setLocationDisplay('📍 ' + name);
    },
    () => {
      if (statusEl) statusEl.textContent = '❌ تعذّر تحديد الموقع';
      if (dotEl) dotEl.className = 'loc-dot loc-err';
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function fillGPSFields(inputId, latId, lngId, statusId, dotId, lat, lng, name) {
  const inp = document.getElementById(inputId);
  const la = document.getElementById(latId);
  const lo = document.getElementById(lngId);
  const st = document.getElementById(statusId);
  const dt = dotId ? document.getElementById(dotId) : null;
  if (inp) inp.value = name;
  if (la) la.value = lat;
  if (lo) lo.value = lng;
  if (st) st.textContent = '✅ ' + name;
  if (dt) dt.className = 'loc-dot loc-ok';
}

async function loadNearbyAlerts() {
  if (!userLat) return;
  try {
    const data = await fetch('/api/alerts/nearby?lat=' + userLat + '&lng=' + userLng + '&km=100').then(r => r.json());
    allAlerts = data;
    renderHomeAlerts(); renderMapAlerts(); updateMapCounts(); updateTicker();
  } catch {}
}

async function loadNearbyUsers() {
  if (!userLat) return;
  try {
    nearbyUsers = await fetch('/api/users/nearby?lat=' + userLat + '&lng=' + userLng + '&km=100').then(r => r.json());
    renderNearbyUsers();
  } catch {}
}

async function loadNearbyPeople() {
  if (!userLat) return;
  try {
    const people = await fetch('/api/people/map').then(r => r.json());
    renderNearbyPeopleList(people);
    if (map && peopleLayerVisible) refreshPeopleMarkers(people);
    const el = document.getElementById('cnt-people');
    if (el) el.textContent = people.length;
  } catch {}
}

/* ============================================================
   NAME MODAL
============================================================ */
function showNameModal() {
  const el = document.getElementById('nameModal');
  if (el && !myName) el.classList.remove('hidden');
}
function saveName() {
  const inp = document.getElementById('nameInput');
  const n = (inp ? inp.value : '').trim();
  if (!n) return showToast('❌ أدخل اسمك أو لقباً', 'error');
  myName = n;
  localStorage.setItem('nabdh_name', n);
  document.getElementById('nameModal').classList.add('hidden');
  showToast('✅ مرحباً ' + n + '! أنت الآن جزء من نبض 💓', 'success');
  if (socket && userLat) socket.emit('user_location', { lat: userLat, lng: userLng, name: myName, area: userLocationName, userId: myUserId });
  // Auto-init profile with name
  syncProfileWithServer({ name: n });
  updateProfileUI();
}
function skipName() {
  myName = 'مستخدم';
  const el = document.getElementById('nameModal');
  if (el) el.classList.add('hidden');
}

/* ============================================================
   GEO SEARCH
============================================================ */
function searchGeoInline(inputId, dropId) {
  const q = document.getElementById(inputId).value.trim();
  const drop = document.getElementById(dropId);
  clearTimeout(geoSearchTimers[inputId]);
  if (!q || q.length < 1) { drop.classList.add('hidden'); return; }
  geoSearchTimers[inputId] = setTimeout(async () => {
    try {
      const res = await fetch('/api/geo/search?q=' + encodeURIComponent(q)).then(r => r.json());
      if (!res.length) { drop.classList.add('hidden'); return; }
      drop.innerHTML = res.map(r =>
        '<div class="geo-result-item" onclick="selectGeoResult(\'' + inputId + '\',\'' + dropId + '\',' + r.lat + ',' + r.lng + ',\'' + escJs(r.label || r.name) + '\')">' + (r.label || r.name) + '</div>'
      ).join('');
      drop.classList.remove('hidden');
    } catch {}
  }, 280);
}

function selectGeoResult(inputId, dropId, lat, lng, name) {
  const inp = document.getElementById(inputId);
  if (inp) inp.value = name.replace(/^[🇸🇩🏙️🏘️🌍]+\s?/u, '');
  document.getElementById(dropId) && document.getElementById(dropId).classList.add('hidden');
  const base = inputId.replace('Input', '');
  const la = document.getElementById(base + 'Lat');
  const lo = document.getElementById(base + 'Lng');
  if (la) la.value = lat;
  if (lo) lo.value = lng;
  if (map && inputId === 'mapSearchInput') {
    map.setView([lat, lng], 14, { animate: true });
    const msr = document.getElementById('mapSearchResults');
    if (msr) msr.classList.add('hidden');
  }
}

function searchGeo() { searchGeoInline('mapSearchInput', 'mapSearchResults'); }

document.addEventListener('click', e => {
  if (!e.target.closest('.geo-picker-wrap') && !e.target.closest('.map-search-wrap')) {
    document.querySelectorAll('.geo-dropdown, .map-search-results').forEach(d => d.classList.add('hidden'));
  }
});

/* ============================================================
   SOCKET.IO
============================================================ */
function connectSocket() {
  try {
    socket = io({ timeout: 5000, reconnectionAttempts: 3, transports: ['websocket', 'polling'] });
  } catch(e) { return; }
  socket.on('connect_error', () => { /* الاتصال اختياري */ });
  socket.on('connect_timeout', () => { /* لا يوقف التطبيق */ });
  socket.on('stats_update', s => updateStats(s));
  socket.on('new_alert', alert => onNewAlert(alert));
  socket.on('new_rate', rate => { allRates.unshift(rate); renderExchange(); });
  socket.on('new_medicine', med => { allMedicines.unshift(med); renderMedicines(); });
  socket.on('new_voice', item => { allVoice.unshift(item); renderVoice(); });
  socket.on('new_skill', skill => { allSkills.unshift(skill); renderSkills(); });
  socket.on('new_market_item', item => {
    allMarket.unshift(item); renderMarket(); renderHomeMarket();
    showNotif('🛒 إعلان جديد: ' + item.title);
  });
  socket.on('vote_update', ({ id, votes }) => {
    const a = allAlerts.find(x => x.id === id); if (a) a.votes = votes;
    document.querySelectorAll('[data-vote-id="' + id + '"]').forEach(el => el.textContent = '👍 ' + votes);
  });
  socket.on('market_like', ({ id, likes }) => {
    const m = allMarket.find(x => x.id === id); if (m) m.likes = likes;
    document.querySelectorAll('[data-like-id="' + id + '"]').forEach(el => el.textContent = '❤️ ' + likes);
  });
  socket.on('nearby_users', users => { nearbyUsers = users; renderNearbyUsers(); });
  socket.on('chat_msg', ({ room, msg }) => { if (chatOpen && chatRoom === room) appendChatMsg(msg, false); });
  socket.on('p2p_msg', msg => showNotif('💬 رسالة من ' + (msg.senderName || 'مستخدم') + ': ' + msg.text));
  socket.on('sos_alert', sos => {
    showNotif('🆘 نداء استغاثة من ' + sos.area);
    if (map && sos.lat && sos.lng) addSOSPin(sos);
  });
  socket.on('people_map_update', () => { loadNearbyPeople(); });
  // Direct Messages
  socket.on('dm_msg', ({ conversationId, msg, from }) => {
    dmUnreadCount++;
    updateDMBadge();
    var preview = msg.mediaType ? ('📎 ' + { image:'صورة', video:'فيديو', audio:'صوت', file:'ملف' }[msg.mediaType] || 'مرفق') : (msg.text || '').substring(0, 40);
    showNotif('💬 رسالة من ' + (msg.senderName || 'مستخدم') + ': ' + preview);
    if (activeDMConversation === conversationId) {
      appendDMMessage(msg, false);
    }
    // Also update dmChatMessages page if open
    var dmPage = document.getElementById('dmChatPage');
    if (dmPage && !dmPage.classList.contains('hidden') && dmCurrentUser && dmCurrentUser.id === from) {
      var container = document.getElementById('dmChatMessages');
      if (container) {
        var emptyEl = container.querySelector('.gp-empty-chat');
        if (emptyEl) container.innerHTML = '';
        var msgEl = document.createElement('div');
        msgEl.className = 'gp-msg gpm-other';
        var mediaHtml = '';
        if (msg.mediaType === 'image' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><img src="' + msg.mediaData + '" class="gpm-img" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
        } else if (msg.mediaType === 'video' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><video src="' + msg.mediaData + '" class="gpm-video" controls playsinline></video></div>';
        } else if (msg.mediaType === 'audio' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><div class="gpm-audio-player"><div class="gpa-icon">🎵</div><audio src="' + msg.mediaData + '" controls class="gpm-audio"></audio></div></div>';
        } else if (msg.mediaType === 'file' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><a href="' + msg.mediaData + '" download="' + escHtml(msg.mediaName || 'ملف') + '" class="gpm-file-link"><span>📄</span><span>' + escHtml(msg.mediaName || 'ملف') + '</span></a></div>';
        }
        msgEl.innerHTML = '<div class="gpm-author">' + escHtml(msg.senderName || 'عضو') + '</div>' + mediaHtml + (msg.text ? '<div class="gpm-text">' + escHtml(msg.text) + '</div>' : '') + '<div class="gpm-footer"><span class="gpm-time">' + timeAgo(msg.time || Date.now()) + '</span></div>';
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
      }
    }
    if (currentSection === 'messages') loadConversations();
  });
  socket.on('dm_sent', ({ conversationId, msg }) => {
    if (activeDMConversation === conversationId) appendDMMessage(msg, true);
    // Also update dmChatMessages page for the sender
    var dmPage = document.getElementById('dmChatPage');
    if (dmPage && !dmPage.classList.contains('hidden')) {
      var container = document.getElementById('dmChatMessages');
      if (container) {
        var emptyEl = container.querySelector('.gp-empty-chat');
        if (emptyEl) container.innerHTML = '';
        var msgEl = document.createElement('div');
        msgEl.className = 'gp-msg gpm-mine';
        var mediaHtml = '';
        if (msg.mediaType === 'image' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><img src="' + msg.mediaData + '" class="gpm-img" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
        } else if (msg.mediaType === 'video' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><video src="' + msg.mediaData + '" class="gpm-video" controls playsinline></video></div>';
        } else if (msg.mediaType === 'audio' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><div class="gpm-audio-player"><div class="gpa-icon">🎵</div><audio src="' + msg.mediaData + '" controls class="gpm-audio"></audio></div></div>';
        } else if (msg.mediaType === 'file' && msg.mediaData) {
          mediaHtml = '<div class="gpm-media"><a href="' + msg.mediaData + '" download="' + escHtml(msg.mediaName || 'ملف') + '" class="gpm-file-link"><span>📄</span><span>' + escHtml(msg.mediaName || 'ملف') + '</span></a></div>';
        }
        if (mediaHtml) {
          msgEl.innerHTML = mediaHtml + (msg.text ? '<div class="gpm-text">' + escHtml(msg.text) + '</div>' : '') + '<div class="gpm-footer"><span class="gpm-time">الآن</span></div>';
          container.appendChild(msgEl);
          container.scrollTop = container.scrollHeight;
        }
      }
    }
  });
}

function onNewAlert(alert) {
  allAlerts.unshift(alert);
  renderHomeAlerts(); renderMapAlerts(); addMapPin(alert); updateTicker(); updateMapCounts();
  showNotif(alert.icon + ' تنبيه جديد: ' + alert.area);
  sendBrowserNotif('نبض: ' + alert.icon + ' ' + alert.msg, alert.area);
}

/* ============================================================
   BROWSER NOTIFICATIONS
============================================================ */
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
function sendBrowserNotif(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/favicon.svg' }); } catch {}
  }
}

/* ============================================================
   STATS
============================================================ */
async function loadStats() {
  try { updateStats(await fetch('/api/stats').then(r => r.json())); } catch {}
}
function updateStats(s) {
  animateCount('liveUsers', s.users); animateCount('liveReports', s.reports);
  animateCount('hUsers', s.users); animateCount('hReports', s.reports);
  animateCount('hLives', s.lives_saved); animateCount('hCities', s.cities);
}

/* ============================================================
   ALERTS
============================================================ */
async function loadAlerts() {
  try { allAlerts = await fetch('/api/alerts').then(r => r.json()); } catch { allAlerts = []; }
  renderHomeAlerts(); updateTicker();
}
function renderHomeAlerts() {
  const el = document.getElementById('homeAlerts');
  if (!el) return;
  const list = userLat ? [...allAlerts].sort((a, b) => (dist(a) || 9999) - (dist(b) || 9999)).slice(0, 6) : allAlerts.slice(0, 6);
  el.innerHTML = list.length ? list.map(a => alertCard(a)).join('') : emptyState('🔕', 'لا توجد تنبيهات بعد', 'كن أول من يُبلّغ عن حدث في منطقتك', 'report');
}
function alertCard(a) {
  const d = dist(a);
  const distTxt = d !== null && d < 500 ? '<span class="alert-dist">📡 ' + (d < 1 ? '<1 كم' : Math.round(d) + ' كم') + '</span>' : '';
  const imgHtml = a.imageId ? '<img src="/api/image/' + a.imageId + '" style="width:100%;max-height:150px;object-fit:cover;border-radius:.5rem;margin:.5rem 0;display:block;" alt="صورة"/>' : '';
  return '<div class="alert-item type-' + a.type + '">' +
    '<div class="alert-icon">' + a.icon + '</div>' +
    '<div class="alert-body">' +
    '<div class="alert-msg">' + escHtml(a.msg) + '</div>' +
    imgHtml +
    '<div class="alert-meta">' +
    '<span class="alert-area">📍 ' + escHtml(a.area) + '</span>' + distTxt +
    '<span>🕐 ' + timeAgo(a.time) + '</span>' +
    '<button class="vote-btn" data-vote-id="' + a.id + '" onclick="vote(\'' + a.id + '\')">👍 ' + a.votes + '</button>' +
    '<button class="share-btn-sm" onclick="shareItem(\'' + escJs(a.msg) + '\',\'' + escJs(a.area) + '\')">🔗</button>' +
    '</div></div></div>';
}
function updateTicker() {
  const el = document.getElementById('alertTicker');
  if (!el) return;
  const txt = allAlerts.length
    ? allAlerts.slice(0, 10).map(a => a.icon + ' ' + a.msg + ' • ').join('') + allAlerts.slice(0, 10).map(a => a.icon + ' ' + a.msg + ' • ').join('')
    : 'مرحباً بك في نبض - ابدأ بمشاركة أول تقرير من منطقتك! 💓 ';
  el.textContent = txt;
}
async function vote(id) {
  try { await fetch('/api/alerts/' + id + '/vote', { method: 'POST' }); } catch {}
}
function shareItem(msg, area) {
  const text = '🚨 من تطبيق نبض:\n' + msg + '\n📍 ' + area + '\n\n#نبض_المدينة';
  if (navigator.share) navigator.share({ title: 'تنبيه نبض', text }).catch(() => {});
  else navigator.clipboard && navigator.clipboard.writeText(text).then(() => showToast('✅ تم النسخ', 'success'));
}

/* ============================================================
   SOS
============================================================ */
let sosTimeout = null;
function triggerSOS() {
  if (!userLat) { showToast('❌ الموقع غير محدد', 'error'); return; }
  ['sosBtn','sosHomeBtn','sosBtn2'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.add('sos-pressing');
  });
  sosTimeout = setTimeout(async () => {
    try {
      await fetch('/api/sos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: userLat, lng: userLng, name: myName || 'مستخدم', area: userLocationName }) });
      showToast('🆘 تم إرسال نداء الاستغاثة لمن حولك!', 'success');
    } catch { showToast('❌ خطأ في الإرسال', 'error'); }
    cancelSOS();
  }, 2000);
}
function cancelSOS() {
  if (sosTimeout) { clearTimeout(sosTimeout); sosTimeout = null; }
  ['sosBtn','sosHomeBtn','sosBtn2'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.remove('sos-pressing');
  });
}
function addSOSPin(sos) {
  if (!map) return;
  const icon = L.divIcon({ className: 'custom-marker', html: '<div style="font-size:2rem;animation:hb .6s ease-in-out infinite">🆘</div>', iconSize: [40, 40], iconAnchor: [20, 40] });
  L.marker([sos.lat, sos.lng], { icon }).addTo(map)
    .bindPopup('<div class="popup-title">🆘 نداء استغاثة!</div><div class="popup-area">📍 ' + escHtml(sos.area) + '</div>', { className: 'custom-popup' });
}
function openSosModal() {
  const m = document.getElementById('sosModal');
  if (m) {
    m.classList.remove('hidden');
    history.pushState({ section: currentSection, modal: 'sos' }, '', '#' + currentSection);
  }
}
function closeSosModal() {
  const m = document.getElementById('sosModal');
  if (m) m.classList.add('hidden');
}
function sendSOSAlert() {
  triggerSOS();
}
function shareSOSLocation() {
  const lat = userLat || 15.5007, lng = userLng || 32.5599;
  const name = myName || 'مستخدم نبض';
  const area = userLocationName || 'غير محدد';
  const text = '🆘 أحتاج مساعدة!\n👤 ' + name + '\n📍 ' + area + '\n🗺️ https://maps.google.com/?q=' + lat + ',' + lng + '\n💓 تطبيق نبض';
  if (navigator.share) {
    navigator.share({ title: '🆘 نداء استغاثة', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('✅ تم نسخ معلومات الموقع', 'success'));
  }
}

/* ============================================================
   MAP
============================================================ */
function initMap() {
  if (map) return;
  const center = userLat ? [userLat, userLng] : [15.5007, 32.5599];
  const zoom = userLat ? 13 : 6;
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView(center, zoom);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd' }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  fetch('/api/map').then(r => r.json()).then(pins => {
    pins.forEach(p => addMapPin(p)); renderMapAlerts(); updateMapCounts();
  }).catch(() => {});
  addSudanStatesLayer();
  if (userLat) updateUserMapMarker();
  map.on('click', e => {
    if (currentSection === 'report') {
      document.getElementById('reportLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('reportLng').value = e.latlng.lng.toFixed(6);
      reverseGeocode(e.latlng.lat, e.latlng.lng).then(name => {
        const inp = document.getElementById('reportAreaInput');
        if (inp) inp.value = name;
        showToast('📍 تم تحديد الموقع: ' + name, 'success');
      });
    }
  });
  loadHeatmapData();
  // Load people on map
  loadNearbyPeople();
}

async function loadHeatmapData() {
  try {
    const pts = await fetch('/api/heatmap').then(r => r.json());
    if (!pts.length) return;
    heatLayer = L.layerGroup();
    pts.forEach(p => {
      const c = L.circleMarker([p.lat, p.lng], {
        radius: Math.min(4 + (p.weight || 1), 12),
        color: p.type === 'danger' ? 'rgba(231,76,60,.5)' : p.type === 'warning' ? 'rgba(241,196,15,.4)' : 'rgba(26,188,156,.3)',
        fillColor: p.type === 'danger' ? 'rgba(231,76,60,.2)' : p.type === 'warning' ? 'rgba(241,196,15,.15)' : 'rgba(26,188,156,.1)',
        fillOpacity: 1, weight: 1
      });
      heatLayer.addLayer(c);
    });
  } catch {}
}

function toggleHeatmap() {
  if (!map) return;
  if (!heatLayer) return showToast('ℹ️ لا توجد بيانات كافية للخريطة الحرارية', 'success');
  mapHeatVisible = !mapHeatVisible;
  if (mapHeatVisible) { heatLayer.addTo(map); showToast('🌡️ خريطة الكثافة مفعّلة', 'success'); }
  else { heatLayer.remove(); showToast('خريطة الكثافة مُخفاة', 'success'); }
}

function addSudanStatesLayer() {
  fetch('/api/geo/sudan').then(r => r.json()).then(states => {
    states.forEach(st => {
      const circle = L.circleMarker([st.lat, st.lng], {
        radius: 8, color: 'rgba(26,188,156,0.6)', fillColor: 'rgba(26,188,156,0.12)', fillOpacity: 1, weight: 1.5
      }).addTo(map);
      circle.bindTooltip('🇸🇩 ' + st.state, { permanent: false, direction: 'top', className: 'custom-popup', opacity: .9 });
      circle.on('click', () => {
        map.setView([st.lat, st.lng], 11, { animate: true });
        const filtered = allAlerts.filter(a => a.area && a.area.includes(st.state));
        const el = document.getElementById('mapAlertsList');
        const title = document.getElementById('mapListTitle');
        if (title) title.textContent = '🇸🇩 تنبيهات ' + st.state + ' (' + filtered.length + ')';
        if (el) el.innerHTML = filtered.length ? filtered.map(a => alertCard(a)).join('') : emptyState('🗺️', 'لا توجد تنبيهات في ' + st.state, 'كن أول من يُبلّغ!', 'report');
      });
    });
  }).catch(() => {});
}

function addMapPin(pin) {
  if (!map || !pin.lat || !pin.lng) return;
  if (mapMarkers[pin.id]) mapMarkers[pin.id].remove();
  const icons = { danger: '🔴', warning: '🟡', info: '🟢' };
  const sizes = { danger: 36, warning: 30, info: 28 };
  const sz = sizes[pin.type] || 30;
  const icon = L.divIcon({
    className: 'custom-marker',
    html: '<div class="marker-inner" style="font-size:' + (sz / 16) + 'rem;animation:' + (pin.type === 'danger' ? 'hb 1.2s ease-in-out infinite' : 'none') + '">' + (icons[pin.type] || '🟡') + '</div>',
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2]
  });
  const d = dist(pin);
  const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(map).bindPopup(
    '<div class="popup-title">' + escHtml(pin.msg) + '</div>' +
    '<div class="popup-area">📍 ' + escHtml(pin.area) + '</div>' +
    '<div class="popup-votes">👍 ' + pin.votes + ' تأكيد • 🕐 ' + timeAgo(pin.time) + '</div>' +
    (d !== null ? '<div class="popup-dist">📡 ' + (d < 1 ? 'أقل من كم' : Math.round(d) + ' كم منك') + '</div>' : '') +
    '<button onclick="shareItem(\'' + escJs(pin.msg) + '\',\'' + escJs(pin.area) + '\')" style="margin-top:.4rem;background:rgba(26,188,156,.15);border:1px solid rgba(26,188,156,.3);color:#1abc9c;padding:.3rem .7rem;border-radius:8px;cursor:pointer;font-size:.78rem">🔗 شارك</button>',
    { className: 'custom-popup', maxWidth: 220 }
  );
  mapMarkers[pin.id] = marker;
}

// رسم أشخاص على الخريطة
function refreshPeopleMarkers(people) {
  if (!map) return;
  // Remove stale markers
  const newIds = new Set(people.map(p => p.socketId || p.userId));
  Object.entries(peopleMarkers).forEach(([id, m]) => {
    if (!newIds.has(id) || id === myUserId) { m.remove(); delete peopleMarkers[id]; }
  });
  people.forEach(p => {
    if (!p.lat || !p.lng) return;
    const pid = p.socketId || p.userId || p.name;
    if (pid === myUserId) return; // don't double-render self
    if (peopleMarkers[pid]) { peopleMarkers[pid].setLatLng([p.lat, p.lng]); return; }
    const avatarText = p.avatar ? p.avatar : (p.name ? p.name.substring(0, 1).toUpperCase() : '👤');
    const icon = L.divIcon({
      className: 'custom-marker',
      html: '<div class="person-map-marker" title="' + escHtml(p.name) + '">' + avatarText + '</div>',
      iconSize: [36, 36], iconAnchor: [18, 36]
    });
    const d = p.lat && userLat ? haversine(userLat, userLng, p.lat, p.lng) : null;
    const marker = L.marker([p.lat, p.lng], { icon }).addTo(map).bindPopup(
      '<div class="popup-person">' +
      '<div class="ppp-avatar">' + avatarText + '</div>' +
      '<div class="ppp-name">' + escHtml(p.name || 'مستخدم') + '</div>' +
      '<div class="ppp-area">📍 ' + escHtml(p.area || '') + '</div>' +
      (d !== null ? '<div class="ppp-dist">📡 ' + (d < 1 ? '<1' : Math.round(d)) + ' كم منك</div>' : '') +
      '<button onclick="openDirectMessage(\'' + escJs(p.userId || '') + '\',\'' + escJs(p.name || 'مستخدم') + '\')" style="margin-top:.5rem;width:100%;background:rgba(26,188,156,.15);border:1px solid rgba(26,188,156,.3);color:#1abc9c;padding:.35rem;border-radius:8px;cursor:pointer;font-size:.78rem;font-family:inherit">💬 راسله الآن</button>' +
      '</div>',
      { className: 'custom-popup', maxWidth: 200 }
    );
    peopleMarkers[pid] = marker;
  });
}

function updateUserMapMarker() {
  if (!map || !userLat) return;
  if (userMarker) { userMarker.remove(); userMarker = null; }
  if (userCircle) { userCircle.remove(); userCircle = null; }
  const icon = L.divIcon({
    className: 'custom-marker',
    html: '<div class="marker-user" style="font-size:1.7rem;animation:hb 2s ease-in-out infinite">📍</div>',
    iconSize: [38, 38], iconAnchor: [19, 38]
  });
  userMarker = L.marker([userLat, userLng], { icon, zIndexOffset: 1000 }).addTo(map)
    .bindPopup('<div class="popup-title">📍 موقعك الحالي</div><div class="popup-area">' + userLocationName + '</div><div style="font-size:.72rem;color:#8892a4;margin-top:.3rem">✅ يتجدد تلقائياً</div>', { className: 'custom-popup' });
  userCircle = L.circle([userLat, userLng], { radius: 5000, color: 'rgba(26,188,156,.7)', fillColor: 'rgba(26,188,156,.05)', fillOpacity: 1, weight: 1.5, dashArray: '6,4' }).addTo(map);
}

function locateOnMap() {
  const btn = document.getElementById('locateBtnIcon');
  if (btn) { btn.textContent = '⏳'; btn.classList.add('spin'); }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      await handleLocationUpdate(pos, false);
      if (map && userLat) map.setView([userLat, userLng], 14, { animate: true });
      if (btn) { btn.textContent = '🎯'; btn.classList.remove('spin'); }
    },
    () => { if (btn) { btn.textContent = '🎯'; btn.classList.remove('spin'); } },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function filterMap(type, btn) {
  document.querySelectorAll('.map-filters .filt').forEach(b => b.classList.remove('active-filt'));
  if (btn) btn.classList.add('active-filt');

  if (type === 'people') {
    // Show only people markers, hide alert markers
    Object.values(mapMarkers).forEach(m => m.remove ? m.remove() : null);
    loadNearbyPeople();
    document.getElementById('mapListTitle').textContent = '👥 الأشخاص على الخريطة';
    document.getElementById('mapAlertsList').innerHTML = emptyState('👥', 'يظهر الأشخاص النشطون على الخريطة', 'اضغط على أي مستخدم للتواصل معه');
    return;
  }

  // Re-show alert markers
  Object.values(mapMarkers).forEach(m => m.addTo && m.addTo(map));

  if (type !== 'all' && type !== 'nearby') allAlerts.forEach(a => { if (mapMarkers[a.id] && a.type !== type) mapMarkers[a.id].remove(); });
  if (type === 'nearby') {
    if (!userLat) { showToast('⚠️ الموقع غير محدد', 'error'); return; }
    allAlerts.forEach(a => { if (mapMarkers[a.id] && (!a.lat || !a.lng || haversine(userLat, userLng, a.lat, a.lng) > 50)) mapMarkers[a.id].remove(); });
    map.setView([userLat, userLng], 13, { animate: true });
  }
  renderMapAlerts(type);
}

function renderMapAlerts(filter) {
  filter = filter || 'all';
  const el = document.getElementById('mapAlertsList');
  const title = document.getElementById('mapListTitle');
  if (!el) return;
  let list = allAlerts;
  if (filter === 'nearby') {
    if (!userLat) return;
    list = allAlerts.filter(a => a.lat && a.lng && haversine(userLat, userLng, a.lat, a.lng) <= 50);
    if (title) title.textContent = '📡 تنبيهات قريبة (' + list.length + ')';
  } else if (filter !== 'all') {
    list = allAlerts.filter(a => a.type === filter);
    const labels = { danger: '🔴 خطر', warning: '🟡 تحذير', info: '🟢 معلومة' };
    if (title) title.textContent = '📋 ' + (labels[filter] || filter) + ' (' + list.length + ')';
  } else {
    if (title) title.textContent = '📋 جميع التنبيهات (' + list.length + ')';
  }
  el.innerHTML = list.length ? list.map(a => alertCard(a)).join('') : emptyState('🗺️', 'لا توجد تنبيهات', 'أرسل تقريرك الأول وسيظهر على الخريطة فوراً', 'report');
}

function updateMapCounts() {
  const g = id => document.getElementById(id);
  if (g('cnt-danger'))  g('cnt-danger').textContent  = allAlerts.filter(a => a.type === 'danger').length;
  if (g('cnt-warning')) g('cnt-warning').textContent = allAlerts.filter(a => a.type === 'warning').length;
  if (g('cnt-info'))    g('cnt-info').textContent    = allAlerts.filter(a => a.type === 'info').length;
  if (g('cnt-total'))   g('cnt-total').textContent   = allAlerts.length;
}

function sortAlerts(by) {
  if (by === 'votes') allAlerts.sort((a, b) => b.votes - a.votes);
  if (by === 'time')  allAlerts.sort((a, b) => b.time - a.time);
  if (by === 'nearby' && userLat) allAlerts.sort((a, b) => (dist(a) || 9999) - (dist(b) || 9999));
  renderMapAlerts();
}

function showOnMap(lat, lng, title) {
  goSection('map');
  setTimeout(() => {
    if (map) {
      map.setView([lat, lng], 16, { animate: true });
      L.popup({ className: 'custom-popup' }).setLatLng([lat, lng]).setContent('<div class="popup-title">' + escHtml(title) + '</div>').openOn(map);
    }
  }, 300);
}

/* ============================================================
   EXCHANGE
============================================================ */
async function loadExchange() {
  try { allRates = await fetch('/api/exchange').then(r => r.json()); } catch { allRates = []; }
  renderExchange();
}
function renderExchange() {
  const liveRateEl = document.getElementById('liveRate');
  if (liveRateEl) liveRateEl.textContent = allRates.length ? allRates[0].rate : '---';
  if (!allRates.length) {
    setEl('exRateMain', '---'); setEl('exUpdated', 'لم يُبلَّغ بعد');
    setEl('homeRateNum', '---'); setEl('homeRateChange', 'لم يُبلَّغ عن أي سعر بعد');
    ['exHigh', 'exLow', 'exAvg'].forEach(id => setEl(id, '-'));
    const rl = document.getElementById('ratesList');
    if (rl) rl.innerHTML = emptyState('💵', 'لا توجد أسعار بعد', 'شارك سعر الصرف من منطقتك');
    renderRateChart([]); return;
  }
  const latest = allRates[0];
  const today = allRates.filter(r => Date.now() - r.time < 86400000);
  const nums = today.map(r => r.rate);
  const hi = Math.max(...nums), lo = Math.min(...nums), avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  setEl('exRateMain', latest.rate); setEl('exUpdated', 'آخر تحديث: ' + timeAgo(latest.time) + ' • ' + latest.source);
  setEl('homeRateNum', latest.rate); setEl('homeRateChange', '📍 ' + latest.source + ' • ' + timeAgo(latest.time));
  setEl('exHigh', hi); setEl('exLow', lo); setEl('exAvg', avg);
  const rl = document.getElementById('ratesList');
  if (rl) rl.innerHTML = allRates.slice(0, 25).map(r =>
    '<div class="rate-item"><div><div class="rate-item-num">' + r.rate + ' <small style="font-size:.72rem;color:var(--text2)">ج.س / $</small></div>' +
    '<div class="rate-item-info">📍 ' + escHtml(r.source) + ' • 🕐 ' + timeAgo(r.time) + '</div></div>' +
    '<div>' + (r.verified ? '<span class="verified-badge">✅ موثق</span>' : '<span style="font-size:.72rem;color:var(--text2)">⏳ قيد التحقق</span>') +
    ' <button class="share-btn-sm" onclick="shareItem(\'' + r.rate + ' ج.س/$\',\'' + escJs(r.source) + '\')">🔗</button></div></div>'
  ).join('');
  renderRateChart(today.slice().reverse());
}
function renderRateChart(rates) {
  const cv = document.getElementById('rateChart');
  if (!cv) return;
  if (rateChart) { rateChart.destroy(); rateChart = null; }
  const noMsg = document.getElementById('noChartMsg');
  if (!rates.length) {
    cv.style.display = 'none';
    if (!noMsg) { const p = document.createElement('p'); p.id = 'noChartMsg'; p.style.cssText = 'text-align:center;color:var(--text2);padding:2rem;font-size:.85rem'; p.textContent = '📈 الرسم سيظهر بعد أول سعر مُبلَّغ عنه'; cv.parentNode.appendChild(p); }
    return;
  }
  cv.style.display = '';
  if (noMsg) noMsg.remove();
  const recent = rates.slice(-30);
  const labels = recent.map(r => { const d = new Date(r.time); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); });
  rateChart = new Chart(cv.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data: recent.map(r => r.rate), borderColor: '#f1c40f', backgroundColor: 'rgba(241,196,15,.08)', fill: true, tension: .4, pointBackgroundColor: '#f1c40f', pointRadius: 3, borderWidth: 2 }] },
    options: { responsive: true, animation: { duration: 600 }, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: '#8892a4', font: { family: 'Tajawal', size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#8892a4', font: { family: 'Tajawal', size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } } }
    }
  });
}
async function submitRate() {
  const rate = document.getElementById('newRate').value;
  const source = document.getElementById('exSourceInput').value || userLocationName;
  const lat = document.getElementById('exSourceLat').value || userLat;
  const lng = document.getElementById('exSourceLng').value || userLng;
  if (!rate || Number(rate) < 1) return showToast('❌ أدخل سعراً صحيحاً', 'error');
  const btn = document.querySelector('#sec-exchange .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  try {
    await fetch('/api/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rate, source, lat, lng }) });
    document.getElementById('newRate').value = '';
    showToast('✅ تم مشاركة السعر! شكراً', 'success');
    loadExchange();
  } catch { showToast('❌ حدث خطأ', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '📤 شارك السعر'; } }
}

/* ============================================================
   MEDICINES
============================================================ */
async function loadMedicines() {
  try { allMedicines = await fetch('/api/medicines').then(r => r.json()); } catch { allMedicines = []; }
  renderMedicines();
}
function renderMedicines() {
  const list = filterMedicines();
  const el = document.getElementById('medList');
  if (!el) return;
  if (!list.length) {
    const q = document.getElementById('medSearch') ? document.getElementById('medSearch').value : '';
    el.innerHTML = q ? emptyState('🔍', 'لا نتائج لـ "' + q + '"', 'جرب اسماً آخر') : emptyState('💊', 'لا توجد أدوية مُسجَّلة', 'أضف معلومة دواء وساعد مجتمعك');
    return;
  }
  el.innerHTML = list.map(m => {
    const d = m.lat && userLat ? haversine(userLat, userLng, m.lat, m.lng) : null;
    return '<div class="med-item ' + (m.available ? 'med-available' : 'med-unavailable') + '">' +
      '<div style="flex:1;min-width:0"><div class="med-name">' + escHtml(m.name) + '</div>' +
      (m.nameEn ? '<div class="med-name-en">' + escHtml(m.nameEn) + '</div>' : '') +
      '<div class="med-info">🏥 ' + escHtml(m.pharmacy) + '</div>' +
      '<div class="med-info">📍 ' + escHtml(m.area) + ' • 🕐 ' + timeAgo(m.time) + '</div>' +
      (d !== null ? '<div class="med-dist">📡 ' + (d < 1 ? '<1' : Math.round(d)) + ' كم</div>' : '') + '</div>' +
      '<div style="text-align:center;flex-shrink:0">' +
      '<div class="med-price ' + (m.available ? '' : 'unavail') + '">' + (m.available && m.price ? m.price + ' ج.س' : m.available ? 'متوفر' : 'غير متوفر') + '</div>' +
      '<div class="avail-badge ' + (m.available ? 'avail-yes' : 'avail-no') + '">' + (m.available ? '✅ متوفر' : '❌ نفد') + '</div>' +
      (m.lat && userLat ? '<button class="show-on-map-btn" onclick="showOnMap(' + m.lat + ',' + m.lng + ',\'' + escJs(m.name + ' - ' + m.pharmacy) + '\')">🗺️</button>' : '') +
      '</div></div>';
  }).join('');
}
function filterMedicines() {
  const q = (document.getElementById('medSearch') ? document.getElementById('medSearch').value : '').toLowerCase().trim();
  return allMedicines.filter(m => {
    const qOk = !q || m.name.includes(q) || (m.nameEn || '').toLowerCase().includes(q) || (m.pharmacy || '').includes(q) || (m.area || '').includes(q);
    const fOk = medFilter === 'all' || (medFilter === 'available' && m.available) || (medFilter === 'unavailable' && !m.available) || (medFilter === 'nearby' && m.lat && userLat && haversine(userLat, userLng, m.lat, m.lng) <= 20);
    return qOk && fOk;
  });
}
function searchMedicine() { renderMedicines(); }
function filterMed(f, btn) {
  if (f === 'nearby' && !userLat) { showToast('⚠️ الموقع غير محدد', 'error'); return; }
  medFilter = f;
  document.querySelectorAll('.med-filter-row .filt').forEach(b => b.classList.remove('active-filt'));
  btn.classList.add('active-filt');
  renderMedicines();
}
async function submitMedicine() {
  const name = document.getElementById('medName').value.trim();
  const pharmacy = document.getElementById('medPharmacy').value.trim();
  const area = document.getElementById('medAreaInput').value.trim() || userLocationName;
  const lat = document.getElementById('medLat').value || userLat;
  const lng = document.getElementById('medLng').value || userLng;
  const price = document.getElementById('medPrice').value;
  const avail = document.querySelector('[name="medAvail"]:checked') ? document.querySelector('[name="medAvail"]:checked').value === 'true' : true;
  if (!name) return showToast('❌ أدخل اسم الدواء', 'error');
  if (!pharmacy) return showToast('❌ أدخل اسم الصيدلية', 'error');
  try {
    await fetch('/api/medicines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pharmacy, area, price: Number(price) || 0, available: avail, lat, lng }) });
    ['medName', 'medPharmacy', 'medAreaInput', 'medPrice'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    showToast('✅ تم إضافة معلومة الدواء!', 'success');
    loadMedicines();
  } catch { showToast('❌ حدث خطأ', 'error'); }
}

/* ============================================================
   VOICE
============================================================ */
async function loadVoice() {
  try { allVoice = await fetch('/api/voice').then(r => r.json()); } catch { allVoice = []; }
  renderVoice();
}
function renderVoice() {
  const el = document.getElementById('voiceList');
  if (!el) return;
  const catIcons = { كهرباء: '⚡', ماء: '💧', طرق: '🛣️', صحة: '🏥', أمن: '🔒', أخرى: '📌' };
  el.innerHTML = allVoice.length ? allVoice.map(v =>
    '<div class="voice-item">' +
    '<div class="voice-item-header"><div class="voice-title">' + (catIcons[v.category] || '📌') + ' ' + escHtml(v.title) + '</div><div class="voice-cat">' + escHtml(v.category || 'أخرى') + '</div></div>' +
    (v.desc ? '<div class="voice-desc">' + escHtml(v.desc) + '</div>' : '') +
    '<div class="voice-footer"><div class="voice-meta">📍 ' + escHtml(v.area) + ' • 🕐 ' + timeAgo(v.time) + '</div>' +
    '<div style="display:flex;gap:.4rem"><button class="vote-btn" onclick="voteVoice(\'' + v.id + '\')">👍 ' + v.votes + '</button>' +
    '<button class="share-btn-sm" onclick="shareItem(\'' + escJs(v.title) + '\',\'' + escJs(v.area) + '\')">🔗</button></div></div></div>'
  ).join('') : emptyState('📢', 'لا توجد بلاغات بعد', 'كن أول من يرفع مشكلة - صوتك يصنع التغيير!');
}
async function submitVoice() {
  const title = document.getElementById('voiceTitle').value.trim();
  const desc = document.getElementById('voiceDesc').value.trim();
  const area = document.getElementById('voiceAreaInput').value.trim() || userLocationName;
  const lat = document.getElementById('voiceLat').value || userLat;
  const lng = document.getElementById('voiceLng').value || userLng;
  const category = document.getElementById('voiceCat').value;
  if (!title) return showToast('❌ أدخل عنوان المشكلة', 'error');
  try {
    await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, desc, area, category, lat, lng }) });
    document.getElementById('voiceTitle').value = ''; document.getElementById('voiceDesc').value = '';
    showToast('📢 تم إرسال صوتك!', 'success'); loadVoice();
  } catch { showToast('❌ حدث خطأ', 'error'); }
}
async function voteVoice(id) {
  try { await fetch('/api/voice/' + id + '/vote', { method: 'POST' }); const v = allVoice.find(x => x.id === id); if (v) { v.votes++; renderVoice(); } } catch {}
}

/* ============================================================
   SKILLS
============================================================ */
async function loadSkills() {
  try { allSkills = await fetch('/api/skills').then(r => r.json()); } catch { allSkills = []; }
  renderSkills();
}
function renderSkills() {
  const el = document.getElementById('skillsList');
  if (!el) return;
  el.innerHTML = allSkills.length ? allSkills.map(s =>
    '<div class="skill-item">' +
    '<div class="skill-avatar">' + escHtml(s.avatar || s.name.substring(0, 2).toUpperCase()) + '</div>' +
    '<div class="skill-body"><div class="skill-name">' + escHtml(s.name) + '</div>' +
    '<div class="skill-skill">💼 ' + escHtml(s.skill) + '</div>' +
    '<div class="skill-exchange"><span class="skill-offer">✅ ' + escHtml(s.offer) + '</span><span class="skill-want">🔄 ' + escHtml(s.want) + '</span></div>' +
    '<div class="skill-footer"><span>📍 ' + escHtml(s.area) + '</span><span class="skill-rating">⭐ ' + s.rating + '</span></div>' +
    (s.contact ? '<div class="skill-contact">📞 <a href="#" onclick="contactSeller(\'' + escJs(s.contact) + '\')">' + escHtml(s.contact) + '</a></div>' : '') +
    '<button class="chat-start-btn" onclick="openChatWith(\'' + escJs(s.name) + '\',\'' + escJs(s.area) + '\')">💬 دردشة</button>' +
    '</div></div>'
  ).join('') : emptyState('🤝', 'لا توجد مهارات بعد', 'أضف مهارتك وتواصل مع مجتمعك مجاناً!');
}
async function submitSkill() {
  const name = document.getElementById('skillName').value.trim();
  const offer = document.getElementById('skillOffer').value.trim();
  const want = document.getElementById('skillWant').value.trim();
  const contact = document.getElementById('skillContact').value.trim();
  const area = document.getElementById('skillAreaInput').value.trim() || userLocationName;
  const lat = document.getElementById('skillLat').value || userLat;
  const lng = document.getElementById('skillLng').value || userLng;
  if (!name) return showToast('❌ أدخل اسمك', 'error');
  if (!offer) return showToast('❌ أدخل ما تعرضه', 'error');
  if (!want) return showToast('❌ أدخل ما تريده', 'error');
  try {
    await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, skill: offer, offer, want, area, contact, lat, lng }) });
    ['skillName', 'skillOffer', 'skillWant', 'skillContact', 'skillAreaInput'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    showToast('🤝 تم إضافة مهارتك!', 'success'); loadSkills();
  } catch { showToast('❌ حدث خطأ', 'error'); }
}

/* ============================================================
   MARKET P2P
============================================================ */
async function loadMarket() {
  try { allMarket = await fetch('/api/market').then(r => r.json()); } catch { allMarket = []; }
  renderMarket(); renderHomeMarket();
}
function getFilteredMarket() {
  return allMarket.filter(m => {
    const typeOk = marketFilter === 'all' || m.type === marketFilter || (marketFilter === 'nearby' && m.lat && userLat && haversine(userLat, userLng, m.lat, m.lng) <= 30);
    const catOk = marketCatFilter === 'all' || m.category === marketCatFilter;
    return typeOk && catOk;
  });
}
function renderMarket() {
  const el = document.getElementById('marketList');
  if (!el) return;
  const list = getFilteredMarket();
  if (!list.length) { el.innerHTML = '<div style="grid-column:1/-1">' + emptyState('🛒', 'لا توجد إعلانات بعد', 'كن أول من ينشر إعلانه!') + '</div>'; return; }
  const typeLabel = { sell: '💰 بيع', buy: '🛍️ شراء', trade: '🔄 تبادل' };
  const typeClass = { sell: 'mc-sell', buy: 'mc-buy', trade: 'mc-trade' };
  el.innerHTML = list.map(m => {
    const d = m.lat && userLat ? haversine(userLat, userLng, m.lat, m.lng) : null;
    return '<div class="market-card" onclick="openMarketModal(\'' + m.id + '\')">' +
      '<span class="mc-type ' + (typeClass[m.type] || 'mc-sell') + '">' + (typeLabel[m.type] || 'بيع') + '</span>' +
      '<div class="mc-title">' + escHtml(m.title) + '</div>' +
      (m.price ? '<div class="mc-price">' + m.price + ' ' + (m.currency || 'ج.س') + '</div>' : '<div class="mc-price" style="color:var(--text2)">تبادل</div>') +
      '<div class="mc-meta">📍 ' + escHtml(m.area) + ' • 🕐 ' + timeAgo(m.time) + '</div>' +
      (d !== null ? '<div class="mc-dist">📡 ' + (d < 1 ? '<1' : Math.round(d)) + ' كم</div>' : '') +
      '<div class="mc-footer"><span class="mc-cat">' + escHtml(m.category) + '</span>' +
      '<span class="mc-likes" data-like-id="' + m.id + '" onclick="event.stopPropagation();likeMarket(\'' + m.id + '\')">❤️ ' + m.likes + '</span></div></div>';
  }).join('');
}
function renderHomeMarket() {
  const el = document.getElementById('homeMarket');
  if (!el) return;
  if (!allMarket.length) { el.innerHTML = emptyState('🛒', 'لا توجد إعلانات بعد', 'كن أول من ينشر!', 'market'); return; }
  el.innerHTML = allMarket.slice(0, 4).map(m =>
    '<div class="market-mini-card" onclick="openMarketModal(\'' + m.id + '\')">' +
    '<div class="mmc-left"><div class="mmc-title">' + escHtml(m.title) + '</div><div class="mmc-meta">📍 ' + escHtml(m.area) + ' • ' + m.category + '</div></div>' +
    (m.price ? '<div class="mmc-price">' + m.price + ' ' + (m.currency || 'ج.س') + '</div>' : '<div class="mmc-price" style="color:var(--text2)">تبادل</div>') +
    '</div>'
  ).join('');
}
function filterMarket(f, btn) {
  if (f === 'nearby' && !userLat) { showToast('⚠️ الموقع غير محدد', 'error'); return; }
  marketFilter = f;
  document.querySelectorAll('.market-filters .mfilt').forEach(b => b.classList.remove('active-mfilt'));
  btn.classList.add('active-mfilt'); renderMarket();
}
function filterMarketCat(cat, btn) {
  marketCatFilter = cat;
  document.querySelectorAll('.market-cats .mcat').forEach(b => b.classList.remove('active-mcat'));
  btn.classList.add('active-mcat'); renderMarket();
}
function selectMType(type, btn) {
  selectedMarketType = type;
  document.querySelectorAll('.mtype').forEach(b => b.classList.remove('active-mtype'));
  btn.classList.add('active-mtype');
}
async function submitMarket() {
  const title = document.getElementById('mTitle').value.trim();
  const desc = document.getElementById('mDesc').value.trim();
  const category = document.getElementById('mCategory').value;
  const price = document.getElementById('mPrice').value;
  const currency = document.getElementById('mCurrency').value;
  const contact = document.getElementById('mContact').value.trim();
  const area = document.getElementById('mAreaInput').value.trim() || userLocationName;
  const lat = document.getElementById('mLat').value || userLat;
  const lng = document.getElementById('mLng').value || userLng;
  if (!title) return showToast('❌ أدخل عنوان الإعلان', 'error');
  if (!contact) return showToast('❌ أدخل طريقة التواصل', 'error');
  try {
    // Upload market photo if present
    let imageId = null;
    const mPhoto = document.getElementById('marketPhoto');
    if (mPhoto && mPhoto.files && mPhoto.files[0]) {
      await new Promise(function(resolve) { uploadPhoto('marketPhoto', function(id) { imageId = id; resolve(); }); });
    }
    await fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, desc, type: selectedMarketType, price: Number(price) || 0, currency, category, contact, area, lat, lng, imageId }) });
    ['mTitle', 'mDesc', 'mPrice', 'mContact', 'mAreaInput'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    if (mPhoto) mPhoto.value = '';
    const mpv = document.getElementById('marketPhotoPreview'); if (mpv) { mpv.classList.add('hidden'); mpv.innerHTML = ''; }
    const mpn = document.getElementById('marketPhotoName'); if (mpn) mpn.textContent = '';
    showToast('🛒 تم نشر إعلانك!', 'success'); loadMarket();
  } catch { showToast('❌ حدث خطأ', 'error'); }
}
async function likeMarket(id) { try { await fetch('/api/market/' + id + '/like', { method: 'POST' }); } catch {} }
function openMarketModal(id) {
  const m = allMarket.find(x => x.id === id);
  if (!m) return;
  fetch('/api/market/' + id + '/view', { method: 'POST' }).catch(() => {});
  const typeLabel = { sell: '💰 للبيع', buy: '🛍️ مطلوب', trade: '🔄 للتبادل' };
  const typeClass = { sell: 'mc-sell', buy: 'mc-buy', trade: 'mc-trade' };
  const d = m.lat && userLat ? haversine(userLat, userLng, m.lat, m.lng) : null;
  document.getElementById('marketModalContent').innerHTML =
    '<span class="modal-type-badge ' + (typeClass[m.type] || 'mc-sell') + '">' + (typeLabel[m.type] || 'بيع') + '</span>' +
    (m.imageId ? '<img src="/api/image/' + m.imageId + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:.6rem;margin:.5rem 0;display:block;" alt="صورة المنتج"/>' : '') +
    '<div class="modal-title">' + escHtml(m.title) + '</div>' +
    (m.price ? '<div class="modal-price">' + m.price + ' ' + (m.currency || 'ج.س') + '</div>' : '<div class="modal-price" style="font-size:1.2rem;color:var(--teal)">تبادل مباشر</div>') +
    (m.desc ? '<div class="modal-desc">' + escHtml(m.desc) + '</div>' : '') +
    '<div class="modal-info-grid">' +
    '<div class="modal-info-item"><small>📍 الموقع</small><span>' + escHtml(m.area) + '</span></div>' +
    '<div class="modal-info-item"><small>📦 الفئة</small><span>' + escHtml(m.category) + '</span></div>' +
    '<div class="modal-info-item"><small>🕐 التاريخ</small><span>' + timeAgo(m.time) + '</span></div>' +
    '<div class="modal-info-item"><small>👁️ المشاهدات</small><span>' + (m.views + 1) + '</span></div>' +
    (d !== null ? '<div class="modal-info-item"><small>📡 المسافة</small><span>' + (d < 1 ? '<1' : Math.round(d)) + ' كم</span></div>' : '') + '</div>' +
    '<div style="display:flex;gap:.5rem;margin-top:.8rem">' +
    '<button class="modal-contact-btn" onclick="contactSeller(\'' + escJs(m.contact) + '\')">📞 تواصل الآن</button>' +
    '<button class="modal-contact-btn" style="background:rgba(26,188,156,.1);color:var(--teal)" onclick="closeMarketModal();openChatWith(\'' + escJs(m.title) + '\',\'' + escJs(m.area) + '\')">💬 دردشة</button></div>' +
    '<button onclick="shareItem(\'' + escJs(m.title) + '\',\'' + escJs(m.area) + '\')" style="margin-top:.5rem;width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--text2);padding:.4rem;border-radius:8px;cursor:pointer;font-family:inherit">🔗 مشاركة الإعلان</button>';
  document.getElementById('marketModal').classList.remove('hidden');
  history.pushState({ section: currentSection, modal: 'market' }, '', '#' + currentSection);
}
function closeMarketModal(e) {
  if (!e || e.target === document.getElementById('marketModal')) document.getElementById('marketModal').classList.add('hidden');
}
function contactSeller(contact) {
  if (!contact) return showToast('❌ لا توجد طريقة تواصل', 'error');
  if (contact.match(/^[\d+]+$/)) window.open('tel:' + contact);
  else if (contact.match(/^https?:\/\//)) window.open(contact);
  else showToast('📞 تواصل عبر: ' + contact, 'success');
}

/* ============================================================
   NEARBY USERS PANEL
============================================================ */
function renderNearbyUsers() {
  const el = document.getElementById('nearbyUsersPanel');
  if (!el) return;
  const countEl = document.getElementById('nearbyCount');
  if (!nearbyUsers.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (countEl) countEl.textContent = '(' + nearbyUsers.length + ' قريب منك)';
  const list = document.getElementById('nearbyUsersList');
  if (!list) return;
  list.innerHTML = nearbyUsers.slice(0, 10).map(u =>
    '<div class="nup-user" onclick="openDirectMessage(\'' + escJs(u.userId || '') + '\',\'' + escJs(u.name || 'مستخدم') + '\')">' +
    '<div class="nup-avatar">' + (u.name ? u.name.substring(0, 2).toUpperCase() : 'مج') + '</div>' +
    '<div class="nup-name">' + escHtml(u.name || 'مستخدم') + '</div>' +
    '<div class="nup-dist">📡 ' + (u.dist || '?') + ' كم</div></div>'
  ).join('');
}

function renderNearbyPeopleList(people) {
  const el = document.getElementById('nearbyPeopleList');
  if (!el) return;
  if (!people || !people.length) {
    el.innerHTML = emptyState('👥', 'لا يوجد أشخاص نشطون قريبون الآن', 'سيظهرون هنا عند فتح التطبيق');
    return;
  }
  el.innerHTML = people.slice(0, 20).map(p => {
    const d = p.lat && userLat ? haversine(userLat, userLng, p.lat, p.lng) : null;
    const avatarText = p.avatar || (p.name ? p.name.substring(0, 2).toUpperCase() : '👤');
    return '<div class="nearby-person-card" onclick="openPersonCard(\'' + escJs(p.userId || '') + '\',\'' + escJs(p.name || 'مستخدم') + '\',\'' + escJs(p.area || '') + '\',' + (p.lat || 'null') + ',' + (p.lng || 'null') + ')">' +
      '<div class="npc-avatar">' + avatarText + '</div>' +
      '<div class="npc-info">' +
      '<div class="npc-name">' + escHtml(p.name || 'مستخدم') + '</div>' +
      '<div class="npc-area">📍 ' + escHtml(p.area || 'غير محدد') + '</div>' +
      (d !== null ? '<div class="npc-dist">📡 ' + (d < 1 ? '<1' : Math.round(d)) + ' كم</div>' : '') +
      '</div>' +
      '<div class="npc-actions">' +
      '<button class="npc-msg-btn" onclick="event.stopPropagation();openDirectMessage(\'' + escJs(p.userId || '') + '\',\'' + escJs(p.name || 'مستخدم') + '\')">💬</button>' +
      '<button class="npc-map-btn" onclick="event.stopPropagation();showOnMap(' + p.lat + ',' + p.lng + ',\'' + escJs(p.name || 'مستخدم') + '\')">🗺️</button>' +
      '</div></div>';
  }).join('');
}

/* ============================================================
   PEOPLE SEARCH (Truecaller-style) - Enhanced v2
============================================================ */
let peopleSearchTimer = null;
function setPeopleSearchType(type, btn) {
  peopleSearchType = type;
  document.querySelectorAll('.psb-tab').forEach(b => b.classList.remove('active-psb-tab'));
  btn.classList.add('active-psb-tab');
  const inp = document.getElementById('peopleSearchInp');
  const icon = document.getElementById('psb-icon');
  if (inp) {
    if (type === 'phone')   { inp.placeholder = '📱 أدخل رقم الهاتف المُعلن أو الشخصي...'; if (icon) icon.textContent = '📱'; inp.type = 'tel'; }
    else if (type === 'email')   { inp.placeholder = '✉️ أدخل البريد الإلكتروني...'; if (icon) icon.textContent = '✉️'; inp.type = 'email'; }
    else if (type === 'name')    { inp.placeholder = '👤 ابحث بالاسم الكامل أو الجزئي...'; if (icon) icon.textContent = '👤'; inp.type = 'text'; }
    else if (type === 'company') { inp.placeholder = '🏢 ابحث باسم الشركة أو المسمى الوظيفي...'; if (icon) icon.textContent = '🏢'; inp.type = 'text'; }
    else { inp.placeholder = 'ابحث في جميع المواقع والشركات...'; if (icon) icon.textContent = '🔍'; inp.type = 'text'; }
    inp.focus();
  }
  searchPeople();
}

function searchPeople(instant = false) {
  clearTimeout(peopleSearchTimer);
  const delay = instant ? 0 : 400;
  peopleSearchTimer = setTimeout(async () => {
    const q = (document.getElementById('peopleSearchInp')?.value || '').trim();
    const el = document.getElementById('peopleResults');
    const statsEl = document.getElementById('psb-stats');
    if (!el) return;
    if (!q || q.length < 2) {
      el.innerHTML = '';
      if (statsEl) statsEl.style.display = 'none';
      return;
    }
    el.innerHTML = '<div class="search-loading"><div class="sl-spinner"></div>جاري البحث في جميع البيانات...</div>';
    try {
      const results = await fetch('/api/search/people?q=' + encodeURIComponent(q) + '&type=' + peopleSearchType + '&limit=30').then(r => r.json());

      // Update stats
      if (statsEl) {
        statsEl.style.display = 'flex';
        const countEl = document.getElementById('psb-count');
        const scopeEl = document.getElementById('psb-scope');
        if (countEl) countEl.textContent = results.length + ' نتيجة';
        if (scopeEl) {
          const types = [...new Set(results.map(r => r.type))];
          const labels = { person: 'أشخاص', listing: 'إعلانات', skill: 'مهارات' };
          scopeEl.textContent = types.map(t => labels[t] || t).join(' + ');
        }
      }

      if (!results.length) {
        el.innerHTML = emptyState('🔍', 'لا نتائج لـ "' + q + '"', 'جرب اسماً أو رقماً أو بريداً مختلفاً');
        return;
      }
      el.innerHTML = results.map(p => renderPersonCard(p, q)).join('');
    } catch { el.innerHTML = emptyState('⚠️', 'خطأ في البحث', 'تحقق من اتصالك وحاول مجدداً'); }
  }, delay);
}

function renderPersonCard(p, query = '') {
  const isOnline = nearbyUsers.some(u => u.userId === p.userId);
  const d = p.lat && userLat ? haversine(userLat, userLng, p.lat, p.lng) : null;
  const avatarText = p.avatar || (p.name ? p.name.substring(0, 2).toUpperCase() : '👤');
  const isPerson  = p.type === 'person'  || !p.type;
  const isListing = p.type === 'listing';
  const isSkill   = p.type === 'skill';
  const typeTag   = isListing ? '<span class="psc-type-tag psc-tag-listing">🛒 إعلان</span>' :
                    isSkill   ? '<span class="psc-type-tag psc-tag-skill">🤝 مهارة</span>' : '';

  // Public phone (always shown if exists)
  const pubPhone = p.publicPhone || '';

  return '<div class="person-search-card" onclick="openPersonCard(\'' + escJs(p.userId || '') + '\',\'' + escJs(p.name || 'مستخدم') + '\',\'' + escJs(p.area || '') + '\',' + (p.lat || 'null') + ',' + (p.lng || 'null') + ',' + JSON.stringify({avatar: p.avatar||'', bio: p.bio||'', company: p.company||'', jobTitle: p.jobTitle||'', website: p.website||'', whatsapp: p.whatsapp||'', telegram: p.telegram||'', publicPhone: pubPhone, verified: p.verified||false}).replace(/'/g,"\\'") + ')">' +
    '<div class="psc-header">' +
    '<div class="psc-avatar ' + (isOnline ? 'psc-online' : '') + '">' + avatarText + typeTag + '</div>' +
    '<div class="psc-info">' +
    '<div class="psc-name">' + escHtml(p.name || 'غير محدد') + (p.verified ? ' <span class="verified-sm">✅</span>' : '') + (isOnline ? ' <span class="online-dot-sm" title="متصل الآن">●</span>' : '') + '</div>' +
    // Job/company line
    ((p.jobTitle || p.company) ? '<div class="psc-job">' + (p.jobTitle ? '💼 ' + escHtml(p.jobTitle) : '') + (p.jobTitle && p.company ? ' • ' : '') + (p.company ? '🏢 ' + escHtml(p.company) : '') + '</div>' : '') +
    '<div class="psc-area">📍 ' + escHtml(p.area || 'غير محدد') + (d !== null ? ' • 📡 ' + (d < 1 ? '<1' : Math.round(d)) + ' كم' : '') + '</div>' +
    (p.bio ? '<div class="psc-bio">' + escHtml(p.bio.substring(0, 90)) + (p.bio.length > 90 ? '...' : '') + '</div>' : '') +
    '</div></div>' +

    // الرقم المعلن - يُعرض دائماً إذا وُجد
    (pubPhone ? '<div class="psc-public-phone"><span class="psc-pp-tag">📢 مُعلن</span><span class="psc-pp-num">' + escHtml(pubPhone) + '</span><a href="tel:' + escHtml(pubPhone) + '" class="psc-call-btn" onclick="event.stopPropagation()">📞</a></div>' : '') +

    // تفاصيل التواصل
    '<div class="psc-details">' +
    (p.phone && !pubPhone ? '<div class="psc-detail"><span class="pcd-icon">📱</span><span class="pcd-val">' + escHtml(p.phone) + '</span>' +
      '<button class="pcd-call" onclick="event.stopPropagation();contactSeller(\'' + escJs(p.phone) + '\')">📞</button></div>' : '') +
    (p.email ? '<div class="psc-detail"><span class="pcd-icon">✉️</span><span class="pcd-val">' + escHtml(p.email) + '</span></div>' : '') +
    (p.website ? '<div class="psc-detail"><span class="pcd-icon">🌐</span><a href="' + escHtml(p.website.startsWith('http') ? p.website : 'https://' + p.website) + '" target="_blank" class="pcd-link" onclick="event.stopPropagation()">' + escHtml(p.website.replace(/^https?:\/\//,'').substring(0,30)) + '</a></div>' : '') +
    '</div>' +

    // أزرار الإجراءات
    '<div class="psc-actions" onclick="event.stopPropagation()">' +
    (p.userId && isPerson ? '<button class="psc-btn psc-msg" onclick="openDirectMessage(\'' + escJs(p.userId) + '\',\'' + escJs(p.name || 'مستخدم') + '\')">💬 راسله</button>' : '') +
    (pubPhone || p.phone ? '<button class="psc-btn psc-call" onclick="contactSeller(\'' + escJs(pubPhone || p.phone) + '\')">📞 اتصال</button>' : '') +
    (p.lat ? '<button class="psc-btn psc-map" onclick="pinpointPersonOnMap(\'' + escJs(p.userId || '') + '\',\'' + escJs(p.name || 'مستخدم') + '\',' + p.lat + ',' + p.lng + ')">📍 موقعه</button>' : '') +
    '</div></div>';
}

/* ============================================================
   QUICK MESSAGE SEARCH (in messages section)
============================================================ */
let quickSearchTimer = null;
function quickSearchForMsg(query) {
  clearTimeout(quickSearchTimer);
  const resEl = document.getElementById('msgQuickResults');
  if (!query || query.length < 2) {
    if (resEl) resEl.classList.add('hidden');
    return;
  }
  quickSearchTimer = setTimeout(async () => {
    try {
      const results = await fetch('/api/search/people?q=' + encodeURIComponent(query) + '&type=name&limit=8').then(r => r.json());
      if (!results.length || !resEl) { if (resEl) resEl.classList.add('hidden'); return; }
      resEl.innerHTML = results.map(p => {
        const avatarText = p.avatar || (p.name ? p.name.substring(0, 2).toUpperCase() : '👤');
        return '<div class="mqr-item" onclick="document.getElementById(\'msgQuickSearch\').value=\'\';document.getElementById(\'msgQuickResults\').classList.add(\'hidden\');openDirectMessage(\'' + escJs(p.userId || '') + '\',\'' + escJs(p.name || 'مستخدم') + '\')">' +
          '<div class="mqr-avatar">' + avatarText + '</div>' +
          '<div class="mqr-name">' + escHtml(p.name || 'مستخدم') + '</div>' +
          '<div class="mqr-area">📍 ' + escHtml(p.area || '') + '</div>' +
          '</div>';
      }).join('');
      resEl.classList.remove('hidden');
    } catch {}
  }, 350);
}

document.addEventListener('click', e => {
  if (!e.target.closest('#msgQuickSearch') && !e.target.closest('#msgQuickResults')) {
    const r = document.getElementById('msgQuickResults');
    if (r) r.classList.add('hidden');
  }
});

/* ============================================================
   USER PROFILE
============================================================ */
function loadMyProfile() {
  const stored = localStorage.getItem('nabdh_profile');
  if (stored) {
    try { myProfile = JSON.parse(stored); } catch { myProfile = null; }
  }
  if (myProfile) {
    myName = myProfile.name || myName;
    updateProfileUI();
  }
}

/* ─────────────────────────────────────────────────────────────
   updateProfileUI  — v4.0 Full Rebuild
───────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────
   updateProfileUI  — v5.0  (2026 Ultra Modern)
───────────────────────────────────────────────────────────── */
function updateProfileUI() {
  const name   = myProfile?.name   || myName    || 'مستخدم نبض';
  const avatar = myProfile?.avatar || (name ? name.substring(0, 2).toUpperCase() : '👤');
  const area   = myProfile?.area   || userLocationName || 'غير محدد';

  // ── Name / menu ───────────────────────────────────────────
  setEl('profileHeroName', name);
  setEl('menuProfileName', name);

  // ── Location row ──────────────────────────────────────────
  const heroAreaEl = document.getElementById('profileHeroArea');
  if (heroAreaEl) {
    const span = heroAreaEl.querySelector('span');
    if (span) span.textContent = area;
    else heroAreaEl.textContent = area;
  }

  // ── Job title ─────────────────────────────────────────────
  const heroJob = document.getElementById('profileHeroJob');
  if (heroJob) {
    const jobStr = [myProfile?.jobTitle, myProfile?.company].filter(Boolean).join(' • ');
    heroJob.textContent = jobStr;
    heroJob.classList.toggle('hidden', !jobStr);
  }

  // ── Avatar display ────────────────────────────────────────
  const avatarDisplay = avatar.length <= 3 ? avatar : avatar.substring(0, 2);
  ['profileAvatarBig', 'menuAvatar', 'peAvatarPreview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = avatarDisplay;
  });

  // ── Restore profile photo if saved ───────────────────────
  if (myProfile?.profileImage) {
    ['profilePhotoDisplay','pePhotoImg'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.src = myProfile.profileImage; el.classList.remove('hidden'); el.style.display = 'block'; }
    });
    const bigAv = document.getElementById('profileAvatarBig');
    if (bigAv) bigAv.style.display = 'none';
  }

  // ── Cover gradient (v5) ───────────────────────────────────
  const cover = document.getElementById('profileCover');
  if (cover) {
    const covers = [
      'linear-gradient(135deg,#0d2233 0%,#1a3a4a 60%,#0a1a2a 100%)',
      'linear-gradient(135deg,#1a0d33 0%,#2d1b4e 60%,#0d0a2a 100%)',
      'linear-gradient(135deg,#0d2a1a 0%,#1a4a2e 60%,#0a1a0d 100%)',
      'linear-gradient(135deg,#2a0d0d 0%,#4a1a1a 60%,#1a0a0a 100%)',
      'linear-gradient(135deg,#0d1a33 0%,#1a2a4a 60%,#0a0d1a 100%)',
      'linear-gradient(135deg,#1a1a0d 0%,#3a2a1a 60%,#0d0d0a 100%)',
      'linear-gradient(135deg,#061a1a 0%,#0d3a3a 60%,#030d0d 100%)',
      'linear-gradient(135deg,#1a0d1a 0%,#330d33 60%,#0d060d 100%)',
    ];
    const idx = myProfile?.coverIndex ?? (name.charCodeAt(0) % covers.length);
    cover.style.background = covers[idx % covers.length];
    cover.style.transition = 'background .6s ease';
  }

  // ── Verified badge ────────────────────────────────────────
  const vBadge = document.getElementById('profileVerifiedBadge');
  if (vBadge) vBadge.style.display = myProfile?.verified ? 'inline-flex' : 'none';

  // ── Public phone bar ──────────────────────────────────────
  const pubPhone    = myProfile?.publicPhone;
  const pubPhoneBar = document.getElementById('publicPhoneBar');
  const ppbNumber   = document.getElementById('ppb-number');
  const pvPubRow    = document.getElementById('pv-public-phone-row');
  const pvPubPhone  = document.getElementById('pv-public-phone');
  if (pubPhoneBar) { pubPhoneBar.style.display = pubPhone ? 'flex' : 'none'; pubPhoneBar.classList.toggle('hidden', !pubPhone); }
  if (ppbNumber)   ppbNumber.textContent = pubPhone || '—';
  if (pvPubRow)    pvPubRow.style.display = pubPhone ? 'flex' : 'none';
  if (pvPubPhone)  pvPubPhone.textContent = pubPhone || '—';

  // ── Contact ───────────────────────────────────────────────
  setEl('pv-phone',    myProfile?.phone    || 'غير مُضاف');
  setEl('pv-email',    myProfile?.email    || 'غير مُضاف');
  setEl('pv-whatsapp', myProfile?.whatsapp || '—');
  setEl('pv-telegram', myProfile?.telegram || '—');

  const phoneCallBtn = document.getElementById('pv-phone-call-btn');
  if (phoneCallBtn) phoneCallBtn.style.display = myProfile?.phone ? 'inline-flex' : 'none';

  const emailLink = document.getElementById('pv-email-link');
  if (emailLink) {
    if (myProfile?.email) { emailLink.href = 'mailto:' + myProfile.email; emailLink.classList.remove('hidden'); emailLink.style.display = 'inline-flex'; }
    else { emailLink.classList.add('hidden'); emailLink.style.display = 'none'; }
  }
  const waLink = document.getElementById('pv-whatsapp-link');
  if (waLink) {
    if (myProfile?.whatsapp) { waLink.href = 'https://wa.me/' + myProfile.whatsapp.replace(/\D/g,''); waLink.classList.remove('hidden'); }
    else waLink.classList.add('hidden');
  }
  const tgLink = document.getElementById('pv-telegram-link');
  if (tgLink) {
    if (myProfile?.telegram) { tgLink.href = 'https://t.me/' + myProfile.telegram.replace('@',''); tgLink.classList.remove('hidden'); }
    else tgLink.classList.add('hidden');
  }

  // ── Professional ──────────────────────────────────────────
  setEl('pv-jobtitle', myProfile?.jobTitle || '—');
  setEl('pv-company',  myProfile?.company  || '—');
  const websiteEl = document.getElementById('pv-website');
  if (websiteEl) {
    websiteEl.textContent = myProfile?.website || '—';
    websiteEl.href = myProfile?.website ? (myProfile.website.startsWith('http') ? myProfile.website : 'https://' + myProfile.website) : '#';
  }
  setEl('pv-area', area);
  setEl('pv-bio',  myProfile?.bio || 'أضف نبذة عنك...');

  // ── Stats with animated counters ─────────────────────────
  if (myProfile?.joinDate) {
    const d = new Date(myProfile.joinDate);
    setEl('ps-joined', d.toLocaleDateString('ar', { year:'numeric', month:'short' }));
  }
  animateCounter('ps-reports', 0, myProfile?.reports || 0, 800);

  // ── XP + Level ────────────────────────────────────────────
  updateProfileXP();

  // ── Badges ────────────────────────────────────────────────
  updateProfileBadges();

  // ── Points card ───────────────────────────────────────────
  refreshProfilePointsCard();

  // ── Activity bars ─────────────────────────────────────────
  refreshActivityBars();

  // ── Sidebar WA stats ─────────────────────────────────────
  updateSidebarStats();
}

/* Update sidebar WhatsApp-style stats */
function updateSidebarStats() {
  const reports = myProfile?.reports || 0;
  const points  = myPoints || 0;
  const lvl     = getProfileLevel(points);
  const menuAvEl = document.getElementById('menuAvatar');
  if (menuAvEl) {
    const avatar = myProfile?.avatar || '👤';
    if (myProfile?.profileImage) {
      menuAvEl.innerHTML = `<img src="${myProfile.profileImage}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    } else {
      menuAvEl.textContent = avatar;
    }
  }
  setEl('menuStatReports', reports);
  setEl('menuStatPoints',  points);
  setEl('menuStatLevel',   lvl.level);
}

/* Animate a numeric counter from start to end */
function animateCounter(id, from, to, duration) {
  const el = document.getElementById(id);
  if (!el) return;
  if (from === to) { el.textContent = to; return; }
  const step  = (to - from) / (duration / 16);
  let current = from;
  const timer = setInterval(() => {
    current = Math.min(to, current + step);
    el.textContent = Math.round(current);
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 400);
    if (current >= to) clearInterval(timer);
  }, 16);
}

/* Build the 7-day activity bar chart */
function refreshActivityBars() {
  const barsEl = document.getElementById('pv4ActivityBars');
  const dotsEl = document.getElementById('pv4ActivityDots');
  if (!barsEl) return;

  // Build synthetic weekly data from reports/points (or fake it nicely)
  const reports = myProfile?.reports || 0;
  const base = Math.max(1, Math.floor(reports / 7));
  const days  = ['أ','ث','ر','خ','ج','س','ح'];
  const heights = days.map((_, i) => {
    const h = Math.round(base + Math.random() * base * 1.5);
    return Math.max(6, Math.min(40, h));
  });
  const maxH = Math.max(...heights);

  barsEl.innerHTML = heights.map((h, i) => {
    const pct = Math.round((h / maxH) * 100);
    const isToday = i === 6;
    return `<div class="pv4-act-bar ${isToday ? 'today' : ''}"
      style="height:${pct}%;flex:1;"
      title="${days[i]}: ${h} نشاط">
    </div>`;
  }).join('');

  if (dotsEl) {
    dotsEl.innerHTML = heights.map((_, i) =>
      `<div class="pv4-dot${i >= 4 ? ' active' : ''}"></div>`
    ).join('');
  }
}

function updateProfileBadges() {
  const grid = document.getElementById('profileBadgesGrid');
  if (!grid) return;
  const reports  = myProfile?.reports || 0;
  const joinDays = myProfile?.joinDate ? Math.floor((Date.now() - myProfile.joinDate) / 86400000) : 0;

  const badges = [];
  badges.push('<div class="pv4-badge pv4-badge-new">🌟 عضو نبض</div>');
  if (reports >= 1)  badges.push('<div class="pv4-badge" style="border-color:rgba(231,76,60,.3);color:#e74c3c">📢 مُبلِّغ</div>');
  if (reports >= 5)  badges.push('<div class="pv4-badge" style="border-color:rgba(230,126,34,.3);color:#e67e22">🔥 مُبلِّغ نشط</div>');
  if (reports >= 20) badges.push('<div class="pv4-badge" style="border-color:rgba(52,152,219,.3);color:#3498db">⚡ خبير</div>');
  if (myProfile?.publicPhone)  badges.push('<div class="pv4-badge" style="border-color:rgba(46,204,113,.3);color:#2ecc71">📞 سهل التواصل</div>');
  if (myProfile?.jobTitle || myProfile?.company) badges.push('<div class="pv4-badge" style="border-color:rgba(155,89,182,.3);color:#9b59b6">💼 محترف</div>');
  if (myProfile?.verified)    badges.push('<div class="pv4-badge" style="border-color:rgba(26,188,156,.4);color:var(--teal)">✅ موثق</div>');
  if (myProfile?.bio && myProfile.bio.length > 20) badges.push('<div class="pv4-badge">📝 له نبذة</div>');
  if (joinDays >= 7)  badges.push('<div class="pv4-badge" style="border-color:rgba(52,152,219,.3);color:#3498db">📅 ' + joinDays + ' يوم</div>');
  if (joinDays >= 30) badges.push('<div class="pv4-badge" style="border-color:rgba(243,156,18,.3);color:#f39c12">🎖️ متحمس</div>');
  if (myProfile?.whatsapp || myProfile?.telegram) badges.push('<div class="pv4-badge" style="border-color:rgba(155,89,182,.3);color:#9b59b6">💬 متواصل</div>');
  if (myProfile?.website) badges.push('<div class="pv4-badge pv4-badge-new">🌐 له موقع</div>');
  grid.innerHTML = badges.join('');
}

function changeProfileCover() {
  const covers = [
    'linear-gradient(135deg,#0d2233 0%,#1a3a4a 60%,#0a1a2a 100%)',
    'linear-gradient(135deg,#1a0d33 0%,#2d1b4e 60%,#0d0a2a 100%)',
    'linear-gradient(135deg,#0d2a1a 0%,#1a4a2e 60%,#0a1a0d 100%)',
    'linear-gradient(135deg,#2a0d0d 0%,#4a1a1a 60%,#1a0a0a 100%)',
    'linear-gradient(135deg,#0d1a33 0%,#1a2a4a 60%,#0a0d1a 100%)',
    'linear-gradient(135deg,#1a1a0d 0%,#3a2a1a 60%,#0d0d0a 100%)',
    'linear-gradient(135deg,#061a1a 0%,#0d3a3a 60%,#030d0d 100%)',
    'linear-gradient(135deg,#1a0d1a 0%,#330d33 60%,#0d060d 100%)',
    'linear-gradient(135deg,#0d0d33 0%,#1a1a5a 60%,#06060d 100%)',
    'linear-gradient(135deg,#1a3a0d 0%,#2a5a1a 60%,#0d1a06 100%)',
  ];
  const cover = document.getElementById('profileCover');
  if (!cover) return;
  const cur  = myProfile?.coverIndex ?? 0;
  const next = (cur + 1) % covers.length;
  cover.style.background   = covers[next];
  cover.style.transition   = 'background .6s ease';
  if (!myProfile) myProfile = {};
  myProfile.coverIndex = next;
  try { localStorage.setItem('nabdh_profile', JSON.stringify(myProfile)); } catch(e) {}
  showToast('🎨 تم تغيير الغلاف', 'success');
}

function callPublicPhone() {
  const ph = myProfile?.publicPhone;
  if (ph) window.open('tel:' + ph);
  else showToast('❌ لم تُضف رقماً معلناً بعد', 'error');
}

function showMyLocationOnMap() {
  if (!userLat) { showToast('❌ الموقع غير محدد', 'error'); return; }
  goSection('map');
  setTimeout(() => {
    if (map) map.setView([userLat, userLng], 16, { animate: true });
  }, 300);
}

function toggleProfileEdit() {
  const form     = document.getElementById('profileEditForm');
  const view     = document.getElementById('profileViewCard');
  const actions  = document.getElementById('profileActions');
  const xpBar    = document.getElementById('profileXpWrap');
  const statsRow = document.querySelector('.pv4-stats-row');
  const ptsCard  = document.getElementById('profilePointsCardV2');
  if (!form) return;
  const isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden');
  if (view)     view.classList.toggle('hidden');
  if (actions)  actions.classList.toggle('hidden');
  if (ptsCard)  ptsCard.classList.toggle('hidden');
  if (xpBar)    xpBar.style.opacity    = isHidden ? '0.5' : '1';
  if (statsRow) statsRow.style.opacity = isHidden ? '0.5' : '1';

  if (isHidden) {
    // Opening → fill form
    const g = id => document.getElementById(id);
    if (g('pe-name'))         g('pe-name').value         = myProfile?.name        || myName || '';
    if (g('pe-phone'))        g('pe-phone').value        = myProfile?.phone       || '';
    if (g('pe-email'))        g('pe-email').value        = myProfile?.email       || '';
    if (g('pe-bio'))          g('pe-bio').value          = myProfile?.bio         || '';
    if (g('pe-jobtitle'))     g('pe-jobtitle').value     = myProfile?.jobTitle    || '';
    if (g('pe-company'))      g('pe-company').value      = myProfile?.company     || '';
    if (g('pe-website'))      g('pe-website').value      = myProfile?.website     || '';
    if (g('pe-public-phone')) g('pe-public-phone').value = myProfile?.publicPhone || '';
    if (g('pe-whatsapp'))     g('pe-whatsapp').value     = myProfile?.whatsapp    || '';
    if (g('pe-telegram'))     g('pe-telegram').value     = myProfile?.telegram    || '';
    if (g('pe-area'))         g('pe-area').value         = myProfile?.area || userLocationName || '';
    if (g('pe-public'))       g('pe-public').checked     = myProfile?.isPublic    !== false;
    if (g('pe-showmap'))      g('pe-showmap').checked    = myProfile?.showOnMap   !== false;
    if (g('pe-notify'))       g('pe-notify').checked     = myProfile?.notify      !== false;
    if (g('peNamePreview'))   g('peNamePreview').textContent = myProfile?.name || myName || 'مستخدم نبض';
    if (g('peAvatarPreview')) {
      const av = myProfile?.avatar || (myProfile?.name || myName || 'م').substring(0, 2).toUpperCase();
      g('peAvatarPreview').textContent = av.length <= 3 ? av : av.substring(0, 2);
    }
    if (myProfile?.profileImage && g('pePhotoImg')) {
      g('pePhotoImg').src = myProfile.profileImage;
      g('pePhotoImg').classList.remove('hidden');
      g('pePhotoImg').style.display = 'block';
      if (g('peAvatarPreview')) g('peAvatarPreview').style.display = 'none';
    }
    setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  } else {
    document.querySelector('#sec-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function saveProfile() {
  const g = id => document.getElementById(id);
  const name        = (g('pe-name')?.value         || '').trim() || myName || 'مستخدم';
  const phone       = (g('pe-phone')?.value        || '').trim();
  const email       = (g('pe-email')?.value        || '').trim();
  const bio         = (g('pe-bio')?.value          || '').trim();
  const jobTitle    = (g('pe-jobtitle')?.value     || '').trim();
  const company     = (g('pe-company')?.value      || '').trim();
  const website     = (g('pe-website')?.value      || '').trim();
  const publicPhone = (g('pe-public-phone')?.value || '').trim();
  const whatsapp    = (g('pe-whatsapp')?.value     || '').trim();
  const telegram    = (g('pe-telegram')?.value     || '').trim();
  const areaInput   = (g('pe-area')?.value         || '').trim();
  const isPublic    = g('pe-public')?.checked  !== false;
  const showOnMap   = g('pe-showmap')?.checked !== false;
  const notify      = g('pe-notify')?.checked  !== false;

  if (!name) return showToast('❌ أدخل اسمك', 'error');

  const area = areaInput || userLocationName || myProfile?.area || 'غير محدد';

  const profileData = {
    userId: myUserId, name, phone, email, bio,
    jobTitle, company, website, publicPhone, whatsapp, telegram,
    area, lat: userLat, lng: userLng,
    isPublic, showOnMap, notify,
    avatar:   myProfile?.avatar   || name.substring(0, 2).toUpperCase(),
    joinDate: myProfile?.joinDate || Date.now(),
    coverIndex: myProfile?.coverIndex,
  };

  const btn = g('profileSaveBtn') || document.querySelector('#profileEditForm .pv4-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }

  try {
    const result = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData)
    }).then(r => r.json());

    myProfile = { ...profileData, ...result.profile };
    myName = name;
    localStorage.setItem('nabdh_name', name);
    localStorage.setItem('nabdh_profile', JSON.stringify(myProfile));

    updateProfileUI();
    toggleProfileEdit();
    showToast('✅ تم حفظ ملفك الشخصي!', 'success');

    if (socket && userLat) {
      socket.emit('user_location', {
        lat: userLat, lng: userLng,
        name: myName, area: userLocationName,
        userId: myUserId, showOnMap,
        avatar: myProfile.avatar, phone: publicPhone || phone
      });
    }
  } catch { showToast('❌ حدث خطأ في الحفظ', 'error'); }
  finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> حفظ الملف الشخصي';
    }
  }
}

async function syncProfileWithServer(partial = {}) {
  try {
    const profileData = {
      userId: myUserId,
      name: myName || 'مستخدم',
      area: userLocationName,
      lat: userLat, lng: userLng,
      ...(myProfile || {}),
      ...partial,
    };
    const result = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData)
    }).then(r => r.json());
    myProfile = { ...(myProfile || {}), ...result.profile };
    localStorage.setItem('nabdh_profile', JSON.stringify(myProfile));
  } catch {}
}

function changeAvatar() {
  const emojis = ['💻','📱','🚀','🌟','💡','🎯','🔥','⚡','🌙','☀️','🌊','🎭','🎵','🎨','🏆','💎','🦁','🦅','🌺','🍃','👨‍💼','👩‍💼','👨‍🔬','👩‍🔬','👨‍🏫','👩‍🏫'];
  const cur = myProfile?.avatar || '';
  const next = emojis[(emojis.indexOf(cur) + 1) % emojis.length];
  if (!myProfile) myProfile = {};
  myProfile.avatar = next;
  localStorage.setItem('nabdh_profile', JSON.stringify(myProfile));
  updateProfileUI();
  syncProfileWithServer({ avatar: next });
  showToast('✅ تم تغيير الأفاتار', 'success');
}

/* ─────────────────────────────────────────────────────────────
   updateProfileXP — v5.0  (animated SVG arc + progress)
───────────────────────────────────────────────────────────── */
function updateProfileXP() {
  const reports  = myProfile?.reports || 0;
  const joinDays = myProfile?.joinDate ? Math.floor((Date.now() - myProfile.joinDate) / 86400000) : 0;
  const bonus    = (myProfile?.bio        ? 10 : 0) +
                   (myProfile?.publicPhone ? 15 : 0) +
                   (myProfile?.jobTitle   ?  5 : 0) +
                   (myProfile?.company    ?  5 : 0) +
                   (myProfile?.website    ?  5 : 0);
  const points   = Math.max(myPoints || 0, Math.floor(reports * 10 + joinDays * 0.5 + bonus));
  const lvl      = getProfileLevel(points);
  const progress = Math.min(100, Math.round((points - lvl.min) / Math.max(1, lvl.max - lvl.min) * 100));

  // ── Animated counters ─────────────────────────────────────
  animateCounter('ps-points', 0, points, 1000);
  setEl('ps-level', lvl.level);

  // ── Level chips (v5 IDs) ──────────────────────────────────
  const pv4Icon = document.getElementById('pv4LevelIcon');
  const pv4Text = document.getElementById('pv4LevelText');
  if (pv4Icon) pv4Icon.textContent = lvl.icon;
  if (pv4Text) pv4Text.textContent = lvl.name;

  ['profileLevelIcon','ppcLevelIcon'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=lvl.icon; });
  ['profileLevelText','ppcLevelTitle'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=lvl.name; });

  const ppcPts = document.getElementById('ppcPtsText');
  if (ppcPts) ppcPts.textContent = points + ' نقطة';

  const levelInline = document.getElementById('profileLevelBadgeInline');
  if (levelInline) levelInline.textContent = lvl.icon + ' ' + lvl.name;

  // ── XP progress bar ───────────────────────────────────────
  const pxbFill  = document.getElementById('pxbFill');
  const pxbPts   = document.getElementById('pxb-pts');
  const pxbLabel = document.getElementById('pxb-label-text');
  const nextLvl  = getProfileLevel(lvl.max);
  if (pxbFill)  pxbFill.style.width = progress + '%';
  if (pxbPts)   pxbPts.textContent  = points + ' / ' + lvl.max + ' XP';
  if (pxbLabel) pxbLabel.textContent = 'التقدم نحو مستوى ' + (lvl.level + 1) + ' · ' + nextLvl.name;

  // ── SVG arc (v5) ──────────────────────────────────────────
  const arc = document.getElementById('pv4XpArc');
  if (arc) {
    const circumference = 2 * Math.PI * 54; // r=54  → ~339.3
    arc.style.strokeDasharray  = circumference;
    arc.style.strokeDashoffset = circumference * (1 - progress / 100);
  }
  const oldRing = document.getElementById('xpRingFill');
  if (oldRing) {
    const circ = 2 * Math.PI * 40;
    oldRing.style.strokeDasharray  = circ;
    oldRing.style.strokeDashoffset = circ * (1 - progress / 100);
  }

  // ── Streak row ────────────────────────────────────────────
  const streakRow  = document.getElementById('pv4StreakRow');
  const streakText = document.getElementById('pv4StreakText');
  if (streakRow && streakText) {
    if (myStreak > 1) { streakRow.style.display = 'flex'; streakText.textContent = 'سلسلة ' + myStreak + ' يوم متتالي!'; }
    else               streakRow.style.display = 'none';
  }
  const ppcStreak = document.getElementById('ppcStreak');
  if (ppcStreak) {
    if (myStreak > 1) { ppcStreak.textContent = '🔥 سلسلة ' + myStreak + ' يوم'; ppcStreak.classList.remove('hidden'); }
    else               ppcStreak.classList.add('hidden');
  }
}


/* ============================================================
   PERSON MODAL (view another person's profile) - Enhanced
============================================================ */
async function openPersonCard(userId, name, area, lat, lng, extraData) {
  const modal = document.getElementById('personModal');
  const content = document.getElementById('personModalContent');
  if (!modal || !content) return;

  // Show loading state
  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text2)">⏳ جاري التحميل...</div>';
  modal.classList.remove('hidden');
  history.pushState({ section: currentSection, modal: 'person' }, '', '#' + currentSection);

  const d = lat && userLat ? haversine(userLat, userLng, lat, lng) : null;
  const avatarText = extraData?.avatar || (name ? name.substring(0, 2).toUpperCase() : '👤');
  const isOnline = nearbyUsers.some(u => u.userId === userId) || Object.values({}).some(() => false);

  // Try to load full profile
  let profile = extraData || {};
  if (userId) {
    try {
      const fetched = await fetch('/api/profile/' + userId).then(r => r.json());
      if (fetched && !fetched.error) profile = fetched;
    } catch {}
  }

  const phone = profile.publicPhone || '';
  const company = profile.company || '';
  const jobTitle = profile.jobTitle || '';
  const website = profile.website || '';
  const bio = profile.bio || '';
  const whatsapp = profile.whatsapp || '';
  const telegram = profile.telegram || '';

  content.innerHTML =
    '<div class="person-modal-header">' +
    '<div class="pmh-avatar ' + (isOnline ? 'pmh-online' : '') + '">' + avatarText + '</div>' +
    '<div class="pmh-info">' +
    '<div class="pmh-name">' + escHtml(name || 'مستخدم') + (profile.verified ? ' <span class="verified-sm">✅</span>' : '') + (isOnline ? ' <span class="online-dot-sm">●</span>' : '') + '</div>' +
    (jobTitle ? '<div class="pmh-job">💼 ' + escHtml(jobTitle) + (company ? ' • 🏢 ' + escHtml(company) : '') + '</div>' : (company ? '<div class="pmh-job">🏢 ' + escHtml(company) + '</div>' : '')) +
    '<div class="pmh-area">📍 ' + escHtml(area || 'غير محدد') + (d !== null ? ' • 📡 ' + (d < 1 ? '<1' : Math.round(d)) + ' كم منك' : '') + '</div>' +
    '</div></div>' +

    // الرقم المعلن
    (phone ? '<div class="pm-public-phone"><span class="pm-pp-icon">📢</span><span class="pm-pp-number">' + escHtml(phone) + '</span><a href="tel:' + escHtml(phone) + '" class="pm-pp-call">📞 اتصال</a></div>' : '') +

    // نبذة
    (bio ? '<div class="pm-bio">' + escHtml(bio) + '</div>' : '') +

    // معلومات التواصل
    '<div class="pm-contact-grid">' +
    (whatsapp ? '<a href="https://wa.me/' + whatsapp.replace(/[^0-9]/g,'') + '" target="_blank" class="pm-contact-item pm-wa">💬 واتساب</a>' : '') +
    (telegram ? '<a href="https://t.me/' + telegram.replace('@','') + '" target="_blank" class="pm-contact-item pm-tg">✈️ تيليغرام</a>' : '') +
    (website ? '<a href="' + escHtml(website.startsWith('http') ? website : 'https://' + website) + '" target="_blank" class="pm-contact-item pm-web">🌐 الموقع</a>' : '') +
    '</div>' +

    // أزرار الإجراءات
    '<div class="pm-actions">' +
    (userId ? '<button class="modal-contact-btn pm-dm-btn" onclick="closePersonModal();openDirectMessage(\'' + escJs(userId) + '\',\'' + escJs(name || 'مستخدم') + '\')">💬 راسله الآن</button>' : '') +
    (lat ? '<button class="modal-contact-btn pm-map-btn" onclick="pinpointPersonOnMap(\'' + escJs(userId || '') + '\',\'' + escJs(name || 'مستخدم') + '\',' + lat + ',' + lng + ')">📍 على الخريطة</button>' : '') +
    '</div>';
}

function closePersonModal(e) {
  if (!e || e.target === document.getElementById('personModal')) document.getElementById('personModal').classList.add('hidden');
}

// تحديد موقع شخص على الخريطة
async function pinpointPersonOnMap(userId, name, fallbackLat, fallbackLng) {
  closePersonModal();
  goSection('map');

  setTimeout(async () => {
    if (!map) return;
    let lat = fallbackLat, lng = fallbackLng;
    // Try to get live location
    if (userId) {
      try {
        const loc = await fetch('/api/people/locate/' + userId).then(r => r.json());
        if (loc.found && loc.lat) { lat = loc.lat; lng = loc.lng; }
      } catch {}
    }
    if (!lat || !lng) { showToast('⚠️ لا يوجد موقع متاح لهذا الشخص', 'error'); return; }
    map.setView([lat, lng], 16, { animate: true });
    const avatarText = (name || 'م').substring(0, 2).toUpperCase();
    const icon = L.divIcon({
      className: 'custom-marker',
      html: '<div class="person-pin-marker" style="animation:hb 1s ease-in-out infinite">' + avatarText + '</div>',
      iconSize: [44, 44], iconAnchor: [22, 44]
    });
    L.marker([lat, lng], { icon }).addTo(map)
      .bindPopup(
        '<div class="popup-person">' +
        '<div class="ppp-avatar">' + avatarText + '</div>' +
        '<div class="ppp-name">📍 ' + escHtml(name || 'مستخدم') + '</div>' +
        '<div class="ppp-area" style="font-size:.72rem;color:#8892a4">تم تحديد موقعه على الخريطة</div>' +
        (userId ? '<button onclick="openDirectMessage(\'' + escJs(userId) + '\',\'' + escJs(name || 'مستخدم') + '\')" style="margin-top:.5rem;width:100%;background:rgba(26,188,156,.15);border:1px solid rgba(26,188,156,.3);color:#1abc9c;padding:.35rem;border-radius:8px;cursor:pointer;font-size:.78rem;font-family:inherit">💬 راسله الآن</button>' : '') +
        '</div>',
        { className: 'custom-popup', maxWidth: 200 }
      ).openPopup();
    showToast('📍 تم تحديد موقع ' + name + ' على الخريطة', 'success');
  }, 300);
}

/* ============================================================
   DIRECT MESSAGES
============================================================ */
function updateDMBadge() {
  const badge = document.getElementById('dmBadgeNav');
  if (badge) {
    if (dmUnreadCount > 0) { badge.textContent = dmUnreadCount > 9 ? '9+' : dmUnreadCount; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
  const menuBadge = document.getElementById('msgBadgeMenu');
  if (menuBadge) {
    if (dmUnreadCount > 0) { menuBadge.textContent = dmUnreadCount > 9 ? '9+' : dmUnreadCount; menuBadge.classList.remove('hidden'); }
    else menuBadge.classList.add('hidden');
  }
}

async function loadConversations() {
  const el = document.getElementById('conversationsList');
  if (!el) return;
  try {
    const convs = await fetch('/api/dm/' + myUserId).then(r => r.json());
    if (!convs.length) { el.innerHTML = emptyState('💬', 'لا توجد محادثات بعد', 'ابدأ بالبحث عن شخص وأرسل له رسالة', 'people'); return; }
    el.innerHTML = convs.map(c => {
      const ot = c.otherUser || {};
      const lastMsg = c.lastMsg;
      const avatarText = ot.avatar || (ot.name ? ot.name.substring(0, 2).toUpperCase() : '👤');
      return '<div class="conv-item" onclick="openDirectMessage(\'' + escJs(ot.userId || '') + '\',\'' + escJs(ot.name || 'مستخدم') + '\')">' +
        '<div class="conv-avatar' + (c.unread > 0 ? ' conv-unread' : '') + '">' + avatarText + '</div>' +
        '<div class="conv-body">' +
        '<div class="conv-header"><span class="conv-name">' + escHtml(ot.name || 'مستخدم') + '</span>' +
        (lastMsg ? '<span class="conv-time">' + timeAgo(lastMsg.time) + '</span>' : '') + '</div>' +
        (lastMsg ? '<div class="conv-preview">' + escHtml(lastMsg.text.substring(0, 50)) + (lastMsg.text.length > 50 ? '...' : '') + '</div>' : '<div class="conv-preview" style="color:var(--text2)">ابدأ المحادثة</div>') +
        '</div>' +
        (c.unread > 0 ? '<div class="conv-badge">' + c.unread + '</div>' : '') +
        '</div>';
    }).join('');
  } catch { el.innerHTML = emptyState('⚠️', 'خطأ في تحميل الرسائل', 'حاول مجدداً'); }
}

function openDirectMessage(otherUserId, otherName) {
  if (!otherUserId) {
    showToast('⚠️ هذا المستخدم غير مسجّل بعد', 'error');
    return;
  }
  const convId = [myUserId, otherUserId].sort().join('__');
  activeDMConversation = convId;
  dmUnreadCount = Math.max(0, dmUnreadCount - 1);
  updateDMBadge();

  const modal = document.getElementById('dmModal');
  const content = document.getElementById('dmModalContent');
  if (!modal || !content) return;
  const avatarText = (otherName || 'م').substring(0, 2).toUpperCase();
  content.innerHTML =
    '<div class="dm-header">' +
    '<div class="dm-header-avatar">' + avatarText + '</div>' +
    '<div class="dm-header-info">' +
    '<div class="dm-header-name">' + escHtml(otherName || 'مستخدم') + '</div>' +
    '<div class="dm-header-sub" id="dmStatus">●  متصل</div>' +
    '</div></div>' +
    '<div class="dm-messages" id="dmMessages"><div class="chat-empty"><span style="font-size:1.5rem">💬</span><span>ابدأ المحادثة...</span></div></div>' +
    '<div class="dm-input-row">' +
    '<input class="dm-inp" id="dmInp" placeholder="اكتب رسالتك..." onkeydown="if(event.key===\'Enter\')sendDM(\'' + escJs(otherUserId) + '\')"/>' +
    '<button class="dm-send-btn" onclick="sendDM(\'' + escJs(otherUserId) + '\')">➤</button>' +
    '</div>';
  modal.classList.remove('hidden');
  history.pushState({ section: currentSection, modal: 'dm' }, '', '#' + currentSection);

  // Load history
  fetch('/api/dm/' + myUserId + '/' + otherUserId).then(r => r.json()).then(msgs => {
    const container = document.getElementById('dmMessages');
    if (!container) return;
    if (msgs.length) {
      container.innerHTML = '';
      msgs.forEach(m => appendDMMessage(m, m.senderId === myUserId));
    }
  }).catch(() => {});

  setTimeout(() => { const di = document.getElementById('dmInp'); if (di) di.focus(); }, 200);
}

async function sendDM(toUserId) {
  const inp = document.getElementById('dmInp');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  const name = myName || myProfile?.name || 'أنت';
  // Use socket for real-time delivery
  if (socket) {
    socket.emit('dm_send', { toUserId, fromUserId: myUserId, text, senderName: name });
  } else {
    // Fallback to HTTP
    try {
      await fetch('/api/dm/' + myUserId + '/' + toUserId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, senderName: name })
      });
      const convId = [myUserId, toUserId].sort().join('__');
      const msg = { id: Date.now() + '', senderId: myUserId, senderName: name, text, time: Date.now(), read: false };
      appendDMMessage(msg, true);
    } catch { showToast('❌ خطأ في الإرسال', 'error'); }
  }
}

function appendDMMessage(msg, isOwn) {
  const container = document.getElementById('dmMessages');
  if (!container) return;
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'dm-msg ' + (isOwn ? 'dm-msg-own' : 'dm-msg-other');
  var mediaHtml = '';
  if (msg.mediaType === 'image' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><img src="' + msg.mediaData + '" class="chat-media-img" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
  } else if (msg.mediaType === 'video' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><video src="' + msg.mediaData + '" class="chat-media-video" controls playsinline></video></div>';
  } else if (msg.mediaType === 'audio' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><div class="chat-audio-player"><span class="chat-audio-ico">🎵</span><audio src="' + msg.mediaData + '" controls class="chat-audio"></audio></div></div>';
  } else if (msg.mediaType === 'file' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><a href="' + msg.mediaData + '" download="' + escHtml(msg.mediaName || 'ملف') + '" class="chat-file-link"><span>📄</span><span>' + escHtml(msg.mediaName || 'ملف') + '</span></a></div>';
  }
  div.innerHTML =
    (!isOwn ? '<div class="dm-msg-sender">' + escHtml(msg.senderName || 'مستخدم') + '</div>' : '') +
    mediaHtml +
    (msg.text ? '<div class="dm-msg-text">' + escHtml(msg.text) + '</div>' : '') +
    '<div class="dm-msg-time">' + timeAgo(msg.time) + (isOwn ? (msg.read ? ' ✓✓' : ' ✓') : '') + '</div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function closeDMModal(e) {
  if (!e || e.target === document.getElementById('dmModal')) {
    document.getElementById('dmModal')?.classList.add('hidden');
    activeDMConversation = null;
  }
}

/* ============================================================
   PUBLIC CHAT
============================================================ */
function openChatWith(name, area) {
  chatUser = { name, area };
  const room = 'dm_' + [myName || 'anon', name].sort().join('_');
  openChatModal('💬 محادثة مع ' + name, area, room);
}
function openPublicChat() {
  chatRoom = 'public_general';
  openChatModal('💬 الدردشة العامة', 'مجتمع نبض', chatRoom);
}
function openChatModal(title, sub, room) {
  chatOpen = true; chatRoom = room;
  if (socket) socket.emit('join_chat', room);
  let overlay = document.getElementById('chatOverlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'chatOverlay'; overlay.className = 'chat-modal-overlay'; document.body.appendChild(overlay); }
  overlay.innerHTML =
    '<div class="chat-modal">' +
    '<div class="chat-header"><div class="chat-header-info"><div class="chat-header-title">' + escHtml(title) + '</div><div class="chat-header-sub">📍 ' + escHtml(sub) + '</div></div>' +
    '<button class="chat-close-btn" onclick="closeChat()">✕</button></div>' +
    '<div class="chat-messages" id="chatMessages"><div class="chat-empty"><span style="font-size:2rem">💬</span><span>ابدأ المحادثة...</span></div></div>' +
    '<div class="chat-input-row">' +
      '<div class="gpi-media-wrap" id="pubMediaWrap">' +
        '<button class="gpi-attach-btn" onclick="togglePubMediaMenu()" title="وسائط" id="pubAttachBtn">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        '</button>' +
        '<div class="gpi-media-menu hidden" id="pubMediaMenu">' +
          '<button class="gpi-media-item" onclick="triggerPubMedia(\'image\');closePubMediaMenu()">' +
            '<span class="gpi-media-ico" style="background:rgba(52,152,219,.15);color:#3498db">🖼️</span><span>صورة</span>' +
          '</button>' +
          '<button class="gpi-media-item" onclick="triggerPubMedia(\'camera\');closePubMediaMenu()">' +
            '<span class="gpi-media-ico" style="background:rgba(39,174,96,.15);color:#27ae60">📷</span><span>كاميرا</span>' +
          '</button>' +
          '<button class="gpi-media-item" onclick="triggerPubMedia(\'video\');closePubMediaMenu()">' +
            '<span class="gpi-media-ico" style="background:rgba(155,89,182,.15);color:#9b59b6">🎬</span><span>فيديو</span>' +
          '</button>' +
          '<button class="gpi-media-item" onclick="triggerPubMedia(\'audio\');closePubMediaMenu()">' +
            '<span class="gpi-media-ico" style="background:rgba(230,126,34,.15);color:#e67e22">🎵</span><span>صوت</span>' +
          '</button>' +
          '<button class="gpi-media-item" onclick="triggerPubMedia(\'file\');closePubMediaMenu()">' +
            '<span class="gpi-media-ico" style="background:rgba(26,188,156,.15);color:#1abc9c">📄</span><span>ملف</span>' +
          '</button>' +
          '<button class="gpi-media-item gpi-media-voice" onclick="closePubMediaMenu();startPubVoiceRecord()">' +
            '<span class="gpi-media-ico" style="background:rgba(231,76,60,.15);color:#e74c3c">🎤</span><span>تسجيل صوتي</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<input class="chat-inp" id="chatInp" placeholder="اكتب رسالتك..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendChat()}"/>' +
      '<button class="gpi-voice-quick" id="pubVoiceBtn" onmousedown="startPubVoiceRecord()" onmouseup="stopPubVoiceRecord()" ontouchstart="startPubVoiceRecord()" ontouchend="stopPubVoiceRecord()" title="اضغط مطولاً للتسجيل">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
      '</button>' +
      '<button class="chat-send-btn" onclick="sendChat()">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
      '</button>' +
      '<input type="file" id="pubImageInput"  accept="image/*"  class="hidden" onchange="uploadPubMedia(this,\'image\')"/>' +
      '<input type="file" id="pubCameraInput" accept="image/*" capture="environment" class="hidden" onchange="uploadPubMedia(this,\'image\')"/>' +
      '<input type="file" id="pubVideoInput"  accept="video/*"  class="hidden" onchange="uploadPubMedia(this,\'video\')"/>' +
      '<input type="file" id="pubAudioInput"  accept="audio/*"  class="hidden" onchange="uploadPubMedia(this,\'audio\')"/>' +
      '<input type="file" id="pubFileInput"   accept="*/*"      class="hidden" onchange="uploadPubMedia(this,\'file\')"/>' +
    '</div>' +
    '<div id="pubVoiceRecordingBar" class="gp-voice-rec-bar hidden">' +
      '<span class="gvr-pulse">🔴</span><span>جاري التسجيل...</span>' +
      '<span id="pubVoiceRecTime">0:00</span>' +
      '<button onclick="cancelPubVoiceRecord()" class="gvr-cancel">✕ إلغاء</button>' +
    '</div>' +
    '</div>';
  overlay.classList.remove('hidden'); overlay.style.display = 'flex';
  fetch('/api/chat/' + room).then(r => r.json()).then(msgs => msgs.forEach(m => appendChatMsg(m, m.sender === myName))).catch(() => {});
  setTimeout(() => { const ci = document.getElementById('chatInp'); if (ci) ci.focus(); }, 200);
}
function closeChat() {
  if (socket && chatRoom) socket.emit('leave_chat', chatRoom);
  chatOpen = false;
  const overlay = document.getElementById('chatOverlay');
  if (overlay) overlay.style.display = 'none';
}
async function sendChat() {
  const inp = document.getElementById('chatInp');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  const name = myName || 'أنت';
  const msg = { id: Date.now() + '', text, sender: name, senderArea: userLocationName, time: Date.now() };
  appendChatMsg(msg, true);
  try { await fetch('/api/chat/' + chatRoom, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, sender: name, senderArea: userLocationName }) }); } catch {}
}
function appendChatMsg(msg, isOwn) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (isOwn ? 'chat-msg-in' : 'chat-msg-out');
  var mediaHtml = '';
  if (msg.mediaType === 'image' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><img src="' + msg.mediaData + '" class="chat-media-img" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
  } else if (msg.mediaType === 'video' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><video src="' + msg.mediaData + '" class="chat-media-video" controls playsinline></video></div>';
  } else if (msg.mediaType === 'audio' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><div class="chat-audio-player"><span class="chat-audio-ico">🎵</span><audio src="' + msg.mediaData + '" controls class="chat-audio"></audio></div></div>';
  } else if (msg.mediaType === 'file' && msg.mediaData) {
    mediaHtml = '<div class="chat-media-wrap"><a href="' + msg.mediaData + '" download="' + escHtml(msg.mediaName || 'ملف') + '" class="chat-file-link"><span>📄</span><span>' + escHtml(msg.mediaName || 'ملف') + '</span></a></div>';
  }
  div.innerHTML =
    (!isOwn ? '<div class="chat-msg-sender">' + escHtml(msg.sender || 'مستخدم') + (msg.senderArea ? ' • ' + escHtml(msg.senderArea) : '') + '</div>' : '') +
    mediaHtml +
    (msg.text ? '<div class="chat-msg-body">' + escHtml(msg.text) + '</div>' : '') +
    '<div class="chat-msg-time">' + timeAgo(msg.time) + '</div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/* ============================================================
   REPORT
============================================================ */
function selectRType(type, btn) {
  selectedReportType = type;
  document.querySelectorAll('.rtype').forEach(b => b.classList.remove('active-rtype'));
  btn.classList.add('active-rtype');
}
async function submitReport() {
  const msg = document.getElementById('reportMsg').value.trim();
  const area = document.getElementById('reportAreaInput').value.trim() || userLocationName;
  const lat = document.getElementById('reportLat').value || userLat;
  const lng = document.getElementById('reportLng').value || userLng;
  if (!msg) return showToast('❌ اكتب تقريرك', 'error');
  if (msg.length < 5) return showToast('❌ وصف أكثر تفصيلاً من فضلك', 'error');
  const btn = document.querySelector('#sec-report .btn-report');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  try {
    // Upload photo first if present
    let imageId = null;
    const photoInput = document.getElementById('reportPhoto');
    if (photoInput && photoInput.files && photoInput.files[0]) {
      await new Promise(function(resolve) { uploadPhoto('reportPhoto', function(id) { imageId = id; resolve(); }); });
    }
    await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: selectedReportType, msg, area, lat: Number(lat) || null, lng: Number(lng) || null, imageId }) });
    document.getElementById('reportMsg').value = '';
    document.getElementById('reportAreaInput').value = '';
    document.getElementById('reportLat').value = '';
    document.getElementById('reportLng').value = '';
    if (photoInput) photoInput.value = '';
    const rpv = document.getElementById('reportPhotoPreview'); if (rpv) { rpv.classList.add('hidden'); rpv.innerHTML = ''; }
    const rpn = document.getElementById('reportPhotoName'); if (rpn) rpn.textContent = '';
    // Update profile reports count
    if (myProfile) { myProfile.reports = (myProfile.reports || 0) + 1; localStorage.setItem('nabdh_profile', JSON.stringify(myProfile)); updateProfileUI(); }
    showToast('🚨 تم إرسال تقريرك! شكراً - أنت تساعد مجتمعك', 'success');
    setTimeout(() => goSection('map'), 1800);
  } catch { showToast('❌ حدث خطأ', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🚨 أرسل التقرير الآن'; } }
}

/* ============================================================
   NAVIGATION
============================================================ */
function goSection(name, pushHistory) {
  // تسجيل القسم السابق في المكدس
  if (pushHistory !== false && currentSection && currentSection !== name) {
    _sectionHistory.push(currentSection);
    if (_sectionHistory.length > 30) _sectionHistory.shift();
  }
  // تحديث History API لمنع الخروج من التطبيق
  if (!_historyPushing) {
    _historyPushing = true;
    history.pushState({ section: name }, '', '#' + name);
    _historyPushing = false;
  }
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active-sec'));
  document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active-bnav'));
  const sec = document.getElementById('sec-' + name);
  if (sec) sec.classList.add('active-sec');
  const bnav = document.getElementById('bnav-' + name);
  if (bnav) bnav.classList.add('active-bnav');
  const mc = document.getElementById('mainContent'); if (mc) mc.scrollTop = 0;
  currentSection = name;
  if (name === 'map') { if (!map) initMap(); else setTimeout(() => map.invalidateSize(), 150); renderMapAlerts(); updateMapCounts(); loadNearbyUsers(); loadNearbyPeople(); }
  if (name === 'medicine') renderMedicines();
  if (name === 'voice')    renderVoice();
  if (name === 'skills')   renderSkills();
  if (name === 'exchange') { renderExchange(); loadExchange(); }
  if (name === 'market')   { renderMarket(); }
  if (name === 'home')     { renderHomeAlerts(); renderHomeMarket(); }
  if (name === 'profile')  { updateProfileUI(); syncProfileWithServer(); }
  if (name === 'people')   { loadNearbyPeople(); }
  if (name === 'messages') { loadConversations(); dmUnreadCount = 0; updateDMBadge(); }
  if (name === 'blood')      { searchBlood(); }
  if (name === 'power')      { loadPowerSchedules(); }
  if (name === 'prayer')     { refreshPrayerTimes(); }
  if (name === 'hospitals')  { loadHospitals(); }
  if (name === 'news')       { loadNews(); }
  if (name === 'rides')      { loadRides(); }
  if (name === 'weather')    { refreshWeather(); }
  if (name === 'water')      { loadWaterReports(); }
  if (name === 'study')      { loadStudyGroups(); }
  if (name === 'help')       { loadHelpRequests(); }
  if (name === 'polls')      { loadPolls(); }
  if (name === 'dashboard')  { loadDashboard(); }
  requestNotifPermission();
}

/* ============================================================
   زر الرجوع - Back Button Handler (Handled below)
============================================================ */

// تهيئة History عند بدء التطبيق
(function initHistory() {
  const hash = window.location.hash.replace('#', '');
  const validSections = ['home','map','report','people','messages','profile','blood','power','prayer','medicine','voice','skills','exchange','market','hospitals','news','rides','weather','water','study','help','polls','dashboard'];
  const startSection = validSections.includes(hash) ? hash : 'home';
  history.replaceState({ section: startSection }, '', '#' + startSection);
})();

function toggleMenu() {
  const menu = document.getElementById('sideMenu');
  const overlay = document.getElementById('menuOverlay');
  const isHidden = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  overlay.classList.toggle('hidden');
  // إذا فتحنا القائمة، أضف state للتاريخ
  if (isHidden) {
    history.pushState({ section: currentSection, menuOpen: true }, '', '#' + currentSection);
  }
}

/* ============================================================
   UTILS
============================================================ */
function dist(item) {
  if (!userLat || !item || !item.lat || !item.lng) return null;
  return haversine(userLat, userLng, item.lat, item.lng);
}
function haversine(la1, lo1, la2, lo2) {
  const R = 6371, r = d => d * Math.PI / 180;
  const a = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function showProfileQR_legacy() {
  var name = (myProfile && myProfile.name) || myName || 'مستخدم نبض';
  var pubPhone = (myProfile && myProfile.publicPhone) || '';
  var msg = '👤 ' + name;
  if (pubPhone) msg += ' · 📞 ' + pubPhone;
  msg += '\n💓 تطبيق نبض';
  showToast(msg, 'success');
}

function emptyState(icon, title, sub, action) {
  return '<div class="empty-state"><div class="empty-icon">' + icon + '</div><div class="empty-title">' + title + '</div><div class="empty-sub">' + sub + '</div>' + (action ? '<button class="empty-btn" onclick="goSection(\'' + action + '\')">ابدأ الآن ←</button>' : '') + '</div>';
}
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escJs(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' '); }
function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent.replace(/[^\d]/g, '')) || 0;
  if (start === target) return;
  const t0 = performance.now();
  (function update(now) {
    const p = Math.min((now - t0) / 800, 1), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * e).toLocaleString('ar');
    if (p < 1) requestAnimationFrame(update);
  })(t0);
}
function timeAgo(ts) {
  if (!ts) return '—';
  var t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const s = Math.floor((Date.now() - t) / 1000), m = Math.floor(s / 60), h = Math.floor(s / 3600), d = Math.floor(s / 86400);
  if (s < 60) return 'الآن';
  if (m < 60) return 'منذ ' + m + ' دقيقة';
  if (h < 24) return 'منذ ' + h + ' ساعة';
  if (d < 30)  return 'منذ ' + d + ' يوم';
  return new Date(t).toLocaleDateString('ar-SA');
}
function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.className = 'toast ' + (type || ''); t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}
function showNotif(msg) {
  const el = document.getElementById('notifBadge');
  if (!el) return;
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}


/* ============================================================
   SHARE APP - مشاركة رابط التطبيق
============================================================ */

function getAppUrl() {
  return window.location.origin;
}

function shareApp() {
  try {
    var modal = document.getElementById('shareAppModal');
    if (!modal) { alert('لم يتم العثور على نافذة المشاركة'); return; }

    var url = getAppUrl();

    // fill URL box
    var inp = document.getElementById('shareAppUrlInput');
    if (inp) inp.value = url;

    // stats
    try {
      var su = document.getElementById('shareStatUsers');
      var sr = document.getElementById('shareStatReports');
      var sc = document.getElementById('shareStatCities');
      if (su) su.textContent = (data && data.stats && data.stats.users > 0) ? data.stats.users : '—';
      if (sr) sr.textContent = (data && data.stats && data.stats.reports > 0) ? data.stats.reports : '—';
      if (sc) sc.textContent = (data && data.stats && data.stats.cities > 0) ? data.stats.cities : '—';
    } catch(e2) {}

    // QR code
    try {
      var canvas = document.getElementById('shareQrCanvas');
      if (canvas && typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, url, { width: 180, margin: 2, color: { dark: '#1abc9c', light: '#1a1a2e' } });
      }
    } catch(e3) {}

    // set href on share links directly (bypasses popup blocker)
    try {
      var shareText = encodeURIComponent(
        '💓 تطبيق نبض - صوت المدينة الحي' + '\n' +
        '📍 أخبار، أسعار، خرائط، رسائل مباشرة' + '\n' +
        '🔗 ' + url + '\n' +
        '#نبض_المدينة #السودان'
      );
      var encUrl = encodeURIComponent(url);

      var waLink  = document.getElementById('shareWhatsappLink');
      var tgLink  = document.getElementById('shareTelegramLink');
      var twLink  = document.getElementById('shareTwitterLink');

      if (waLink) waLink.href = 'https://wa.me/?text=' + shareText;
      if (tgLink) tgLink.href = 'https://t.me/share/url?url=' + encUrl + '&text=' + encodeURIComponent('💓 تطبيق نبض - صوت المدينة الحي');
      if (twLink) twLink.href = 'https://twitter.com/intent/tweet?url=' + encUrl + '&text=' + encodeURIComponent('💓 تطبيق #نبض - صوت المدينة الحي 🇸🇩');
    } catch(e4) {}

    // native share button label
    try {
      var lbl = document.getElementById('shareNativeLabel');
      var ico = document.querySelector('#shareNativeBtn .sbc-icon');
      if (lbl && ico) {
        if (navigator.share) { lbl.textContent = 'مشاركة'; ico.textContent = '🔗'; }
        else { lbl.textContent = 'نسخ الرابط'; ico.textContent = '📋'; }
      }
    } catch(e5) {}

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch(err) {
    console.error('shareApp error:', err);
  }
}

function closeShareAppModal(e) {
  if (e && e.target !== e.currentTarget) return;
  var modal = document.getElementById('shareAppModal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function copyAppUrl() {
  var url = getAppUrl();
  var btn = document.querySelector('.share-url-copy-btn');
  function onCopied() {
    showToast('✅ تم نسخ الرابط!', 'success');
    if (btn) { btn.textContent = '✅ تم!'; setTimeout(function(){ btn.textContent = '📋 نسخ'; }, 2000); }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onCopied).catch(function() {
      fallbackCopy(url, onCopied);
    });
  } else {
    fallbackCopy(url, onCopied);
  }
}

function fallbackCopy(text, cb) {
  var el = document.getElementById('shareAppUrlInput');
  if (!el) {
    el = document.createElement('input');
    el.style.position = 'fixed'; el.style.top = '-9999px';
    document.body.appendChild(el);
  }
  el.value = text;
  el.select();
  el.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); if (cb) cb(); } catch(e) {}
}

function _buildShareText() {
  var url = getAppUrl();
  var users = (data && data.stats && data.stats.users > 0) ? ('\n\u{1F465} ' + data.stats.users + ' \u0645\u0633\u062A\u062E\u062F\u0645 \u0646\u0634\u0637 \u0627\u0644\u0622\u0646') : '';
  return '\u{1F493} \u062A\u0637\u0628\u064A\u0642 \u0646\u0628\u0636 - \u0635\u0648\u062A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0627\u0644\u062D\u064A' + users + '\n\u{1F4CD} \u0623\u062E\u0628\u0627\u0631\u060C \u0623\u0633\u0639\u0627\u0631\u060C \u062E\u0631\u0627\u0626\u0637\u060C \u0631\u0633\u0627\u0626\u0644 \u0645\u0628\u0627\u0634\u0631\u0629\n\u{1F517} ' + url + '\n#\u0646\u0628\u0636_\u0627\u0644\u0645\u062F\u064A\u0646\u0629 #\u0627\u0644\u0633\u0648\u062F\u0627\u0646';
}

function shareViaWhatsApp() {
  var url = 'https://wa.me/?text=' + encodeURIComponent(_buildShareText());
  window.open(url, '_blank');
}

function shareViaTelegram() {
  var appUrl = encodeURIComponent(getAppUrl());
  var txt = encodeURIComponent('\u{1F493} \u062A\u0637\u0628\u064A\u0642 \u0646\u0628\u0636 - \u0635\u0648\u062A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\n\u0623\u062E\u0628\u0627\u0631 \u0648\u0623\u0633\u0639\u0627\u0631 \u0648\u062E\u0631\u0627\u0626\u0637 \u0645\u0628\u0627\u0634\u0631\u0629');
  window.open('https://t.me/share/url?url=' + appUrl + '&text=' + txt, '_blank');
}

function shareViaTwitter() {
  var appUrl = encodeURIComponent(getAppUrl());
  var txt = encodeURIComponent('\u{1F493} \u062A\u0637\u0628\u064A\u0642 #\u0646\u0628\u0636 - \u0635\u0648\u062A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\n\u0623\u062E\u0628\u0627\u0631\u060C \u0623\u0633\u0639\u0627\u0631\u060C \u062E\u0631\u0627\u0626\u0637 \u0645\u0628\u0627\u0634\u0631\u0629 \u{1F1F8}\u{1F1E9}');
  window.open('https://twitter.com/intent/tweet?url=' + appUrl + '&text=' + txt, '_blank');
}

function shareViaNative() {
  var url = getAppUrl();
  if (navigator.share) {
    navigator.share({
      title: 'تطبيق نبض',
      text: 'أخبار وأسعار وخرائط مباشرة من مجتمعك',
      url: url
    }).catch(function(err) {
      if (err.name !== 'AbortError') copyAppUrl();
    });
  } else {
    copyAppUrl();
  }
}

/* ============================================================
   🩸 BLOOD BANK - بنك الدم
   ============================================================ */
var _selectedBloodType = '';
var _selectedDonorType = '';
var _selectedRequestType = '';

function switchBloodTab(tab, btn) {
  document.querySelectorAll('.blood-tab').forEach(function(b){ b.classList.remove('active-blood-tab'); });
  btn.classList.add('active-blood-tab');
  var tabs = ['search','request','donate'];
  tabs.forEach(function(t){
    var el = document.getElementById('blood-tab-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'search') searchBlood();
  if (tab === 'request') loadBloodRequests();
}

function selectBloodType(btn, type) {
  document.querySelectorAll('#blood-tab-search .btype-btn').forEach(function(b){ b.classList.remove('active-btype'); });
  btn.classList.add('active-btype');
  _selectedBloodType = type;
}

function selectDonorType(btn, type) {
  document.querySelectorAll('#blood-tab-donate .btype-btn').forEach(function(b){ b.classList.remove('active-btype'); });
  btn.classList.add('active-btype');
  _selectedDonorType = type;
}

function selectRequestType(btn, type) {
  document.querySelectorAll('#blood-tab-request .btype-btn').forEach(function(b){ b.classList.remove('active-btype'); });
  btn.classList.add('active-btype');
  _selectedRequestType = type;
}

function searchBlood() {
  var areaEl = document.getElementById('bloodSearchArea');
  var area = areaEl ? areaEl.value.trim() : '';
  var url = '/api/blood/donors?';
  if (_selectedBloodType) url += 'type=' + encodeURIComponent(_selectedBloodType) + '&';
  if (area) url += 'area=' + encodeURIComponent(area);
  var list = document.getElementById('bloodSearchResults');
  if (list) list.innerHTML = '<p style="color:var(--text2);text-align:center;padding:1rem">⏳ جاري البحث...</p>';
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(donors) {
      if (!list) return;
      if (!Array.isArray(donors) || !donors.length) {
        list.innerHTML = '<p style="color:var(--text2);text-align:center;padding:1.5rem">🩸 لا يوجد متبرعون مسجلون' +
          (_selectedBloodType ? ' بفصيلة <strong>' + _selectedBloodType + '</strong>' : '') +
          ' حالياً<br><small style="color:var(--teal)">كن أول من يسجل! انتقل لتبويب "سجّل كمتبرع"</small></p>';
        return;
      }
      list.innerHTML = '<div style="margin-bottom:.5rem;color:var(--teal);font-size:.85rem;font-weight:600">✅ وُجد ' + donors.length + ' متبرع</div>' +
        donors.map(function(d) {
          return '<div class="blood-donor-card">' +
            '<div class="blood-type-badge ' + d.bloodType.replace('+','pos').replace('-','neg') + '">' + d.bloodType + '</div>' +
            '<div class="blood-donor-info">' +
              '<div class="blood-donor-name">👤 ' + escHtml(d.name || 'متبرع مجهول') + '</div>' +
              '<div class="blood-donor-area">📍 ' + escHtml(d.area || '—') + '</div>' +
              (d.contact ? '<a href="tel:' + escHtml(d.contact) + '" class="blood-donor-phone">📞 ' + escHtml(d.contact) + '</a>' : '') +
            '</div>' +
          '</div>';
        }).join('');
    })
    .catch(function(e) {
      console.warn('searchBlood err', e);
      if (list) list.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:1rem">⚠️ خطأ في الاتصال بالسيرفر</p>';
    });
}

function submitDonor() {
  if (!_selectedDonorType) { showToast('اختر فصيلة دمك أولاً', 'warning'); return; }
  var phoneEl = document.getElementById('donorPhone');
  var phone = phoneEl ? phoneEl.value.trim() : '';
  if (!phone) { showToast('رقم الهاتف مطلوب للتواصل', 'warning'); return; }
  var area  = (document.getElementById('donorArea') || {}).value || '';
  var lat   = (document.getElementById('donorLat')  || {}).value || '';
  var lng   = (document.getElementById('donorLng')  || {}).value || '';
  var name  = (document.getElementById('donorName') || {}).value || '';
  var btn   = document.querySelector('#blood-tab-donate .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التسجيل...'; }
  fetch('/api/blood/donor', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      bloodType: _selectedDonorType,
      name: name.trim(),
      contact: phone,
      area: area.trim(),
      lat: lat ? parseFloat(lat) : (userLat || null),
      lng: lng ? parseFloat(lng) : (userLng || null)
    })
  }).then(function(r){ return r.json(); }).then(function(data) {
    if (btn) { btn.disabled = false; btn.textContent = '🩸 سجّل كمتبرع'; }
    if (data.success) {
      showToast('✅ تم تسجيلك كمتبرع! جزاك الله خيراً', 'success');
      if (phoneEl) phoneEl.value = '';
      var nameEl = document.getElementById('donorName');
      if (nameEl) nameEl.value = '';
      _selectedDonorType = '';
      document.querySelectorAll('#blood-tab-donate .btype-btn').forEach(function(b){ b.classList.remove('active-btype'); });
    } else {
      showToast(data.error || 'خطأ في التسجيل', 'error');
    }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = '🩸 سجّل كمتبرع'; }
    showToast('خطأ في الاتصال بالسيرفر', 'error');
  });
}

function submitBloodRequest() {
  if (!_selectedRequestType) { showToast('اختر فصيلة الدم المطلوبة', 'warning'); return; }
  var contactEl = document.getElementById('reqContact');
  var contact = contactEl ? contactEl.value.trim() : '';
  if (!contact) { showToast('رقم التواصل مطلوب', 'warning'); return; }
  var btn = document.querySelector('#blood-tab-request .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  var body = {
    bloodType: _selectedRequestType,
    patientName: (document.getElementById('reqPatientName') || {}).value || '',
    hospital:    (document.getElementById('reqHospital')   || {}).value || '',
    contact:     contact,
    area:        (document.getElementById('reqArea')       || {}).value || '',
    urgent:      document.getElementById('reqUrgent') ? document.getElementById('reqUrgent').checked : true,
    lat:         userLat || null,
    lng:         userLng || null
  };
  fetch('/api/blood/request', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r){ return r.json(); }).then(function(data) {
    if (btn) { btn.disabled = false; btn.textContent = '🆘 أرسل طلب الدم الآن'; }
    if (data.success) {
      showToast('🆘 تم إرسال الطلب! سيتواصل معك المتبرعون قريباً', 'success');
      if (contactEl) contactEl.value = '';
      ['reqPatientName','reqHospital','reqArea'].forEach(function(id){
        var el = document.getElementById(id); if (el) el.value = '';
      });
      _selectedRequestType = '';
      document.querySelectorAll('#blood-tab-request .btype-btn').forEach(function(b){ b.classList.remove('active-btype'); });
      loadBloodRequests();
    } else { showToast(data.error || 'خطأ في الإرسال', 'error'); }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = '🆘 أرسل طلب الدم الآن'; }
    showToast('خطأ في الاتصال', 'error');
  });
}

function loadBloodRequests() {
  fetch('/api/blood/requests')
    .then(function(r){ return r.json(); })
    .then(function(requests) {
      var list = document.getElementById('bloodRequestsList');
      if (!list) return;
      var active = Array.isArray(requests) ? requests.filter(function(r){ return !r.fulfilled; }) : [];
      if (!active.length) {
        list.innerHTML = '<p style="color:var(--text2);text-align:center;padding:1rem">لا توجد طلبات دم نشطة حالياً</p>';
        return;
      }
      list.innerHTML = '<h4 style="color:#e74c3c;margin-bottom:.6rem;font-size:.9rem">📋 الطلبات النشطة (' + active.length + ')</h4>' +
        active.slice(0,10).map(function(r) {
          return '<div class="blood-donor-card" style="border-right:3px solid ' + (r.urgent ? '#e74c3c' : '#e67e22') + '">' +
            '<div class="blood-type-badge">' + r.bloodType + '</div>' +
            '<div class="blood-donor-info">' +
              (r.urgent ? '<span style="color:#e74c3c;font-size:.72rem;font-weight:700;display:block;margin-bottom:.2rem">🆘 عاجل جداً</span>' : '') +
              '<div class="blood-donor-name">🏥 ' + escHtml(r.hospital || r.patientName || 'مريض') + '</div>' +
              (r.area ? '<div class="blood-donor-area">📍 ' + escHtml(r.area) + '</div>' : '') +
              '<a href="tel:' + escHtml(r.contact) + '" class="blood-donor-phone">📞 ' + escHtml(r.contact) + '</a>' +
            '</div>' +
          '</div>';
        }).join('');
    })
    .catch(function(e){ console.warn('blood requests error', e); });
}

/* ============================================================
   ⚡ ELECTRICITY SCHEDULE - جدول الكهرباء
   ============================================================ */
function loadPowerSchedules() {
  var url = '/api/power';
  if (userLat && userLng) url += '?lat=' + userLat + '&lng=' + userLng;
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(schedules) {
      var list = document.getElementById('powerList');
      if (!list) return;
      if (!Array.isArray(schedules) || !schedules.length) {
        list.innerHTML = '<p style="color:var(--text2);text-align:center;padding:1.5rem">لا توجد تقارير انقطاع بعد<br><small style="color:var(--teal)">كن أول من يشارك جدول حيّك!</small></p>';
        return;
      }
      list.innerHTML = schedules.map(function(s) {
        var statusIcon = s.status === 'confirmed' ? '🔴 مؤكد' : s.status === 'unconfirmed' ? '🟡 غير مؤكد' : '⚡ مقطوع';
        var statusCls  = s.denies > s.confirms ? 'power-off' : 'power-on';
        return '<div class="power-card ' + statusCls + '">' +
          '<div class="power-card-top">' +
            '<span class="power-area-badge">📍 ' + escHtml(s.area || '—') + '</span>' +
            '<span class="power-cut-time">⏰ ' + (s.cutStart || '—') + (s.cutEnd && s.cutEnd !== 'غير محدد' ? ' ← ' + s.cutEnd : '') + '</span>' +
          '</div>' +
          '<div class="power-card-info">' +
            '<span>' + statusIcon + '</span>' +
            (s.district && s.district !== s.area ? '<span>📌 ' + escHtml(s.district) + '</span>' : '') +
          '</div>' +
          '<div class="power-card-votes">👍 ' + (s.confirms || 0) + ' مؤكد &nbsp; 👎 ' + (s.denies || 0) + ' غير صحيح' +
            ' &nbsp; <button style="background:rgba(39,174,96,.15);border:1px solid rgba(39,174,96,.3);color:#27ae60;padding:.2rem .5rem;border-radius:.4rem;cursor:pointer;font-size:.8rem" onclick="votePowerItem(\'' + s.id + '\',\'confirm\')">✅ صحيح</button>' +
            ' <button style="background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.25);color:#e74c3c;padding:.2rem .5rem;border-radius:.4rem;cursor:pointer;font-size:.8rem" onclick="votePowerItem(\'' + s.id + '\',\'deny\')">❌ خطأ</button>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function(e){ console.warn('power load error', e); });
}

function votePower(vote) {
  var area = userLocationName || 'منطقتي';
  var icon = document.getElementById('powerIcon');
  var label = document.getElementById('powerStatusLabel');
  if (vote === 'off') {
    if (icon) icon.textContent = '🔴';
    if (label) label.textContent = '❌ الكهرباء مقطوعة في ' + area;
    fetch('/api/power', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        area: area, district: area,
        cutStart: new Date().toTimeString().slice(0,5),
        cutEnd: 'غير محدد',
        lat: userLat || null,
        lng: userLng || null
      })
    }).then(function(){ showToast('❌ تم تسجيل الانقطاع، شكراً!', 'info'); loadPowerSchedules(); })
      .catch(function(){ showToast('خطأ في الإرسال', 'error'); });
  } else {
    if (icon) icon.textContent = '✅';
    if (label) label.textContent = '✅ الكهرباء موجودة في ' + area;
    showToast('✅ شكراً! سجّلنا أن الكهرباء موجودة', 'info');
  }
}

function votePowerItem(id, vote) {
  fetch('/api/power/' + id + '/vote', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ vote: vote })
  }).then(function(r){ return r.json(); })
    .then(function(){ loadPowerSchedules(); })
    .catch(function(){ showToast('خطأ في التصويت', 'error'); });
}

function submitPowerSchedule() {
  var areaEl = document.getElementById('powerArea');
  var area = areaEl ? areaEl.value.trim() : '';
  if (!area) { showToast('أدخل اسم الحي أو المنطقة', 'warning'); return; }
  var cutTimeEl = document.getElementById('powerCutTime');
  var cutTime = cutTimeEl ? cutTimeEl.value : '';
  if (!cutTime) { showToast('حدد وقت الانقطاع', 'warning'); return; }
  var lat = (document.getElementById('powerLat') || {}).value || '';
  var lng = (document.getElementById('powerLng') || {}).value || '';
  var duration = parseInt((document.getElementById('powerDuration') || {}).value) || 0;
  var cutEnd = '';
  if (cutTime && duration) {
    var parts = cutTime.split(':');
    var h = (parseInt(parts[0]) + duration) % 24;
    cutEnd = String(h).padStart(2,'0') + ':' + parts[1];
  }
  var btn = document.querySelector('#sec-power .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  fetch('/api/power', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      area: area, district: area,
      cutStart: cutTime,
      cutEnd: cutEnd || 'غير محدد',
      lat: lat ? parseFloat(lat) : (userLat || null),
      lng: lng ? parseFloat(lng) : (userLng || null)
    })
  }).then(function(r){ return r.json(); }).then(function(data) {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ شارك الجدول'; }
    if (data.success) {
      showToast('✅ تم مشاركة جدول الكهرباء!', 'success');
      ['powerArea','powerCutTime','powerDuration','powerNotes'].forEach(function(id){
        var el = document.getElementById(id); if (el) el.value = '';
      });
      loadPowerSchedules();
    } else { showToast(data.error || 'خطأ', 'error'); }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ شارك الجدول'; }
    showToast('خطأ في الاتصال', 'error');
  });
}

/* ============================================================
   🕌 PRAYER TIMES - أوقات الصلاة
   ============================================================ */
var _prayerCountdownInterval = null;
var _prayerTimesLoaded = false;

function loadPrayerTimes(lat, lng) {
  var method = (document.getElementById('prayerMethod') || {}).value || '4';
  var tzOffset = -(new Date().getTimezoneOffset() / 60);
  var useLat = lat || userLat || 15.5007;
  var useLng = lng || userLng || 32.5599;
  var url = '/api/prayer?lat=' + useLat + '&lng=' + useLng + '&method=' + method + '&tz=' + tzOffset;
  var locEl = document.getElementById('prayerLocText');
  if (locEl) locEl.textContent = '⏳ جاري تحديد الأوقات...';
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.success) { if (locEl) locEl.textContent = '⚠️ خطأ في الحساب'; return; }
      var times = data.times;
      var keys = ['fajr','sunrise','dhuhr','asr','maghrib','isha'];
      keys.forEach(function(k) {
        var el = document.getElementById('pt-' + k);
        if (el && times[k]) el.textContent = times[k];
      });
      _prayerTimesLoaded = true;
      startPrayerCountdown(times);
      if (locEl) {
        var cityName = data.city || (userLocationName && userLocationName !== 'غير محدد' ? userLocationName : '');
        locEl.textContent = '📍 ' + (cityName || ('خط العرض: ' + parseFloat(useLat).toFixed(2)));
      }
    })
    .catch(function(e) {
      console.warn('prayer load error', e);
      if (locEl) locEl.textContent = '⚠️ تعذّر تحميل الأوقات';
    });
}

function refreshPrayerTimes() {
  if (userLat && userLng) {
    loadPrayerTimes(userLat, userLng);
  } else if (navigator.geolocation) {
    var locEl = document.getElementById('prayerLocText');
    if (locEl) locEl.textContent = '📡 جاري تحديد موقعك...';
    navigator.geolocation.getCurrentPosition(
      function(pos) { loadPrayerTimes(pos.coords.latitude, pos.coords.longitude); },
      function()    { loadPrayerTimes(15.5007, 32.5599); } // Default: Khartoum
    );
  } else {
    loadPrayerTimes(15.5007, 32.5599);
  }
}

function startPrayerCountdown(times) {
  if (_prayerCountdownInterval) clearInterval(_prayerCountdownInterval);
  var prayers = [
    { name:'الفجر',   key:'fajr'    },
    { name:'الشروق',  key:'sunrise' },
    { name:'الظهر',   key:'dhuhr'   },
    { name:'العصر',   key:'asr'     },
    { name:'المغرب',  key:'maghrib' },
    { name:'العشاء',  key:'isha'    }
  ];

  function parseTime(str) {
    if (!str || str === '—') return null;
    var m = str.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return null;
    var h = parseInt(m[1]), mn = parseInt(m[2]);
    if (m[3]) {
      if (m[3].toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    }
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mn, 0);
  }

  function tick() {
    var now = new Date();
    var next = null, nextName = '';
    for (var i = 0; i < prayers.length; i++) {
      var t = parseTime(times[prayers[i].key]);
      if (t && t > now) { next = t; nextName = prayers[i].name; break; }
    }
    if (!next) {
      var tf = parseTime(times['fajr']);
      if (tf) { tf.setDate(tf.getDate() + 1); next = tf; nextName = 'الفجر (غداً)'; }
    }
    // Update active prayer card
    prayers.forEach(function(p) {
      var card = document.querySelector('.pc-' + p.key);
      if (card) card.classList.toggle('prayer-active', p.name === nextName.replace(' (غداً)',''));
    });
    if (next) {
      var diff = Math.floor((next - now) / 1000);
      var hh = Math.floor(diff / 3600), mm = Math.floor((diff % 3600) / 60), ss = diff % 60;
      var nnEl = document.getElementById('nextPrayerName');
      var cdEl = document.getElementById('prayerCountdown');
      if (nnEl) nnEl.textContent = nextName;
      if (cdEl) cdEl.textContent = String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
    }
    // Hijri date
    try {
      var hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day:'numeric', month:'long', year:'numeric' }).format(now);
      var hEl = document.getElementById('prayerHijri');
      if (hEl && hijri) hEl.textContent = hijri;
    } catch(e){}
  }

  tick();
  _prayerCountdownInterval = setInterval(tick, 1000);
}

/* ============================================================
   📷 PHOTO UPLOAD - رفع الصور
   ============================================================ */
function previewPhoto(inputId, previewId) {
  var input   = document.getElementById(inputId);
  var preview = document.getElementById(previewId);
  if (!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 2 * 1024 * 1024) {
    showToast('حجم الصورة كبير جداً (الحد 2 ميغابايت)', 'warning');
    input.value = ''; return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    if (preview) {
      preview.classList.remove('hidden');
      preview.innerHTML = '<img src="' + e.target.result + '" style="max-width:100%;border-radius:.5rem;max-height:180px;object-fit:cover" alt="معاينة"/>';
    }
  };
  reader.readAsDataURL(file);
}

function uploadPhoto(inputId, callback) {
  var input = document.getElementById(inputId);
  if (!input || !input.files || !input.files[0]) { callback(null); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    fetch('/api/upload/image', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ imageData: e.target.result, type: inputId.includes('market') ? 'market' : 'report' })
    }).then(function(r){ return r.json(); })
      .then(function(data){ callback(data.success ? data.imageId : null); })
      .catch(function(){ callback(null); });
  };
  reader.readAsDataURL(input.files[0]);
}

/* ============================================================
   🏥 HOSPITALS - دليل المستشفيات
   ============================================================ */
var _allHospitals = [];
var _activeHospTab = 'list';
function loadHospitals() {
  var lat = userLat || 15.5007, lng = userLng || 32.5599;
  fetch('/api/hospitals?lat=' + lat + '&lng=' + lng)
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allHospitals = list || [];
      renderHospitals(_allHospitals);
    }).catch(function(){
      var el = document.getElementById('hospList');
      if (el) el.innerHTML = emptyState('🏥','لا توجد بيانات','أضف أول مرفق صحي في منطقتك');
    });
}
function renderHospitals(list) {
  var el = document.getElementById('hospList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('🏥','لا توجد مستشفيات','كن أول من يضيف مرفقاً صحياً في منطقتك!');
    return;
  }
  el.innerHTML = list.map(function(h){
    var dist_txt = h.dist != null ? '<span class="card-dist">📍 ' + (h.dist < 1 ? Math.round(h.dist*1000)+'م' : h.dist.toFixed(1)+'كم') + '</span>' : '';
    var typeIcon = {مستشفى:'🏥',عيادة:'🩺',مختبر:'🔬',صيدلية:'💊',طوارئ:'🚨'}[h.type] || '🏥';
    var stars = '';
    var avg = h.avgRating || 0;
    for (var i=1;i<=5;i++) stars += i<=Math.round(avg) ? '★' : '☆';
    var emerg = h.emergency ? '<span class="hosp-badge-emerg">🚨 طوارئ 24h</span>' : '';
    return '<div class="hosp-card">' +
      '<div class="hosp-card-top">' +
        '<span class="hosp-type-icon">' + typeIcon + '</span>' +
        '<div class="hosp-info">' +
          '<div class="hosp-name">' + escHtml(h.name) + ' ' + emerg + '</div>' +
          '<div class="hosp-meta">' + escHtml(h.type||'') + ' · ' + escHtml(h.area||'') + '</div>' +
          (h.address ? '<div class="hosp-addr">📍 ' + escHtml(h.address) + '</div>' : '') +
          (h.phone ? '<div class="hosp-phone">📞 ' + escHtml(h.phone) + '</div>' : '') +
          '<div class="hosp-stars"><span style="color:#f39c12">' + stars + '</span> <span style="color:var(--text2);font-size:.8rem">(' + (h.ratingCount||0) + ' تقييم)</span>' + dist_txt + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hosp-actions">' +
        (h.phone ? '<button class="hosp-btn hosp-call" onclick="window.open(\'tel:' + escHtml(h.phone) + '\')">📞 اتصال</button>' : '') +
        (h.lat && h.lng ? '<button class="hosp-btn hosp-map" onclick="showOnMap(' + h.lat + ',' + h.lng + ',\'' + escJs(h.name) + '\')">🗺️ خريطة</button>' : '') +
        '<button class="hosp-btn hosp-rate" onclick="rateHospital(\'' + h.id + '\',this)">⭐ قيّم</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
function filterHospitals() {
  var q = (document.getElementById('hospSearchInp')||{value:''}).value.toLowerCase();
  var t = (document.getElementById('hospTypeFilter')||{value:''}).value;
  var filtered = _allHospitals.filter(function(h){
    return (!q || (h.name||'').toLowerCase().includes(q) || (h.area||'').toLowerCase().includes(q)) &&
           (!t || h.type === t);
  });
  renderHospitals(filtered);
}
function switchHospTab(tab) {
  _activeHospTab = tab;
  var form = document.getElementById('hospAddForm');
  var list = document.getElementById('hospList');
  if (tab === 'add') { if(form) form.classList.remove('hidden'); }
  else { if(form) form.classList.add('hidden'); }
}
function submitHospital() {
  var name = (document.getElementById('hospName')||{value:''}).value.trim();
  var type = (document.getElementById('hospType')||{value:'مستشفى'}).value;
  var area = (document.getElementById('hospArea')||{value:''}).value.trim();
  var lat  = (document.getElementById('hospLat')||{value:''}).value;
  var lng  = (document.getElementById('hospLng')||{value:''}).value;
  var addr = (document.getElementById('hospAddress')||{value:''}).value.trim();
  var phone= (document.getElementById('hospPhone')||{value:''}).value.trim();
  var emerg= (document.getElementById('hospEmergency')||{checked:false}).checked;
  if (!name || !area) { showToast('أدخل اسم المرفق والمنطقة', 'warning'); return; }
  var body = { name:name, type:type, area:area, address:addr, phone:phone, emergency:emerg,
    lat: lat ? parseFloat(lat) : (userLat||15.5), lng: lng ? parseFloat(lng) : (userLng||32.5),
    userId: myUserId };
  var btn = document.querySelector('#hospAddForm .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  fetch('/api/hospitals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تمت الإضافة بنجاح!', 'success');
        ['hospName','hospAddress','hospPhone'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var ec = document.getElementById('hospEmergency'); if(ec) ec.checked=false;
        switchHospTab('list');
        loadHospitals();
      } else { showToast('حدث خطأ، حاول مرة أخرى', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='🏥 أضف الآن';} });
}
function rateHospital(id, btn) {
  var stars = prompt('قيّم هذا المرفق من 1 إلى 5:');
  if (!stars || isNaN(stars) || stars < 1 || stars > 5) return;
  fetch('/api/hospitals/' + id + '/rate', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ rating: parseInt(stars), userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(){ showToast('✅ شكراً على تقييمك!', 'success'); loadHospitals(); })
    .catch(function(){ showToast('خطأ في الإرسال', 'error'); });
}

/* ============================================================
   📰 NEWS - الأخبار المحلية
   ============================================================ */
var _allNews = [];
var _newsFilter = '';
function loadNews() {
  fetch('/api/news')
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allNews = list || [];
      renderNews(_allNews);
    }).catch(function(){
      var el = document.getElementById('newsList');
      if (el) el.innerHTML = emptyState('📰','لا توجد أخبار','شارك أول خبر في منطقتك');
    });
}
function renderNews(list) {
  var el = document.getElementById('newsList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('📰','لا توجد أخبار','كن أول من ينشر خبراً مجتمعياً!');
    return;
  }
  el.innerHTML = list.map(function(n){
    var catIcon = {سياسة:'🏛️',اقتصاد:'💰',أمن:'🛡️',صحة:'🏥',عام:'📋'}[n.category] || '📰';
    var credBar = '<div class="news-cred-bar"><div class="news-cred-fill" style="width:' + Math.round((n.votes||0)/Math.max((n.votes||0)+(n.downvotes||0),1)*100) + '%"></div></div>';
    return '<div class="news-card">' +
      '<div class="news-card-top">' +
        '<span class="news-cat-badge">' + catIcon + ' ' + escHtml(n.category||'عام') + '</span>' +
        '<span class="news-time">' + timeAgo(n.ts) + '</span>' +
      '</div>' +
      '<div class="news-title">' + escHtml(n.title) + '</div>' +
      '<div class="news-body">' + escHtml(n.body||'') + '</div>' +
      (n.area ? '<div class="news-area">📍 ' + escHtml(n.area) + (n.source?' · المصدر: '+escHtml(n.source):'') + '</div>' : '') +
      '<div class="news-footer">' +
        '<div class="news-trust">' +
          '<span style="color:var(--text2);font-size:.8rem">موثوقية: </span>' + credBar +
        '</div>' +
        '<div style="display:flex;gap:.4rem">' +
          '<button class="news-vote-btn" onclick="voteNews(\'' + n.id + '\',1,this)">✅ صحيح ' + (n.votes||0) + '</button>' +
          '<button class="news-vote-btn news-vote-down" onclick="voteNews(\'' + n.id + '\',-1,this)">❌ كذب ' + (n.downvotes||0) + '</button>' +
          '<button class="news-vote-btn" onclick="shareItem(\'' + escJs(n.title) + '\',\'' + escJs(n.area||'نبض') + '\')">🔗</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
function filterNews(cat, btn) {
  _newsFilter = cat;
  document.querySelectorAll('#sec-news .filt').forEach(function(b){ b.classList.remove('active-filt'); });
  if (btn) btn.classList.add('active-filt');
  renderNews(cat ? _allNews.filter(function(n){ return n.category === cat; }) : _allNews);
}
function submitNews() {
  var title = (document.getElementById('newsTitle')||{value:''}).value.trim();
  var body  = (document.getElementById('newsBody')||{value:''}).value.trim();
  var cat   = (document.getElementById('newsCat')||{value:'عام'}).value;
  var src   = (document.getElementById('newsSource')||{value:''}).value.trim();
  var area  = (document.getElementById('newsArea')||{value:''}).value.trim();
  if (!title || !body) { showToast('أدخل العنوان والتفاصيل', 'warning'); return; }
  var btn = document.querySelector('#sec-news .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري النشر...'; }
  fetch('/api/news', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ title:title, body:body, category:cat, source:src, area:area,
      lat: userLat||null, lng: userLng||null, userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تم نشر الخبر!', 'success');
        ['newsTitle','newsBody','newsSource','newsArea'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        loadNews();
      } else { showToast('حدث خطأ', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='📰 نشر الخبر';} });
}
function voteNews(id, val, btn) {
  fetch('/api/news/' + id + '/vote', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ vote: val, userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      showToast(val > 0 ? '✅ شكراً على تأكيد الخبر' : '❌ تم التبليغ عن عدم صحته', 'success');
      loadNews();
    }).catch(function(){});
}

/* ============================================================
   🚗 RIDES - مشاركة التنقل
   ============================================================ */
var _allRides = [];
function loadRides() {
  fetch('/api/rides')
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allRides = list || [];
      renderRides(_allRides);
    }).catch(function(){
      var el = document.getElementById('ridesList');
      if (el) el.innerHTML = emptyState('🚗','لا توجد رحلات','أضف رحلتك وشارك المشوار!');
    });
}
function renderRides(list) {
  var el = document.getElementById('ridesList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('🚗','لا توجد رحلات','أضف رحلتك وشارك مع من يريد المشوار نفسه!');
    return;
  }
  el.innerHTML = list.map(function(r){
    var seatsLeft = r.seatsLeft != null ? r.seatsLeft : ((r.seats||0) - (r.passengers ? r.passengers.length : 0));
    var seatsColor = seatsLeft > 0 ? '#27ae60' : '#e74c3c';
    return '<div class="ride-card">' +
      '<div class="ride-route">' +
        '<span class="ride-from">🚩 ' + escHtml(r.from||'—') + '</span>' +
        '<span class="ride-arrow">→</span>' +
        '<span class="ride-to">🏁 ' + escHtml(r.to||'—') + '</span>' +
      '</div>' +
      '<div class="ride-meta">' +
        '<span>📅 ' + escHtml(r.date||'') + (r.time?' '+escHtml(r.time):'') + '</span>' +
        '<span style="color:' + seatsColor + '">💺 ' + seatsLeft + ' مقعد متاح</span>' +
        (r.price ? '<span>💵 ' + r.price + ' ج.س</span>' : '<span style="color:#27ae60">مجاني</span>') +
      '</div>' +
      (r.notes ? '<div class="ride-notes">📝 ' + escHtml(r.notes) + '</div>' : '') +
      '<div class="ride-actions">' +
        (r.contact ? '<a href="tel:' + escHtml(r.contact) + '" class="hosp-btn hosp-call">📞 ' + escHtml(r.contact) + '</a>' : '') +
        (seatsLeft > 0 ? '<button class="hosp-btn" onclick="requestRide(\'' + r.id + '\',this)" style="background:rgba(52,152,219,.15);color:#3498db;border-color:rgba(52,152,219,.3)">✋ أريد المشوار</button>' : '<span style="color:#e74c3c;font-size:.85rem">اكتملت المقاعد</span>') +
        ((r.fromLat && r.toLat) ? '<button class="ride-map-btn" onclick="showRideOnMap(' + (r.fromLat||0) + ',' + (r.fromLng||0) + ',' + (r.toLat||0) + ',' + (r.toLng||0) + ',\'' + escJs((r.from||'') + ' → ' + (r.to||'')) + '\')">🗺️ مسار</button>' : '') +
        '<button class="share-btn-sm" onclick="shareItem(\'' + escJs((r.from||'')+'→'+(r.to||'')) + '\',\'رحلات\')" title="شارك">🔗</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
function searchRides() {
  var from = (document.getElementById('rideFromSearch')||{value:''}).value.trim().toLowerCase();
  var to   = (document.getElementById('rideToSearch')||{value:''}).value.trim().toLowerCase();
  var date = (document.getElementById('rideDateSearch')||{value:''}).value;
  var filtered = _allRides.filter(function(r){
    return (!from || (r.from||'').toLowerCase().includes(from)) &&
           (!to   || (r.to||'').toLowerCase().includes(to)) &&
           (!date || r.date === date);
  });
  renderRides(filtered);
}
function submitRide() {
  var from    = (document.getElementById('rideFrom')||{value:''}).value.trim();
  var to      = (document.getElementById('rideTo')||{value:''}).value.trim();
  var date    = (document.getElementById('rideDate')||{value:''}).value;
  var time    = (document.getElementById('rideTime')||{value:''}).value;
  var seats   = parseInt((document.getElementById('rideSeats')||{value:'3'}).value) || 3;
  var price   = parseFloat((document.getElementById('ridePrice')||{value:'0'}).value) || 0;
  var contact = (document.getElementById('rideContact')||{value:''}).value.trim();
  var notes   = (document.getElementById('rideNotes')||{value:''}).value.trim();
  if (!from || !to || !contact) { showToast('أدخل نقطة الانطلاق والوجهة والتواصل', 'warning'); return; }
  var btn = document.querySelector('#sec-rides .btn-rides');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإضافة...'; }
  fetch('/api/rides', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ from:from, to:to, date:date, time:time, seats:seats, price:price,
      contact:contact, notes:notes, userId:myUserId,
      lat: userLat||null, lng: userLng||null }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تمت إضافة الرحلة!', 'success');
        ['rideFrom','rideTo','rideContact','rideNotes'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        loadRides();
      } else { showToast('حدث خطأ', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='🚗 أضف الرحلة';} });
}
function requestRide(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  fetch('/api/rides/' + id + '/request', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      showToast((data.ok||data.success) ? '✅ تم تأكيد حجزك!' : (data.error||'الرحلة مكتملة'), (data.ok||data.success) ? 'success':'error');
      loadRides();
    }).catch(function(){ if(btn){btn.disabled=false;btn.textContent='✋ أريد المشوار';} });
}

/* ============================================================
   🌦️ WEATHER - الطقس
   ============================================================ */
var _weatherCodes = {
  0:'☀️ صحو',1:'🌤️ صحو جزئياً',2:'⛅ غيوم متفرقة',3:'☁️ غائم',
  45:'🌫️ ضباب',48:'🌫️ ضباب كثيف',
  51:'🌦️ رذاذ خفيف',53:'🌦️ رذاذ',55:'🌧️ رذاذ كثيف',
  61:'🌧️ مطر خفيف',63:'🌧️ مطر',65:'⛈️ مطر غزير',
  71:'❄️ ثلج خفيف',73:'❄️ ثلج',75:'❄️ ثلج كثيف',
  80:'🌦️ زخات خفيفة',81:'🌧️ زخات',82:'⛈️ زخات غزيرة',
  95:'⛈️ عاصفة رعدية',96:'⛈️ عاصفة مع بَرَد',99:'⛈️ عاصفة شديدة'
};
function refreshWeather() {
  var lat = userLat || 15.5007, lng = userLng || 32.5599;
  var name = userLocationName || 'الخرطوم';
  var el = document.getElementById('weatherLocText');
  if (el) el.textContent = '📍 ' + name;
  loadWeather(lat, lng);
}
function loadWeatherForCity() {
  var lat = (document.getElementById('weatherCityLat')||{value:''}).value;
  var lng = (document.getElementById('weatherCityLng')||{value:''}).value;
  var name = (document.getElementById('weatherCityInp')||{value:''}).value;
  if (!lat || !lng) { showToast('اختر مدينة من القائمة', 'warning'); return; }
  loadWeather(parseFloat(lat), parseFloat(lng), name);
}
function loadWeather(lat, lng, cityName) {
  var card = document.getElementById('weatherMainCard');
  if (card) card.innerHTML = '<div class="weather-loading">⏳ جاري تحميل بيانات الطقس...</div>';
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature' +
    '&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=Africa%2FKhartoum&forecast_days=5';
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(data){
      renderWeather(data, cityName);
    }).catch(function(){
      if (card) card.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text2)">⚠️ تعذر تحميل بيانات الطقس. تحقق من الاتصال بالإنترنت.</div>';
    });
}
function renderWeather(data, cityName) {
  var card = document.getElementById('weatherMainCard');
  if (!card) return;
  var c = data.current || {};
  var daily = data.daily || {};
  var code = c.weather_code || 0;
  var icon = (_weatherCodes[code]||'🌤️').split(' ')[0];
  var desc = (_weatherCodes[code]||'غير معروف').split(' ').slice(1).join(' ');
  var temp = Math.round(c.temperature_2m || 0);
  var feel = Math.round(c.apparent_temperature || temp);
  var hum  = c.relative_humidity_2m || 0;
  var wind = Math.round(c.wind_speed_10m || 0);

  // Tips
  var tips = '';
  if (temp > 38) tips = '🌡️ حرارة شديدة — اشرب الماء كثيراً وتجنب الخروج وقت الذهيرة';
  else if (temp > 30) tips = '☀️ طقس حار — يُنصح بارتداء ملابس خفيفة';
  else if (temp < 15) tips = '🧥 طقس بارد — ارتدِ ملابس دافئة';
  else tips = '🌤️ طقس لطيف';
  var tipsCard = document.getElementById('weatherTipsCard');
  if (tipsCard) tipsCard.innerHTML = '<p style="font-size:.95rem">💡 ' + tips + '</p>';

  // Daily forecast
  var forecastHtml = '';
  if (daily.time) {
    var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    forecastHtml = '<div class="weather-forecast-row">';
    for (var i = 1; i < Math.min(5, daily.time.length); i++) {
      var d = new Date(daily.time[i]);
      var dayName = days[d.getDay()];
      var dCode = daily.weather_code[i] || 0;
      var dIcon = (_weatherCodes[dCode]||'🌤️').split(' ')[0];
      var dMax = Math.round(daily.temperature_2m_max[i]);
      var dMin = Math.round(daily.temperature_2m_min[i]);
      forecastHtml += '<div class="weather-day-card"><div class="wdc-day">' + dayName + '</div>' +
        '<div class="wdc-icon">' + dIcon + '</div>' +
        '<div class="wdc-temps"><span class="wdc-max">' + dMax + '°</span><span class="wdc-min">' + dMin + '°</span></div>' +
        '</div>';
    }
    forecastHtml += '</div>';
  }

  card.innerHTML =
    '<div class="weather-header">' +
      '<div class="weather-city">' + (cityName || userLocationName || 'موقعك الحالي') + '</div>' +
      '<div class="weather-icon-big">' + icon + '</div>' +
      '<div class="weather-temp-big">' + temp + '°C</div>' +
      '<div class="weather-desc">' + desc + '</div>' +
    '</div>' +
    '<div class="weather-details-row">' +
      '<div class="weather-detail"><span>🌡️</span><span>' + feel + '°</span><small>يبدو كأنه</small></div>' +
      '<div class="weather-detail"><span>💧</span><span>' + hum + '%</span><small>رطوبة</small></div>' +
      '<div class="weather-detail"><span>💨</span><span>' + wind + ' km/h</span><small>رياح</small></div>' +
    '</div>' +
    forecastHtml;
}

/* ============================================================
   💧 WATER - خريطة المياه
   ============================================================ */
var _allWater = [];
function loadWaterReports() {
  var lat = userLat || 15.5007, lng = userLng || 32.5599;
  fetch('/api/water?lat=' + lat + '&lng=' + lng)
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allWater = list || [];
      renderWaterReports(_allWater);
      updateWaterStatus();
    }).catch(function(){
      var el = document.getElementById('waterList');
      if (el) el.innerHTML = emptyState('💧','لا توجد تقارير','أبلّغ عن انقطاع المياه في منطقتك');
    });
}
function updateWaterStatus() {
  var nearby = _allWater.filter(function(w){ return w.dist != null && w.dist < 5 && w.type === 'cut'; });
  var labelEl = document.getElementById('waterStatusLabel');
  if (labelEl) {
    if (!userLat) { labelEl.textContent = 'حدّد موقعك لمعرفة حالة المياه'; }
    else if (nearby.length > 0) {
      labelEl.textContent = '❌ مياه مقطوعة بالقرب منك';
      labelEl.style.color = '#e74c3c';
    } else {
      labelEl.textContent = '✅ لا تقارير انقطاع في منطقتك';
      labelEl.style.color = '#27ae60';
    }
  }
}
function renderWaterReports(list) {
  var el = document.getElementById('waterList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('💧','لا توجد تقارير','أبلّغ عن انقطاع المياه في منطقتك!');
    return;
  }
  var typeMap = { cut:'انقطاع كلي 🔴', low:'ضعف الضغط 🟡', dirty:'مياه ملوثة ⚫', distribution:'نقطة توزيع 💧' };
  el.innerHTML = list.map(function(w){
    var dist_txt = w.dist != null ? ' · 📍 ' + (w.dist < 1 ? Math.round(w.dist*1000)+'م' : w.dist.toFixed(1)+'كم') : '';
    return '<div class="water-card">' +
      '<div class="water-card-top">' +
        '<span class="water-type-badge ' + (w.type==='cut'?'wtype-cut':w.type==='low'?'wtype-low':w.type==='dirty'?'wtype-dirty':'wtype-dist') + '">' + (typeMap[w.type]||w.type) + '</span>' +
        '<span class="water-card-time">' + timeAgo(w.ts) + '</span>' +
      '</div>' +
      '<div class="water-card-area">📍 ' + escHtml(w.area||'غير محدد') + dist_txt + '</div>' +
      (w.notes ? '<div class="water-card-notes">' + escHtml(w.notes) + '</div>' : '') +
      (w.duration ? '<div style="color:var(--text2);font-size:.82rem">⏳ المدة: ' + escHtml(w.duration) + '</div>' : '') +
      '<div class="water-card-votes">' +
        '<button class="water-vote-sm wv-yes" onclick="voteWaterItem(\'' + w.id + '\',1,this)">✅ ' + (w.votes||0) + '</button>' +
        '<button class="water-vote-sm wv-no"  onclick="voteWaterItem(\'' + w.id + '\',-1,this)">❌ ' + (w.downvotes||0) + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
function voteWater(status) {
  if (!userLat) { showToast('حدّد موقعك أولاً', 'warning'); return; }
  var body = { type: status === 'off' ? 'cut' : 'ok', area: userLocationName || 'غير محدد',
    lat: userLat, lng: userLng, userId: myUserId, notes: '' };
  if (status === 'off') {
    fetch('/api/water', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .then(function(r){ return r.json(); })
      .then(function(data){
        showToast('✅ تم الإبلاغ، شكراً!', 'success');
        loadWaterReports();
      }).catch(function(){});
  } else {
    showToast('✅ شكراً! تم تأكيد توفر المياه', 'success');
  }
}
function voteWaterItem(id, val, btn) {
  fetch('/api/water/' + id + '/vote', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ vote: val, userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(){ loadWaterReports(); })
    .catch(function(){});
}
function submitWaterReport() {
  var area  = (document.getElementById('waterArea')||{value:''}).value.trim();
  var lat   = (document.getElementById('waterLat')||{value:''}).value;
  var lng   = (document.getElementById('waterLng')||{value:''}).value;
  var type  = (document.getElementById('waterType')||{value:'cut'}).value;
  var dur   = (document.getElementById('waterDuration')||{value:''}).value.trim();
  var notes = (document.getElementById('waterNotes')||{value:''}).value.trim();
  if (!area) { showToast('أدخل اسم المنطقة', 'warning'); return; }
  var btn = document.querySelector('#sec-water .btn-water');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  fetch('/api/water', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ area:area, type:type, duration:dur, notes:notes,
      lat: lat ? parseFloat(lat) : (userLat||15.5), lng: lng ? parseFloat(lng) : (userLng||32.5),
      userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تم إرسال التقرير!', 'success');
        ['waterArea','waterDuration','waterNotes'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        loadWaterReports();
      } else { showToast('حدث خطأ', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='💧 أبلّغ الآن';} });
}

/* ============================================================
   🎓 STUDY GROUPS - مجموعات التعلم
   ============================================================ */
var _allStudyGroups = [];
var _activeStudyGroup = null;
function loadStudyGroups() {
  fetch('/api/study')
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allStudyGroups = list || [];
      renderStudyGroups(_allStudyGroups);
    }).catch(function(){
      var el = document.getElementById('studyList');
      if (el) el.innerHTML = emptyState('🎓','لا توجد مجموعات','أنشئ أول مجموعة تعلم!');
    });
}
function renderStudyGroups(list) {
  var el = document.getElementById('studyList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('🎓','لا توجد مجموعات تعلم','أنشئ مجموعة وادعُ أصدقاءك!');
    return;
  }
  var levelIcons = {ابتدائي:'🏫',متوسط:'🏫',ثانوي:'🏫',جامعي:'🎓',مهني:'🔧',عام:'📚'};
  el.innerHTML = list.map(function(g){
    var members = g.members ? g.members.length : 0;
    var max = g.maxMembers || 20;
    var pct = Math.min(100, Math.round(members/max*100));
    return '<div class="study-card">' +
      '<div class="study-card-top">' +
        '<span class="study-level-badge">' + (levelIcons[g.level]||'📚') + ' ' + escHtml(g.level||'عام') + '</span>' +
        '<span class="study-members">' + members + '/' + max + ' عضو</span>' +
      '</div>' +
      '<div class="study-name">' + escHtml(g.name) + '</div>' +
      '<div class="study-subject">📖 ' + escHtml(g.subject||'') + '</div>' +
      (g.schedule ? '<div class="study-schedule">📅 ' + escHtml(g.schedule) + '</div>' : '') +
      (g.area ? '<div class="study-area">📍 ' + escHtml(g.area) + '</div>' : '') +
      '<div class="study-progress-bar"><div class="study-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="study-footer">' +
        (g.contact ? '<a class="study-contact-btn" href="tel:' + escHtml(g.contact) + '">📞 ' + escHtml(g.contact) + '</a>' : '<span class="study-time">' + timeAgo(g.ts) + '</span>') +
        '<div style="display:flex;gap:.4rem">' +
          (members < max ? '<button class="study-join-btn" onclick="joinStudyGroup(\'' + g.id + '\',\'' + escJs(g.name) + '\',this)">✋ انضم</button>' : '<span style="color:#e74c3c;font-size:.78rem">ممتلئة</span>') +
          '<button class="study-chat-btn" onclick="openStudyChat(\'' + g.id + '\',\'' + escJs(g.name) + '\')">💬</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
function joinStudyGroup(id, name, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  fetch('/api/study/' + id + '/join', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ userId: myUserId, name: myName||'مجهول' }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      showToast((data.ok||data.success) ? ('✅ انضممت إلى "' + name + '"!') : (data.error||'حدث خطأ'), (data.ok||data.success)?'success':'error');
      loadStudyGroups();
    }).catch(function(){ if(btn){btn.disabled=false;btn.textContent='✋ انضم';} });
}
function openStudyChat(id, name) {
  _activeStudyGroup = id;
  var nameEl = document.getElementById('studyChatName');
  if (nameEl) nameEl.textContent = name;
  var chatDiv = document.getElementById('studyGroupChat');
  if (chatDiv) chatDiv.classList.remove('hidden');
  loadStudyChatMessages(id);
  var listDiv = document.getElementById('studyList');
  if (listDiv) listDiv.scrollIntoView({ behavior:'smooth' });
  // join socket room for real-time study chat messages
  if (socket) {
    socket.emit('join_study', id);
    socket.off('study_standalone_msg');
    // listen for incoming messages in the standalone study chat panel
    socket.on('study_msg', function(data) {
      if (data.groupId !== _activeStudyGroup) return;
      // avoid duplicates if group page is also open
      var el = document.getElementById('studyChatMessages');
      if (!el) return;
      var m = data.msg;
      var isMe = m.userId === myUserId;
      var dispName = m.name || m.author || 'مجهول';
      var mediaHtml = '';
      if (m.mediaType === 'image' && m.mediaData) {
        mediaHtml = '<div class="study-msg-media"><img src="' + m.mediaData + '" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
      } else if (m.mediaType === 'video' && m.mediaData) {
        mediaHtml = '<div class="study-msg-media"><video src="' + m.mediaData + '" class="study-msg-video" controls playsinline></video></div>';
      } else if (m.mediaType === 'audio' && m.mediaData) {
        mediaHtml = '<div class="study-msg-media"><div class="chat-audio-player"><span class="chat-audio-ico">🎵</span><audio src="' + m.mediaData + '" controls class="chat-audio"></audio></div></div>';
      } else if (m.mediaType === 'file' && m.mediaData) {
        mediaHtml = '<div class="study-msg-media"><a href="' + m.mediaData + '" download="' + escHtml(m.mediaName||'ملف') + '" class="chat-file-link"><span>📄</span><span>' + escHtml(m.mediaName||'ملف') + '</span></a></div>';
      }
      // only append if message not already rendered
      var existing = el.querySelector('[data-msg-id="' + m.id + '"]');
      if (!existing) {
        var div = document.createElement('div');
        div.className = 'study-msg' + (isMe ? ' study-msg-me' : '');
        div.setAttribute('data-msg-id', m.id);
        div.innerHTML =
          (!isMe ? '<div class="study-msg-name">' + escHtml(dispName) + '</div>' : '') +
          mediaHtml +
          (m.text ? '<div class="study-msg-bubble">' + escHtml(m.text) + '</div>' : '') +
          '<div class="study-msg-time">' + timeAgo(m.ts || m.time) + '</div>';
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
      }
    });
  }
}
function closeStudyChat() {
  if (socket && _activeStudyGroup) socket.emit('leave_study', _activeStudyGroup);
  _activeStudyGroup = null;
  var chatDiv = document.getElementById('studyGroupChat');
  if (chatDiv) chatDiv.classList.add('hidden');
}
function loadStudyChatMessages(id) {
  fetch('/api/study/' + id + '/messages')
    .then(function(r){ return r.json(); })
    .then(function(msgs){
      var el = document.getElementById('studyChatMessages');
      if (!el) return;
      if (!msgs || !msgs.length) { el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:1rem">لا توجد رسائل بعد. كن أول من يبدأ!</div>'; return; }
      el.innerHTML = msgs.map(function(m){
        var isMe = m.userId === myUserId;
        var dispName = m.name || m.author || 'مجهول';
        var mediaHtml = '';
        if (m.mediaType === 'image' && m.mediaData) {
          mediaHtml = '<div class="study-msg-media"><img src="' + m.mediaData + '" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
        } else if (m.mediaType === 'video' && m.mediaData) {
          mediaHtml = '<div class="study-msg-media"><video src="' + m.mediaData + '" class="study-msg-video" controls playsinline></video></div>';
        } else if (m.mediaType === 'audio' && m.mediaData) {
          mediaHtml = '<div class="study-msg-media"><div class="chat-audio-player"><span class="chat-audio-ico">🎵</span><audio src="' + m.mediaData + '" controls class="chat-audio"></audio></div></div>';
        } else if (m.mediaType === 'file' && m.mediaData) {
          mediaHtml = '<div class="study-msg-media"><a href="' + m.mediaData + '" download="' + escHtml(m.mediaName||'ملف') + '" class="chat-file-link"><span>📄</span><span>' + escHtml(m.mediaName||'ملف') + '</span></a></div>';
        }
        return '<div class="study-msg ' + (isMe?'study-msg-me':'') + '" data-msg-id="' + (m.id||'') + '">' +
          (!isMe ? '<div class="study-msg-name">' + escHtml(dispName) + '</div>' : '') +
          mediaHtml +
          (m.text ? '<div class="study-msg-bubble">' + escHtml(m.text) + '</div>' : '') +
          '<div class="study-msg-time">' + timeAgo(m.ts || m.time) + '</div>' +
        '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }).catch(function(){});
}
function sendStudyMsg() {
  if (!_activeStudyGroup) return;
  var inp = document.getElementById('studyChatInp');
  var text = inp ? (inp.value || inp.textContent || '').trim() : '';
  if (!text) return;
  fetch('/api/study/' + _activeStudyGroup + '/msg', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text:text, userId:myUserId, name:myName||'مجهول' }) })
    .then(function(r){ return r.json(); })
    .then(function(){
      if(inp) { inp.value=''; inp.style.height=''; }
      loadStudyChatMessages(_activeStudyGroup);
    })
    .catch(function(){});
}
function submitStudyGroup() {
  var name    = (document.getElementById('studyName')||{value:''}).value.trim();
  var subject = (document.getElementById('studySubject')||{value:''}).value.trim();
  var level   = (document.getElementById('studyLevel')||{value:'عام'}).value;
  var max     = parseInt((document.getElementById('studyMax')||{value:'20'}).value) || 20;
  var sched   = (document.getElementById('studySchedule')||{value:''}).value.trim();
  var contact = (document.getElementById('studyContact')||{value:''}).value.trim();
  var area    = (document.getElementById('studyArea')||{value:''}).value.trim();
  var avatar  = (document.getElementById('studyAvatar')||{value:'🎓'}).value || '🎓';
  var desc    = (document.getElementById('studyDescription')||{value:''}).value.trim();
  if (!name || !subject) { showToast('أدخل اسم المجموعة والموضوع', 'warning'); return; }
  var btn = document.querySelector('#sec-study .btn-study');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإنشاء...'; }
  fetch('/api/study', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name:name, subject:subject, level:level, maxMembers:max,
      schedule:sched, contact:contact, area:area, userId:myUserId, author:myName||'عضو',
      avatar:avatar, description:desc }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تم إنشاء المجموعة!', 'success');
        ['studyName','studySubject','studySchedule','studyContact','studyArea','studyDescription'].forEach(function(id){
          var e=document.getElementById(id); if(e) e.value='';
        });
        loadStudyGroups();
        // Open the new group automatically
        if (data.group) {
          setTimeout(function(){ openGroupPage(data.id); }, 800);
        }
      } else { showToast(data.error || 'حدث خطأ', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='🎓 أنشئ المجموعة';} });
}

/* ============================================================
   📦 HELP REQUESTS - طلبات المساعدة
   ============================================================ */
var _allHelp = [];
var _helpFilter = '';
function loadHelpRequests() {
  fetch('/api/help?lat=' + (userLat||15.5) + '&lng=' + (userLng||32.5))
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allHelp = list || [];
      renderHelp(_allHelp);
    }).catch(function(){
      var el = document.getElementById('helpList');
      if (el) el.innerHTML = emptyState('📦','لا توجد طلبات','اطلب مساعدة أو قدّمها');
    });
}
function renderHelp(list) {
  var el = document.getElementById('helpList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('📦','لا توجد طلبات مساعدة','كن أول من يطلب أو يقدم مساعدة!');
    return;
  }
  var typeIcon = {food:'🍞',medicine:'💊',transport:'🚗',shelter:'🏠',money:'💵',other:'📋'};
  var typeLabel = {food:'غذاء',medicine:'دواء',transport:'مواصلات',shelter:'مأوى',money:'مالي',other:'أخرى'};
  el.innerHTML = list.map(function(h){
    var dist_txt = h.dist != null ? ' · 📍 ' + (h.dist < 1 ? Math.round(h.dist*1000)+'م' : h.dist.toFixed(1)+'كم') : '';
    var urgent = h.urgent ? '<span class="help-urgent-badge">🚨 عاجل</span>' : '';
    var closed = (h.closed || h.status === 'closed') ? '<span style="color:var(--text2);font-size:.8rem;margin-right:.4rem">(مُغلق)</span>' : '';
    var isClosed = h.closed || h.status === 'closed';
    return '<div class="help-card ' + (isClosed?'help-closed':'') + '">' +
      '<div class="help-card-top">' +
        '<span class="help-type-badge ht-' + (h.type||'other') + '">' + (typeIcon[h.type]||'📋') + ' ' + escHtml(typeLabel[h.type]||'أخرى') + '</span>' +
        urgent + closed +
        '<span class="help-time">' + timeAgo(h.ts) + '</span>' +
      '</div>' +
      '<div class="help-title">' + escHtml(h.title) + '</div>' +
      (h.desc ? '<div class="help-desc">' + escHtml(h.desc) + '</div>' : '') +
      '<div class="help-meta">' + escHtml(h.area||'غير محدد') + dist_txt + ' · ' + (h.offers||h.offersCount||0) + ' عرض مساعدة</div>' +
      (!isClosed ? '<div class="help-actions">' +
        (h.contact ? '<a href="tel:' + escHtml(h.contact) + '" class="hosp-btn hosp-call">📞 ' + escHtml(h.contact) + '</a>' : '') +
        '<button class="hosp-btn" onclick="offerHelp(\'' + h.id + '\',this)" style="background:rgba(230,126,34,.15);color:#e67e22;border-color:rgba(230,126,34,.3)">🤝 ساعد</button>' +
        ((h.lat && h.lng) ? '<button class="help-map-btn" onclick="showHelpOnMap(' + h.lat + ',' + h.lng + ',\'' + (h.type||'other') + '\',\'' + escJs(h.title) + '\')">🗺️ موقع</button>' : '') +
        '<button class="help-close-btn" onclick="closeHelpRequest(\'' + h.id + '\',this)">✓ تم التوفير</button>' +
      '</div>' : '') +
    '</div>';
  }).join('');
}
function filterHelp(type, btn) {
  _helpFilter = type;
  document.querySelectorAll('#sec-help .filt').forEach(function(b){ b.classList.remove('active-filt'); });
  if (btn) btn.classList.add('active-filt');
  var filtered = _allHelp;
  if (type === 'urgent') filtered = _allHelp.filter(function(h){ return h.urgent; });
  else if (type) filtered = _allHelp.filter(function(h){ return h.type === type; });
  renderHelp(filtered);
}
function offerHelp(id, btn) {
  var msg = prompt('كيف يمكنك المساعدة؟ (اختياري)') || '';
  if (btn) { btn.disabled = true; }
  fetch('/api/help/' + id + '/offer', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ userId: myUserId, name: myName||'مجهول', message: msg }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      showToast((data.ok||data.success||data.offers!=null) ? '✅ تم إرسال عرض المساعدة!' : (data.error||'حدث خطأ'), (data.ok||data.success||data.offers!=null)?'success':'error');
      loadHelpRequests();
    }).catch(function(){ if(btn) btn.disabled=false; });
}
function submitHelpRequest() {
  var type    = (document.getElementById('helpType')||{value:'other'}).value;
  var title   = (document.getElementById('helpTitle')||{value:''}).value.trim();
  var desc    = (document.getElementById('helpDesc')||{value:''}).value.trim();
  var area    = (document.getElementById('helpArea')||{value:''}).value.trim();
  var contact = (document.getElementById('helpContact')||{value:''}).value.trim();
  var urgent  = (document.getElementById('helpUrgent')||{checked:false}).checked;
  if (!title || !area || !contact) { showToast('أدخل الطلب والمنطقة وطريقة التواصل', 'warning'); return; }
  var btn = document.querySelector('#sec-help .btn-help');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
  fetch('/api/help', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ type:type, title:title, desc:desc, area:area, contact:contact,
      urgent:urgent, lat: userLat||null, lng: userLng||null, userId:myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تم إرسال طلب المساعدة!', 'success');
        ['helpTitle','helpDesc','helpArea','helpContact'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var uc = document.getElementById('helpUrgent'); if(uc) uc.checked=false;
        loadHelpRequests();
      } else { showToast('حدث خطأ', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='📦 أرسل الطلب';} });
}

/* ============================================================
   🗳️ POLLS - استطلاعات الرأي
   ============================================================ */
var _allPolls = [];
var _votedPolls = JSON.parse(localStorage.getItem('_nabdh_voted_polls')||'{}');
function loadPolls() {
  fetch('/api/polls')
    .then(function(r){ return r.json(); })
    .then(function(list){
      _allPolls = list || [];
      renderPolls(_allPolls);
    }).catch(function(){
      var el = document.getElementById('pollsList');
      if (el) el.innerHTML = emptyState('🗳️','لا توجد استطلاعات','أنشئ أول استطلاع رأي!');
    });
}
function renderPolls(list) {
  var el = document.getElementById('pollsList');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyState('🗳️','لا توجد استطلاعات','أنشئ استطلاعاً وشارك رأيك!');
    return;
  }
  el.innerHTML = list.map(function(p){
    // Server stores options as [{text, votes}], compute total
    var opts = p.options || [];
    var total = p.totalVotes || opts.reduce(function(a,b){ return a + (typeof b==='object'?b.votes:0); }, 0);
    var hasVoted = !!_votedPolls[p.id];
    var expired = p.expiresAt && new Date(p.expiresAt) < new Date();
    var maxVotes = Math.max.apply(null, opts.map(function(o){ return typeof o==='object'?o.votes:0; }).concat([0]));
    var optHtml = opts.map(function(opt, i){
      var optText = typeof opt === 'object' ? opt.text : opt;
      var cnt = typeof opt === 'object' ? (opt.votes||0) : ((p.votes||[])[i]||0);
      var pct = total > 0 ? Math.round(cnt/total*100) : 0;
      var isWinner = hasVoted && cnt === maxVotes && total > 0;
      return '<div class="poll-option ' + (hasVoted||expired?'poll-voted':'poll-clickable') + (isWinner?' poll-winner':'')+'"' +
        (!hasVoted && !expired ? ' onclick="castVote(\'' + p.id + '\',' + i + ',this)"' : '') + '>' +
        '<div class="poll-opt-row">' +
          '<span class="poll-opt-text">' + escHtml(optText) + '</span>' +
          (hasVoted||expired ? '<span class="poll-opt-pct">' + pct + '%</span>' : '') +
        '</div>' +
        (hasVoted||expired ? '<div class="poll-bar"><div class="poll-bar-fill" style="width:' + pct + '%"></div></div>' : '') +
      '</div>';
    }).join('');
    return '<div class="poll-card ' + (expired?'poll-expired':'') + '">' +
      '<div class="poll-card-top">' +
        '<span class="poll-q">' + escHtml(p.question) + '</span>' +
        (expired ? '<span class="poll-badge-expired">منتهي</span>' : '') +
      '</div>' +
      (p.area ? '<div style="color:var(--text2);font-size:.8rem;margin-bottom:.5rem">📍 ' + escHtml(p.area) + '</div>' : '') +
      '<div class="poll-options">' + optHtml + '</div>' +
      '<div class="poll-footer">' +
        '<span style="color:var(--text2);font-size:.8rem">' + total + ' صوت</span>' +
        (p.expiresAt && !expired ? '<span style="color:var(--text2);font-size:.8rem">⏰ ينتهي: ' + new Date(p.expiresAt).toLocaleDateString('ar-SA') + '</span>' : '') +
        '<button class="poll-share-btn" onclick="sharePoll(\'' + p.id + '\',\'' + escJs(p.question) + '\')">🔗 شارك</button>' +
      '</div>' +
    '</div>';
  }).join('');
}
function castVote(pollId, optIndex, el) {
  if (_votedPolls[pollId]) { showToast('لقد صوتت على هذا الاستطلاع بالفعل', 'warning'); return; }
  fetch('/api/polls/' + pollId + '/vote', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ option: optIndex, userId: myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        _votedPolls[pollId] = optIndex;
        localStorage.setItem('_nabdh_voted_polls', JSON.stringify(_votedPolls));
        showToast('✅ تم تسجيل صوتك!', 'success');
        loadPolls();
      } else { showToast(data.error||'حدث خطأ', 'error'); }
    }).catch(function(){});
}
function addPollOption() {
  var container = document.getElementById('pollOptionsContainer');
  if (!container) return;
  var inputs = container.querySelectorAll('.poll-option-inp');
  if (inputs.length >= 8) { showToast('الحد الأقصى 8 خيارات', 'warning'); return; }
  var inp = document.createElement('input');
  inp.className = 'inp poll-option-inp';
  inp.placeholder = 'خيار آخر';
  inp.style.marginBottom = '.4rem';
  container.appendChild(inp);
}
function submitPoll() {
  var question = (document.getElementById('pollQuestion')||{value:''}).value.trim();
  var optInputs = document.querySelectorAll('.poll-option-inp');
  var options = Array.from(optInputs).map(function(i){ return i.value.trim(); }).filter(Boolean);
  var expiry = parseInt((document.getElementById('pollExpiry')||{value:'24'}).value) || 24;
  var area   = (document.getElementById('pollArea')||{value:''}).value.trim();
  if (!question) { showToast('أدخل السؤال', 'warning'); return; }
  if (options.length < 2) { showToast('أدخل خيارين على الأقل', 'warning'); return; }
  var btn = document.querySelector('#sec-polls .btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري النشر...'; }
  var expiresAt = new Date(Date.now() + expiry * 3600000).toISOString();
  fetch('/api/polls', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ question:question, options:options, expiresAt:expiresAt, area:area, userId:myUserId }) })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.id) {
        showToast('✅ تم نشر الاستطلاع!', 'success');
        var pq = document.getElementById('pollQuestion'); if(pq) pq.value='';
        var pa = document.getElementById('pollArea'); if(pa) pa.value='';
        var cont = document.getElementById('pollOptionsContainer');
        if (cont) {
          cont.innerHTML = '<input class="inp poll-option-inp" placeholder="الخيار الأول *" style="margin-bottom:.4rem"/><input class="inp poll-option-inp" placeholder="الخيار الثاني *" style="margin-bottom:.4rem"/>';
        }
        loadPolls();
      } else { showToast('حدث خطأ', 'error'); }
    }).catch(function(){ showToast('خطأ في الاتصال', 'error'); })
    .finally(function(){ if(btn){btn.disabled=false;btn.textContent='🗳️ نشر الاستطلاع';} });
}

/* ============================================================
   📊 DASHBOARD - لوحة الإحصاءات
   ============================================================ */
function loadDashboard() {
  fetch('/api/dashboard')
    .then(function(r){ return r.json(); })
    .then(function(data){
      renderDashboard(data);
    }).catch(function(){
      showToast('تعذر تحميل الإحصاءات', 'error');
    });
}
function renderDashboard(data) {
  var s = data.stats || {};
  // Live stats
  setEl('dsc-online',  s.online  || 0);
  setEl('dsc-reports', s.reports || 0);
  setEl('dsc-lives',   s.lives   || s.lives_saved || 0);
  setEl('dsc-cities',  s.cities  || 0);

  // Feature stats grid — works with both features[] array AND flat stats object
  var grid = document.getElementById('dashGrid');
  if (grid) {
    var features = data.features;
    if (!features || !features.length) {
      // Build from flat stats
      features = [
        { icon:'📢', label:'بلاغات',       count: s.reports||0 },
        { icon:'💵', label:'أسعار صرف',    count: s.exchange||0 },
        { icon:'💊', label:'أدوية',         count: s.medicines||0 },
        { icon:'🔊', label:'صوت الحي',      count: s.voice||0 },
        { icon:'🤝', label:'مهارات',        count: s.skills||0 },
        { icon:'🛒', label:'سوق P2P',       count: s.market||0 },
        { icon:'🩸', label:'متبرعو الدم',   count: s.bloodDonors||0 },
        { icon:'⚡', label:'تقارير كهرباء', count: s.power||0 },
        { icon:'🏥', label:'مستشفيات',     count: s.hospitals||0 },
        { icon:'📰', label:'أخبار',         count: s.news||0 },
        { icon:'🚗', label:'رحلات',         count: s.rides||0 },
        { icon:'💧', label:'تقارير مياه',   count: s.water||0 },
        { icon:'🎓', label:'مجموعات تعلم', count: s.study||0 },
        { icon:'📦', label:'طلبات مساعدة', count: s.help||0 },
        { icon:'🗳️', label:'استطلاعات',   count: s.polls||0 }
      ];
    }
    grid.innerHTML = features.map(function(f){
      return '<div class="dash-stat-card">' +
        '<div class="dsc-num">' + (f.count||0) + '</div>' +
        '<div class="dsc-lbl">' + (f.icon||'') + ' ' + (f.label||'') + '</div>' +
      '</div>';
    }).join('');
  }

  // Top areas
  var areasEl = document.getElementById('dashTopAreas');
  if (areasEl) {
    var areas = data.topAreas || [];
    if (!areas.length) {
      areasEl.innerHTML = '<div style="color:var(--text2);font-size:.9rem;text-align:center">لا توجد بيانات كافية بعد</div>';
    } else {
      var maxCount = areas[0].count || 1;
      areasEl.innerHTML = areas.slice(0,5).map(function(a, i){
        var pct = Math.round(a.count/maxCount*100);
        return '<div style="margin-bottom:.6rem">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:.2rem">' +
            '<span style="font-size:.9rem">' + (i===0?'🥇':i===1?'🥈':i===2?'🥉':'  ') + ' ' + escHtml(a.area||a.name||'—') + '</span>' +
            '<span style="color:var(--teal);font-weight:bold">' + a.count + '</span>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.06);border-radius:.3rem;height:6px">' +
            '<div style="background:var(--teal);height:100%;border-radius:.3rem;width:' + pct + '%"></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  // Last 24h stats — server may return object or array
  var h24El = document.getElementById('dash24h');
  if (h24El) {
    var h24raw = data.recent24h || data.last24h || {};
    var h24arr = [];
    if (Array.isArray(h24raw)) {
      h24arr = h24raw;
    } else {
      Object.keys(h24raw).forEach(function(k){
        h24arr.push({ label: k, count: h24raw[k] });
      });
    }
    if (h24arr.length) {
      h24El.innerHTML = h24arr.map(function(f){
        return '<div class="dash-stat-card">' +
          '<div class="dsc-num">' + (f.count||0) + '</div>' +
          '<div class="dsc-lbl">' + (f.label||'') + '</div>' +
        '</div>';
      }).join('');
    } else {
      h24El.innerHTML = '<div style="color:var(--text2);font-size:.85rem;text-align:center;padding:.5rem">لا توجد نشاطات في آخر 24 ساعة</div>';
    }
  }
}

/* ============================================================
   🔌 REAL-TIME SOCKET EVENTS for new features
   ============================================================ */
(function() {
  var _sockWait = setInterval(function() {
    if (typeof socket !== 'undefined' && socket) {
      clearInterval(_sockWait);

      socket.on('new_blood_donor', function(donor) {
        var sec = document.getElementById('sec-blood');
        if (sec && sec.classList.contains('active-sec')) searchBlood();
        showNotif('🩸 متبرع دم جديد: ' + (donor.bloodType || '') + ' في ' + (donor.area || '—'));
      });

      socket.on('new_blood_request', function(req) {
        if (req.urgent) {
          showNotif('🆘 طلب دم عاجل: ' + (req.bloodType || '') + ' - ' + (req.hospital || req.area || '—'));
          showToast('🆘 طلب دم عاجل: ' + (req.bloodType || '') + ' في ' + (req.hospital || req.area || '—'), 'error');
        }
        var list = document.getElementById('bloodRequestsList');
        if (list) loadBloodRequests();
      });

      socket.on('new_power_report', function() {
        var sec = document.getElementById('sec-power');
        if (sec && sec.classList.contains('active-sec')) loadPowerSchedules();
      });

      socket.on('power_vote_update', function() {
        var sec = document.getElementById('sec-power');
        if (sec && sec.classList.contains('active-sec')) loadPowerSchedules();
      });
    }
  }, 500);
})();

/* ============================================================
   📲 PWA INSTALL - تثبيت التطبيق
   ============================================================ */
var _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // Show install banner after 3 seconds if not dismissed
  setTimeout(function() {
    var banner = document.getElementById('pwaInstallBanner');
    var dismissed = localStorage.getItem('pwa_install_dismissed');
    if (banner && !dismissed) {
      banner.classList.remove('hidden');
    }
  }, 3000);
});

function installPWA() {
  var banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.classList.add('hidden');
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    _deferredInstallPrompt.userChoice.then(function(result) {
      if (result.outcome === 'accepted') {
        showToast('✅ تم تثبيت نبض على جهازك!', 'success');
      }
      _deferredInstallPrompt = null;
    });
  } else {
    showToast('📲 يمكنك تثبيت التطبيق من قائمة المتصفح', 'info');
  }
}

function hideInstallBanner() {
  var banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.classList.add('hidden');
  localStorage.setItem('pwa_install_dismissed', '1');
}

window.addEventListener('appinstalled', function() {
  showToast('✅ تم تثبيت نبض بنجاح!', 'success');
  _deferredInstallPrompt = null;
});

/* ============================================================
   🗺️ MAP ENHANCEMENTS v2 - طبقات الخريطة والتحسينات
============================================================ */

let currentTileLayer = null;
let statesLayerVisible = true;
let alertsLayerVisible = true;
let mapLayersPanelOpen = false;

const MAP_TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
};

function changeMapStyle(style) {
  if (!map) return;
  if (currentTileLayer) { map.removeLayer(currentTileLayer); }
  const url = MAP_TILES[style] || MAP_TILES.dark;
  currentTileLayer = L.tileLayer(url, { maxZoom: 19, subdomains: style === 'dark' || style === 'light' ? 'abcd' : 'abc' });
  currentTileLayer.addTo(map);
  currentTileLayer.bringToBack();
  showToast('🗺️ تم تغيير نمط الخريطة', 'success');
}

function toggleMapLayers() {
  mapLayersPanelOpen = !mapLayersPanelOpen;
  const panel = document.getElementById('mapLayersPanel');
  if (panel) panel.classList.toggle('hidden', !mapLayersPanelOpen);
}

function toggleLayerAlerts(btn) {
  alertsLayerVisible = !alertsLayerVisible;
  btn && btn.classList.toggle('active', alertsLayerVisible);
  Object.values(mapMarkers).forEach(m => {
    if (alertsLayerVisible) m.addTo && m.addTo(map);
    else m.remove && m.remove();
  });
  showToast(alertsLayerVisible ? '📢 التنبيهات مرئية' : '📢 التنبيهات مخفية', 'success');
}

function toggleLayerPeople(btn) {
  peopleLayerVisible = !peopleLayerVisible;
  btn && btn.classList.toggle('active', peopleLayerVisible);
  Object.values(peopleMarkers).forEach(m => {
    if (peopleLayerVisible) m.addTo && m.addTo(map);
    else m.remove && m.remove();
  });
  showToast(peopleLayerVisible ? '👥 الأشخاص مرئيون' : '👥 الأشخاص مخفيون', 'success');
}

function toggleStatesLayer(btn) {
  statesLayerVisible = !statesLayerVisible;
  btn && btn.classList.toggle('active', statesLayerVisible);
  // reload states or hide
  if (statesLayerVisible) addSudanStatesLayer();
  else {
    // remove state circles - they don't have a separate layer group, so reinit map
    showToast('🇸🇩 طبقة الولايات ' + (statesLayerVisible ? 'مرئية' : 'مخفية'), 'success');
  }
}

function refreshAllMapData() {
  const btn = document.querySelector('.map-refresh-btn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  Promise.all([
    fetch('/api/map').then(r => r.json()).catch(() => []),
    fetch('/api/people/map').then(r => r.json()).catch(() => [])
  ]).then(([pins, people]) => {
    // Clear old markers
    Object.values(mapMarkers).forEach(m => m.remove && m.remove());
    mapMarkers = {};
    pins.forEach(p => addMapPin(p));
    renderMapAlerts();
    updateMapCounts();
    if (peopleLayerVisible) refreshPeopleMarkers(people);
    const el = document.getElementById('cnt-people');
    if (el) el.textContent = people.length;
    showToast('✅ تم تحديث الخريطة', 'success');
  }).finally(() => {
    if (btn) { btn.textContent = '🔄'; btn.disabled = false; }
  });
}

// تحديث درجة الحرارة على شريط الخريطة
function updateMapWeatherMini() {
  const wrap = document.getElementById('msb-weather-mini');
  const temp = document.getElementById('cnt-temp');
  if (!wrap || !temp) return;
  fetch('/api/weather?lat=' + (userLat || 15.5007) + '&lon=' + (userLng || 32.5599))
    .then(r => r.json())
    .then(d => {
      if (d && d.current) {
        temp.textContent = Math.round(d.current.temp || d.current.temperature || 0);
        wrap.style.display = 'flex';
      }
    }).catch(() => {});
}

// تشغيل تحديث الطقس على الخريطة
setTimeout(updateMapWeatherMini, 3000);

/* ============================================================
   🏥 HOSPITALS ENHANCED
============================================================ */
function renderHospitalCard(h) {
  const icons = { 'مستشفى': '🏥', 'عيادة': '🩺', 'مختبر': '🔬', 'صيدلية': '💊', 'طوارئ': '🚨' };
  const d = dist(h);
  const distTxt = d !== null ? (d < 1 ? '<1 كم' : Math.round(d) + ' كم') : '—';
  const stars = '⭐'.repeat(Math.round(h.rating || 0)) + '☆'.repeat(5 - Math.round(h.rating || 0));
  const emergencyBadge = h.emergency ? '<span class="badge-emergency">🚨 طوارئ 24/7</span>' : '';
  const ratingCount = h.ratingCount ? `<small style="color:var(--text2)">(${h.ratingCount})</small>` : '';
  return `<div class="hosp-card">
    <div class="hosp-card-top">
      <div class="hosp-icon">${icons[h.type] || '🏥'}</div>
      <div class="hosp-info">
        <div class="hosp-name">${escHtml(h.name)}</div>
        <div class="hosp-type">${escHtml(h.type || 'مرفق صحي')} ${emergencyBadge}</div>
        <div class="hosp-rating">${stars} ${ratingCount}</div>
      </div>
      <div class="hosp-dist">${distTxt}</div>
    </div>
    <div class="hosp-meta">
      ${h.address ? `<div class="hosp-addr">📍 ${escHtml(h.address)}</div>` : ''}
      ${h.phone ? `<div class="hosp-phone">📞 ${escHtml(h.phone)}</div>` : ''}
    </div>
    <div class="hosp-actions">
      ${h.phone ? `<a href="tel:${escHtml(h.phone)}" class="hosp-btn hosp-call">📞 اتصال</a>` : ''}
      ${(h.lat && h.lng) ? `<button class="hosp-btn hosp-map" onclick="showOnMap(${h.lat},${h.lng},'${escJs(h.name)}')">🗺️ على الخريطة</button>` : ''}
      <button class="hosp-btn hosp-rate" onclick="rateHospital('${h.id}',this)">⭐ قيّم</button>
      <button class="hosp-btn" onclick="shareItem('${escJs(h.name + ' - ' + (h.address||h.area||''))}','${escJs(h.area||'')}')">🔗</button>
    </div>
  </div>`;
}

/* ============================================================
   📰 NEWS ENHANCED
============================================================ */
function renderNewsCard(n) {
  const catIcons = { 'سياسة':'🏛️', 'اقتصاد':'💰', 'أمن':'🛡️', 'صحة':'🏥', 'عام':'📋', 'رياضة':'⚽', 'ثقافة':'🎭' };
  const icon = catIcons[n.category] || '📋';
  const total = (n.upvotes || 0) + (n.downvotes || 0);
  const credPct = total > 0 ? Math.round((n.upvotes || 0) / total * 100) : 50;
  const credColor = credPct >= 70 ? '#1abc9c' : credPct >= 40 ? '#f39c12' : '#e74c3c';
  return `<div class="news-card">
    <div class="news-card-top">
      <span class="news-cat">${icon} ${escHtml(n.category || 'عام')}</span>
      <span class="news-time">🕐 ${timeAgo(n.time)}</span>
    </div>
    <div class="news-title">${escHtml(n.title)}</div>
    <div class="news-body">${escHtml(n.body)}</div>
    <div class="news-footer">
      <span class="news-area">📍 ${escHtml(n.area || '—')}</span>
      ${n.source ? `<span class="news-source">📡 ${escHtml(n.source)}</span>` : ''}
    </div>
    <div class="news-cred-bar-wrap">
      <div class="news-cred-label">مصداقية</div>
      <div class="news-cred-bar">
        <div class="news-cred-fill" style="width:${credPct}%;background:${credColor}"></div>
      </div>
      <div class="news-cred-pct" style="color:${credColor}">${credPct}%</div>
    </div>
    <div class="news-actions">
      <button class="news-vote-btn nv-up" onclick="voteNews('${n.id}',1,this)">👍 ${n.upvotes || 0}</button>
      <button class="news-vote-btn nv-down" onclick="voteNews('${n.id}',-1,this)">👎 ${n.downvotes || 0}</button>
      <button class="news-vote-btn" onclick="shareItem('${escJs(n.title)}','${escJs(n.area||'')}')">🔗 شارك</button>
    </div>
  </div>`;
}

/* ============================================================
   🚗 RIDES ENHANCED
============================================================ */
function renderRideCard(r) {
  const d = dist(r);
  const seatsLeft = (r.seats || 1) - (r.passengers || 0);
  const seatsColor = seatsLeft <= 1 ? '#e74c3c' : seatsLeft <= 2 ? '#f39c12' : '#1abc9c';
  return `<div class="ride-card">
    <div class="ride-route">
      <div class="ride-from">🟢 ${escHtml(r.from || '—')}</div>
      <div class="ride-arrow">↓</div>
      <div class="ride-to">🔴 ${escHtml(r.to || '—')}</div>
    </div>
    <div class="ride-meta">
      <span>🕐 ${r.time ? new Date(r.time).toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'}) : '—'}</span>
      <span style="color:${seatsColor}">💺 ${seatsLeft} مقعد متاح</span>
      ${r.price ? `<span>💵 ${r.price} جنيه</span>` : '<span>🆓 مجاني</span>'}
      ${d !== null ? `<span>📡 ${Math.round(d)} كم</span>` : ''}
    </div>
    <div class="ride-driver">
      <span>👤 ${escHtml(r.driver || r.name || 'سائق')}</span>
      ${r.phone ? `<a href="tel:${escHtml(r.phone)}" class="ride-call-btn">📞</a>` : ''}
    </div>
    <div class="ride-actions">
      ${r.phone ? `<a href="tel:${escHtml(r.phone)}" class="ride-btn ride-contact">📞 تواصل</a>` : ''}
      ${seatsLeft > 0 ? `<button class="ride-btn ride-join" onclick="requestRide('${r.id}',this)">🚗 انضم للرحلة</button>` : '<span class="ride-full-badge">🚫 مكتمل</span>'}
      <button class="ride-btn" onclick="shareItem('رحلة من ${escJs(r.from||'')} إلى ${escJs(r.to||'')}','${escJs(r.area||r.from||'')}')">🔗</button>
    </div>
  </div>`;
}

/* ============================================================
   💧 WATER REPORTS ENHANCED
============================================================ */
function renderWaterCard(w) {
  const typeLabels = { 'انقطاع':'🚱 انقطاع', 'ضعيف':'💧 ضغط ضعيف', 'ملوث':'☣️ ملوث', 'توزيع':'🚰 توزيع' };
  const typeClass = { 'انقطاع':'wtype-cut', 'ضعيف':'wtype-low', 'ملوث':'wtype-dirty', 'توزيع':'wtype-dist' };
  const d = dist(w);
  const duration = w.endTime ? Math.ceil((new Date(w.endTime) - new Date(w.startTime)) / 3600000) + ' ساعة' : 'جارٍ';
  return `<div class="water-card">
    <div class="water-card-top">
      <span class="water-type ${typeClass[w.type] || ''}">${typeLabels[w.type] || w.type}</span>
      <span class="water-time">🕐 ${timeAgo(w.time)}</span>
    </div>
    <div class="water-area">📍 ${escHtml(w.area)}</div>
    ${w.notes ? `<div class="water-notes">${escHtml(w.notes)}</div>` : ''}
    <div class="water-meta">
      <span>⏱️ ${duration}</span>
      ${d !== null ? `<span>📡 ${Math.round(d)} كم منك</span>` : ''}
      ${(w.lat && w.lng) ? `<button class="water-map-btn" onclick="showOnMap(${w.lat},${w.lng},'${escJs(w.area)}')">🗺️</button>` : ''}
    </div>
    <div class="water-votes">
      <button class="water-vote-sm wv-yes" onclick="voteWaterItem('${w.id}',1,this)">✅ ${w.upvotes || 0} صحيح</button>
      <button class="water-vote-sm wv-no"  onclick="voteWaterItem('${w.id}',-1,this)">❌ ${w.downvotes || 0} خطأ</button>
      <button class="water-vote-sm" onclick="shareItem('${escJs(typeLabels[w.type]||w.type)} في ${escJs(w.area)}','${escJs(w.area)}')">🔗</button>
    </div>
  </div>`;
}

/* ============================================================
   🎓 STUDY GROUPS ENHANCED
============================================================ */
function renderStudyGroupCard(g) {
  const levelIcons = { 'ابتدائي':'🏫', 'متوسط':'📚', 'ثانوي':'🎒', 'جامعي':'🎓', 'مهني':'🔧' };
  const icon = levelIcons[g.level] || '📖';
  const membersArr = Array.isArray(g.members) ? g.members : Object.keys(g.members || {});
  const isMember = membersArr.includes(myUserId);
  const membersCount = membersArr.length;
  const maxM = g.maxMembers || 10;
  const pct = Math.min(Math.round(membersCount / maxM * 100), 100);
  const isFull = membersCount >= maxM;
  return `<div class="study-card">
    <div class="study-card-top">
      <span class="study-level-badge">${icon} ${escHtml(g.level || 'عام')}</span>
      <span class="study-members">${membersCount}/${maxM} عضو</span>
    </div>
    <div class="study-name">${escHtml(g.name)}</div>
    <div class="study-subject">📖 ${escHtml(g.subject)}</div>
    ${g.schedule ? `<div class="study-schedule">🗓️ ${escHtml(g.schedule)}</div>` : ''}
    ${g.area ? `<div class="study-area">📍 ${escHtml(g.area)}</div>` : ''}
    <div class="study-progress-bar">
      <div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px">
        <div style="height:100%;width:${pct}%;background:${pct>=90?'#e74c3c':pct>=60?'#f39c12':'#1abc9c'};border-radius:2px;transition:.5s"></div>
      </div>
    </div>
    <div class="study-footer">
      ${g.contact ? `<a href="tel:${escHtml(g.contact)}" class="study-contact-btn">📞 تواصل</a>` : ''}
      ${isMember
        ? `<button class="study-join-btn study-joined" disabled>✅ أنت عضو</button>`
        : isFull
          ? `<button class="study-join-btn" disabled style="opacity:.5">🚫 مكتمل</button>`
          : `<button class="study-join-btn" onclick="joinStudyGroup('${g.id}','${escJs(g.name)}',this)">➕ انضم</button>`}
      <button class="study-chat-btn" onclick="openStudyChat('${g.id}','${escJs(g.name)}')">💬 محادثة</button>
    </div>
  </div>`;
}

/* ============================================================
   🆘 HELP REQUESTS ENHANCED
============================================================ */
function renderHelpCard(h) {
  const typeIcons = { 'food':'🍞', 'medicine':'💊', 'transport':'🚗', 'shelter':'🏠', 'money':'💵', 'other':'🤝' };
  const typeLabels = { 'food':'طعام', 'medicine':'دواء', 'transport':'نقل', 'shelter':'مأوى', 'money':'مساعدة مالية', 'other':'أخرى' };
  const icon = typeIcons[h.type] || '🤝';
  const label = typeLabels[h.type] || h.type;
  const d = dist(h);
  const urgentBadge = h.urgent ? '<span class="help-badge-urgent">🚨 عاجل</span>' : '';
  const closedBadge = h.status === 'closed' ? '<span class="help-badge-closed">✅ مكتمل</span>' : '';
  return `<div class="help-card ${h.urgent ? 'help-urgent' : ''}">
    <div class="help-card-top">
      <span class="help-type-badge ht-${h.type}">${icon} ${label}</span>
      <div>${urgentBadge}${closedBadge}</div>
      <span class="help-time">🕐 ${timeAgo(h.time)}</span>
    </div>
    <div class="help-title">${escHtml(h.title)}</div>
    <div class="help-desc">${escHtml(h.desc || h.description || '')}</div>
    <div class="help-meta">
      📍 ${escHtml(h.area || '—')}
      ${d !== null ? ` • 📡 ${Math.round(d)} كم` : ''}
    </div>
    <div class="help-actions">
      ${h.contact ? `<a href="tel:${escHtml(h.contact)}" class="help-btn help-call">📞 تواصل</a>` : ''}
      ${h.status !== 'closed' ? `<button class="help-btn help-offer" onclick="offerHelp('${h.id}',this)">🤝 أقدم مساعدة</button>` : ''}
      <button class="help-btn" onclick="shareItem('${escJs(h.title)}','${escJs(h.area||'')}')">🔗</button>
    </div>
  </div>`;
}

/* ============================================================
   🗳️ POLLS ENHANCED
============================================================ */
function renderPollCard(p) {
  const total = (p.options || []).reduce((s, o) => s + (o.votes || 0), 0);
  const isVoted = _votedPolls && _votedPolls[p.id] !== undefined;
  const votedIdx = isVoted ? _votedPolls[p.id] : -1;
  const isExpired = p.expiresAt && Date.now() > new Date(p.expiresAt).getTime();
  const expiryBadge = isExpired ? '<span class="poll-badge-expired">⏰ انتهى</span>' : '';
  const maxVotes = Math.max(...(p.options||[]).map(o => o.votes||0), 1);

  const optionsHtml = (p.options || []).map((opt, i) => {
    const pct = total > 0 ? Math.round((opt.votes || 0) / total * 100) : 0;
    const isWinner = (opt.votes || 0) === maxVotes && total > 0 && !isExpired;
    const isMyVote = votedIdx === i;
    return `<div class="poll-opt-row ${isWinner ? 'poll-winner' : ''} ${(!isVoted && !isExpired) ? 'poll-clickable' : ''}"
      onclick="${(!isVoted && !isExpired) ? `castVote('${p.id}',${i},this)` : ''}">
      <div class="poll-opt-text">
        ${isMyVote ? '✅ ' : isWinner && isVoted ? '🏆 ' : ''}${escHtml(opt.text)}
      </div>
      <div class="poll-bar">
        <div class="poll-bar-fill" style="width:${pct}%;background:${isMyVote?'#1abc9c':isWinner?'#f39c12':'rgba(255,255,255,.15)'}"></div>
      </div>
      <div class="poll-opt-pct">${pct}%</div>
    </div>`;
  }).join('');

  return `<div class="poll-card">
    <div class="poll-card-top">
      <div class="poll-q">${escHtml(p.question)}</div>
      ${expiryBadge}
    </div>
    ${optionsHtml}
    <div class="poll-footer">
      <span class="poll-total">${total} صوت</span>
      ${p.area ? `<span>📍 ${escHtml(p.area)}</span>` : ''}
      ${p.expiresAt && !isExpired ? `<span>⏳ ${timeAgo(p.expiresAt)}</span>` : ''}
    </div>
  </div>`;
}

/* ============================================================
   📊 DASHBOARD ENHANCED
============================================================ */

/* ============================================================
   🔙 BACK BUTTON FIX - إصلاح زر الرجوع
============================================================ */
// Override the existing popstate handler with a better one
window.removeEventListener('popstate', window._nabdhPopstate);
window._nabdhPopstate = function(e) {
  // Check modals first
  const modals = ['sosModal','profileQrModal','personModal','chatModal','marketModal','mapLayersPanel'];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) {
      el.classList.add('hidden');
      mapLayersPanelOpen = false;
      history.pushState({ section: currentSection }, '', '#' + currentSection);
      return;
    }
  }
  // Check side menu
  const menu = document.getElementById('sideMenu');
  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    const overlay = document.getElementById('menuOverlay');
    if (overlay) overlay.classList.add('hidden');
    history.pushState({ section: currentSection }, '', '#' + currentSection);
    return;
  }
  // Navigate back through section history
  if (_sectionHistory.length > 0) {
    const prev = _sectionHistory.pop();
    _historyPushing = true;
    goSection(prev, false);
    _historyPushing = false;
    history.pushState({ section: prev }, '', '#' + prev);
  } else if (currentSection !== 'home') {
    _historyPushing = true;
    goSection('home', false);
    _historyPushing = false;
    history.pushState({ section: 'home' }, '', '#home');
  } else {
    // Already at home - push state to prevent exit
    history.pushState({ section: 'home' }, '', '#home');
  }
};
window.addEventListener('popstate', window._nabdhPopstate);


/* ============================================================
   🗺️ MAP v3 - تحسينات الخريطة الشاملة
============================================================ */

// مسار الرحلة
let routeLayer = null;
let routeOrigin = null;
let routeDestination = null;

function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  routeOrigin = null; routeDestination = null;
  showToast('🗺️ تم مسح المسار', 'success');
}

function drawRoute(fromLat, fromLng, toLat, toLng, label) {
  if (!map) return;
  if (routeLayer) map.removeLayer(routeLayer);
  const pts = [[fromLat, fromLng], [toLat, toLng]];
  routeLayer = L.polyline(pts, {
    color: '#1abc9c', weight: 4, opacity: 0.8,
    dashArray: '8,6', lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40], animate: true });
  const d = haversine(fromLat, fromLng, toLat, toLng);
  const time = Math.round(d / 40 * 60);
  showToast(`📍 المسافة: ${d < 1 ? '<1' : Math.round(d)} كم • ~${time} دقيقة`, 'success');
  // Popup on route
  const mid = [(fromLat+toLat)/2, (fromLng+toLng)/2];
  L.popup({ className: 'custom-popup', closeButton: true })
    .setLatLng(mid)
    .setContent(`<div style="text-align:center;padding:.3rem">
      <div style="font-size:.85rem;font-weight:700;color:#1abc9c">🗺️ ${escHtml(label||'مسار')}</div>
      <div style="font-size:.78rem;color:#8892a4;margin-top:.3rem">${d<1?'<1':Math.round(d)} كم • ~${time} دقيقة</div>
      <button onclick="clearRoute()" style="margin-top:.4rem;background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;padding:.25rem .6rem;border-radius:8px;cursor:pointer;font-size:.75rem">✕ مسح المسار</button>
    </div>`)
    .openOn(map);
}

function navigateToPin(lat, lng, name) {
  if (!userLat) { showToast('⚠️ الموقع غير محدد', 'error'); return; }
  drawRoute(userLat, userLng, lat, lng, name);
}

// تحسين addMapPin - إضافة زر المسار
const _origAddMapPin = addMapPin;

// تحسين مسار للمستخدم
function navigateToUser(userId, name, lat, lng) {
  if (!userLat) { showToast('⚠️ الموقع غير محدد', 'error'); return; }
  goSection('map');
  setTimeout(() => drawRoute(userLat, userLng, lat, lng, 'إلى ' + name), 300);
}

// Map click: إضافة دبوس مؤقت
let tempPin = null;
function addTempPin(lat, lng) {
  if (tempPin) { map.removeLayer(tempPin); tempPin = null; }
  const icon = L.divIcon({
    className: 'custom-marker',
    html: '<div style="font-size:1.8rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">📌</div>',
    iconSize: [36, 36], iconAnchor: [18, 36]
  });
  tempPin = L.marker([lat, lng], { icon }).addTo(map).bindPopup(
    `<div style="text-align:center">
      <div style="font-size:.8rem;color:var(--text2);margin-bottom:.5rem">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <button onclick="goSection('report')" style="background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;padding:.3rem .8rem;border-radius:8px;cursor:pointer;font-size:.78rem;width:100%">📢 بلّغ عن هذا الموقع</button>
    </div>`,
    { className: 'custom-popup' }
  ).openPopup();
}

// تحديث initMap لإضافة ميزات جديدة
const _origInitMap = initMap;

/* ============================================================
   🏥 HOSPITALS v2 - دليل المستشفيات المحسّن
============================================================ */
let _hospMap = null;

function initHospMap() {
  if (_hospMap) return;
  const el = document.getElementById('hospMapMini');
  if (!el) return;
  _hospMap = L.map('hospMapMini', { zoomControl: false, attributionControl: false }).setView([15.5007, 32.5599], 12);
  L.tileLayer(MAP_TILES.dark, { maxZoom: 19, subdomains: 'abcd' }).addTo(_hospMap);
}

function showHospOnMiniMap(lat, lng, name, type) {
  initHospMap();
  if (!_hospMap) return;
  _hospMap.setView([lat, lng], 15, { animate: true });
  const icons = { 'مستشفى': '🏥', 'عيادة': '🩺', 'مختبر': '🔬', 'صيدلية': '💊', 'طوارئ': '🚨' };
  const icon = L.divIcon({
    className: 'custom-marker',
    html: `<div style="font-size:1.6rem">${icons[type]||'🏥'}</div>`,
    iconSize: [32,32], iconAnchor: [16,32]
  });
  L.marker([lat, lng], { icon }).addTo(_hospMap)
    .bindPopup(`<div class="popup-title">${escHtml(name)}</div>`, { className: 'custom-popup' })
    .openPopup();
  const el = document.getElementById('hospMapMiniWrap');
  if (el) el.classList.remove('hidden');
  setTimeout(() => _hospMap.invalidateSize(), 200);
}

function searchHospitalsNear() {
  if (!userLat) { showToast('⚠️ الموقع غير محدد', 'error'); return; }
  const list = (_allHospitals || []).filter(h => h.lat && h.lng && haversine(userLat,userLng,h.lat,h.lng) <= 20);
  list.sort((a,b) => (dist(a)||999) - (dist(b)||999));
  renderHospitals(list);
  showToast(`🏥 ${list.length} مرفق صحي في دائرة 20 كم`, 'success');
}

/* ============================================================
   📰 NEWS v2 - الأخبار المحسّنة
============================================================ */
function bookmarkNews(id, btn) {
  const saved = JSON.parse(localStorage.getItem('nabdh_saved_news') || '[]');
  const idx = saved.indexOf(id);
  if (idx >= 0) {
    saved.splice(idx, 1);
    btn && (btn.textContent = '🔖');
    showToast('تم إلغاء الحفظ', 'success');
  } else {
    saved.push(id);
    btn && (btn.textContent = '✅');
    showToast('✅ تم حفظ الخبر', 'success');
  }
  localStorage.setItem('nabdh_saved_news', JSON.stringify(saved));
}

function filterNewsBySearch() {
  const q = (document.getElementById('newsSearchInp')||{value:''}).value.trim().toLowerCase();
  if (!q) { renderNews(_allNews); return; }
  const filtered = (_allNews||[]).filter(n =>
    (n.title||'').toLowerCase().includes(q) ||
    (n.body||'').toLowerCase().includes(q) ||
    (n.area||'').toLowerCase().includes(q)
  );
  renderNews(filtered);
}

/* ============================================================
   🚗 RIDES v2 - مشاركة الرحلات المحسّنة
============================================================ */
function showRideOnMap(fromLat, fromLng, toLat, toLng, label) {
  if (!fromLat || !toLat) { showToast('⚠️ إحداثيات غير متوفرة', 'error'); return; }
  goSection('map');
  setTimeout(() => {
    if (map) drawRoute(fromLat, fromLng, toLat, toLng, label || 'رحلة');
  }, 350);
}

function filterRidesByDate() {
  const today = new Date().toDateString();
  const todayRides = (_allRides||[]).filter(r => {
    if (!r.date) return false;
    return new Date(r.date).toDateString() === today;
  });
  renderRides(todayRides.length ? todayRides : _allRides);
  showToast(`🚗 ${todayRides.length} رحلة متاحة اليوم`, 'success');
}

/* ============================================================
   💧 WATER v2 - تقارير المياه المحسّنة
============================================================ */
function showWaterOnMap(lat, lng, type, area) {
  if (!lat || !lng) { showToast('⚠️ الموقع غير متوفر', 'error'); return; }
  goSection('map');
  setTimeout(() => {
    if (map) {
      map.setView([lat, lng], 15, { animate: true });
      const icons = { 'cut': '💧', 'low': '🔵', 'dirty': '⚠️', 'dist': '🚰' };
      const ico = icons[type] || '💧';
      L.popup({ className: 'custom-popup' })
        .setLatLng([lat, lng])
        .setContent(`<div class="popup-title">${ico} مشكلة مياه - ${escHtml(area)}</div>`)
        .openOn(map);
    }
  }, 350);
}

/* ============================================================
   🎓 STUDY GROUPS v2 - مجموعات الدراسة المحسّنة
============================================================ */
function searchStudyGroups() {
  const q = (document.getElementById('studySearchInp')||{value:''}).value.trim().toLowerCase();
  const list = Object.values(_allStudyGroups || {});
  if (!q) { renderStudyGroups(list); return; }
  const filtered = list.filter(g =>
    (g.name||'').toLowerCase().includes(q) ||
    (g.subject||'').toLowerCase().includes(q) ||
    (g.area||'').toLowerCase().includes(q)
  );
  renderStudyGroups(filtered);
}

function filterStudyByLevel(level, btn) {
  document.querySelectorAll('.study-level-filt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const list = Object.values(_allStudyGroups || {});
  const filtered = level === 'all' ? list : list.filter(g => g.level === level);
  renderStudyGroups(filtered);
}

/* ============================================================
   📦 HELP v2 - طلبات المساعدة المحسّنة
============================================================ */
function showHelpOnMap(lat, lng, type, title) {
  if (!lat || !lng) { showToast('⚠️ الموقع غير متوفر', 'error'); return; }
  goSection('map');
  setTimeout(() => {
    if (map) {
      map.setView([lat, lng], 15, { animate: true });
      const icons = { food:'🍞', medicine:'💊', transport:'🚗', shelter:'🏠', money:'💰', other:'📦' };
      L.popup({ className: 'custom-popup' })
        .setLatLng([lat, lng])
        .setContent(`<div class="popup-title">${icons[type]||'📦'} ${escHtml(title)}</div>`)
        .openOn(map);
    }
  }, 350);
}

function closeHelpRequest(id, btn) {
  if (!confirm('هل تريد إغلاق هذا الطلب؟')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  fetch('/api/help/' + id + '/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: myUserId })
  }).then(r => r.json()).then(() => {
    showToast('✅ تم إغلاق الطلب', 'success');
    loadHelpRequests();
  }).catch(() => {
    if (btn) { btn.disabled = false; btn.textContent = '✓ تم التوفير'; }
    showToast('❌ خطأ', 'error');
  });
}

/* ============================================================
   🗳️ POLLS v2 - الاستطلاعات المحسّنة
============================================================ */
function sharePoll(id, question) {
  const text = `🗳️ استطلاع نبض:\n${question}\n\nأضف رأيك الآن في تطبيق نبض! 💓`;
  if (navigator.share) navigator.share({ title: 'استطلاع نبض', text }).catch(() => {});
  else navigator.clipboard && navigator.clipboard.writeText(text).then(() => showToast('✅ تم نسخ الاستطلاع', 'success'));
}

/* ============================================================
   🌡️ WEATHER v2 - الطقس المحسّن
============================================================ */
function getWeatherForHospital(lat, lng, name) {
  if (!lat || !lng) return;
  loadWeather(lat, lng, name);
  goSection('weather');
}

/* ============================================================
   📊 DASHBOARD v2 - لوحة التحكم المحسّنة
============================================================ */
function refreshDashboard() {
  const btn = document.getElementById('dashRefreshBtn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  loadDashboard();
  setTimeout(() => {
    if (btn) { btn.textContent = '🔄 تحديث'; btn.disabled = false; }
  }, 2000);
}

/* ============================================================
   🔔 NOTIFICATIONS v2 - الإشعارات المحسّنة
============================================================ */
function showInAppNotif(title, body, icon, action) {
  const container = document.getElementById('inAppNotifContainer');
  if (!container) return;
  const id = 'notif_' + Date.now();
  const el = document.createElement('div');
  el.className = 'in-app-notif';
  el.id = id;
  el.innerHTML = `
    <div class="ian-icon">${icon || '🔔'}</div>
    <div class="ian-content">
      <div class="ian-title">${escHtml(title)}</div>
      <div class="ian-body">${escHtml(body)}</div>
    </div>
    <button class="ian-close" onclick="document.getElementById('${id}').remove()">✕</button>
  `;
  if (action) el.onclick = (e) => { if (!e.target.closest('.ian-close')) { action(); el.remove(); } };
  container.appendChild(el);
  el.classList.add('slide-in');
  setTimeout(() => { if (el.parentNode) { el.classList.add('fade-out'); setTimeout(() => el.remove(), 500); } }, 5000);
}

/* ============================================================
   🎨 UI HELPERS v2 - مساعدات الواجهة
============================================================ */
function openSearchInSection(sectionName) {
  goSection(sectionName);
  setTimeout(() => {
    const searchMap = {
      hospitals: 'hospSearchInp',
      news: 'newsSearchInp',
      rides: 'ridesSearchInp',
      water: 'waterSearchInp',
      study: 'studySearchInp',
      help: 'helpSearchInp',
    };
    const inp = document.getElementById(searchMap[sectionName]);
    if (inp) inp.focus();
  }, 300);
}

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

// تحديث عداد البيانات في الوقت الفعلي
function startLiveCounters() {
  setInterval(async () => {
    try {
      const stats = await fetch('/api/stats').then(r => r.json());
      if (stats) {
        animateCount('liveUsers', stats.users || 0);
        animateCount('liveReports', stats.reports || 0);
        const rate = (stats.reports > 0 && stats.users > 0) ? Math.round(stats.reports / Math.max(stats.users,1)) : 0;
        const rateEl = document.getElementById('liveRate');
        if (rateEl) rateEl.textContent = rate;
      }
    } catch {}
  }, 30000);
}
setTimeout(startLiveCounters, 5000);

/* ============================================================
   📱 PWA INSTALL v2
============================================================ */
function checkInstallState() {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    const btn = document.getElementById('menuInstallBtn');
    if (btn) btn.style.display = 'none';
  }
}
setTimeout(checkInstallState, 1000);

/* ============================================================
   🔄 AUTO REFRESH - تحديث تلقائي
============================================================ */
setInterval(() => {
  if (currentSection === 'map') {
    fetch('/api/map').then(r => r.json()).then(pins => {
      pins.forEach(p => { if (!mapMarkers[p.id]) addMapPin(p); });
      updateMapCounts();
    }).catch(() => {});
  }
}, 60000);

// تحديث الطقس على شريط الخريطة كل 5 دقائق
setInterval(updateMapWeatherMini, 300000);



/* ============================================================
   HOSPITALS v2 - دليل المستشفيات
============================================================ */

/* ============================================================
   NEWS v2 - الاخبار المحسّنة
============================================================ */

/* ============================================================
   RIDES v2 - مشاركة الرحلات
============================================================ */

/* ============================================================
   WATER v2 - تقارير المياه
============================================================ */

/* ============================================================
   STUDY GROUPS v2 - مجموعات الدراسة
============================================================ */
function searchStudyGroupsFn() {
  var q = ((document.getElementById('studySearchInp')||{}).value||'').trim().toLowerCase();
  var list = Object.values(_allStudyGroups || {});
  if (!q) { renderStudyGroups(list); return; }
  renderStudyGroups(list.filter(function(g) {
    return (g.name||'').toLowerCase().includes(q) || (g.subject||'').toLowerCase().includes(q) || (g.area||'').toLowerCase().includes(q);
  }));
}

/* ============================================================
   HELP v2 - طلبات المساعدة
============================================================ */

/* ============================================================
   POLLS v2 - الاستطلاعات
============================================================ */

/* ============================================================
   DASHBOARD v2 - لوحة التحكم
============================================================ */

/* ============================================================
   IN-APP NOTIFICATIONS - اشعارات داخل التطبيق
============================================================ */

/* ============================================================
   LIVE COUNTERS - عدادات حية
============================================================ */
setTimeout(startLiveCounters, 8000);

/* ============================================================
   AUTO MAP REFRESH - تحديث تلقائي للخريطة
============================================================ */
setInterval(function() {
  if (currentSection === 'map') {
    fetch('/api/map').then(function(r){ return r.json(); }).then(function(pins) {
      pins.forEach(function(p){ if (!mapMarkers[p.id]) addMapPin(p); });
      updateMapCounts();
    }).catch(function(){});
  }
}, 60000);

setInterval(updateMapWeatherMini, 300000);

/* ================================================================
   🎓 GROUP PAGE SYSTEM - نظام صفحة المجموعة الكاملة
   ================================================================ */

// ── State ──────────────────────────────────────────────────────
var gpCurrentGroup = null;      // full group object
var gpMessages = [];            // cached messages
var gpReplyingTo = null;        // { id, text, author }
var gpVoiceRecorder = null;
var gpVoiceChunks = [];
var gpVoiceTimer = null;
var gpVoiceSeconds = 0;
var gpMediaRecorder = null;
var gpActiveTab = 'chat';
var gpMediaTabActive = 'images';

// ── Call State ─────────────────────────────────────────────────
var gpPeerConnections = {};     // peerConnections map { socketId: RTCPeerConnection }
var gpLocalStream = null;
var gpCallActive = false;
var gpCallType = null;          // 'voice' | 'video'
var gpCallTimer = null;
var gpCallSeconds = 0;
var gpCallIsGroup = false;

// ── DM Call State ──────────────────────────────────────────────
var dmPeer = null;
var dmLocalStream = null;
var dmCallActive = false;
var dmCallType = null;
var dmCallTimer = null;
var dmCallSeconds = 0;
var dmCurrentUser = null;       // { id, name, socketId }
var dmReplyingTo = null;

// ── WebRTC config ──────────────────────────────────────────────
var ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

/* ================================================================
   OPEN / CLOSE GROUP PAGE
   ================================================================ */
function openGroupPage(groupId) {
  fetch('/api/study/' + groupId)
    .then(function(r){ return r.json(); })
    .then(function(g) {
      if (g.error) { showToast('لم يتم العثور على المجموعة', 'error'); return; }
      gpCurrentGroup = g;
      gpMessages = [];
      gpReplyingTo = null;

      // Fill header
      var levelEmojis = { ابتدائي:'🌱', متوسط:'📗', ثانوي:'📘', جامعي:'🎓', مهني:'⚙️', عام:'🌐' };
      document.getElementById('gpAvatar').textContent = g.avatar || levelEmojis[g.level] || '🎓';
      document.getElementById('gpName').textContent = g.name;
      document.getElementById('gpMeta').textContent = (g.members ? g.members.length : 0) + ' عضو • ' + (g.level || 'عام');

      // Show page
      var page = document.getElementById('groupPage');
      page.classList.remove('hidden');
      page.style.transform = 'translateX(100%)';
      setTimeout(function(){ page.style.transform = 'translateX(0)'; }, 10);

      // Push history state
      history.pushState({ page: 'group', groupId: groupId }, '', '#group/' + groupId);

      // Join socket room
      if (socket) socket.emit('join_study', groupId);

      // Register socket events for this group
      setupGroupSocketEvents(groupId);

      // Load chat
      switchGroupTab('chat', null);
    })
    .catch(function(){ showToast('خطأ في تحميل المجموعة', 'error'); });
}

function closeGroupPage() {
  var page = document.getElementById('groupPage');
  page.style.transform = 'translateX(100%)';
  setTimeout(function(){ page.classList.add('hidden'); }, 300);

  if (gpCurrentGroup && socket) socket.emit('leave_study', gpCurrentGroup.id);

  // End any active call
  if (gpCallActive) endGroupCall();

  gpCurrentGroup = null;
  gpMessages = [];

  // Go back in history
  if (history.state && history.state.page === 'group') {
    history.back();
  }
}

/* ================================================================
   GROUP PAGE TABS
   ================================================================ */
function switchGroupTab(tab, btn) {
  gpActiveTab = tab;

  // Update tab buttons
  document.querySelectorAll('.gp-tab').forEach(function(b) { b.classList.remove('active-gp-tab'); });
  if (btn) btn.classList.add('active-gp-tab');
  else {
    document.querySelectorAll('.gp-tab').forEach(function(b) {
      if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'" + tab + "'")) b.classList.add('active-gp-tab');
    });
  }

  // Hide all tab content
  ['gpTabChat', 'gpTabMembers', 'gpTabMedia', 'gpTabInfo'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  if (tab === 'chat') {
    document.getElementById('gpTabChat').classList.remove('hidden');
    if (gpCurrentGroup) loadGroupMessages(gpCurrentGroup.id);
  } else if (tab === 'members') {
    document.getElementById('gpTabMembers').classList.remove('hidden');
    loadGroupMembers();
  } else if (tab === 'media') {
    document.getElementById('gpTabMedia').classList.remove('hidden');
    loadGroupMedia('images');
  } else if (tab === 'info') {
    document.getElementById('gpTabInfo').classList.remove('hidden');
    renderGroupInfo();
  }
}

/* ================================================================
   LOAD GROUP MESSAGES
   ================================================================ */
function loadGroupMessages(groupId) {
  fetch('/api/study/' + groupId + '/messages')
    .then(function(r){ return r.json(); })
    .then(function(msgs) {
      gpMessages = msgs || [];
      renderGroupMessages();
    })
    .catch(function(){});
}

function renderGroupMessages() {
  var container = document.getElementById('gpChatMessages');
  if (!container) return;

  if (!gpMessages.length) {
    container.innerHTML = '<div class="gp-empty-chat"><div class="gec-icon">💬</div><div>لا توجد رسائل بعد<br><small>كن أول من يكتب!</small></div></div>';
    return;
  }

  var html = '';
  var uid = localStorage.getItem('nabdh_uid') || '';
  var prevDate = '';

  gpMessages.forEach(function(m) {
    var isMine = m.userId === uid;
    var msgDate = new Date(m.time || m.createdAt).toLocaleDateString('ar');
    if (msgDate !== prevDate) {
      html += '<div class="gp-date-divider"><span>' + msgDate + '</span></div>';
      prevDate = msgDate;
    }

    var replyHtml = '';
    if (m.replyTo) {
      replyHtml = '<div class="gpm-reply"><div class="gpmr-author">' + escHtml(m.replyTo.author) + '</div><div class="gpmr-text">' + escHtml((m.replyTo.text||'').slice(0,60)) + '</div></div>';
    }

    var mediaHtml = '';
    if (m.mediaType === 'image' && m.mediaData) {
      mediaHtml = '<div class="gpm-media"><img src="' + m.mediaData + '" class="gpm-img" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
    } else if (m.mediaType === 'video' && m.mediaData) {
      mediaHtml = '<div class="gpm-media"><video src="' + m.mediaData + '" class="gpm-video" controls playsinline></video></div>';
    } else if (m.mediaType === 'audio' && m.mediaData) {
      mediaHtml = '<div class="gpm-media"><div class="gpm-audio-player"><div class="gpa-icon">🎵</div><audio src="' + m.mediaData + '" controls class="gpm-audio"></audio></div></div>';
    } else if (m.mediaType === 'file' && m.mediaData) {
      mediaHtml = '<div class="gpm-media"><a href="' + m.mediaData + '" download="' + escHtml(m.mediaName || 'ملف') + '" class="gpm-file-link"><span>📄</span><span>' + escHtml(m.mediaName || 'ملف') + '</span></a></div>';
    }

    var reactionsHtml = '';
    if (m.reactions && Object.keys(m.reactions).length) {
      reactionsHtml = '<div class="gpm-reactions">';
      Object.entries(m.reactions).forEach(function(pair) {
        var emoji = pair[0], users = pair[1];
        var myReact = users.indexOf(uid) >= 0 ? ' my-react' : '';
        reactionsHtml += '<span class="gpm-react' + myReact + '" onclick="reactToMessage(\'' + escJs(m.id) + '\',\'' + escJs(emoji) + '\')">' + emoji + ' ' + users.length + '</span>';
      });
      reactionsHtml += '</div>';
    }

    var timeStr = timeAgo(m.time || new Date(m.createdAt).getTime());

    html += '<div class="gp-msg ' + (isMine ? 'gpm-mine' : 'gpm-other') + '" data-msgid="' + escJs(m.id) + '">';
    if (!isMine) html += '<div class="gpm-author">' + escHtml(m.author) + '</div>';
    html += replyHtml;
    html += mediaHtml;
    if (m.text) html += '<div class="gpm-text">' + escHtml(m.text) + '</div>';
    html += '<div class="gpm-footer"><span class="gpm-time">' + timeStr + '</span>';
    html += '<div class="gpm-actions"><span onclick="replyToGroupMsg(\'' + escJs(m.id) + '\',\'' + escJs(m.text||'') + '\',\'' + escJs(m.author) + '\')" class="gpma-btn" title="رد">↩️</span>';
    html += '<span onclick="showEmojiReactMenu(\'' + escJs(m.id) + '\',this)" class="gpma-btn" title="تفاعل">😊</span></div>';
    html += '</div>';
    html += reactionsHtml;
    html += '</div>';
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

/* ================================================================
   SEND GROUP MESSAGE
   ================================================================ */
function sendGroupMessage() {
  if (!gpCurrentGroup) return;
  var input = document.getElementById('gpMsgInput');
  var text = (input.value || '').trim();
  if (!text && !gpReplyingTo) return;

  var uid = localStorage.getItem('nabdh_uid') || ('u_' + Math.random().toString(36).slice(2));
  var uname = localStorage.getItem('nabdh_name') || 'عضو';

  var payload = {
    text: text,
    author: uname,
    userId: uid,
    replyTo: gpReplyingTo || null
  };

  input.value = '';
  input.style.height = '';
  cancelReply();

  fetch('/api/study/' + gpCurrentGroup.id + '/msg/advanced', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    if (res.success) {
      gpMessages.push(res.msg);
      renderGroupMessages();
    }
  })
  .catch(function(){ showToast('فشل إرسال الرسالة', 'error'); });
}

/* ================================================================
   REPLY TO MESSAGE
   ================================================================ */
function replyToGroupMsg(id, text, author) {
  gpReplyingTo = { id: id, text: text, author: author };
  var preview = document.getElementById('gpReplyPreview');
  var replyText = document.getElementById('gpReplyText');
  if (preview) preview.classList.remove('hidden');
  if (replyText) replyText.textContent = author + ': ' + text.slice(0, 60);
  var input = document.getElementById('gpMsgInput');
  if (input) input.focus();
}

function cancelReply() {
  gpReplyingTo = null;
  var preview = document.getElementById('gpReplyPreview');
  if (preview) preview.classList.add('hidden');
}

/* ================================================================
   EMOJI REACTIONS
   ================================================================ */
function showEmojiReactMenu(msgId, triggerEl) {
  var existing = document.getElementById('emojiReactMenu');
  if (existing) existing.remove();

  var emojis = ['👍','❤️','😂','😮','😢','😡','🔥','👏','🎉','💯'];
  var menu = document.createElement('div');
  menu.id = 'emojiReactMenu';
  menu.className = 'emoji-react-menu';
  menu.innerHTML = emojis.map(function(e) {
    return '<span onclick="reactToMessage(\'' + escJs(msgId) + '\',\'' + e + '\');document.getElementById(\'emojiReactMenu\').remove()" class="erm-emoji">' + e + '</span>';
  }).join('');

  document.body.appendChild(menu);
  var rect = triggerEl.getBoundingClientRect();
  menu.style.top = (rect.top - 50) + 'px';
  menu.style.left = Math.max(10, rect.left - 60) + 'px';
  menu.style.position = 'fixed';

  setTimeout(function() {
    document.addEventListener('click', function removeMenu(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', removeMenu); }
    });
  }, 100);
}

function reactToMessage(msgId, emoji) {
  if (!gpCurrentGroup) return;
  var uid = localStorage.getItem('nabdh_uid') || '';
  fetch('/api/study/' + gpCurrentGroup.id + '/msg/' + msgId + '/react', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji: emoji, userId: uid })
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    var msg = gpMessages.find(function(m){ return m.id === msgId; });
    if (msg && res.reactions) { msg.reactions = res.reactions; renderGroupMessages(); }
  })
  .catch(function(){});
}

/* ================================================================
   EMOJI PICKER (send in message)
   ================================================================ */
function toggleEmojiPicker() {
  var picker = document.getElementById('gpEmojiPicker');
  if (!picker) return;
  picker.classList.toggle('hidden');

  // make emoji spans clickable
  picker.querySelectorAll('.gep-grid').forEach(function(grid) {
    grid.onclick = function(e) {
      var emoji = e.target.textContent.trim();
      if (emoji) {
        var inp = document.getElementById('gpMsgInput');
        if (inp) { inp.value += emoji; inp.focus(); }
        picker.classList.add('hidden');
      }
    };
  });
}

function toggleDMEmojiPicker() {
  var picker = document.getElementById('dmEmojiPicker');
  if (!picker) return;
  picker.classList.toggle('hidden');
  picker.querySelectorAll('.gep-grid').forEach(function(grid) {
    grid.onclick = function(e) {
      var emoji = e.target.textContent.trim();
      if (emoji) {
        var inp = document.getElementById('dmMsgInput');
        if (inp) { inp.value += emoji; inp.focus(); }
        picker.classList.add('hidden');
      }
    };
  });
}

/* ================================================================
   MEDIA UPLOAD (Images & Videos)
   ================================================================ */
/* ── Media menu helpers (Group) ──────────────────────────── */
function toggleGpMediaMenu() {
  var menu = document.getElementById('gpMediaMenu');
  var btn  = document.getElementById('gpAttachBtn');
  if (!menu) return;
  var isOpen = !menu.classList.contains('hidden');
  // Close DM menu if open
  var dmMenu = document.getElementById('dmMediaMenu');
  if (dmMenu) dmMenu.classList.add('hidden');
  menu.classList.toggle('hidden', isOpen);
  if (btn) btn.classList.toggle('gpi-attach-open', !isOpen);
  if (!isOpen) {
    // close on outside click
    setTimeout(function() {
      document.addEventListener('click', function _closeGp(e) {
        var wrap = document.getElementById('gpMediaWrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.classList.add('hidden');
          if (btn) btn.classList.remove('gpi-attach-open');
        }
        document.removeEventListener('click', _closeGp);
      });
    }, 10);
  }
}
function closeGpMediaMenu() {
  var menu = document.getElementById('gpMediaMenu');
  var btn  = document.getElementById('gpAttachBtn');
  if (menu) menu.classList.add('hidden');
  if (btn)  btn.classList.remove('gpi-attach-open');
}

/* ── Media menu helpers (DM) ──────────────────────────────── */
function toggleDmMediaMenu() {
  var menu = document.getElementById('dmMediaMenu');
  var btn  = document.getElementById('dmAttachBtn');
  if (!menu) return;
  var isOpen = !menu.classList.contains('hidden');
  // Close GP menu if open
  var gpMenu = document.getElementById('gpMediaMenu');
  if (gpMenu) gpMenu.classList.add('hidden');
  menu.classList.toggle('hidden', isOpen);
  if (btn) btn.classList.toggle('gpi-attach-open', !isOpen);
  if (!isOpen) {
    setTimeout(function() {
      document.addEventListener('click', function _closeDm(e) {
        var wrap = document.getElementById('dmMediaWrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.classList.add('hidden');
          if (btn) btn.classList.remove('gpi-attach-open');
        }
        document.removeEventListener('click', _closeDm);
      });
    }, 10);
  }
}
function closeDmMediaMenu() {
  var menu = document.getElementById('dmMediaMenu');
  var btn  = document.getElementById('dmAttachBtn');
  if (menu) menu.classList.add('hidden');
  if (btn)  btn.classList.remove('gpi-attach-open');
}

/* ── triggerMediaPicker — Group ───────────────────────────── */
function triggerMediaPicker(type) {
  var map = { image:'gpImageInput', camera:'gpCameraInput', video:'gpVideoInput', audio:'gpAudioInput', file:'gpFileInput' };
  var el = document.getElementById(map[type] || 'gpFileInput');
  if (el) { el.value = ''; el.click(); }
  else showToast('عنصر الرفع غير موجود', 'error');
}

function uploadGroupMedia(input, type) {
  var file = input.files[0];
  if (!file) return;

  // Size limits by type
  var limits = { image: 5, video: 50, audio: 20, file: 20 };
  var maxMB  = limits[type] || 20;
  if (file.size > maxMB * 1024 * 1024) {
    showToast('الملف كبير جداً (الحد ' + maxMB + 'MB)', 'error');
    input.value = '';
    return;
  }

  var icons = { image:'🖼️', video:'🎬', audio:'🎵', file:'📄' };
  showToast(icons[type] + ' جاري الرفع...', 'info');

  var reader = new FileReader();
  reader.onload = function(e) {
    var uid   = localStorage.getItem('nabdh_uid')  || '';
    var uname = localStorage.getItem('nabdh_name') || 'عضو';
    if (!gpCurrentGroup) { showToast('لم يتم تحديد المجموعة', 'error'); return; }
    fetch('/api/study/' + gpCurrentGroup.id + '/msg/advanced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '', author: uname, userId: uid,
        mediaType: type, mediaData: e.target.result, mediaName: file.name
      })
    })
    .then(function(r){ return r.json(); })
    .then(function(res) {
      if (res.success) {
        gpMessages.push(res.msg);
        renderGroupMessages();
        showToast('تم الإرسال ✓', 'success');
      } else {
        showToast('فشل إرسال الوسيط', 'error');
      }
    })
    .catch(function(){ showToast('فشل رفع الوسائط', 'error'); });
    input.value = '';
  };
  reader.readAsDataURL(file);
}

/* ================================================================
   VOICE RECORDING
   ================================================================ */
function startVoiceRecord() {
  if (!navigator.mediaDevices) { showToast('المتصفح لا يدعم التسجيل', 'error'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(stream) {
      gpVoiceChunks = [];
      gpVoiceSeconds = 0;
      var options = {};
      try { options = { mimeType: 'audio/webm;codecs=opus' }; } catch(e) {}
      gpVoiceRecorder = new MediaRecorder(stream, options);
      gpVoiceRecorder.ondataavailable = function(e) { if (e.data.size>0) gpVoiceChunks.push(e.data); };
      gpVoiceRecorder.onstop = function() {
        stream.getTracks().forEach(function(t){ t.stop(); });
        finishVoiceRecord();
      };
      gpVoiceRecorder.start();

      // Show recording bar
      var bar = document.getElementById('gpVoiceRecordingBar');
      if (bar) bar.classList.remove('hidden');
      gpVoiceTimer = setInterval(function() {
        gpVoiceSeconds++;
        var el = document.getElementById('gpVoiceRecTime');
        if (el) el.textContent = Math.floor(gpVoiceSeconds/60) + ':' + ('0'+gpVoiceSeconds%60).slice(-2);
        if (gpVoiceSeconds >= 120) stopVoiceRecord();
      }, 1000);
    })
    .catch(function(){ showToast('لا يمكن الوصول إلى المايكروفون', 'error'); });
}

function stopVoiceRecord() {
  if (gpVoiceRecorder && gpVoiceRecorder.state !== 'inactive') {
    gpVoiceRecorder.stop();
  }
  clearInterval(gpVoiceTimer);
  var bar = document.getElementById('gpVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}

function cancelVoiceRecord() {
  if (gpVoiceRecorder && gpVoiceRecorder.state !== 'inactive') {
    gpVoiceRecorder.stream && gpVoiceRecorder.stream.getTracks().forEach(function(t){ t.stop(); });
    gpVoiceRecorder.stop();
  }
  clearInterval(gpVoiceTimer);
  gpVoiceChunks = [];
  var bar = document.getElementById('gpVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}

function finishVoiceRecord() {
  if (!gpVoiceChunks.length || !gpCurrentGroup) return;
  var blob = new Blob(gpVoiceChunks, { type: 'audio/webm' });
  if (gpVoiceSeconds < 1) { showToast('التسجيل قصير جداً', 'error'); return; }

  var reader = new FileReader();
  reader.onload = function(e) {
    var uid = localStorage.getItem('nabdh_uid') || '';
    var uname = localStorage.getItem('nabdh_name') || 'عضو';
    fetch('/api/study/' + gpCurrentGroup.id + '/msg/advanced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '🎵 رسالة صوتية (' + Math.floor(gpVoiceSeconds/60) + ':' + ('0'+gpVoiceSeconds%60).slice(-2) + ')',
        author: uname, userId: uid,
        mediaType: 'audio', mediaData: e.target.result
      })
    })
    .then(function(r){ return r.json(); })
    .then(function(res) {
      if (res.success) { gpMessages.push(res.msg); renderGroupMessages(); }
    })
    .catch(function(){});
  };
  reader.readAsDataURL(blob);
}

/* ================================================================
   TYPING INDICATOR
   ================================================================ */
var gpTypingTimeout = null;
function onGroupTyping() {
  if (!gpCurrentGroup || !socket) return;
  socket.emit('study_typing', { groupId: gpCurrentGroup.id, name: localStorage.getItem('nabdh_name') || 'عضو' });
  clearTimeout(gpTypingTimeout);
  gpTypingTimeout = setTimeout(function(){}, 2000);
}

/* ================================================================
   MEMBERS TAB
   ================================================================ */
function loadGroupMembers() {
  if (!gpCurrentGroup) return;
  fetch('/api/study/' + gpCurrentGroup.id)
    .then(function(r){ return r.json(); })
    .then(function(g) {
      gpCurrentGroup = g;
      renderGroupMembers(g);
    })
    .catch(function(){});
}

function renderGroupMembers(g) {
  var cnt = document.getElementById('gpMembersCount');
  var list = document.getElementById('gpMembersList');
  if (!list) return;

  var members = g.members || [];
  if (cnt) cnt.textContent = members.length + ' / ' + (g.maxMembers || 20) + ' عضو';

  if (!members.length) {
    list.innerHTML = '<div class="gp-empty-chat"><div class="gec-icon">👥</div><div>لا يوجد أعضاء بعد</div></div>';
    return;
  }

  var uid = localStorage.getItem('nabdh_uid') || '';
  list.innerHTML = members.map(function(mid) {
    var isMe = mid === uid;
    var isAdmin = mid === g.userId;
    return '<div class="gpm-member">' +
      '<div class="gpm-m-avatar">' + (isMe ? '👤' : '🧑') + '</div>' +
      '<div class="gpm-m-info"><div class="gpm-m-name">' + (isMe ? 'أنت' : 'عضو') +
      (isAdmin ? ' <span class="gpm-admin-badge">مشرف</span>' : '') + '</div>' +
      '<div class="gpm-m-id">' + mid.slice(0,8) + '...</div></div>' +
      ((!isMe && socket) ? '<button class="gpm-dm-btn" onclick="startDMWithMember(\'' + escJs(mid) + '\')">💬 رسالة</button>' : '') +
      '</div>';
  }).join('');
}

/* ================================================================
   MEDIA TAB
   ================================================================ */
function switchMediaTab(tab, btn) {
  gpMediaTabActive = tab;
  document.querySelectorAll('.gmt-tab').forEach(function(b){ b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  loadGroupMedia(tab);
}

function loadGroupMedia(type) {
  var grid = document.getElementById('gpMediaGrid');
  if (!grid || !gpCurrentGroup) return;

  var filtered = gpMessages.filter(function(m){ return m.mediaType === type.slice(0,-1) || (type==='audio' && m.mediaType==='audio'); });

  // re-map: images→image, videos→video, audio→audio, files→file
  var typeMap = { images:'image', videos:'video', audio:'audio', files:'file' };
  var targetType = typeMap[type] || type;
  filtered = gpMessages.filter(function(m){ return m.mediaType === targetType; });

  if (!filtered.length) {
    grid.innerHTML = '<div class="gp-empty-chat"><div class="gec-icon">' + (type==='images'?'📷':type==='videos'?'🎬':type==='audio'?'🎵':'📁') + '</div><div>لا توجد وسائط من هذا النوع</div></div>';
    return;
  }

  if (type === 'images') {
    grid.innerHTML = filtered.map(function(m) {
      return '<div class="gpmed-item"><img src="' + m.mediaData + '" class="gpmed-img" onclick="viewFullImage(this.src)" loading="lazy"/><div class="gpmed-caption">' + escHtml(m.author) + '</div></div>';
    }).join('');
  } else if (type === 'videos') {
    grid.innerHTML = filtered.map(function(m) {
      return '<div class="gpmed-item"><video src="' + m.mediaData + '" class="gpmed-video" controls playsinline></video><div class="gpmed-caption">' + escHtml(m.author) + '</div></div>';
    }).join('');
  } else if (type === 'audio') {
    grid.innerHTML = filtered.map(function(m) {
      return '<div class="gpmed-audio-item"><div class="gpa-icon">🎵</div><audio src="' + m.mediaData + '" controls class="gpm-audio"></audio><div class="gpmed-caption">' + escHtml(m.author) + ' • ' + timeAgo(m.time) + '</div></div>';
    }).join('');
  }
}

/* ================================================================
   INFO TAB
   ================================================================ */
function renderGroupInfo() {
  var g = gpCurrentGroup;
  if (!g) return;
  var el = document.getElementById('gpInfoContent');
  if (!el) return;

  el.innerHTML = '<div class="gpi-section">' +
    '<div class="gpi-row"><span class="gpi-label">📚 المادة</span><span class="gpi-val">' + escHtml(g.subject) + '</span></div>' +
    '<div class="gpi-row"><span class="gpi-label">📊 المستوى</span><span class="gpi-val">' + escHtml(g.level||'عام') + '</span></div>' +
    '<div class="gpi-row"><span class="gpi-label">👥 الأعضاء</span><span class="gpi-val">' + (g.members?g.members.length:0) + ' / ' + (g.maxMembers||20) + '</span></div>' +
    (g.schedule ? '<div class="gpi-row"><span class="gpi-label">📅 المواعيد</span><span class="gpi-val">' + escHtml(g.schedule) + '</span></div>' : '') +
    (g.area ? '<div class="gpi-row"><span class="gpi-label">📍 المنطقة</span><span class="gpi-val">' + escHtml(g.area) + '</span></div>' : '') +
    (g.contact ? '<div class="gpi-row"><span class="gpi-label">📞 التواصل</span><span class="gpi-val">' + escHtml(g.contact) + '</span></div>' : '') +
    '<div class="gpi-row"><span class="gpi-label">📅 تأسست</span><span class="gpi-val">' + timeAgo(g.time||new Date(g.createdAt).getTime()) + '</span></div>' +
    '</div>' +
    '<div class="gpi-actions">' +
    '<button class="gpi-btn gpi-invite" onclick="showGroupInvite()">🔗 دعوة أصدقاء</button>' +
    '<button class="gpi-btn gpi-leave" onclick="leaveGroup()">🚪 مغادرة المجموعة</button>' +
    '</div>';
}

/* ================================================================
   INVITE LINK
   ================================================================ */
function showGroupInvite() {
  if (!gpCurrentGroup) return;
  var modal = document.getElementById('gpInviteModal');
  var linkEl = document.getElementById('gpInviteLink');
  if (!modal || !linkEl) return;

  linkEl.textContent = 'جاري توليد الرابط...';
  modal.classList.remove('hidden');

  fetch('/api/study/' + gpCurrentGroup.id + '/invite', { method: 'POST' })
    .then(function(r){ return r.json(); })
    .then(function(res) {
      var base = window.location.origin;
      var link = base + '/?join=' + res.token;
      linkEl.textContent = link;

      // Simple QR via text
      var qrEl = document.getElementById('gpInviteQR');
      if (qrEl) qrEl.innerHTML = '<div class="gpim-qr-text">🔗 ' + link + '</div>';
    })
    .catch(function(){ linkEl.textContent = 'فشل توليد الرابط'; });
}

function copyGroupLink() {
  var linkEl = document.getElementById('gpInviteLink');
  if (!linkEl) return;
  var text = linkEl.textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function(){ showToast('تم نسخ الرابط ✓', 'success'); });
  } else {
    var el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('تم نسخ الرابط ✓', 'success');
  }
}

function shareGroupLink() {
  var linkEl = document.getElementById('gpInviteLink');
  var groupName = gpCurrentGroup ? gpCurrentGroup.name : 'مجموعة';
  var url = linkEl ? linkEl.textContent : '';

  if (navigator.share) {
    navigator.share({
      title: 'انضم لمجموعة ' + groupName,
      text: 'مرحباً! انضم إلينا في مجموعة "' + groupName + '" على تطبيق نبض',
      url: url
    }).catch(function(){});
  } else {
    copyGroupLink();
  }
}

/* ================================================================
   LEAVE GROUP
   ================================================================ */
function leaveGroup() {
  if (!gpCurrentGroup) return;
  if (!confirm('هل تريد مغادرة المجموعة "' + gpCurrentGroup.name + '"؟')) return;
  var uid = localStorage.getItem('nabdh_uid') || '';
  fetch('/api/study/' + gpCurrentGroup.id + '/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid })
  })
  .then(function(){ showToast('غادرت المجموعة', 'info'); closeGroupPage(); })
  .catch(function(){ showToast('خطأ في المغادرة', 'error'); });
}

/* ================================================================
   AUTO-RESIZE TEXTAREA
   ================================================================ */
function autoResizeTA(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* ================================================================
   VIEW FULL IMAGE
   ================================================================ */
function viewFullImage(src) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  overlay.innerHTML = '<img src="' + src + '" style="max-width:95vw;max-height:95vh;border-radius:8px;object-fit:contain"/>';
  overlay.onclick = function(){ document.body.removeChild(overlay); };
  document.body.appendChild(overlay);
}

/* ================================================================
   SOCKET EVENTS FOR GROUP
   ================================================================ */
function setupGroupSocketEvents(groupId) {
  if (!socket) return;

  // Remove old listeners first
  socket.off('study_msg');
  socket.off('study_react');
  socket.off('study_typing');
  socket.off('study_join');

  socket.on('study_msg', function(data) {
    if (!gpCurrentGroup || data.groupId !== gpCurrentGroup.id) return;
    if (!gpMessages.find(function(m){ return m.id === data.msg.id; })) {
      gpMessages.push(data.msg);
      if (gpActiveTab === 'chat') renderGroupMessages();
    }
  });

  socket.on('study_react', function(data) {
    if (!gpCurrentGroup || data.groupId !== gpCurrentGroup.id) return;
    var msg = gpMessages.find(function(m){ return m.id === data.msgId; });
    if (msg) { msg.reactions = data.reactions; if (gpActiveTab === 'chat') renderGroupMessages(); }
  });

  socket.on('study_typing', function(data) {
    var el = document.getElementById('gpTypingIndicator');
    var txt = document.getElementById('gpTypingText');
    if (el && txt) {
      txt.textContent = (data.name || 'شخص ما') + ' يكتب...';
      el.classList.remove('hidden');
      clearTimeout(gpTypingTimeout);
      gpTypingTimeout = setTimeout(function(){ el.classList.add('hidden'); }, 2500);
    }
  });

  socket.on('study_join', function(data) {
    if (gpCurrentGroup && data.id === gpCurrentGroup.id) {
      gpCurrentGroup.members = data.members;
      document.getElementById('gpMeta').textContent = data.members.length + ' عضو • ' + (gpCurrentGroup.level || 'عام');
      if (gpActiveTab === 'members') renderGroupMembers(gpCurrentGroup);
    }
  });
}

/* ================================================================
   🎙️ GROUP VOICE / VIDEO CALLS (WebRTC)
   ================================================================ */
function startGroupVoiceCall() {
  if (!gpCurrentGroup) return;
  gpCallIsGroup = true;
  initiateGroupCall('voice');
}

function startGroupVideoCall() {
  if (!gpCurrentGroup) return;
  gpCallIsGroup = true;
  initiateGroupCall('video');
}

function initiateGroupCall(type) {
  gpCallType = type;
  var constraints = type === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true, video: false };

  navigator.mediaDevices.getUserMedia(constraints)
    .then(function(stream) {
      gpLocalStream = stream;
      gpCallActive = true;

      // Show call banner
      var banner = document.getElementById('gpCallBanner');
      if (banner) banner.classList.remove('hidden');
      document.getElementById('gpCallType').textContent = type === 'video' ? '📹 مكالمة مرئية جارية' : '🎙️ مكالمة صوتية جارية';

      // Show video grid if video call
      if (type === 'video') {
        var grid = document.getElementById('gpVideoGrid');
        if (grid) grid.classList.remove('hidden');
        var localVid = document.getElementById('localVideo');
        if (localVid) localVid.srcObject = stream;
      }

      // Start call timer
      gpCallSeconds = 0;
      gpCallTimer = setInterval(function() {
        gpCallSeconds++;
        var el = document.getElementById('gpCallTime');
        if (el) el.textContent = Math.floor(gpCallSeconds/60) + ':' + ('0'+gpCallSeconds%60).slice(-2);
      }, 1000);

      // Notify group via socket
      if (socket) {
        socket.emit('call_request', {
          groupId: gpCurrentGroup.id,
          from: socket.id,
          fromName: localStorage.getItem('nabdh_name') || 'عضو',
          type: type
        });
      }

      showToast(type === 'video' ? '📹 بدأت مكالمة مرئية' : '🎙️ بدأت مكالمة صوتية', 'success');
    })
    .catch(function(err) {
      showToast('لا يمكن الوصول إلى الكاميرا/المايكروفون', 'error');
      console.warn('Media error:', err);
    });
}

function toggleMuteCall() {
  if (!gpLocalStream) return;
  var audioTracks = gpLocalStream.getAudioTracks();
  if (!audioTracks.length) return;
  audioTracks[0].enabled = !audioTracks[0].enabled;
  var btn = document.getElementById('btnMute');
  if (btn) btn.textContent = audioTracks[0].enabled ? '🎙️' : '🔇';
}

function toggleVideoCall() {
  if (!gpLocalStream) return;
  var videoTracks = gpLocalStream.getVideoTracks();
  if (!videoTracks.length) return;
  videoTracks[0].enabled = !videoTracks[0].enabled;
  var btn = document.getElementById('btnCam');
  if (btn) btn.textContent = videoTracks[0].enabled ? '📹' : '📷';
}

function endGroupCall() {
  if (gpLocalStream) {
    gpLocalStream.getTracks().forEach(function(t){ t.stop(); });
    gpLocalStream = null;
  }
  Object.values(gpPeerConnections).forEach(function(pc){ try{ pc.close(); }catch(e){} });
  gpPeerConnections = {};
  gpCallActive = false;
  clearInterval(gpCallTimer);

  var banner = document.getElementById('gpCallBanner');
  if (banner) banner.classList.add('hidden');
  var grid = document.getElementById('gpVideoGrid');
  if (grid) grid.classList.add('hidden');

  // Clear remote videos
  var remoteVids = document.getElementById('remoteVideos');
  if (remoteVids) remoteVids.innerHTML = '';

  if (socket && gpCurrentGroup) socket.emit('call_end', { groupId: gpCurrentGroup.id });
  showToast('انتهت المكالمة', 'info');
}

// Handle incoming group call
function handleIncomingGroupCall(data) {
  var incoming = document.getElementById('gpIncomingCall');
  var callerName = document.getElementById('gpCallerName');
  var subtitle = document.getElementById('gpCallSubtitle');

  if (incoming && callerName) {
    callerName.textContent = data.fromName || 'عضو في المجموعة';
    if (subtitle) subtitle.textContent = data.type === 'video' ? '📹 مكالمة مرئية' : '🎙️ مكالمة صوتية';
    incoming._callData = data;
    incoming.classList.remove('hidden');
  }
}

function acceptCall() {
  var incoming = document.getElementById('gpIncomingCall');
  if (!incoming) return;
  var data = incoming._callData;
  incoming.classList.add('hidden');
  if (data) initiateGroupCall(data.type || 'voice');
}

function rejectCall() {
  var incoming = document.getElementById('gpIncomingCall');
  if (incoming) incoming.classList.add('hidden');
  if (socket && incoming && incoming._callData) {
    socket.emit('call_reject', { to: incoming._callData.from });
  }
}

/* ================================================================
   🔔 INCOMING CALL SOCKET LISTENER
   ================================================================ */
if (socket) {
  socket.on('call_request', function(data) {
    // If we're on the group page for this group, show incoming call
    if (gpCurrentGroup && data.groupId === gpCurrentGroup.id) {
      handleIncomingGroupCall(data);
    } else if (!data.groupId && document.getElementById('dmChatPage') && !document.getElementById('dmChatPage').classList.contains('hidden')) {
      // DM incoming call
      handleIncomingDMCall(data);
    }
  });

  socket.on('call_end', function() {
    endGroupCall();
    endDMCall();
  });
}

/* ================================================================
   💬 ADVANCED DM CHAT PAGE
   ================================================================ */
function openDMChatPage(userId, userName) {
  dmCurrentUser = { id: userId, name: userName };
  dmReplyingTo = null;

  document.getElementById('dmChatAvatar').textContent = '👤';
  document.getElementById('dmChatName').textContent = userName || 'محادثة';
  document.getElementById('dmChatStatus').textContent = 'عضو في نبض';

  var page = document.getElementById('dmChatPage');
  page.classList.remove('hidden');
  page.style.transform = 'translateX(100%)';
  setTimeout(function(){ page.style.transform = 'translateX(0)'; }, 10);

  history.pushState({ page: 'dm', userId: userId }, '', '#dm/' + userId);

  // Load DM messages
  loadDMMessages(userId);
}

function closeDMChatPage() {
  var page = document.getElementById('dmChatPage');
  page.style.transform = 'translateX(100%)';
  setTimeout(function(){ page.classList.add('hidden'); }, 300);

  if (dmCallActive) endDMCall();
  dmCurrentUser = null;

  if (history.state && history.state.page === 'dm') history.back();
}

function loadDMMessages(userId) {
  var container = document.getElementById('dmChatMessages');
  if (!container) return;

  // Use existing conversations from localStorage cache
  var convId = [localStorage.getItem('nabdh_uid'), userId].sort().join('_');
  var conv = (window._conversations || []).find(function(c){ return c.id === convId; });

  if (!conv || !conv.messages || !conv.messages.length) {
    container.innerHTML = '<div class="gp-empty-chat"><div class="gec-icon">💬</div><div>ابدأ المحادثة الآن!</div></div>';
    return;
  }

  var uid = localStorage.getItem('nabdh_uid') || '';
  var html = '';
  conv.messages.forEach(function(m) {
    var isMine = m.from === uid;
    html += '<div class="gp-msg ' + (isMine ? 'gpm-mine' : 'gpm-other') + '">';
    if (!isMine) html += '<div class="gpm-author">' + escHtml(dmCurrentUser ? dmCurrentUser.name : 'عضو') + '</div>';
    if (m.mediaType === 'image' && m.mediaData) {
      html += '<div class="gpm-media"><img src="' + m.mediaData + '" class="gpm-img" onclick="viewFullImage(this.src)" loading="lazy"/></div>';
    } else if (m.mediaType === 'video' && m.mediaData) {
      html += '<div class="gpm-media"><video src="' + m.mediaData + '" class="gpm-video" controls playsinline></video></div>';
    } else if (m.mediaType === 'audio' && m.mediaData) {
      html += '<div class="gpm-media"><div class="gpm-audio-player"><div class="gpa-icon">🎵</div><audio src="' + m.mediaData + '" controls class="gpm-audio"></audio></div></div>';
    } else if (m.mediaType === 'file' && m.mediaData) {
      html += '<div class="gpm-media"><a href="' + m.mediaData + '" download="' + escHtml(m.mediaName||'ملف') + '" class="gpm-file-link"><span>📄</span><span>' + escHtml(m.mediaName||'ملف') + '</span></a></div>';
    }
    if (m.text) html += '<div class="gpm-text">' + escHtml(m.text) + '</div>';
    html += '<div class="gpm-footer"><span class="gpm-time">' + timeAgo(m.time || Date.now()) + '</span></div>';
    html += '</div>';
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function sendDMFromPage() {
  if (!dmCurrentUser) return;
  var input = document.getElementById('dmMsgInput');
  var text = (input.value || '').trim();
  if (!text) return;

  var uid = localStorage.getItem('nabdh_uid') || '';
  var uname = localStorage.getItem('nabdh_name') || 'عضو';

  if (socket) {
    socket.emit('dm_send', {
      toUserId: dmCurrentUser.id,
      fromUserId: uid,
      senderName: uname,
      text: text
    });
  }

  // Optimistically add to UI
  var container = document.getElementById('dmChatMessages');
  if (container) {
    var emptyEl = container.querySelector('.gp-empty-chat');
    if (emptyEl) container.innerHTML = '';
    var msgEl = document.createElement('div');
    msgEl.className = 'gp-msg gpm-mine';
    msgEl.innerHTML = '<div class="gpm-text">' + escHtml(text) + '</div><div class="gpm-footer"><span class="gpm-time">الآن</span></div>';
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  input.value = '';
  input.style.height = '';
}

/* ── triggerDMMedia — DM ──────────────────────────────────── */
function triggerDMMedia(type) {
  var map = { image:'dmImageInput', camera:'dmCameraInput', video:'dmVideoInput', audio:'dmAudioInput', file:'dmFileInput' };
  var el = document.getElementById(map[type] || 'dmFileInput');
  if (el) { el.value = ''; el.click(); }
  else showToast('عنصر الرفع غير موجود', 'error');
}

function uploadDMMedia(input, type) {
  var file = input.files[0];
  if (!file) return;

  // Size limits
  var limits = { image:5, video:50, audio:20, file:20 };
  var maxMB  = limits[type] || 20;
  if (file.size > maxMB * 1024 * 1024) {
    showToast('الملف كبير جداً (الحد ' + maxMB + 'MB)', 'error');
    input.value = '';
    return;
  }

  var icons = { image:'🖼️', video:'🎬', audio:'🎵', file:'📄' };
  showToast(icons[type] + ' جاري الرفع...', 'info');

  var reader = new FileReader();
  reader.onload = function(e) {
    if (!dmCurrentUser || !socket) { showToast('الاتصال غير متاح', 'error'); return; }
    var uid   = localStorage.getItem('nabdh_uid')  || '';
    var uname = localStorage.getItem('nabdh_name') || 'عضو';
    var label = { image:'📷 صورة', video:'🎬 فيديو', audio:'🎵 صوت', file:'📄 ملف: ' + file.name };
    socket.emit('dm_send', {
      toUserId:   dmCurrentUser.id,
      fromUserId: uid,
      senderName: uname,
      text:       label[type] || '📎 مرفق',
      mediaType:  type,
      mediaData:  e.target.result,
      mediaName:  file.name
    });
    showToast('تم الإرسال ✓', 'success');
    input.value = '';
  };
  reader.readAsDataURL(file);
}

function onDMTyping() {
  if (!dmCurrentUser || !socket) return;
  socket.emit('dm_typing', { toUserId: dmCurrentUser.id });
}

// DM Voice Record
var dmVoiceRecorder = null, dmVoiceChunks = [], dmVoiceTimer = null, dmVoiceSeconds = 0;

function startDMVoiceRecord() {
  if (!navigator.mediaDevices) { showToast('التسجيل غير مدعوم', 'error'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(stream) {
      dmVoiceChunks = [];
      dmVoiceSeconds = 0;
      var opts = {};
      try { opts = { mimeType: 'audio/webm;codecs=opus' }; } catch(e) {}
      dmVoiceRecorder = new MediaRecorder(stream, opts);
      dmVoiceRecorder.ondataavailable = function(e){ if(e.data.size>0) dmVoiceChunks.push(e.data); };
      dmVoiceRecorder.onstop = function() {
        stream.getTracks().forEach(function(t){ t.stop(); });
        finishDMVoiceRecord();
      };
      dmVoiceRecorder.start();
      var bar = document.getElementById('dmVoiceRecordingBar');
      if (bar) bar.classList.remove('hidden');
      dmVoiceTimer = setInterval(function() {
        dmVoiceSeconds++;
        var el = document.getElementById('dmVoiceRecTime');
        if (el) el.textContent = Math.floor(dmVoiceSeconds/60) + ':' + ('0'+dmVoiceSeconds%60).slice(-2);
        if (dmVoiceSeconds >= 120) stopDMVoiceRecord();
      }, 1000);
    })
    .catch(function(){ showToast('لا يمكن الوصول للمايكروفون', 'error'); });
}

function stopDMVoiceRecord() {
  if (dmVoiceRecorder && dmVoiceRecorder.state !== 'inactive') dmVoiceRecorder.stop();
  clearInterval(dmVoiceTimer);
  var bar = document.getElementById('dmVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}

function cancelDMVoiceRecord() {
  if (dmVoiceRecorder && dmVoiceRecorder.state !== 'inactive') dmVoiceRecorder.stop();
  clearInterval(dmVoiceTimer);
  dmVoiceChunks = [];
  var bar = document.getElementById('dmVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}

function finishDMVoiceRecord() {
  if (!dmVoiceChunks.length || !dmCurrentUser) return;
  var blob = new Blob(dmVoiceChunks, { type: 'audio/webm' });
  var reader = new FileReader();
  reader.onload = function(e) {
    if (!socket) return;
    socket.emit('dm_send', {
      toUserId: dmCurrentUser.id,
      fromUserId: localStorage.getItem('nabdh_uid') || '',
      senderName: localStorage.getItem('nabdh_name') || 'عضو',
      text: '🎵 رسالة صوتية',
      mediaType: 'audio',
      mediaData: e.target.result
    });
    showToast('تم إرسال الرسالة الصوتية ✓', 'success');
  };
  reader.readAsDataURL(blob);
}

/* ================================================================
   🌐 PUBLIC CHAT — MEDIA (toggleMenu, trigger, upload, voice)
   ================================================================ */
var pubVoiceRecorder = null, pubVoiceChunks = [], pubVoiceTimer = null, pubVoiceSeconds = 0;

function togglePubMediaMenu() {
  var menu = document.getElementById('pubMediaMenu');
  var btn  = document.getElementById('pubAttachBtn');
  if (!menu) return;
  var isOpen = !menu.classList.contains('hidden');
  menu.classList.toggle('hidden', isOpen);
  if (btn) btn.classList.toggle('gpi-attach-open', !isOpen);
  if (!isOpen) {
    setTimeout(function() {
      document.addEventListener('click', function _closePub(e) {
        var wrap = document.getElementById('pubMediaWrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.classList.add('hidden');
          if (btn) btn.classList.remove('gpi-attach-open');
        }
        document.removeEventListener('click', _closePub);
      });
    }, 10);
  }
}
function closePubMediaMenu() {
  var menu = document.getElementById('pubMediaMenu');
  var btn  = document.getElementById('pubAttachBtn');
  if (menu) menu.classList.add('hidden');
  if (btn)  btn.classList.remove('gpi-attach-open');
}
function triggerPubMedia(type) {
  var map = { image:'pubImageInput', camera:'pubCameraInput', video:'pubVideoInput', audio:'pubAudioInput', file:'pubFileInput' };
  var el = document.getElementById(map[type] || 'pubFileInput');
  if (el) { el.value = ''; el.click(); }
  else showToast('عنصر الرفع غير موجود', 'error');
}
function uploadPubMedia(input, type) {
  var file = input.files[0];
  if (!file) return;
  var limits = { image:5, video:50, audio:20, file:20 };
  var maxMB = limits[type] || 20;
  if (file.size > maxMB * 1024 * 1024) {
    showToast('الملف كبير جداً (الحد ' + maxMB + 'MB)', 'error');
    input.value = ''; return;
  }
  var icons = { image:'🖼️', video:'🎬', audio:'🎵', file:'📄' };
  showToast((icons[type]||'📎') + ' جاري الإرسال...', 'info');
  var reader = new FileReader();
  reader.onload = function(e) {
    var name = myName || 'أنت';
    var label = { image:'📷 صورة', video:'🎬 فيديو', audio:'🎵 صوت', file:'📄 ملف: ' + file.name };
    var msg = {
      id: Date.now() + '', sender: name, senderArea: userLocationName,
      text: label[type] || '📎 مرفق',
      mediaType: type, mediaData: e.target.result, mediaName: file.name,
      time: Date.now()
    };
    appendChatMsg(msg, true);
    try {
      fetch('/api/chat/' + chatRoom, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg.text, sender: name, senderArea: userLocationName,
          mediaType: type, mediaData: e.target.result, mediaName: file.name
        })
      });
    } catch(err) {}
    input.value = '';
    showToast('تم الإرسال ✓', 'success');
  };
  reader.readAsDataURL(file);
}
function startPubVoiceRecord() {
  if (!navigator.mediaDevices) { showToast('المتصفح لا يدعم التسجيل', 'error'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(stream) {
      pubVoiceChunks = []; pubVoiceSeconds = 0;
      var opts = {};
      try { opts = { mimeType: 'audio/webm;codecs=opus' }; } catch(e) {}
      pubVoiceRecorder = new MediaRecorder(stream, opts);
      pubVoiceRecorder.ondataavailable = function(e) { if (e.data.size > 0) pubVoiceChunks.push(e.data); };
      pubVoiceRecorder.onstop = function() {
        stream.getTracks().forEach(function(t) { t.stop(); });
        finishPubVoiceRecord();
      };
      pubVoiceRecorder.start();
      var bar = document.getElementById('pubVoiceRecordingBar');
      if (bar) bar.classList.remove('hidden');
      pubVoiceTimer = setInterval(function() {
        pubVoiceSeconds++;
        var el = document.getElementById('pubVoiceRecTime');
        if (el) el.textContent = Math.floor(pubVoiceSeconds/60) + ':' + ('0'+pubVoiceSeconds%60).slice(-2);
        if (pubVoiceSeconds >= 120) stopPubVoiceRecord();
      }, 1000);
    })
    .catch(function() { showToast('لا يمكن الوصول إلى المايكروفون', 'error'); });
}
function stopPubVoiceRecord() {
  if (pubVoiceRecorder && pubVoiceRecorder.state !== 'inactive') pubVoiceRecorder.stop();
  clearInterval(pubVoiceTimer);
  var bar = document.getElementById('pubVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}
function cancelPubVoiceRecord() {
  if (pubVoiceRecorder && pubVoiceRecorder.state !== 'inactive') pubVoiceRecorder.stop();
  clearInterval(pubVoiceTimer);
  pubVoiceChunks = [];
  var bar = document.getElementById('pubVoiceRecordingBar');
  if (bar) bar.classList.add('hidden');
}
function finishPubVoiceRecord() {
  if (!pubVoiceChunks.length) return;
  var blob = new Blob(pubVoiceChunks, { type: 'audio/webm' });
  if (pubVoiceSeconds < 1) { showToast('التسجيل قصير جداً', 'error'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var name = myName || 'أنت';
    var durStr = Math.floor(pubVoiceSeconds/60) + ':' + ('0'+pubVoiceSeconds%60).slice(-2);
    var msg = {
      id: Date.now() + '', sender: name, senderArea: userLocationName,
      text: '🎵 رسالة صوتية (' + durStr + ')',
      mediaType: 'audio', mediaData: e.target.result,
      time: Date.now()
    };
    appendChatMsg(msg, true);
    try {
      fetch('/api/chat/' + chatRoom, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.text, sender: name, senderArea: userLocationName,
          mediaType: 'audio', mediaData: e.target.result })
      });
    } catch(err) {}
    showToast('تم إرسال الرسالة الصوتية ✓', 'success');
  };
  reader.readAsDataURL(blob);
}

/* ================================================================
   📚 STUDY CHAT — MEDIA (toggleMenu, trigger, upload, voice)
   ================================================================ */
var studyVoiceRecorder = null, studyVoiceChunks = [], studyVoiceTimer = null, studyVoiceSeconds = 0;

function toggleStudyMediaMenu() {
  var menu = document.getElementById('studyMediaMenu');
  var btn  = document.getElementById('studyAttachBtn');
  if (!menu) return;
  var isOpen = !menu.classList.contains('hidden');
  menu.classList.toggle('hidden', isOpen);
  if (btn) btn.classList.toggle('gpi-attach-open', !isOpen);
  if (!isOpen) {
    setTimeout(function() {
      document.addEventListener('click', function _closeStudy(e) {
        var wrap = document.getElementById('studyMediaWrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.classList.add('hidden');
          if (btn) btn.classList.remove('gpi-attach-open');
        }
        document.removeEventListener('click', _closeStudy);
      });
    }, 10);
  }
}
function closeStudyMediaMenu() {
  var menu = document.getElementById('studyMediaMenu');
  var btn  = document.getElementById('studyAttachBtn');
  if (menu) menu.classList.add('hidden');
  if (btn)  btn.classList.remove('gpi-attach-open');
}
function triggerStudyMedia(type) {
  var map = { image:'studyImageInput', camera:'studyCameraInput', video:'studyVideoInput', audio:'studyAudioInput', file:'studyFileInput' };
  var el = document.getElementById(map[type] || 'studyFileInput');
  if (el) { el.value = ''; el.click(); }
  else showToast('عنصر الرفع غير موجود', 'error');
}
function uploadStudyMedia(input, type) {
  if (!_activeStudyGroup) { showToast('لم يتم تحديد مجموعة', 'error'); return; }
  var file = input.files[0];
  if (!file) return;
  var limits = { image:5, video:50, audio:20, file:20 };
  var maxMB = limits[type] || 20;
  if (file.size > maxMB * 1024 * 1024) {
    showToast('الملف كبير جداً (الحد ' + maxMB + 'MB)', 'error');
    input.value = ''; return;
  }
  var icons = { image:'🖼️', video:'🎬', audio:'🎵', file:'📄' };
  showToast((icons[type]||'📎') + ' جاري الإرسال...', 'info');
  var reader = new FileReader();
  reader.onload = function(e) {
    fetch('/api/study/' + _activeStudyGroup + '/msg', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '',
        userId: myUserId || localStorage.getItem('nabdh_uid') || '',
        name: myName || 'عضو',
        mediaType: type, mediaData: e.target.result, mediaName: file.name
      })
    })
    .then(function(r) { return r.json(); })
    .then(function() { input.value = ''; loadStudyChatMessages(_activeStudyGroup); showToast('تم الإرسال ✓', 'success'); })
    .catch(function() { showToast('فشل إرسال الوسيط', 'error'); });
  };
  reader.readAsDataURL(file);
}
function startStudyVoiceRecord() {
  if (!navigator.mediaDevices) { showToast('المتصفح لا يدعم التسجيل', 'error'); return; }
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(stream) {
      studyVoiceChunks = []; studyVoiceSeconds = 0;
      var opts = {};
      try { opts = { mimeType: 'audio/webm;codecs=opus' }; } catch(e) {}
      studyVoiceRecorder = new MediaRecorder(stream, opts);
      studyVoiceRecorder.ondataavailable = function(e) { if (e.data.size > 0) studyVoiceChunks.push(e.data); };
      studyVoiceRecorder.onstop = function() {
        stream.getTracks().forEach(function(t) { t.stop(); });
        finishStudyVoiceRecord();
      };
      studyVoiceRecorder.start();
      var bar = document.getElementById('studyVoiceRecBar');
      if (bar) bar.classList.remove('hidden');
      studyVoiceTimer = setInterval(function() {
        studyVoiceSeconds++;
        var el = document.getElementById('studyVoiceRecTime');
        if (el) el.textContent = Math.floor(studyVoiceSeconds/60) + ':' + ('0'+studyVoiceSeconds%60).slice(-2);
        if (studyVoiceSeconds >= 120) stopStudyVoiceRecord();
      }, 1000);
    })
    .catch(function() { showToast('لا يمكن الوصول إلى المايكروفون', 'error'); });
}
function stopStudyVoiceRecord() {
  if (studyVoiceRecorder && studyVoiceRecorder.state !== 'inactive') studyVoiceRecorder.stop();
  clearInterval(studyVoiceTimer);
  var bar = document.getElementById('studyVoiceRecBar');
  if (bar) bar.classList.add('hidden');
}
function cancelStudyVoiceRecord() {
  if (studyVoiceRecorder && studyVoiceRecorder.state !== 'inactive') studyVoiceRecorder.stop();
  clearInterval(studyVoiceTimer);
  studyVoiceChunks = [];
  var bar = document.getElementById('studyVoiceRecBar');
  if (bar) bar.classList.add('hidden');
}
function finishStudyVoiceRecord() {
  if (!studyVoiceChunks.length || !_activeStudyGroup) return;
  var blob = new Blob(studyVoiceChunks, { type: 'audio/webm' });
  if (studyVoiceSeconds < 1) { showToast('التسجيل قصير جداً', 'error'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var durStr = Math.floor(studyVoiceSeconds/60) + ':' + ('0'+studyVoiceSeconds%60).slice(-2);
    fetch('/api/study/' + _activeStudyGroup + '/msg', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '🎵 رسالة صوتية (' + durStr + ')',
        userId: myUserId || localStorage.getItem('nabdh_uid') || '',
        name: myName || 'عضو',
        mediaType: 'audio', mediaData: e.target.result
      })
    })
    .then(function(r) { return r.json(); })
    .then(function() { loadStudyChatMessages(_activeStudyGroup); showToast('تم إرسال الرسالة الصوتية ✓', 'success'); })
    .catch(function() {});
  };
  reader.readAsDataURL(blob);
}

/* ================================================================
   📞 DM VOICE / VIDEO CALLS
   ================================================================ */
function startDMVoiceCall() {
  initiateDMCall('voice');
}

function startDMVideoCall() {
  initiateDMCall('video');
}

function initiateDMCall(type) {
  if (!dmCurrentUser) return;
  dmCallType = type;
  var constraints = type === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true, video: false };

  navigator.mediaDevices.getUserMedia(constraints)
    .then(function(stream) {
      dmLocalStream = stream;
      dmCallActive = true;

      var banner = document.getElementById('dmCallBanner');
      if (banner) banner.classList.remove('hidden');
      document.getElementById('dmCallType').textContent = type === 'video' ? '📹 مكالمة مرئية' : '🎙️ مكالمة صوتية';

      if (type === 'video') {
        var grid = document.getElementById('dmVideoGrid');
        if (grid) grid.classList.remove('hidden');
        var localVid = document.getElementById('dmLocalVideo');
        if (localVid) localVid.srcObject = stream;
      }

      dmCallSeconds = 0;
      dmCallTimer = setInterval(function() {
        dmCallSeconds++;
        var el = document.getElementById('dmCallTime');
        if (el) el.textContent = Math.floor(dmCallSeconds/60) + ':' + ('0'+dmCallSeconds%60).slice(-2);
      }, 1000);

      // Create WebRTC peer connection
      dmPeer = new RTCPeerConnection(ICE_SERVERS);
      stream.getTracks().forEach(function(t){ dmPeer.addTrack(t, stream); });

      dmPeer.ontrack = function(e) {
        var remoteVid = document.getElementById('dmRemoteVideo');
        if (remoteVid) remoteVid.srcObject = e.streams[0];
      };

      dmPeer.onicecandidate = function(e) {
        if (e.candidate && socket && dmCurrentUser.socketId) {
          socket.emit('webrtc_ice', { to: dmCurrentUser.socketId, candidate: e.candidate });
        }
      };

      dmPeer.createOffer().then(function(offer) {
        return dmPeer.setLocalDescription(offer).then(function(){ return offer; });
      }).then(function(offer) {
        if (socket && dmCurrentUser.socketId) {
          socket.emit('webrtc_offer', { to: dmCurrentUser.socketId, offer: offer });
        }
      }).catch(function(e){ console.warn('WebRTC offer error:', e); });

      // Notify via socket
      if (socket) {
        socket.emit('call_request', {
          to: dmCurrentUser.socketId,
          from: socket.id,
          fromName: localStorage.getItem('nabdh_name') || 'عضو',
          type: type
        });
      }

      showToast(type === 'video' ? '📹 جاري الاتصال...' : '🎙️ جاري الاتصال...', 'info');
    })
    .catch(function(err) {
      showToast('لا يمكن الوصول للكاميرا/المايكروفون', 'error');
    });
}

function toggleDMMute() {
  if (!dmLocalStream) return;
  var tracks = dmLocalStream.getAudioTracks();
  if (!tracks.length) return;
  tracks[0].enabled = !tracks[0].enabled;
  var btn = document.getElementById('dmBtnMute');
  if (btn) btn.textContent = tracks[0].enabled ? '🎙️' : '🔇';
}

function toggleDMVideo() {
  if (!dmLocalStream) return;
  var tracks = dmLocalStream.getVideoTracks();
  if (!tracks.length) return;
  tracks[0].enabled = !tracks[0].enabled;
  var btn = document.getElementById('dmBtnCam');
  if (btn) btn.textContent = tracks[0].enabled ? '📹' : '📷';
}

function endDMCall() {
  if (dmLocalStream) { dmLocalStream.getTracks().forEach(function(t){ t.stop(); }); dmLocalStream = null; }
  if (dmPeer) { try { dmPeer.close(); } catch(e){} dmPeer = null; }
  dmCallActive = false;
  clearInterval(dmCallTimer);

  var banner = document.getElementById('dmCallBanner');
  if (banner) banner.classList.add('hidden');
  var grid = document.getElementById('dmVideoGrid');
  if (grid) grid.classList.add('hidden');

  var remoteVid = document.getElementById('dmRemoteVideo');
  if (remoteVid) remoteVid.srcObject = null;

  if (socket && dmCurrentUser && dmCurrentUser.socketId) {
    socket.emit('call_end', { to: dmCurrentUser.socketId });
  }
}

function handleIncomingDMCall(data) {
  // Show call notification
  showToast('📞 مكالمة واردة من ' + (data.fromName || 'عضو') + ' - ' + (data.type === 'video' ? '📹 مرئية' : '🎙️ صوتية'), 'info');
}

/* ================================================================
   START DM WITH MEMBER (from group members list)
   ================================================================ */
function startDMWithMember(userId) {
  closeGroupPage();
  setTimeout(function() {
    openDMChatPage(userId, 'عضو في المجموعة');
  }, 350);
}

/* ================================================================
   HANDLE INVITE JOIN (URL param ?join=token)
   ================================================================ */
(function checkInviteJoin() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('join');
  if (!token) return;

  var uid = localStorage.getItem('nabdh_uid') || ('u_' + Math.random().toString(36).slice(2));
  var uname = localStorage.getItem('nabdh_name') || 'عضو';
  localStorage.setItem('nabdh_uid', uid);

  fetch('/api/study/join-invite/' + token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, author: uname })
  })
  .then(function(r){ return r.json(); })
  .then(function(res) {
    if (res.success) {
      showToast('مرحباً! انضممت إلى مجموعة "' + res.group.name + '"', 'success');
      setTimeout(function(){ openGroupPage(res.group.id); }, 1000);
    } else {
      showToast(res.error || 'رابط الدعوة غير صالح', 'error');
    }
  })
  .catch(function(){});
})();

/* ================================================================
   BACK BUTTON FIX - Fix popstate to handle group page
   ================================================================ */
window.removeEventListener('popstate', window._popstateHandler);
window._popstateHandler = function(e) {
  // Close any open emoji menus
  var erm = document.getElementById('emojiReactMenu');
  if (erm) { erm.remove(); return; }

  // Close group emoji picker
  var gpPicker = document.getElementById('gpEmojiPicker');
  if (gpPicker && !gpPicker.classList.contains('hidden')) { gpPicker.classList.add('hidden'); return; }

  // Close DM emoji picker
  var dmPicker = document.getElementById('dmEmojiPicker');
  if (dmPicker && !dmPicker.classList.contains('hidden')) { dmPicker.classList.add('hidden'); return; }

  // Close invite modal
  var invModal = document.getElementById('gpInviteModal');
  if (invModal && !invModal.classList.contains('hidden')) { invModal.classList.add('hidden'); return; }

  // Close DM page
  var dmPage = document.getElementById('dmChatPage');
  if (dmPage && !dmPage.classList.contains('hidden')) {
    dmPage.style.transform = 'translateX(100%)';
    setTimeout(function(){ dmPage.classList.add('hidden'); }, 300);
    if (dmCallActive) endDMCall();
    dmCurrentUser = null;
    return;
  }

  // Close group page
  var grpPage = document.getElementById('groupPage');
  if (grpPage && !grpPage.classList.contains('hidden')) {
    grpPage.style.transform = 'translateX(100%)';
    setTimeout(function(){ grpPage.classList.add('hidden'); }, 300);
    if (gpCurrentGroup && socket) socket.emit('leave_study', gpCurrentGroup.id);
    if (gpCallActive) endGroupCall();
    gpCurrentGroup = null;
    return;
  }

  // 1. Close group page if open
  var gp = document.getElementById('groupPage');
  if (gp && !gp.classList.contains('hidden')) {
    gp.style.transform = 'translateX(100%)';
    setTimeout(function(){ gp.classList.add('hidden'); }, 300);
    if (typeof gpCallActive !== 'undefined' && gpCallActive && typeof endGroupCall === 'function') endGroupCall();
    if (socket && typeof gpCurrentGroup !== 'undefined' && gpCurrentGroup) socket.emit('leave_study', gpCurrentGroup.id);
    gpCurrentGroup = null;
    return;
  }

  // 2. Close DM chat page if open
  var dmPage = document.getElementById('dmChatPage');
  if (dmPage && !dmPage.classList.contains('hidden')) {
    dmPage.classList.add('hidden');
    document.body.style.overflow = '';
    if (typeof dmCallActive !== 'undefined' && dmCallActive && typeof endDMCall === 'function') endDMCall();
    return;
  }

  // 3. Close side menu
  var menu = document.getElementById('sideMenu');
  if (menu && !menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }

  // 4. Close any open modal
  var openModal = document.querySelector('.modal:not(.hidden), .overlay-modal:not(.hidden)');
  if (openModal) { openModal.classList.add('hidden'); return; }

  // 5. Navigate back in section history
  var state = e.state;
  if (state && state.section) {
    goSection(state.section);
  } else if (currentSection !== 'home') {
    goSection('home');
  }
  // If already at home, do nothing (don't exit app)
};
window.addEventListener('popstate', window._popstateHandler);

/* ================================================================
   UPDATE renderStudyGroups to use openGroupPage
   ================================================================ */
function renderStudyGroupsNew(groups) {
  var el = document.getElementById('studyList');
  if (!el) return;
  if (!groups || !groups.length) {
    el.innerHTML = '<div class="empty-state"><div class="es-icon">🎓</div><div class="es-title">لا توجد مجموعات بعد</div><div class="es-sub">كن أول من ينشئ مجموعة تعليمية!</div></div>';
    return;
  }

  var uid = localStorage.getItem('nabdh_uid') || '';
  var levelColors = { ابتدائي:'#27ae60', متوسط:'#2980b9', ثانوي:'#8e44ad', جامعي:'#e67e22', مهني:'#e74c3c', عام:'#1abc9c' };
  var levelEmojis = { ابتدائي:'🌱', متوسط:'📗', ثانوي:'📘', جامعي:'🎓', مهني:'⚙️', عام:'🌐' };

  el.innerHTML = groups.map(function(g) {
    var color = levelColors[g.level] || '#1abc9c';
    var emoji = g.avatar || levelEmojis[g.level] || '🎓';
    var isMember = Array.isArray(g.members) && g.members.includes(uid);
    var isFull = Array.isArray(g.members) && g.members.length >= (g.maxMembers || 20);
    var membersCount = Array.isArray(g.members) ? g.members.length : 0;

    return '<div class="study-card" style="border-left:4px solid ' + color + ';cursor:pointer" onclick="openGroupPage(\'' + escJs(g.id) + '\')">' +
      '<div class="sc-header">' +
      '<div class="sc-avatar" style="background:' + color + '20">' + emoji + '</div>' +
      '<div class="sc-info">' +
      '<div class="sc-name">' + escHtml(g.name) + '</div>' +
      '<div class="sc-subject">' + escHtml(g.subject) + '</div>' +
      '</div>' +
      '<div class="sc-badge" style="background:' + color + '20;color:' + color + '">' + escHtml(g.level||'عام') + '</div>' +
      '</div>' +
      '<div class="sc-stats">' +
      '<span class="sc-stat">👥 ' + membersCount + '/' + (g.maxMembers||20) + '</span>' +
      (g.area ? '<span class="sc-stat">📍 ' + escHtml(g.area) + '</span>' : '') +
      (g.schedule ? '<span class="sc-stat">📅 ' + escHtml(g.schedule) + '</span>' : '') +
      '</div>' +
      '<div class="sc-actions">' +
      '<button class="sc-open-btn" onclick="event.stopPropagation();openGroupPage(\'' + escJs(g.id) + '\')">📖 فتح المجموعة</button>' +
      (!isMember && !isFull ? '<button class="sc-join-btn" onclick="event.stopPropagation();joinStudyGroup(\'' + escJs(g.id) + '\',\'' + escJs(g.name) + '\',this)">✋ انضم</button>' : '') +
      (isMember ? '<span class="sc-member-badge">✅ أنت عضو</span>' : '') +
      (isFull && !isMember ? '<span class="sc-full-badge">🔒 ممتلئة</span>' : '') +
      '</div>' +
      '</div>';
  }).join('');
}

// Override the existing renderStudyGroups
if (typeof renderStudyGroups === 'function') {
  var _origRenderStudyGroups = renderStudyGroups;
}
renderStudyGroups = renderStudyGroupsNew;

/* ================================================================
   GROUP PAGE CSS TRANSITION
   ================================================================ */
(function() {
  var gpPage = document.getElementById('groupPage');
  var dmPage = document.getElementById('dmChatPage');
  if (gpPage) gpPage.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
  if (dmPage) dmPage.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
})();


/* ================================================================
   🎨 GROUP AVATAR PICKER
================================================================ */
function selectGroupAvatar(emoji, btn) {
  document.querySelectorAll('.avatar-pick').forEach(function(b){ b.classList.remove('active-avatar'); });
  btn.classList.add('active-avatar');
  var inp = document.getElementById('studyAvatar');
  if (inp) inp.value = emoji;
}

/* ================================================================
   🔥 VIRAL FEATURES - ميزات الانتشار بسرعة البرق
   نظام النقاط | المتصدرون | التحديات | الطوارئ | المشاركة الفورية
================================================================ */

/* ──────────────────────────────────────────────
   🏆 POINTS & GAMIFICATION SYSTEM
   نظام النقاط والمكافآت
──────────────────────────────────────────────── */
var POINT_ACTIONS = {
  report:      { pts: 10, label: 'نشر بلاغ' },
  vote_up:     { pts: 2,  label: 'تقييم إيجابي' },
  sos:         { pts: 20, label: 'نداء استغاثة' },
  help_offer:  { pts: 15, label: 'عرض مساعدة' },
  donate_blood:{ pts: 25, label: 'تسجيل تبرع دم' },
  share:       { pts: 5,  label: 'مشاركة حدث' },
  daily_login: { pts: 3,  label: 'دخول يومي' },
  study_msg:   { pts: 2,  label: 'رسالة مجموعة' },
  join_study:  { pts: 8,  label: 'انضمام لمجموعة' },
  market_post: { pts: 5,  label: 'نشر في السوق' },
  news_post:   { pts: 12, label: 'نشر خبر' },
  challenge:   { pts: 30, label: 'تحدي يومي' }
};

var BADGES = [
  { id:'first_report', icon:'🚨', title:'أول بلاغ',    desc:'نشرت أول بلاغ لك',      pts:10  },
  { id:'helper',       icon:'🤝', title:'مساعد',        desc:'قدّمت 3 عروض مساعدة',   pts:45  },
  { id:'hero',         icon:'🦸', title:'بطل المجتمع',  desc:'أنقذت 5 أرواح',          pts:100 },
  { id:'reporter',     icon:'📰', title:'مراسل ميداني', desc:'نشرت 10 أخبار',          pts:120 },
  { id:'blooddonor',   icon:'🩸', title:'واهب الحياة',  desc:'تبرعت بالدم مرتين',     pts:50  },
  { id:'connector',    icon:'🔗', title:'الرابط',        desc:'دعوت 5 أشخاص',          pts:50  },
  { id:'vigilant',     icon:'👁️', title:'اليقظ',        desc:'صوّت على 20 بلاغ',      pts:40  },
  { id:'scholar',      icon:'🎓', title:'العالم',        desc:'أنشأت مجموعة دراسية',   pts:30  },
  { id:'streaker',     icon:'🔥', title:'المتواصل',      desc:'دخلت 7 أيام متتالية',   pts:70  },
  { id:'legend',       icon:'⭐', title:'أسطورة نبض',   desc:'تجاوزت 500 نقطة',       pts:500 }
];

var DAILY_CHALLENGES = [
  { id:'dc1', title:'بلاغ عاجل', desc:'شارك بلاغاً حقيقياً من منطقتك اليوم', action:'report', target:1, reward:'10 نقطة + شارة 🚨' },
  { id:'dc2', title:'واهب الدم', desc:'سجّل كمتبرع بالدم أو شارك طلب دم', action:'blood', target:1, reward:'25 نقطة + شارة 🩸' },
  { id:'dc3', title:'ناشر الخير', desc:'شارك التطبيق مع 3 أشخاص من معارفك', action:'share', target:3, reward:'15 نقطة' },
  { id:'dc4', title:'الطالب النشيط', desc:'أرسل 5 رسائل في مجموعة دراسية', action:'study_msg', target:5, reward:'20 نقطة + شارة 🎓' },
  { id:'dc5', title:'يد العون', desc:'ردّ على طلب مساعدة في منطقتك', action:'help_offer', target:1, reward:'30 نقطة + شارة 🤝' },
  { id:'dc6', title:'الناخب', desc:'صوّت على 5 بلاغات مختلفة', action:'vote_up', target:5, reward:'10 نقطة' },
  { id:'dc7', title:'السوق النشط', desc:'انشر منتجاً في سوق P2P', action:'market_post', target:1, reward:'15 نقطة 🛒' }
];

// State
var myPoints = 0;
var myBadges = [];
var myStreak = 0;
var leaderboardData = [];
var todayChallenge = null;
var challengeProgress = 0;

// ── Load points from localStorage ──────────────────────────────
function loadPoints() {
  myPoints  = parseInt(localStorage.getItem('nabdh_pts') || '0');
  myBadges  = JSON.parse(localStorage.getItem('nabdh_badges') || '[]');
  myStreak  = parseInt(localStorage.getItem('nabdh_streak') || '0');
  checkDailyLogin();
  updatePointsUI();
}

function savePoints() {
  localStorage.setItem('nabdh_pts', myPoints);
  localStorage.setItem('nabdh_badges', JSON.stringify(myBadges));
  localStorage.setItem('nabdh_streak', myStreak);
}

function addPoints(action) {
  var def = POINT_ACTIONS[action];
  if (!def) return;
  myPoints += def.pts;
  savePoints();
  updatePointsUI();
  showPointsPopup('+' + def.pts + ' نقطة', def.label);
  checkBadges();
  // Broadcast to server with area info for city leaderboard
  var area = (typeof myProfile !== 'undefined' && myProfile && myProfile.area) ? myProfile.area :
             (localStorage.getItem('nabdh_area') || '');
  fetch('/api/points/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: myUserId, action: action, pts: def.pts, name: myName || 'عضو', area: area })
  }).catch(function(){});
}

function showPointsPopup(pts, label) {
  var el = document.createElement('div');
  el.className = 'points-popup';
  el.innerHTML = '<span class="pp-pts">' + pts + '</span><span class="pp-label">' + label + '</span>';
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;background:linear-gradient(135deg,#f39c12,#e67e22);color:#fff;padding:.5rem 1.2rem;border-radius:30px;font-weight:700;font-size:.9rem;animation:pointsFloat 2s ease forwards;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(243,156,18,.4)';
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 2000);
}

function updatePointsUI() {
  // Update profile points display
  var els = document.querySelectorAll('.my-points-display');
  els.forEach(function(e){ e.textContent = myPoints + ' نقطة'; });
  // Update profile level
  var level = getPointLevel(myPoints);
  var lvlEls = document.querySelectorAll('.my-level-display');
  lvlEls.forEach(function(e){ e.textContent = level.icon + ' ' + level.title; });
}

function getPointLevel(pts) {
  if (pts >= 1000) return { icon:'💎', title:'أسطورة', color:'#9b59b6' };
  if (pts >= 500)  return { icon:'⭐', title:'نجم',    color:'#f39c12' };
  if (pts >= 200)  return { icon:'🥇', title:'متقدم',  color:'#e67e22' };
  if (pts >= 80)   return { icon:'🥈', title:'نشيط',   color:'#3498db' };
  if (pts >= 20)   return { icon:'🥉', title:'مبتدئ',  color:'#1abc9c' };
  return { icon:'🌱', title:'جديد', color:'#95a5a6' };
}

/* Full XP-level system with thresholds for the profile page */
function getProfileLevel(pts) {
  const levels = [
    { level:1, name:'جديد',   icon:'🌱', min:0,    max:20   },
    { level:2, name:'مبتدئ',  icon:'🥉', min:20,   max:80   },
    { level:3, name:'نشيط',   icon:'🥈', min:80,   max:200  },
    { level:4, name:'متقدم',  icon:'🥇', min:200,  max:500  },
    { level:5, name:'نجم',    icon:'⭐', min:500,  max:1000 },
    { level:6, name:'أسطورة', icon:'💎', min:1000, max:2000 },
  ];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (pts >= levels[i].min) return levels[i];
  }
  return levels[0];
}

function checkBadges() {
  BADGES.forEach(function(b) {
    if (myBadges.includes(b.id)) return;
    var earned = false;
    if (b.id === 'legend' && myPoints >= 500) earned = true;
    if (b.id === 'streaker' && myStreak >= 7) earned = true;
    // more checks via server
    if (earned) awardBadge(b);
  });
}

function awardBadge(badge) {
  if (myBadges.includes(badge.id)) return;
  myBadges.push(badge.id);
  savePoints();
  showAchievementToast(badge.icon, badge.title, badge.desc);
}

function showAchievementToast(icon, title, sub) {
  var el = document.getElementById('achievementToast');
  if (!el) return;
  document.getElementById('atIcon').textContent = icon;
  document.getElementById('atTitle').textContent = '🏅 ' + title;
  document.getElementById('atSub').textContent = sub;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  setTimeout(function(){ el.style.animation = ''; }, 10);
  setTimeout(function(){ el.classList.add('hidden'); }, 4000);
}

function checkDailyLogin() {
  var today = new Date().toDateString();
  var lastLogin = localStorage.getItem('nabdh_last_login');
  if (lastLogin !== today) {
    localStorage.setItem('nabdh_last_login', today);
    var yesterday = new Date(Date.now() - 86400000).toDateString();
    if (lastLogin === yesterday) {
      myStreak++;
      savePoints();
      if (myStreak >= 3) showAchievementToast('🔥', 'متواصل ' + myStreak + ' أيام', 'تفتح هذا التطبيق كل يوم!');
    } else if (lastLogin !== today) {
      myStreak = 1;
      savePoints();
    }
    addPoints('daily_login');
  }
}

/* ──────────────────────────────────────────────
   🏆 LEADERBOARD
──────────────────────────────────────────────── */
function goSection_leaderboard() { openLeaderboard(); }

function openLeaderboard() {
  var page = document.getElementById('leaderboardPage');
  if (!page) return;
  page.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  history.pushState({ page: 'leaderboard' }, '', '#leaderboard');
  loadLeaderboard('weekly');
}

function closeLeaderboard() {
  var page = document.getElementById('leaderboardPage');
  if (page) page.classList.add('hidden');
  document.body.style.overflow = '';
  if (history.state && history.state.page === 'leaderboard') history.back();
}

function switchLbTab(tab, btn) {
  document.querySelectorAll('.lb-tab').forEach(function(b){ b.classList.remove('active-lb-tab'); });
  if (btn) btn.classList.add('active-lb-tab');
  loadLeaderboard(tab);
}

function loadLeaderboard(tab) {
  fetch('/api/leaderboard?tab=' + (tab||'weekly'))
    .then(function(r){ return r.json(); })
    .then(function(data) {
      renderLeaderboard(data.list || [], data.myRank);
    })
    .catch(function() {
      // Fallback: show local data
      var list = document.getElementById('lbList');
      if (list) list.innerHTML = '<div class="gp-empty-chat">لا يوجد بيانات بعد - كن أول المتصدرين! 🏆</div>';
    });
}

function renderLeaderboard(list, myRank) {
  var el = document.getElementById('lbList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="gp-empty-chat" style="padding:2rem">🏆 لا يوجد متصدرون بعد<br><small>ابدأ بنشر البلاغات واكسب النقاط!</small></div>';
  } else {
    var medals = ['🥇','🥈','🥉'];
    el.innerHTML = list.slice(0, 20).map(function(u, i) {
      var isMe = u.userId === myUserId;
      var level = getPointLevel(u.pts || 0);
      return '<div class="lb-item ' + (isMe ? 'lb-item-me' : '') + '">' +
        '<div class="lb-rank">' + (medals[i] || (i+1)) + '</div>' +
        '<div class="lb-avatar">' + (u.avatar || level.icon) + '</div>' +
        '<div class="lb-info">' +
          '<div class="lb-name">' + escHtml(u.name || 'مستخدم') + (isMe ? ' (أنت)' : '') + '</div>' +
          '<div class="lb-area">' + escHtml(u.area || '') + ' • ' + level.title + '</div>' +
        '</div>' +
        '<div class="lb-pts">' +
          '<div class="lb-pts-num">' + (u.pts || 0) + '</div>' +
          '<div class="lb-pts-lbl">نقطة</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  // My rank
  if (myRank) {
    document.getElementById('myRankNum').textContent = '#' + myRank.rank;
    document.getElementById('myRankPts').textContent = myRank.pts + ' نقطة';
  } else {
    document.getElementById('myRankNum').textContent = '#' + (list.length + 1);
    document.getElementById('myRankPts').textContent = myPoints + ' نقطة';
  }
}

// Mini leaderboard for home page
function loadHomeLeaderboard() {
  fetch('/api/leaderboard?tab=weekly&limit=3')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var el = document.getElementById('homeLeaderboard');
      if (!el) return;
      var list = data.list || [];
      if (!list.length) {
        el.innerHTML = '<div class="lb-mini-empty">لا يوجد متصدرون بعد - كن الأول! 🏆</div>';
        return;
      }
      var medals = ['🥇','🥈','🥉'];
      el.innerHTML = list.slice(0,3).map(function(u, i) {
        var isMe = u.userId === myUserId;
        return '<div class="lb-mini-item ' + (isMe ? 'lb-mini-me' : '') + '">' +
          '<span class="lb-mini-medal">' + (medals[i]||'') + '</span>' +
          '<span class="lb-mini-name">' + escHtml(u.name||'مستخدم') + '</span>' +
          '<span class="lb-mini-pts">' + (u.pts||0) + ' نقطة</span>' +
        '</div>';
      }).join('') +
      '<button class="lb-mini-more" onclick="openLeaderboard()">عرض الكل 🏆</button>';
    })
    .catch(function(){
      var el = document.getElementById('homeLeaderboard');
      if (el) el.innerHTML = '<div class="lb-mini-empty">ابدأ بالبلاغات واكسب نقاط 🏆</div>';
    });
}

/* ──────────────────────────────────────────────
   🎯 DAILY CHALLENGE
──────────────────────────────────────────────── */
function loadDailyChallenge() {
  // Pick challenge based on day of week
  var dayIdx = new Date().getDay();
  todayChallenge = DAILY_CHALLENGES[dayIdx % DAILY_CHALLENGES.length];
  challengeProgress = parseInt(localStorage.getItem('dc_progress_' + todayChallenge.id + '_' + new Date().toDateString()) || '0');

  document.getElementById('dcTitle').textContent = todayChallenge.title;
  document.getElementById('dcDesc').textContent = todayChallenge.desc;
  document.getElementById('dcReward').textContent = todayChallenge.reward;
  var pct = Math.min(100, Math.round((challengeProgress / todayChallenge.target) * 100));
  document.getElementById('dcProgress').style.width = pct + '%';
  document.getElementById('dcProgressText').textContent = challengeProgress + ' / ' + todayChallenge.target + (pct >= 100 ? ' ✅ مكتمل!' : ' مشارك');
}

function openDailyChallenge() {
  if (!todayChallenge) return;
  var modal = document.getElementById('dailyChallengeModal');
  if (!modal) return;
  var isDone = challengeProgress >= todayChallenge.target;
  var pct = Math.min(100, Math.round((challengeProgress / todayChallenge.target) * 100));
  document.getElementById('dcModalContent').innerHTML =
    '<div class="dc-icon">🎯</div>' +
    '<div class="dc-m-title">' + todayChallenge.title + '</div>' +
    '<div class="dc-m-desc">' + todayChallenge.desc + '</div>' +
    '<div class="dc-m-progress">' +
      '<div class="dcp-bar large"><div class="dcp-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="dcp-nums">' + challengeProgress + ' / ' + todayChallenge.target + '</div>' +
    '</div>' +
    '<div class="dc-m-reward">🏅 المكافأة: ' + escHtml(todayChallenge.reward) + '</div>' +
    '<div class="dc-m-streak">🔥 سلسلتك الحالية: ' + myStreak + ' يوم</div>';

  var btn = document.getElementById('dcJoinBtn');
  if (isDone) { btn.textContent = '✅ تم الإنجاز! احصل على النقاط'; btn.style.background = '#27ae60'; }
  else        { btn.textContent = '▶ ابدأ التحدي'; btn.style.background = ''; }
  modal.classList.remove('hidden');
}

function closeDailyChallenge() {
  var m = document.getElementById('dailyChallengeModal');
  if (m) m.classList.add('hidden');
}

function joinDailyChallenge() {
  if (!todayChallenge) return;
  var isDone = challengeProgress >= todayChallenge.target;
  if (isDone) {
    var key = 'dc_rewarded_' + todayChallenge.id + '_' + new Date().toDateString();
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      addPoints('challenge');
      showAchievementToast('🎯', 'تحدي اليوم مكتمل!', todayChallenge.reward);
    } else {
      showToast('لقد حصلت على مكافأتك اليوم ✅', 'info');
    }
  } else {
    // Navigate to the relevant section
    var sectionMap = { report:'report', blood:'blood', share:null, study_msg:'study', help_offer:'help', vote_up:'map', market_post:'market' };
    var sec = sectionMap[todayChallenge.action];
    closeDailyChallenge();
    if (sec) goSection(sec);
    else shareApp();
  }
}

function incrementChallengeProgress(action) {
  if (!todayChallenge || todayChallenge.action !== action) return;
  var key = 'dc_progress_' + todayChallenge.id + '_' + new Date().toDateString();
  challengeProgress = Math.min(todayChallenge.target, challengeProgress + 1);
  localStorage.setItem(key, challengeProgress);
  loadDailyChallenge();
  if (challengeProgress >= todayChallenge.target) {
    showToast('🎉 أكملت تحدي اليوم! افتح التحدي للحصول على المكافأة', 'success');
  }
}

/* ──────────────────────────────────────────────
   🔥 VIRAL ALERTS - الأحداث الأكثر انتشاراً
──────────────────────────────────────────────── */
function loadViralAlerts() {
  var el = document.getElementById('viralAlerts');
  if (!el) return;
  fetch('/api/alerts/viral')
    .then(function(r){ return r.json(); })
    .then(function(list) {
      if (!list || !list.length) {
        el.innerHTML = '<div class="viral-empty">لا توجد أحداث انتشرت بعد - كن الأول! 🔥</div>';
        return;
      }
      el.innerHTML = list.slice(0,5).map(function(a) {
        var heat = (a.votes||0) + (a.shares||0)*3 + (a.views||0)*0.5;
        var heatBar = Math.min(100, Math.round(heat / 2));
        var typeIcon = { danger:'🔴', warning:'🟡', info:'🔵' };
        return '<div class="viral-card" onclick="showOnMap(' + (a.lat||0) + ',' + (a.lng||0) + ',\'' + escJs(a.msg||'') + '\')">' +
          '<div class="vc-type">' + (typeIcon[a.type]||'📌') + '</div>' +
          '<div class="vc-content">' +
            '<div class="vc-msg">' + escHtml((a.msg||'').slice(0,70)) + '</div>' +
            '<div class="vc-area">📍 ' + escHtml(a.area||'غير محدد') + ' • ' + timeAgo(a.time||a.ts) + '</div>' +
            '<div class="vc-heat-bar"><div class="vc-heat-fill" style="width:' + heatBar + '%"></div></div>' +
          '</div>' +
          '<div class="vc-stats">' +
            '<span class="vc-stat">👍 ' + (a.votes||0) + '</span>' +
            '<span class="vc-stat">🔁 ' + (a.shares||0) + '</span>' +
          '</div>' +
          '<button class="vc-share-btn" onclick="event.stopPropagation();quickShareAlert(' + JSON.stringify(a).replace(/"/g,"'") + ')">📲</button>' +
        '</div>';
      }).join('');
    })
    .catch(function(){
      if (el) el.innerHTML = '<div class="viral-empty">لا توجد بيانات حالياً</div>';
    });
}

/* ──────────────────────────────────────────────
   📡 EMERGENCY MODE - وضع الطوارئ الجماعي
──────────────────────────────────────────────── */
var emergencyModeActive = false;
var emergencyThreshold = 5; // عدد البلاغات لتفعيل وضع الطوارئ

function checkEmergencyMode(alertCount) {
  if (alertCount >= emergencyThreshold && !emergencyModeActive) {
    activateEmergencyMode(alertCount);
  } else if (alertCount < emergencyThreshold && emergencyModeActive) {
    deactivateEmergencyMode();
  }
}

function activateEmergencyMode(alertCount) {
  emergencyModeActive = true;
  var el = document.getElementById('emergencyMode');
  if (!el) return;
  document.getElementById('emAlertCount').textContent = alertCount;
  document.getElementById('emSOSCount').textContent = Math.floor(alertCount * 0.3);
  document.getElementById('emHelpers').textContent = Math.floor(alertCount * 0.8);
  document.getElementById('emSubtitle').textContent = 'تم رصد ' + alertCount + ' بلاغ في آخر ساعة';
  el.classList.remove('hidden');
  // Change app theme
  document.body.classList.add('emergency-theme');
  // Sound/vibration
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  showToast('🚨 تم تفعيل وضع الطوارئ - ' + alertCount + ' بلاغ نشط', 'error');
}

function deactivateEmergencyMode() {
  emergencyModeActive = false;
  document.body.classList.remove('emergency-theme');
  closeEmergencyMode();
}

function closeEmergencyMode() {
  var el = document.getElementById('emergencyMode');
  if (el) el.classList.add('hidden');
}

function offerEmergencyHelp() {
  closeEmergencyMode();
  addPoints('help_offer');
  incrementChallengeProgress('help_offer');
  goSection('help');
  showToast('شكراً على تبرعك! انشر عرض المساعدة 🤝', 'success');
}

/* ──────────────────────────────────────────────
   📲 QUICK SHARE - المشاركة الفورية للأحداث
──────────────────────────────────────────────── */
var _qsItem = null;

function quickShareAlert(alert) {
  _qsItem = alert;
  var overlay = document.getElementById('quickShareOverlay');
  if (!overlay) return;

  var typeIcon = { danger:'🔴 خطر', warning:'⚠️ تحذير', info:'🔵 معلومة' };
  var preview = document.getElementById('qsPreview');
  if (preview) {
    preview.innerHTML =
      '<div class="qsp-type">' + (typeIcon[alert.type]||'📌') + '</div>' +
      '<div class="qsp-msg">' + escHtml((alert.msg||'').slice(0,100)) + '</div>' +
      '<div class="qsp-area">📍 ' + escHtml(alert.area||'') + ' • ' + timeAgo(alert.time) + '</div>' +
      '<div class="qsp-via">عبر تطبيق نبض 💓</div>';
  }

  // Update view/share counts
  document.getElementById('qsViews').textContent  = alert.views  || 0;
  document.getElementById('qsShares').textContent = alert.shares || 0;
  document.getElementById('qsHeat').textContent   = Math.max(1, (alert.votes||0) + (alert.shares||0));

  overlay.classList.remove('hidden');

  // Increment view count
  fetch('/api/alerts/' + alert.id + '/view', { method:'POST' }).catch(function(){});
}

function closeQuickShare() {
  var el = document.getElementById('quickShareOverlay');
  if (el) el.classList.add('hidden');
  _qsItem = null;
}

function qsShareTo(platform) {
  if (!_qsItem) return;
  var url = window.location.origin + '/#alert/' + _qsItem.id;
  var text = '🔴 ' + (_qsItem.msg||'') + '\n📍 ' + (_qsItem.area||'') + '\n\nعبر تطبيق نبض 💓\n' + url;

  var urls = {
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text),
    telegram: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(_qsItem.msg||''),
    twitter:  'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text),
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
    copy: null,
    native: null
  };

  if (platform === 'copy') {
    navigator.clipboard.writeText(url).then(function(){ showToast('✅ تم نسخ الرابط', 'success'); }).catch(function(){});
  } else if (platform === 'native') {
    if (navigator.share) navigator.share({ title:'نبض - حدث عاجل', text: _qsItem.msg||'', url: url }).catch(function(){});
    else { navigator.clipboard.writeText(url).then(function(){ showToast('تم نسخ الرابط', 'success'); }); }
  } else if (urls[platform]) {
    window.open(urls[platform], '_blank');
  }

  // Increment share count + add points
  fetch('/api/alerts/' + _qsItem.id + '/share', { method:'POST' }).catch(function(){});
  addPoints('share');
  incrementChallengeProgress('share');

  var shareStat = document.getElementById('qsShares');
  if (shareStat) shareStat.textContent = parseInt(shareStat.textContent||'0') + 1;
  closeQuickShare();
}

/* ──────────────────────────────────────────────
   📊 LIVE MOMENTUM - شريط الزخم الحي
──────────────────────────────────────────────── */
function updateMomentumBar() {
  fetch('/api/stats/live')
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var online = document.getElementById('onlineCountBig');
      var today  = document.getElementById('todayReports');
      var zones  = document.getElementById('activeZonesCount');
      var trend  = document.getElementById('trendingTopic');
      if (online) animateCount('onlineCountBig', d.online || d.users || 0);
      if (today)  animateCount('todayReports', d.todayReports || 0);
      if (zones)  animateCount('activeZonesCount', d.activeZones || d.cities || 0);
      if (trend && d.trending)  trend.textContent = d.trending;
      // Check emergency mode
      checkEmergencyMode(d.activeAlerts || 0);
    })
    .catch(function(){});
}

/* ──────────────────────────────────────────────
   🔗 REFERRAL SYSTEM - نظام الإحالة
──────────────────────────────────────────────── */
function generateReferralLink() {
  var ref = myUserId ? myUserId.slice(0,8) : 'nabdh';
  return window.location.origin + '/?ref=' + ref;
}

function shareReferral() {
  var link = generateReferralLink();
  var text = '💓 جرّب تطبيق نبض - اعرف ما يحدث حولك في الوقت الحقيقي!\n\n🗺️ خريطة حية للأحداث\n💵 سعر الصرف اللحظي\n🩸 بنك الدم\n📢 صوت المجتمع\n\n' + link;
  if (navigator.share) {
    navigator.share({ title: 'نبض - صوت مدينتك الحي', text, url: link }).catch(function(){});
  } else {
    navigator.clipboard.writeText(text).then(function(){ showToast('✅ تم نسخ رابط الإحالة', 'success'); });
  }
  addPoints('share');
}

/* ──────────────────────────────────────────────
   🚀 INIT VIRAL FEATURES
──────────────────────────────────────────────── */
(function initViral() {
  // Load after DOM is ready
  setTimeout(function() {
    loadPoints();
    loadDailyChallenge();
    loadHomeLeaderboard();
    loadViralAlerts();
    updateMomentumBar();

    // Check referral
    var params = new URLSearchParams(window.location.search);
    var ref = params.get('ref');
    if (ref && ref !== (myUserId||'').slice(0,8)) {
      showToast('مرحباً! تم تسجيلك عبر رابط إحالة 🎉', 'success');
      // Reward referrer
      fetch('/api/referral', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ref, newUser: myUserId })
      }).catch(function(){});
    }

    // Refresh momentum every 30s
    setInterval(updateMomentumBar, 30000);
    // Refresh viral alerts every 5 min
    setInterval(loadViralAlerts, 300000);
    // Refresh leaderboard every 2 min if on home
    setInterval(function(){
      if (currentSection === 'home') loadHomeLeaderboard();
    }, 120000);
  }, 2000);
})();

// Override goSection to handle leaderboard (use window assignment to avoid hoisting)
(function() {
  var _origGoSection = window.goSection;
  window.goSection = function(name, push) {
    if (name === 'leaderboard') { openLeaderboard(); return; }
    if (typeof _origGoSection === 'function') _origGoSection(name, push);
  };
})();

// Hook into existing functions to award points
// Override vote to add points
var _origVote = typeof vote === 'function' ? vote : null;
if (_origVote) {
  window.vote = function(id) {
    _origVote(id);
    addPoints('vote_up');
    incrementChallengeProgress('vote_up');
  };
}


/* ================================================================
   🏆 POINTS HOOKS - ربط نقاط المكافآت بالأفعال الحقيقية
   يضمن حصول المستخدم على نقاط عند كل فعل مهم
================================================================ */
(function hookPointsToActions() {
  setTimeout(function() {

    // ── Hook: submit alert / report ─────────────────────────────
    var _origSubmitAlert = typeof submitAlert === 'function' ? submitAlert : null;
    if (_origSubmitAlert && !_origSubmitAlert._nabdhHooked) {
      window.submitAlert = function() {
        _origSubmitAlert.apply(this, arguments);
        setTimeout(function() {
          addPoints('report');
          incrementChallengeProgress('report');
        }, 1500);
      };
      window.submitAlert._nabdhHooked = true;
    }

    // ── Hook: submit blood donor ────────────────────────────────
    var _origSubmitDonor = typeof submitDonor === 'function' ? submitDonor : null;
    if (_origSubmitDonor && !_origSubmitDonor._nabdhHooked) {
      window.submitDonor = function() {
        _origSubmitDonor.apply(this, arguments);
        setTimeout(function() {
          addPoints('donate_blood');
          incrementChallengeProgress('blood');
        }, 1500);
      };
      window.submitDonor._nabdhHooked = true;
    }

    // ── Hook: submit blood request ──────────────────────────────
    var _origSubmitBlood = typeof submitBloodRequest === 'function' ? submitBloodRequest : null;
    if (_origSubmitBlood && !_origSubmitBlood._nabdhHooked) {
      window.submitBloodRequest = function() {
        _origSubmitBlood.apply(this, arguments);
        setTimeout(function() {
          addPoints('donate_blood');
          incrementChallengeProgress('blood');
        }, 1500);
      };
      window.submitBloodRequest._nabdhHooked = true;
    }

    // ── Hook: submit help offer ─────────────────────────────────
    var _origOfferHelp = typeof offerHelp === 'function' ? offerHelp : null;
    if (_origOfferHelp && !_origOfferHelp._nabdhHooked) {
      window.offerHelp = function(id) {
        _origOfferHelp(id);
        setTimeout(function() {
          addPoints('help_offer');
          incrementChallengeProgress('help_offer');
        }, 500);
      };
      window.offerHelp._nabdhHooked = true;
    }

    // ── Hook: submit market post ────────────────────────────────
    var _origSubmitMarket = typeof submitMarket === 'function' ? submitMarket : null;
    if (_origSubmitMarket && !_origSubmitMarket._nabdhHooked) {
      window.submitMarket = function() {
        _origSubmitMarket.apply(this, arguments);
        setTimeout(function() {
          addPoints('market_post');
          incrementChallengeProgress('market_post');
        }, 1500);
      };
      window.submitMarket._nabdhHooked = true;
    }

    // ── Hook: submit news ───────────────────────────────────────
    var _origSubmitNews = typeof submitNews === 'function' ? submitNews : null;
    if (_origSubmitNews && !_origSubmitNews._nabdhHooked) {
      window.submitNews = function() {
        _origSubmitNews.apply(this, arguments);
        setTimeout(function() { addPoints('news_post'); }, 1500);
      };
      window.submitNews._nabdhHooked = true;
    }

    // ── Hook: join study group ──────────────────────────────────
    var _origJoinStudy = typeof joinStudyGroup === 'function' ? joinStudyGroup : null;
    if (_origJoinStudy && !_origJoinStudy._nabdhHooked) {
      window.joinStudyGroup = function(id) {
        _origJoinStudy(id);
        setTimeout(function() { addPoints('join_study'); }, 500);
      };
      window.joinStudyGroup._nabdhHooked = true;
    }

    // ── Hook: vote on alert ─────────────────────────────────────
    var _origVoteAlert = typeof voteAlert === 'function' ? voteAlert : null;
    if (_origVoteAlert && !_origVoteAlert._nabdhHooked) {
      window.voteAlert = function(id, type) {
        _origVoteAlert(id, type);
        addPoints('vote_up');
        incrementChallengeProgress('vote_up');
      };
      window.voteAlert._nabdhHooked = true;
    }

    // ── Hook: SOS send ──────────────────────────────────────────
    var _origSendSOS = typeof sendSOS === 'function' ? sendSOS : null;
    if (_origSendSOS && !_origSendSOS._nabdhHooked) {
      window.sendSOS = function() {
        _origSendSOS.apply(this, arguments);
        setTimeout(function() { addPoints('sos'); }, 500);
      };
      window.sendSOS._nabdhHooked = true;
    }

  }, 3000); // Wait for all functions to be defined
})();

/* ================================================================
   📊 PROFILE POINTS DISPLAY - عرض النقاط في الملف الشخصي
================================================================ */
(function enhanceProfileWithPoints() {
  // Poll until profile section exists
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (attempts > 20) { clearInterval(timer); return; }
    var profileSection = document.getElementById('sec-profile');
    if (!profileSection) return;
    clearInterval(timer);

    // Add points/badges display after profile loads
    var origLoadProfile = typeof loadMyProfile === 'function' ? loadMyProfile : null;
    if (origLoadProfile && !origLoadProfile._pointsHooked) {
      window.loadMyProfile = function() {
        origLoadProfile.apply(this, arguments);
        setTimeout(injectProfilePointsCard, 800);
      };
      window.loadMyProfile._pointsHooked = true;
    }
  }, 500);
})();

function injectProfilePointsCard() {
  var existing = document.getElementById('profilePointsCard');
  if (existing) { updateProfilePointsCard(existing); return; }

  var profileSection = document.getElementById('sec-profile');
  if (!profileSection) return;

  var firstPad = profileSection.querySelector('.section-pad');
  if (!firstPad) return;

  var card = document.createElement('div');
  card.id = 'profilePointsCard';
  card.className = 'section-pad';
  card.innerHTML = buildProfilePointsHTML();
  profileSection.insertBefore(card, firstPad.nextSibling);
}

function updateProfilePointsCard(card) {
  card.innerHTML = buildProfilePointsHTML();
}

function buildProfilePointsHTML() {
  var level = getPointLevel(myPoints);
  var badgeIcons = BADGES.filter(function(b) { return myBadges.includes(b.id); }).map(function(b) {
    return '<span title="' + b.title + '">' + b.icon + '</span>';
  }).join('');

  return '<div style="background:linear-gradient(135deg,rgba(26,188,156,.08),rgba(52,152,219,.06));border:1px solid rgba(26,188,156,.2);border-radius:var(--r);padding:1rem;">' +
    '<div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.7rem">' +
      '<div style="font-size:2rem">' + level.icon + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:.95rem;font-weight:800;color:var(--text)">' + level.title + '</div>' +
        '<div class="my-points-display" style="font-size:.8rem;color:var(--teal);font-weight:700">' + myPoints + ' نقطة</div>' +
      '</div>' +
      '<button onclick="openLeaderboard()" style="background:rgba(26,188,156,.15);border:1px solid rgba(26,188,156,.3);border-radius:20px;padding:.3rem .8rem;color:var(--teal);cursor:pointer;font-size:.75rem;font-weight:700">🏆 المتصدرون</button>' +
    '</div>' +
    (myStreak > 1 ? '<div style="font-size:.8rem;color:#e67e22;margin-bottom:.5rem">🔥 سلسلة ' + myStreak + ' يوم متتالي</div>' : '') +
    (badgeIcons ? '<div style="font-size:1.3rem;letter-spacing:.3rem;margin-bottom:.4rem" title="شاراتك">' + badgeIcons + '</div>' : '') +
    '<div style="display:flex;gap:.5rem">' +
      '<button onclick="shareReferral()" style="flex:1;background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.25);border-radius:var(--r);padding:.5rem;cursor:pointer;font-size:.78rem;font-weight:700;color:#3498db">🔗 دعوة صديق +20 نقطة</button>' +
      '<button onclick="openDailyChallenge()" style="flex:1;background:rgba(155,89,182,.1);border:1px solid rgba(155,89,182,.25);border-radius:var(--r);padding:.5rem;cursor:pointer;font-size:.78rem;font-weight:700;color:#9b59b6">🎯 تحدي اليوم</button>' +
    '</div>' +
  '</div>';
}


/* ============================================================
   📷 PROFILE PHOTO + EMOJI AVATAR SYSTEM
   Camera / Gallery / Emoji picker buttons
   ============================================================ */
(function() {
  'use strict';

  // ── Temp storage ──────────────────────────────────────────
  var _profilePhotoBase64 = null;

  /* ---- triggerProfilePhotoUpload ---- */
  window.triggerProfilePhotoUpload = function() {
    var inp = document.getElementById('profilePhotoInput');
    if (inp) { inp.value = ''; inp.click(); }
    else showToast && showToast('⚠️ عنصر رفع الصورة غير موجود', 'error');
  };

  /* ---- triggerProfilePhotoCapture ---- */
  window.triggerProfilePhotoCapture = function() {
    var inp = document.getElementById('profileCameraInput');
    if (inp) { inp.value = ''; inp.click(); }
    else window.triggerProfilePhotoUpload();   // Fallback for desktop
  };

  /* ---- onProfilePhotoSelected ---- */
  window.onProfilePhotoSelected = function(input, fromCamera) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      if (typeof showToast === 'function') showToast('❌ حجم الصورة يجب أن لا يتجاوز 3 ميجابايت', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      var b64 = e.target.result;
      _profilePhotoBase64 = b64;

      // Update preview in edit form
      var photoImg    = document.getElementById('pePhotoImg');
      var avatarPrev  = document.getElementById('peAvatarPreview');
      if (photoImg) { photoImg.src = b64; photoImg.classList.remove('hidden'); photoImg.style.display = 'block'; }
      if (avatarPrev) { avatarPrev.style.display = 'none'; }

      // Also update main profile avatar if visible
      var profilePhotoDisplay = document.getElementById('profilePhotoDisplay');
      var profileAvatarBig    = document.getElementById('profileAvatarBig');
      if (profilePhotoDisplay) { profilePhotoDisplay.src = b64; profilePhotoDisplay.classList.remove('hidden'); profilePhotoDisplay.style.display = 'block'; }
      if (profileAvatarBig) profileAvatarBig.style.display = 'none';

      if (typeof showToast === 'function') showToast(fromCamera ? '📷 تم التقاط الصورة، احفظ الملف لرفعها' : '🖼️ تم اختيار الصورة، احفظ الملف لرفعها', 'success');
    };
    reader.readAsDataURL(file);
  };

  /* ---- uploadProfilePhoto (called by saveProfile) ---- */
  window.uploadProfilePhoto = async function(b64) {
    try {
      var res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: b64, type: 'profile', userId: window.myUserId || 'unknown' })
      });
      var data = await res.json();
      return data.url || data.imageUrl || null;
    } catch(e) {
      console.error('uploadProfilePhoto error:', e);
      return null;
    }
  };

  /* ---- updateProfilePhotoDisplay ---- */
  window.updateProfilePhotoDisplay = function(photoUrl) {
    var ids = ['profilePhotoDisplay', 'pePhotoImg'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (photoUrl) { el.src = photoUrl; el.classList.remove('hidden'); el.style.display = 'block'; }
      else          { el.src = ''; el.classList.add('hidden'); el.style.display = 'none'; }
    });
    // Show/hide emoji avatar element
    var bigAvatar = document.getElementById('profileAvatarBig');
    var prevAvatar = document.getElementById('peAvatarPreview');
    if (bigAvatar)  bigAvatar.style.display  = photoUrl ? 'none' : '';
    if (prevAvatar) prevAvatar.style.display  = photoUrl ? 'none' : '';
  };

  // ── Patch saveProfile to upload photo first ───────────────
  var _originalSaveProfile = window.saveProfile;
  window.saveProfile = async function() {
    if (_profilePhotoBase64) {
      if (typeof showToast === 'function') showToast('⏳ جاري رفع الصورة...', 'info');
      try {
        var photoUrl = await window.uploadProfilePhoto(_profilePhotoBase64);
        if (photoUrl) {
          if (!window.myProfile) window.myProfile = {};
          window.myProfile.profileImage = photoUrl;
          _profilePhotoBase64 = null;
          window.updateProfilePhotoDisplay(photoUrl);
        } else {
          if (typeof showToast === 'function') showToast('⚠️ فشل رفع الصورة، سيتم الحفظ بدونها', 'warning');
          _profilePhotoBase64 = null;
        }
      } catch(e) {
        _profilePhotoBase64 = null;
      }
    }
    if (typeof _originalSaveProfile === 'function') return _originalSaveProfile();
  };

  // ── Emoji Avatar Picker ───────────────────────────────────
  var AVATAR_EMOJIS = [
    '👤','👦','👧','👨','👩','🧑','👴','👵','🧒',
    '🦸','🦹','🧙','🧝','🧛','🧟','🧞','🧜','🧚',
    '👮','💂','🕵️','👷','🤴','👸','🤶','🎅','🧑‍⚕️',
    '🧑‍🏫','🧑‍🌾','🧑‍🍳','🧑‍🔧','🧑‍🏭','🧑‍💼','🧑‍🔬','🧑‍🎨','🧑‍✈️',
    '🦊','🐺','🦁','🐯','🐻','🐼','🐨','🦝','🦔',
    '🤖','👾','👻','💀','☠️','🎭','🌟','⚡','🔥',
    '🌊','🌈','🎯','🏆','💎','🦅','🦋','🌺','🌙',
    'م','ن','ب','ع','خ','ا','س','ح','ي','ف','ق','ك','ل','ج','و','ر','ز','ص','ط','ت','ث','ذ','ظ','ض','غ','ش'
  ];

  window.openEmojiAvatarPicker = function() {
    var picker = document.getElementById('emojiAvatarPicker');
    var grid   = document.getElementById('eapGrid');
    if (!picker) return;
    if (grid) {
      grid.innerHTML = '';
      AVATAR_EMOJIS.forEach(function(em) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = em;
        btn.className = 'eap-btn';
        btn.style.cssText = 'font-size:1.6rem;background:var(--card,#1a2332);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:8px;padding:.4rem .5rem;cursor:pointer;transition:transform .15s';
        btn.onclick = function() { window.selectEmojiAvatar(em); };
        grid.appendChild(btn);
      });
    }
    picker.classList.remove('hidden');
    picker.style.display = 'block';
    picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  window.closeEmojiAvatarPicker = function() {
    var picker = document.getElementById('emojiAvatarPicker');
    if (picker) { picker.classList.add('hidden'); picker.style.display = 'none'; }
  };

  window.selectEmojiAvatar = function(emoji) {
    if (!window.myProfile) window.myProfile = {};
    window.myProfile.avatar = emoji;
    window.myProfile.profileImage = null;
    _profilePhotoBase64 = null;

    // Update all avatar elements
    ['profileAvatarBig','peAvatarPreview','menuAvatar'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.textContent = emoji; el.style.display = ''; }
    });
    // Hide photo img elements
    ['profilePhotoDisplay','pePhotoImg'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
    });

    window.closeEmojiAvatarPicker();

    // Persist immediately
    try { localStorage.setItem('nabdh_profile', JSON.stringify(window.myProfile)); } catch(e) {}
    if (typeof showToast === 'function') showToast('✅ تم اختيار ' + emoji + ' كرمز لملفك', 'success');
  };

  // ── Sync photo display when profile section opens ─────────
  var _profileSectionObserver = (function() {
    var sec = document.getElementById('sec-profile');
    if (!sec) return;
    var obs = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (sec.classList.contains('active-sec')) {
            var img = (window.myProfile && window.myProfile.profileImage) || null;
            if (img) window.updateProfilePhotoDisplay(img);
          }
        }
      });
    });
    obs.observe(sec, { attributes: true });
  })();

  console.log('✅ Profile photo & emoji system loaded');
})();
/* ============================================================
   END PROFILE PHOTO + EMOJI SYSTEM
   ============================================================ */

/* ── refreshProfilePointsCard — v4 points card sync ── */
function refreshProfilePointsCard() {
  var points = myPoints || 0;
  var streak = myStreak || 0;
  var level  = getPointLevel(points);

  // Update all level/points display elements
  var ids = {
    'ppcLevelIcon':          function(e){ e.textContent = level.icon; },
    'ppcLevelTitle':         function(e){ e.textContent = level.title; },
    'ppcPtsText':            function(e){ e.textContent = points + ' نقطة'; },
    'pv4LevelIcon':          function(e){ e.textContent = level.icon; },
    'pv4LevelText':          function(e){ e.textContent = level.title; },
    'profileLevelBadgeInline': function(e){ e.textContent = level.icon + ' ' + level.title; },
    'profileLevelIcon':      function(e){ e.textContent = level.icon; },
    'profileLevelText':      function(e){ e.textContent = level.title; },
  };
  Object.keys(ids).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) ids[id](el);
  });

  // Streak
  var streakEl = document.getElementById('ppcStreak');
  if (streakEl) {
    if (streak > 1) { streakEl.textContent = '🔥 سلسلة ' + streak + ' يوم'; streakEl.classList.remove('hidden'); }
    else streakEl.classList.add('hidden');
  }

  // Badges chips in points card
  var badgesEl = document.getElementById('ppcBadgesRow');
  if (badgesEl && myBadges && myBadges.length > 0) {
    var BADGE_MAP = {};
    if (typeof BADGES !== 'undefined') BADGES.forEach(function(b){ BADGE_MAP[b.id] = b; });
    var html = myBadges.map(function(bid) {
      var b = BADGE_MAP[bid];
      if (!b) return '';
      return '<span class="pv4-chip pv4-chip-level" style="background:rgba(26,188,156,.08);border-color:rgba(26,188,156,.2);color:var(--teal)">' + b.icon + ' ' + b.title + '</span>';
    }).filter(Boolean).join('');
    if (html) badgesEl.innerHTML = html;
  }

  // Animated points counter in stats row
  var psPts = document.getElementById('ps-points');
  if (psPts) {
    var cur = parseInt(psPts.textContent) || 0;
    if (cur !== points) animateCounter('ps-points', cur, points, 600);
  }

  // Refresh activity bars
  refreshActivityBars();
}

/* ================================================================
   PROFILE v5 — Missing Functions (shareProfile, QR, phone, location)
================================================================ */

/* ── Share Profile ─────────────────────────────────────────── */
function shareProfile() {
  var name      = (myProfile && myProfile.name) || myName || 'مستخدم نبض';
  var pubPhone  = (myProfile && myProfile.publicPhone) || '';
  var company   = (myProfile && myProfile.company)     || '';
  var area      = (myProfile && myProfile.area)        || userLocationName || '';
  var url       = window.location.origin + '/#profile';
  var text      = '👤 ' + name + ' على تطبيق نبض';
  if (area)     text += '\n📍 ' + area;
  if (company)  text += '\n🏢 ' + company;
  if (pubPhone) text += '\n📞 ' + pubPhone;
  text += '\n🔗 ' + url;

  if (navigator.share) {
    navigator.share({ title: 'ملف ' + name + ' على نبض', text: text, url: url })
      .catch(function(){});
  } else {
    try {
      navigator.clipboard.writeText(text);
      showToast('📋 تم نسخ بيانات الملف الشخصي', 'success');
    } catch(e) {
      showToast(text.substring(0, 60) + '…', 'info');
    }
  }
}

/* ── Show Profile QR Modal ─────────────────────────────────── */
function showProfileQRModal() {
  var modal = document.getElementById('profileQrModal');
  if (!modal) return;
  var name = (myProfile && myProfile.name) || myName || 'مستخدم نبض';
  var url  = window.location.origin + '/#profile';

  // Update name labels
  var nameEl = document.getElementById('pqmName');
  var subEl  = document.getElementById('pqmSub');
  if (nameEl) nameEl.textContent = name;
  if (subEl)  subEl.textContent  = 'امسح الكود للتواصل معي';

  // Generate QR
  var canvas = document.getElementById('profileQrCanvas');
  if (canvas && typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, url, {
      width: 200, margin: 1,
      color: { dark: '#1abc9c', light: '#0e151e' }
    }, function(err) { if (err) console.warn('QR error:', err); });
  }

  modal.classList.remove('hidden');
  history.pushState({ section: currentSection, modal: 'qr' }, '', '#profile');
}

function closeProfileQrModal() {
  var modal = document.getElementById('profileQrModal');
  if (modal) modal.classList.add('hidden');
}

/* ── Copy Profile Link ─────────────────────────────────────── */
function copyProfileLink() {
  var url = window.location.origin + '/#profile';
  try {
    navigator.clipboard.writeText(url).then(function() {
      showToast('📋 تم نسخ رابط ملفك الشخصي!', 'success');
    });
  } catch(e) {
    showToast('🔗 الرابط: ' + url, 'info');
  }
}

/* ── Call Profile Phone (private) ─────────────────────────── */
function callProfilePhone() {
  var ph = myProfile && myProfile.phone;
  if (ph) window.open('tel:' + ph);
  else showToast('❌ لم تُضف رقم هاتف', 'error');
}

/* ── Use Current Location for Profile ─────────────────────── */
function useCurrentLocationForProfile() {
  if (!navigator.geolocation) {
    showToast('❌ المتصفح لا يدعم الموقع', 'error');
    return;
  }
  showToast('⏳ جارٍ تحديد موقعك...', 'info');
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;

      // Reverse geocode
      fetch('https://nominatim.openstreetmap.org/reverse?lat=' + userLat + '&lon=' + userLng + '&format=json&accept-language=ar')
        .then(function(r){ return r.json(); })
        .then(function(d) {
          var city  = d.address && (d.address.city || d.address.town || d.address.county || d.address.state) || '';
          var state = d.address && d.address.state || '';
          userLocationName = city || state || 'موقعي الحالي';

          var areaInput = document.getElementById('pe-area');
          if (areaInput) areaInput.value = userLocationName;
          showToast('📍 تم تحديد موقعك: ' + userLocationName, 'success');
        })
        .catch(function() {
          userLocationName = 'موقعي الحالي';
          var areaInput = document.getElementById('pe-area');
          if (areaInput) areaInput.value = userLocationName;
          showToast('📍 تم تحديد الإحداثيات', 'success');
        });
    },
    function(err) {
      var msgs = { 1: 'رُفض الإذن', 2: 'الموقع غير متاح', 3: 'انتهت المهلة' };
      showToast('❌ ' + (msgs[err.code] || 'خطأ في الموقع'), 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* ============================================================
   🚀 PERFORMANCE & UX ENHANCEMENTS v7.0
   - Skeleton loaders
   - Debounce / Throttle
   - Offline cache (localStorage)
   - Pull-to-refresh
   - IntersectionObserver lazy images
   - Virtual scroll hint
   - Prefetch on idle
   - Connection quality detection
============================================================ */

/* ── Debounce & Throttle ────────────────────────────────── */
function debounce(fn, ms) {
  let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}
function throttle(fn, ms) {
  let last = 0; return function(...a) { const now = Date.now(); if (now - last >= ms) { last = now; fn.apply(this, a); } };
}

/* ── Skeleton HTML generator ────────────────────────────── */
function skeletonCards(n, type) {
  if (type === 'alert') {
    return Array(n).fill(0).map(() =>
      '<div class="sk-card"><div class="sk-icon"></div><div class="sk-body"><div class="sk-line sk-w80"></div><div class="sk-line sk-w60"></div><div class="sk-line sk-w40"></div></div></div>'
    ).join('');
  }
  if (type === 'market') {
    return Array(n).fill(0).map(() =>
      '<div class="sk-card sk-market"><div class="sk-img"></div><div class="sk-body"><div class="sk-line sk-w70"></div><div class="sk-line sk-w50"></div><div class="sk-line sk-w30"></div></div></div>'
    ).join('');
  }
  if (type === 'person') {
    return Array(n).fill(0).map(() =>
      '<div class="sk-card sk-person"><div class="sk-avatar"></div><div class="sk-body"><div class="sk-line sk-w60"></div><div class="sk-line sk-w40"></div></div></div>'
    ).join('');
  }
  return Array(n).fill(0).map(() =>
    '<div class="sk-card"><div class="sk-line sk-w90"></div><div class="sk-line sk-w70"></div><div class="sk-line sk-w50"></div></div>'
  ).join('');
}

/* ── Offline Cache helpers ──────────────────────────────── */
const _cache = {
  set(key, data, ttlMs) {
    try { localStorage.setItem('nc_' + key, JSON.stringify({ data, exp: Date.now() + (ttlMs || 300000) })); } catch {}
  },
  get(key) {
    try {
      const raw = localStorage.getItem('nc_' + key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() > obj.exp) { localStorage.removeItem('nc_' + key); return null; }
      return obj.data;
    } catch { return null; }
  },
  clear(key) { try { localStorage.removeItem('nc_' + key); } catch {} }
};

/* ── Cached fetch wrapper ───────────────────────────────── */
async function cachedFetch(url, ttlMs, forceRefresh) {
  const key = url.replace(/[^a-z0-9]/gi, '_');
  if (!forceRefresh) {
    const cached = _cache.get(key);
    if (cached !== null) return cached;
  }
  const data = await fetch(url).then(r => r.json());
  _cache.set(key, data, ttlMs || 120000);
  return data;
}

/* ── Connection quality detection ───────────────────────── */
let _connQuality = 'good'; // 'good' | 'slow' | 'offline'
function detectConnection() {
  if (!navigator.onLine) { _connQuality = 'offline'; return; }
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    const type = conn.effectiveType;
    _connQuality = (type === '2g' || type === 'slow-2g') ? 'slow' : 'good';
  }
}
window.addEventListener('online',  () => { _connQuality = 'good';    showToast('✅ عاد الاتصال بالإنترنت', 'success'); const offEl = document.getElementById('offlineIndicator'); if (offEl) offEl.classList.add('hidden'); });
window.addEventListener('offline', () => { _connQuality = 'offline'; showToast('⚠️ انقطع الاتصال - وضع offline', 'warning'); const offEl = document.getElementById('offlineIndicator'); if (offEl) offEl.classList.remove('hidden'); });
detectConnection();

/* ── Pull-to-refresh ────────────────────────────────────── */
(function initPullToRefresh() {
  let startY = 0, pulling = false;
  const threshold = 80;
  let indicator = null;
  function getIndicator() {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pullRefreshIndicator';
      indicator.innerHTML = '<span class="ptr-icon">🔄</span><span class="ptr-text">اسحب للتحديث</span>';
      indicator.style.cssText = 'position:fixed;top:-50px;left:50%;transform:translateX(-50%);background:var(--dark3);color:var(--text);padding:.5rem 1.2rem;border-radius:2rem;font-size:.85rem;z-index:9000;transition:top .2s ease;display:flex;align-items:center;gap:.4rem;box-shadow:0 4px 16px rgba(0,0,0,.4)';
      document.body.appendChild(indicator);
    }
    return indicator;
  }
  document.addEventListener('touchstart', e => {
    const mc = document.getElementById('mainContent');
    if (mc && mc.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10 && dy < threshold + 40) {
      const ind = getIndicator();
      ind.style.top = Math.min(dy - 40, 20) + 'px';
      ind.querySelector('.ptr-text').textContent = dy >= threshold ? '↑ أفلت للتحديث' : '↓ اسحب للتحديث';
    }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!pulling) return;
    const dy = e.changedTouches[0].clientY - startY;
    const ind = getIndicator();
    ind.style.top = '-50px';
    if (dy >= threshold) {
      showToast('🔄 جاري التحديث...', 'info');
      // Refresh current section
      if (currentSection === 'home')      { loadAlerts(); loadStats(); }
      else if (currentSection === 'market')   loadMarket();
      else if (currentSection === 'exchange') loadExchange();
      else if (currentSection === 'news')     loadNews();
      else if (currentSection === 'map')      { loadNearbyAlerts(); loadNearbyPeople(); }
      else if (currentSection === 'dashboard') loadDashboard();
      else if (currentSection === 'study')    loadStudyGroups();
      else if (currentSection === 'help')     loadHelpRequests();
      else if (currentSection === 'polls')    loadPolls();
    }
    pulling = false;
  }, { passive: true });
})();

/* ── Lazy image loading via IntersectionObserver ────────── */
function lazyLoadImages() {
  if (!('IntersectionObserver' in window)) return;
  const imgs = document.querySelectorAll('img[data-src]');
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        obs.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  imgs.forEach(img => io.observe(img));
}

/* ── Idle prefetch (background data loading) ─────────────── */
function scheduleIdlePrefetch() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      fetch('/api/prefetch').then(r => r.json()).then(d => {
        if (d.alerts && d.alerts.length) { _cache.set('_api_alerts', d.alerts, 180000); }
        if (d.exchange) { _cache.set('_api_exchange', d.exchange, 180000); }
        if (d.market)   { _cache.set('_api_market',   d.market,   180000); }
      }).catch(() => {});
    }, { timeout: 5000 });
  }
}

/* ── Enhanced loadAlerts with skeleton + cache ──────────── */
const _origLoadAlerts = loadAlerts;
async function loadAlerts(forceRefresh) {
  const el = document.getElementById('homeAlerts');
  // Show skeleton immediately
  if (el && !allAlerts.length) el.innerHTML = skeletonCards(4, 'alert');
  try {
    allAlerts = await cachedFetch('/api/alerts', 120000, forceRefresh);
    renderHomeAlerts(); updateTicker();
  } catch {
    allAlerts = [];
    if (el) renderHomeAlerts();
  }
}

/* ── Enhanced loadMarket with skeleton + cache ──────────── */
const _origLoadMarket = loadMarket;
async function loadMarket(forceRefresh) {
  const el = document.getElementById('marketList');
  if (el && !allMarket.length) el.innerHTML = skeletonCards(4, 'market');
  try {
    allMarket = await cachedFetch('/api/market', 120000, forceRefresh);
    renderMarket();
  } catch {
    allMarket = [];
    renderMarket();
  }
}

/* ── Enhanced loadStats with cache ─────────────────────── */
const _origLoadStats = loadStats;
async function loadStats(forceRefresh) {
  try {
    const s = await cachedFetch('/api/stats', 30000, forceRefresh);
    updateStats(s);
  } catch {}
}

/* ── Image viewer with pinch zoom ───────────────────────── */
function viewFullImage(src) {
  let viewer = document.getElementById('fullImgViewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'fullImgViewer';
    viewer.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    viewer.innerHTML = '<img id="fullImgEl" style="max-width:96vw;max-height:96vh;object-fit:contain;border-radius:8px;transition:transform .2s"/><button style="position:absolute;top:1rem;right:1rem;background:rgba(255,255,255,.1);border:none;color:#fff;font-size:1.6rem;width:2.5rem;height:2.5rem;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center" onclick="document.getElementById(\'fullImgViewer\').remove()">✕</button>';
    viewer.addEventListener('click', e => { if (e.target === viewer) viewer.remove(); });
    document.body.appendChild(viewer);
  }
  document.getElementById('fullImgEl').src = src;
  viewer.style.display = 'flex';
}

/* ── Format file size ───────────────────────────────────── */
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ── Copy text to clipboard ─────────────────────────────── */
function copyText(text, msg) {
  try {
    navigator.clipboard.writeText(text).then(() => showToast(msg || '✅ تم النسخ', 'success'));
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(msg || '✅ تم النسخ', 'success');
  }
}

/* ── Trending section on home ───────────────────────────── */
async function loadTrending() {
  try {
    const items = await cachedFetch('/api/trending', 60000);
    const el = document.getElementById('trendingList');
    if (!el || !items.length) return;
    el.innerHTML = items.slice(0, 5).map((item, i) =>
      '<div class="trend-item" onclick="goSection(\'home\')">' +
        '<span class="trend-num">' + (i + 1) + '</span>' +
        '<div class="trend-body">' +
          '<span class="trend-text">' + escHtml((item.text || '').substring(0, 60)) + '</span>' +
          '<span class="trend-type">' + { alert: '🚨', news: '📰', voice: '🔊' }[item.type] + '</span>' +
        '</div>' +
      '</div>'
    ).join('');
  } catch {}
}

/* ── Smart search with debounce ────────────────────────── */
const _debouncedPeopleSearch = debounce(function(q) {
  const el = document.getElementById('nearbyPeopleList');
  if (!el) return;
  if (!q) { loadNearbyPeople(); return; }
  const q2 = q.toLowerCase();
  const filtered = nearbyUsers.filter(u =>
    (u.name || '').toLowerCase().includes(q2) ||
    (u.area || '').toLowerCase().includes(q2) ||
    (u.jobTitle || '').toLowerCase().includes(q2) ||
    (u.company || '').toLowerCase().includes(q2)
  );
  if (!filtered.length) {
    el.innerHTML = emptyState('🔍', 'لا توجد نتائج', 'جرّب بحثاً آخر', '');
  } else {
    el.innerHTML = filtered.map(u => renderPersonCard(u)).join('');
  }
}, 300);

function smartSearch(q) { _debouncedPeopleSearch(q); }

/* ── Animated counter with easing (improved) ───────────── */
function animateCount2(id, target, duration) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent.replace(/[^\d]/g, '')) || 0;
  if (start === target) return;
  const dur = duration || 1000;
  const t0 = performance.now();
  (function loop(now) {
    const p = Math.min((now - t0) / dur, 1);
    const ease = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    el.textContent = Math.round(start + (target - start) * ease).toLocaleString('ar');
    if (p < 1) requestAnimationFrame(loop);
  })(t0);
}

/* ── Scroll to top button ───────────────────────────────── */
function initScrollTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  mc.addEventListener('scroll', throttle(() => {
    if (mc.scrollTop > 300) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }, 200));
  btn.onclick = () => mc.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Touch feedback for buttons ─────────────────────────── */
function addTouchFeedback() {
  document.addEventListener('touchstart', e => {
    const btn = e.target.closest('button, .btn, .bnav, .alert-item, .market-card, .person-card');
    if (btn) btn.classList.add('touch-active');
  }, { passive: true });
  document.addEventListener('touchend', e => {
    document.querySelectorAll('.touch-active').forEach(el => el.classList.remove('touch-active'));
  }, { passive: true });
}

/* ── Time formatter (extended) ──────────────────────────── */
function timeAgoFull(ts) {
  if (!ts) return '—';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5)  return 'الآن';
  if (s < 60) return 'منذ ' + s + ' ثانية';
  const m = Math.floor(s / 60);
  if (m < 60) return 'منذ ' + m + ' دقيقة';
  const h = Math.floor(m / 60);
  if (h < 24) return 'منذ ' + h + ' ساعة';
  const d = Math.floor(h / 24);
  if (d < 7)  return 'منذ ' + d + ' يوم';
  if (d < 30) return 'منذ ' + Math.floor(d / 7) + ' أسبوع';
  return new Date(t).toLocaleDateString('ar-SA');
}

/* ── Page visibility - pause/resume ─────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Refresh when user returns
    setTimeout(() => { loadStats(true); if (currentSection === 'home') loadAlerts(); }, 200);
  }
});

/* ── Register enhanced Service Worker ───────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Check for updates every 5 min
        setInterval(() => reg.update(), 5 * 60 * 1000);
      })
      .catch(() => {});
  });
}

/* ── Init all enhancements after DOMContentLoaded ───────── */
document.addEventListener('DOMContentLoaded', () => {
  addTouchFeedback();
  initScrollTop();
  scheduleIdlePrefetch();
  loadTrending();
  // Init lazy images on any dynamic content update
  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    const mo = new MutationObserver(() => lazyLoadImages());
    mo.observe(mainContent, { childList: true, subtree: true });
  }
});


/* ============================================================
   🔍 GLOBAL SEARCH v7.0
============================================================ */
let _globalSearchTimer = null;

function openGlobalSearch() {
  let modal = document.getElementById('globalSearchModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'globalSearchModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9990;display:flex;flex-direction:column;padding:1rem';
    modal.innerHTML =
      '<div style="display:flex;gap:.5rem;margin-bottom:.8rem">' +
        '<input id="globalSearchInp" class="inp" placeholder="🔍 ابحث في كل شيء..." autofocus style="flex:1;font-size:1rem;padding:.7rem 1rem"/>' +
        '<button onclick="closeGlobalSearch()" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:var(--text);padding:.5rem .9rem;border-radius:var(--rs);cursor:pointer;font-family:inherit;font-size:.9rem">✕</button>' +
      '</div>' +
      '<div id="globalSearchResults" style="overflow-y:auto;flex:1"></div>';
    document.body.appendChild(modal);
    const inp = modal.querySelector('#globalSearchInp');
    inp.addEventListener('input', () => {
      clearTimeout(_globalSearchTimer);
      _globalSearchTimer = setTimeout(() => performGlobalSearch(inp.value), 350);
    });
    inp.focus();
  } else {
    modal.style.display = 'flex';
    setTimeout(() => { const i = document.getElementById('globalSearchInp'); if (i) { i.value = ''; i.focus(); } }, 50);
    document.getElementById('globalSearchResults').innerHTML = '';
  }
}

function closeGlobalSearch() {
  const m = document.getElementById('globalSearchModal');
  if (m) m.style.display = 'none';
}

async function performGlobalSearch(q) {
  const el = document.getElementById('globalSearchResults');
  if (!el) return;
  if (!q || q.trim().length < 2) { el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:2rem">ابحث عن أي شيء...</div>'; return; }
  el.innerHTML = '<div style="text-align:center;padding:1.5rem"><span class="spinner"></span></div>';
  try {
    const data = await fetch('/api/search?q=' + encodeURIComponent(q.trim())).then(r => r.json());
    if (!data.total) { el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:2rem">🔍 لا توجد نتائج لـ "' + escHtml(q) + '"</div>'; return; }
    let html = '';
    const sections = [
      { key: 'alerts', label: '🚨 تنبيهات', goTo: 'map' },
      { key: 'market', label: '🛒 سوق', goTo: 'market' },
      { key: 'news',   label: '📰 أخبار',  goTo: 'news' },
      { key: 'people', label: '👤 أشخاص',  goTo: 'people' }
    ];
    sections.forEach(s => {
      const items = data[s.key] || [];
      if (!items.length) return;
      html += '<div style="margin-bottom:.8rem"><div style="font-size:.8rem;color:var(--text2);font-weight:700;margin-bottom:.4rem;padding:0 .3rem">' + s.label + '</div>';
      items.forEach(item => {
        html += '<div onclick="closeGlobalSearch();goSection(\'' + s.goTo + '\')" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .8rem;background:var(--dark3);border-radius:var(--rs);margin-bottom:.3rem;cursor:pointer;border:1px solid var(--border)">' +
          '<span style="font-size:1.2rem">' + (item.icon || '•') + '</span>' +
          '<div style="flex:1;overflow:hidden">' +
            '<div style="font-size:.9rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(item.title || '') + '</div>' +
            (item.sub ? '<div style="font-size:.75rem;color:var(--text2)">' + escHtml(item.sub) + '</div>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    });
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<div style="text-align:center;color:var(--red);padding:2rem">❌ خطأ في البحث</div>';
  }
}

/* ============================================================
   📊 LIVE STATS UPDATER (topbar quick stats)
============================================================ */
async function loadQuickStats() {
  try {
    const s = await fetch('/api/stats/quick').then(r => r.json());
    // Update topbar
    const lr = document.getElementById('liveRate');
    if (lr && s.usdRate) lr.textContent = s.usdRate.toLocaleString('ar');
    const lu = document.getElementById('liveUsers');
    if (lu) animateCount('liveUsers', s.users || 0);
    const lrep = document.getElementById('liveReports');
    if (lrep) animateCount('liveReports', s.reports || 0);
    // Today reports
    const tr = document.getElementById('todayReports');
    if (tr) tr.textContent = s.todayReports || 0;
    // Online count big
    const ocb = document.getElementById('onlineCountBig');
    if (ocb) ocb.textContent = s.users || 0;
  } catch {}
}

/* ============================================================
   🏷️ APP VERSION CHECKER
============================================================ */
async function checkAppVersion() {
  try {
    const v = await fetch('/api/version').then(r => r.json());
    const savedV = localStorage.getItem('nabdh_version');
    if (savedV && savedV !== v.version) {
      showToast('🚀 إصدار جديد متاح! v' + v.version, 'info');
      // Tell service worker to update
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage('skipWaiting');
      }
    }
    localStorage.setItem('nabdh_version', v.version);
  } catch {}
}

/* ============================================================
   📋 ALERT DETAILS MODAL
============================================================ */
function openAlertDetails(alertId) {
  const alert = allAlerts.find(a => a.id === alertId);
  if (!alert) return;
  let modal = document.getElementById('alertDetailsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'alertDetailsModal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML = '<button class="modal-close" onclick="document.getElementById(\'alertDetailsModal\').classList.add(\'hidden\')">✕</button><div id="alertDetailsContent"></div>';
    modal.appendChild(box);
    document.body.appendChild(modal);
  }
  const img = alert.imageId ? '<img src="/api/image/' + alert.imageId + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:var(--rs);margin:.7rem 0" alt="صورة"/>' : '';
  document.getElementById('alertDetailsContent').innerHTML =
    '<div style="font-size:2rem;text-align:center;margin-bottom:.5rem">' + (alert.icon || '🔴') + '</div>' +
    '<div style="font-size:1rem;font-weight:700;margin-bottom:.5rem">' + escHtml(alert.msg) + '</div>' +
    img +
    '<div style="display:flex;flex-direction:column;gap:.4rem;margin-top:.6rem">' +
      '<span style="font-size:.85rem;color:var(--text2)">📍 ' + escHtml(alert.area || '—') + '</span>' +
      '<span style="font-size:.85rem;color:var(--text2)">🕐 ' + timeAgo(alert.time) + '</span>' +
      '<span style="font-size:.85rem;color:var(--text2)">👁️ ' + (alert.views || 0) + ' مشاهدة</span>' +
      '<span style="font-size:.85rem;color:var(--text2)">👍 ' + (alert.votes || 0) + ' تأييد</span>' +
    '</div>' +
    '<div style="display:flex;gap:.5rem;margin-top:.8rem">' +
      '<button onclick="vote(\'' + alert.id + '\');document.getElementById(\'alertDetailsModal\').classList.add(\'hidden\')" style="flex:1;background:rgba(26,188,156,.15);border:1px solid rgba(26,188,156,.3);color:var(--teal);padding:.6rem;border-radius:var(--rs);cursor:pointer;font-family:inherit;font-weight:700">👍 أؤيد</button>' +
      '<button onclick="shareItem(\'' + escJs(alert.msg) + '\',\'' + escJs(alert.area) + '\');document.getElementById(\'alertDetailsModal\').classList.add(\'hidden\')" style="flex:1;background:rgba(52,152,219,.15);border:1px solid rgba(52,152,219,.3);color:#3498db;padding:.6rem;border-radius:var(--rs);cursor:pointer;font-family:inherit;font-weight:700">🔗 مشاركة</button>' +
    '</div>';
  modal.classList.remove('hidden');
}

/* ============================================================
   🔔 IN-APP NOTIFICATION SYSTEM
============================================================ */
function showInAppNotif(msg, type, duration) {
  const container = document.getElementById('inAppNotifContainer');
  if (!container) return;
  const notif = document.createElement('div');
  notif.style.cssText = 'background:' + (type === 'error' ? 'rgba(231,76,60,.95)' : type === 'success' ? 'rgba(46,204,113,.95)' : 'rgba(26,188,156,.95)') + ';color:#fff;padding:.5rem 1rem;border-radius:2rem;font-size:.85rem;font-weight:600;max-width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.4);animation:slideDown .3s ease;pointer-events:auto';
  notif.textContent = msg;
  container.appendChild(notif);
  setTimeout(() => { notif.style.opacity = '0'; notif.style.transform = 'translateY(-10px)'; notif.style.transition = 'all .3s'; setTimeout(() => notif.remove(), 300); }, duration || 3000);
}

/* ============================================================
   📈 TOPBAR LIVE RATE UPDATE
============================================================ */
// Update live USD rate from exchange rates
function updateTopbarRate() {
  const usdRate = allRates.find(r => (r.currency || '').includes('دولار') || (r.currency || '').toLowerCase().includes('usd'));
  if (usdRate) {
    const el = document.getElementById('liveRate');
    if (el) el.textContent = (usdRate.buy || usdRate.rate || '---').toLocaleString('ar');
  }
}

// Hook into existing data updates
const _origRenderExchange = typeof renderExchange === 'function' ? renderExchange : null;

/* ============================================================
   🛡️ INPUT SANITIZATION (XSS prevention)
============================================================ */
function sanitizeInput(str, maxLen) {
  if (!str) return '';
  return String(str).replace(/[<>"'&]/g, c => ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#x27;", '&':'&amp;' }[c])).substring(0, maxLen || 500);
}

/* ============================================================
   📱 HAPTIC FEEDBACK (vibration for mobile)
============================================================ */
function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern || [50]);
}

/* ============================================================
   🔄 AUTO-REFRESH INTERVALS (enhanced)
============================================================ */
// Override initApp intervals to be smarter
document.addEventListener('DOMContentLoaded', () => {
  // Initial quick stats load
  setTimeout(loadQuickStats, 1500);
  // Check version after 3 seconds
  setTimeout(checkAppVersion, 3000);
  // Periodic quick stats (every 20 seconds)
  setInterval(loadQuickStats, 20000);
  // Update topbar rate when exchange data changes
  setInterval(updateTopbarRate, 15000);
});

/* ============================================================
   ⌨️ KEYBOARD SHORTCUTS
============================================================ */
document.addEventListener('keydown', e => {
  // Escape to close modals
  if (e.key === 'Escape') {
    closeGlobalSearch();
    const modals = document.querySelectorAll('.modal-overlay:not(.hidden)');
    modals.forEach(m => m.classList.add('hidden'));
  }
  // / or Ctrl+F to open search
  if ((e.key === '/' || (e.ctrlKey && e.key === 'f')) && !e.target.matches('input, textarea')) {
    e.preventDefault();
    openGlobalSearch();
  }
});


/* ============================================================
   🚀 NABDH v7.1 — COMPLETE FEATURES ENGINE
   تحسينات شاملة: أداء + UX + ميزات متقدمة
   ============================================================ */

/* ── Enhanced Skeleton Loaders ─────────────────────────────── */
function showSkeleton(containerId, type = 'generic', count = 4) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = skeletonCards(count, type);
  el.classList.add('skeleton-loading');
}
function hideSkeleton(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.classList.remove('skeleton-loading');
}
function skeletonList(n) {
  return Array(n).fill(0).map(() =>
    `<div class="sk-list-item"><div class="sk-avatar"></div><div class="sk-body"><div class="sk-line sk-w70"></div><div class="sk-line sk-w45"></div></div></div>`
  ).join('');
}
function skeletonStats(n) {
  return Array(n).fill(0).map(() =>
    `<div class="sk-stat"><div class="sk-num"></div><div class="sk-label"></div></div>`
  ).join('');
}

/* ── Virtual Scroll for Long Lists ────────────────────────── */
class VirtualScroll {
  constructor(container, items, renderFn, itemHeight = 80) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.items = items;
    this.renderFn = renderFn;
    this.itemHeight = itemHeight;
    this.visibleCount = Math.ceil((this.container?.clientHeight || 600) / itemHeight) + 5;
    this.startIndex = 0;
    this._bound = this._onScroll.bind(this);
    this.init();
  }
  init() {
    if (!this.container) return;
    this.container.style.overflowY = 'auto';
    this.spacer = document.createElement('div');
    this.spacer.style.height = (this.items.length * this.itemHeight) + 'px';
    this.container.appendChild(this.spacer);
    this.viewport = document.createElement('div');
    this.viewport.className = 'vs-viewport';
    this.container.appendChild(this.viewport);
    this.container.addEventListener('scroll', this._bound);
    this.render();
  }
  _onScroll() {
    const scrollTop = this.container.scrollTop;
    const newStart = Math.max(0, Math.floor(scrollTop / this.itemHeight) - 2);
    if (newStart !== this.startIndex) {
      this.startIndex = newStart;
      this.render();
    }
  }
  render() {
    if (!this.viewport) return;
    const end = Math.min(this.startIndex + this.visibleCount, this.items.length);
    const slice = this.items.slice(this.startIndex, end);
    this.viewport.style.transform = `translateY(${this.startIndex * this.itemHeight}px)`;
    this.viewport.innerHTML = slice.map(item => this.renderFn(item)).join('');
  }
  update(items) {
    this.items = items;
    if (this.spacer) this.spacer.style.height = (items.length * this.itemHeight) + 'px';
    this.render();
  }
  destroy() {
    if (this.container) this.container.removeEventListener('scroll', this._bound);
  }
}

/* ── Advanced Offline Cache ────────────────────────────────── */
const NabdhCache = {
  _store: {},
  set(key, value, ttl = 300000) {
    this._store[key] = { value, expires: Date.now() + ttl };
    try { localStorage.setItem('nabdh_cache_' + key, JSON.stringify({ value, expires: Date.now() + ttl })); } catch(e) {}
  },
  get(key) {
    // Memory first
    if (this._store[key] && Date.now() < this._store[key].expires) return this._store[key].value;
    // LocalStorage fallback
    try {
      const raw = localStorage.getItem('nabdh_cache_' + key);
      if (raw) {
        const item = JSON.parse(raw);
        if (Date.now() < item.expires) { this._store[key] = item; return item.value; }
        localStorage.removeItem('nabdh_cache_' + key);
      }
    } catch(e) {}
    return null;
  },
  del(key) {
    delete this._store[key];
    try { localStorage.removeItem('nabdh_cache_' + key); } catch(e) {}
  },
  clear() {
    this._store = {};
    try {
      Object.keys(localStorage).filter(k => k.startsWith('nabdh_cache_')).forEach(k => localStorage.removeItem(k));
    } catch(e) {}
  }
};

/* ── Smart Fetch with Cache ────────────────────────────────── */
async function smartFetch(url, opts = {}) {
  const cacheKey = url;
  const ttl = opts.ttl || 30000;
  const forceRefresh = opts.forceRefresh || false;
  if (!forceRefresh) {
    const cached = NabdhCache.get(cacheKey);
    if (cached) return cached;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    NabdhCache.set(cacheKey, data, ttl);
    return data;
  } catch(e) {
    const stale = NabdhCache.get(cacheKey + '_stale');
    if (stale) return stale;
    throw e;
  }
}

/* ── Pull to Refresh ───────────────────────────────────────── */
function initPullToRefresh(containerId, onRefresh) {
  const el = document.getElementById(containerId) || document.getElementById('content');
  if (!el) return;
  let startY = 0, pulling = false, indicator = null;

  const getIndicator = () => {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'ptr-indicator';
      indicator.innerHTML = '<span class="ptr-icon">↓</span><span class="ptr-text">اسحب للتحديث</span>';
      el.parentNode.insertBefore(indicator, el);
    }
    return indicator;
  };

  el.addEventListener('touchstart', e => {
    if (el.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 20) {
      const ind = getIndicator();
      ind.style.height = Math.min(dy, 70) + 'px';
      ind.style.opacity = Math.min(dy / 70, 1);
      if (dy > 60) {
        ind.querySelector('.ptr-text').textContent = 'ارفع للتحديث';
        ind.querySelector('.ptr-icon').textContent = '↑';
      }
    }
  }, { passive: true });

  el.addEventListener('touchend', async e => {
    if (!pulling || !indicator) return;
    pulling = false;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 60) {
      indicator.querySelector('.ptr-text').textContent = 'جاري التحديث...';
      indicator.querySelector('.ptr-icon').innerHTML = '<div class="ptr-spinner"></div>';
      try { await onRefresh(); } catch(e) {}
    }
    if (indicator) { indicator.style.height = '0'; indicator.style.opacity = '0'; }
    setTimeout(() => { if (indicator) { indicator.remove(); indicator = null; } }, 300);
  }, { passive: true });
}

/* ── Intersection Observer for Lazy Loading ────────────────── */
const lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      if (el.dataset.src) {
        el.src = el.dataset.src;
        el.removeAttribute('data-src');
        el.classList.add('lazy-loaded');
        lazyObserver.unobserve(el);
      }
      if (el.dataset.bg) {
        el.style.backgroundImage = `url(${el.dataset.bg})`;
        el.removeAttribute('data-bg');
        lazyObserver.unobserve(el);
      }
    }
  });
}, { rootMargin: '200px', threshold: 0.01 });

function observeLazy(container) {
  const imgs = (container || document).querySelectorAll('[data-src],[data-bg]');
  imgs.forEach(img => lazyObserver.observe(img));
}

/* ── Animated Number Counter ───────────────────────────────── */
function animateNumber(el, target, duration = 1200, prefix = '', suffix = '') {
  if (!el) return;
  const start = parseInt(el.textContent.replace(/\D/g, '')) || 0;
  const diff = target - start;
  if (diff === 0) return;
  const startTime = performance.now();
  const step = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(start + diff * eased);
    el.textContent = prefix + current.toLocaleString('ar-EG') + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── Enhanced Toast Notifications ─────────────────────────── */
const ToastQueue = [];
let toastTimer = null;
function showEnhancedToast(msg, type = 'info', duration = 3500) {
  const types = {
    success: { icon: '✅', class: 'toast-success' },
    error:   { icon: '❌', class: 'toast-error' },
    warning: { icon: '⚠️', class: 'toast-warning' },
    info:    { icon: 'ℹ️', class: 'toast-info' }
  };
  const t = types[type] || types.info;
  const toast = document.createElement('div');
  toast.className = `enhanced-toast ${t.class}`;
  toast.innerHTML = `<span class="toast-icon">${t.icon}</span><span class="toast-msg">${escHtml(msg)}</span>`;
  toast.onclick = () => toast.remove();

  const container = document.getElementById('toastContainer') || document.body;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
// Override default showToast
window.showToast = showEnhancedToast;

/* ── Haptic Feedback ───────────────────────────────────────── */
function haptic(type = 'light') {
  if (!navigator.vibrate) return;
  const patterns = { light: [10], medium: [20], heavy: [30, 10, 30], success: [10, 5, 10], error: [50, 10, 50] };
  navigator.vibrate(patterns[type] || [10]);
}

/* ── Connection Quality Monitor ────────────────────────────── */
const ConnectionMonitor = {
  quality: 'good',
  _handlers: [],
  init() {
    if (navigator.connection) {
      const update = () => {
        const c = navigator.connection;
        const rtt = c.rtt || 100;
        this.quality = rtt < 100 ? 'excellent' : rtt < 300 ? 'good' : rtt < 700 ? 'fair' : 'poor';
        this._handlers.forEach(h => h(this.quality));
        const badge = document.getElementById('connectionBadge');
        if (badge) {
          badge.className = `conn-badge conn-${this.quality}`;
          badge.title = `جودة الاتصال: ${this.quality}`;
        }
      };
      navigator.connection.addEventListener('change', update);
      update();
    }
    window.addEventListener('online', () => {
      this.quality = 'good';
      showEnhancedToast('🌐 عاد الاتصال بالإنترنت', 'success');
      loadStats(); loadAlerts();
    });
    window.addEventListener('offline', () => {
      this.quality = 'offline';
      showEnhancedToast('📴 لا يوجد اتصال بالإنترنت', 'warning', 5000);
    });
  },
  onChange(fn) { this._handlers.push(fn); }
};

/* ── Smart Search with Debounce ────────────────────────────── */
let _searchTimer = null;
function smartSearch(query, callback, delay = 400) {
  clearTimeout(_searchTimer);
  if (!query || query.trim().length < 2) { callback(null); return; }
  _searchTimer = setTimeout(async () => {
    try {
      const data = await smartFetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { ttl: 15000 });
      callback(data);
    } catch(e) { callback(null); }
  }, delay);
}

/* ── Scroll to Top Button ──────────────────────────────────── */
function initScrollToTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  const content = document.getElementById('content');
  if (!content) return;
  const handleScroll = throttle(() => {
    if (content.scrollTop > 300) btn.classList.add('show');
    else btn.classList.remove('show');
  }, 100);
  content.addEventListener('scroll', handleScroll, { passive: true });
  btn.addEventListener('click', () => {
    content.scrollTo({ top: 0, behavior: 'smooth' });
    haptic('light');
  });
}

/* ── Enhanced App Stats ────────────────────────────────────── */
async function loadEnhancedStats() {
  try {
    const data = await smartFetch('/api/dashboard/full', { ttl: 30000 });
    if (data.stats) {
      const s = data.stats;
      animateNumber(document.getElementById('hUsers'), s.online || 0);
      animateNumber(document.getElementById('hReports'), s.reports || 0);
      animateNumber(document.getElementById('hLives'), s.lives_saved || 0);
      animateNumber(document.getElementById('hCities'), s.cities || 0);

      // Top bar quick stats
      const liveEl = document.getElementById('liveUsers');
      const repEl = document.getElementById('liveReports');
      if (liveEl) liveEl.textContent = (s.online || 0).toLocaleString('ar-EG');
      if (repEl) repEl.textContent = (s.reports || 0).toLocaleString('ar-EG');

      // Update online count
      const onlineBig = document.getElementById('onlineCountBig');
      if (onlineBig) animateNumber(onlineBig, s.online || 0);
    }
    if (data.top_areas && data.top_areas.length) {
      updateTopAreasBar(data.top_areas);
    }
  } catch(e) { /* silent fail */ }
}

function updateTopAreasBar(areas) {
  const el = document.getElementById('topAreasList');
  if (!el) return;
  el.innerHTML = areas.map((a, i) =>
    `<div class="top-area-item" onclick="filterByArea('${escHtml(a.area)}')">
      <span class="ta-rank">#${i+1}</span>
      <span class="ta-name">${escHtml(a.area)}</span>
      <span class="ta-count">${a.count}</span>
    </div>`
  ).join('');
}

/* ── Filter by Area ────────────────────────────────────────── */
function filterByArea(area) {
  const input = document.getElementById('alertFilterArea') || document.getElementById('filterArea');
  if (input) { input.value = area; input.dispatchEvent(new Event('input')); }
  goSection('home');
  showEnhancedToast(`🗺️ تصفية حسب: ${area}`, 'info');
}

/* ── Weather Widget ────────────────────────────────────────── */
async function loadWeatherWidget() {
  const el = document.getElementById('weatherWidget');
  if (!el) return;
  const city = userCity || 'الخرطوم';
  try {
    const w = await smartFetch(`/api/weather/${encodeURIComponent(city)}`, { ttl: 300000 });
    el.innerHTML = `
      <div class="weather-mini">
        <span class="weather-icon">${w.icon || '☀️'}</span>
        <span class="weather-temp">${w.temp}°</span>
        <span class="weather-cond">${escHtml(w.condition)}</span>
        <span class="weather-city">${escHtml(w.area)}</span>
      </div>`;
    el.style.display = 'block';
  } catch(e) { el.style.display = 'none'; }
}

/* ── Prayer Times Widget ───────────────────────────────────── */
async function loadPrayerWidget() {
  const el = document.getElementById('prayerWidget');
  if (!el) return;
  try {
    const lat = userLat || 15.5;
    const lng = userLng || 32.5;
    const p = await smartFetch(`/api/prayer/${lat}/${lng}`, { ttl: 3600000 });
    if (!p.prayers) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const nextPrayer = Object.entries(p.prayers).find(([, t]) => t > timeStr);
    if (nextPrayer) {
      el.innerHTML = `<div class="prayer-mini">🕌 ${nextPrayer[0] === 'fajr' ? 'الفجر' : nextPrayer[0] === 'dhuhr' ? 'الظهر' : nextPrayer[0] === 'asr' ? 'العصر' : nextPrayer[0] === 'maghrib' ? 'المغرب' : 'العشاء'}: ${nextPrayer[1]}</div>`;
    }
  } catch(e) {}
}

/* ── Enhanced Leaderboard ──────────────────────────────────── */
async function loadEnhancedLeaderboard() {
  const el = document.getElementById('leaderboardList') || document.getElementById('weeklyLeaderboard');
  if (!el) return;
  el.innerHTML = skeletonList(5);
  try {
    const data = await smartFetch('/api/leaderboard', { ttl: 60000 });
    if (!data.board || !data.board.length) {
      el.innerHTML = emptyState('🏆 لا توجد بيانات بعد');
      return;
    }
    el.innerHTML = data.board.slice(0, 10).map((u, i) => `
      <div class="leader-item ${i < 3 ? 'leader-top' : ''}">
        <span class="leader-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i+1)}</span>
        <span class="leader-avatar">${u.avatar || '👤'}</span>
        <div class="leader-info">
          <div class="leader-name">${escHtml(u.name)}</div>
          <div class="leader-area">${escHtml(u.area || '')}</div>
        </div>
        <div class="leader-stats">
          <span class="leader-pts">${(u.points || 0).toLocaleString('ar-EG')} نقطة</span>
          <span class="leader-badge">${(u.badges || []).join(' ')}</span>
        </div>
      </div>`).join('');
  } catch(e) { el.innerHTML = emptyState('❌ تعذر التحميل'); }
}

/* ── Blood Bank Stats ──────────────────────────────────────── */
async function loadBloodStats() {
  const el = document.getElementById('bloodStats');
  if (!el) return;
  try {
    const data = await smartFetch('/api/blood/stats', { ttl: 120000 });
    if (!data.stats) return;
    const bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
    el.innerHTML = `<div class="blood-stats-grid">${
      bloodTypes.map(t => `
        <div class="blood-type-card ${(data.stats[t] || 0) > 0 ? 'blood-available' : 'blood-empty'}">
          <span class="bt-type">${t}</span>
          <span class="bt-count">${data.stats[t] || 0}</span>
        </div>`).join('')
    }</div><div class="blood-total">إجمالي المتبرعين: ${data.total}</div>`;
  } catch(e) {}
}

/* ── Trending Topics ───────────────────────────────────────── */
async function loadTrendingTopics() {
  const el = document.getElementById('trendingList');
  if (!el) return;
  try {
    const data = await smartFetch('/api/trending', { ttl: 120000 });
    if (!data.items || !data.items.length) {
      el.innerHTML = emptyState('📊 لا توجد مواضيع رائجة');
      return;
    }
    el.innerHTML = data.items.slice(0, 5).map((item, i) => `
      <div class="trending-item" onclick="handleTrendingClick('${item.type}','${item.id}')">
        <span class="tr-rank">#${i+1}</span>
        <span class="tr-icon">${escHtml(item.icon || '🔥')}</span>
        <div class="tr-info">
          <div class="tr-title">${escHtml((item.title || '').substring(0, 50))}</div>
          <div class="tr-meta">${escHtml(item.area || '')} • ${escHtml(timeAgo(item.time))}</div>
        </div>
        <span class="tr-score">${item.score || ''}</span>
      </div>`).join('');
  } catch(e) { el.innerHTML = emptyState('❌ تعذر التحميل'); }
}

function handleTrendingClick(type, id) {
  if (type === 'alert') goSection('home');
  else if (type === 'market') goSection('market');
  else if (type === 'voice') goSection('voice');
  else if (type === 'news') goSection('news');
}

/* ── Enhanced Exchange Rate Display ────────────────────────── */
async function loadEnhancedExchange() {
  const el = document.getElementById('exchangeList') || document.getElementById('homeRateNum');
  try {
    const data = await smartFetch('/api/exchange', { ttl: 60000 });
    const rates = data.rates || data;
    if (!rates || !rates.length) return;
    const latest = rates[0];
    if (el && el.id === 'homeRateNum') {
      el.textContent = (latest.sdg || latest.rate || '---');
    }
    // Update top bar rate
    const rateEl = document.getElementById('liveRate');
    if (rateEl && latest) rateEl.textContent = (latest.sdg || latest.rate || '---') + ' ج.س';
  } catch(e) {}
}

/* ── Polls Quick View ──────────────────────────────────────── */
async function loadActivePolls() {
  const el = document.getElementById('activePollsList');
  if (!el) return;
  el.innerHTML = skeletonList(3);
  try {
    const data = await smartFetch('/api/polls/active', { ttl: 60000 });
    if (!data.polls || !data.polls.length) { el.innerHTML = emptyState('📊 لا توجد استطلاعات'); return; }
    el.innerHTML = data.polls.slice(0, 3).map(p => `
      <div class="poll-mini-card" onclick="goSection('polls')">
        <div class="poll-q">${escHtml(p.question || p.text || '').substring(0, 60)}</div>
        <div class="poll-meta">${p.totalVotes || 0} صوت • ${escHtml(timeAgo(p.time))}</div>
      </div>`).join('');
  } catch(e) { el.innerHTML = ''; }
}

/* ── Help Requests Urgent Banner ───────────────────────────── */
async function checkUrgentHelp() {
  try {
    const data = await smartFetch('/api/help/urgent', { ttl: 60000 });
    if (data.count > 0) {
      const banner = document.getElementById('urgentHelpBanner');
      if (banner) {
        banner.innerHTML = `⚠️ ${data.count} طلب مساعدة عاجل - <a onclick="goSection('help')" style="cursor:pointer;text-decoration:underline">عرض الآن</a>`;
        banner.style.display = 'block';
      }
    }
  } catch(e) {}
}

/* ── Online Users Map ──────────────────────────────────────── */
async function updateOnlineUsersOnMap() {
  if (currentSection !== 'map') return;
  try {
    const data = await smartFetch('/api/users/map', { ttl: 15000 });
    if (!data.users || !map) return;
    // Already handled by socket nearby_users, but fallback
    data.users.forEach(u => {
      if (u.lat && u.lng) {
        const icon = L.divIcon({ className: 'user-map-dot', html: '👤', iconSize: [20, 20] });
        L.marker([u.lat, u.lng], { icon }).bindPopup(`<b>${escHtml(u.name)}</b><br>${escHtml(u.area || '')}`).addTo(map);
      }
    });
  } catch(e) {}
}

/* ── Service Worker Message Handler ────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    const { type, payload } = event.data || {};
    if (type === 'NEW_ALERT') {
      showEnhancedToast(`🔔 ${payload?.msg || 'تنبيه جديد'}`, 'info');
      haptic('medium');
    }
    if (type === 'SYNC_COMPLETE') {
      NabdhCache.clear();
      loadStats(); loadAlerts();
    }
  });
}

/* ── Page Visibility API ───────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Refresh when user comes back
    setTimeout(() => {
      loadEnhancedStats();
      loadAlerts();
      if (currentSection === 'exchange') loadEnhancedExchange();
      if (currentSection === 'dashboard') loadDashboard();
    }, 500);
  }
});

/* ── Idle Prefetch ─────────────────────────────────────────── */
function prefetchOnIdle() {
  const prefetch = () => {
    smartFetch('/api/prefetch', { ttl: 300000 }).catch(() => {});
    smartFetch('/api/stats/quick', { ttl: 30000 }).catch(() => {});
    smartFetch('/api/trending', { ttl: 120000 }).catch(() => {});
  };
  if ('requestIdleCallback' in window) requestIdleCallback(prefetch, { timeout: 5000 });
  else setTimeout(prefetch, 3000);
}

/* ── Share Content ─────────────────────────────────────────── */
async function shareContent(title, text, url) {
  const shareUrl = url || getAppUrl();
  if (navigator.share) {
    try { await navigator.share({ title, text, url: shareUrl }); haptic('success'); return true; }
    catch(e) {}
  }
  try {
    await navigator.clipboard.writeText(`${title}\n${text}\n${shareUrl}`);
    showEnhancedToast('📋 تم نسخ الرابط', 'success');
    return true;
  } catch(e) {
    showEnhancedToast('❌ تعذر المشاركة', 'error');
    return false;
  }
}

/* ── Copy to Clipboard ─────────────────────────────────────── */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showEnhancedToast('✅ تم النسخ', 'success', 2000);
    haptic('light');
  } catch(e) {
    showEnhancedToast('❌ تعذر النسخ', 'error');
  }
}

/* ── Image Viewer ──────────────────────────────────────────── */
function openImageViewer(src, caption = '') {
  const existing = document.getElementById('imgViewerOverlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'imgViewerOverlay';
  overlay.className = 'img-viewer-overlay';
  overlay.innerHTML = `
    <button class="img-viewer-close" onclick="this.closest('#imgViewerOverlay').remove()">✕</button>
    <img src="${escHtml(src)}" class="img-viewer-img" alt="${escHtml(caption)}" loading="lazy">
    ${caption ? `<div class="img-viewer-caption">${escHtml(caption)}</div>` : ''}
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  requestAnimationFrame(() => overlay.classList.add('show'));
}

/* ── Format File Size ──────────────────────────────────────── */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ── Date Formatter ────────────────────────────────────────── */
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}
function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

/* ── Quick Stats for Top Bar ───────────────────────────────── */
async function loadTopBarStats() {
  try {
    const data = await smartFetch('/api/stats/quick', { ttl: 20000 });
    const rateEl = document.getElementById('liveRate');
    const usersEl = document.getElementById('liveUsers');
    const reportsEl = document.getElementById('liveReports');
    if (rateEl && data.rate) rateEl.textContent = data.rate;
    if (usersEl && data.online !== undefined) usersEl.textContent = data.online.toLocaleString('ar-EG');
    if (reportsEl && data.reports !== undefined) reportsEl.textContent = data.reports.toLocaleString('ar-EG');
  } catch(e) {}
}

/* ── Keyboard Navigation ───────────────────────────────────── */
function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    const shortcuts = {
      'h': () => goSection('home'),
      'm': () => goSection('map'),
      'p': () => goSection('people'),
      'e': () => goSection('exchange'),
      'r': () => goSection('report'),
    };
    if (!e.ctrlKey && !e.altKey && !e.metaKey && shortcuts[e.key]) {
      shortcuts[e.key]();
    }
  });
}

/* ── Swipe Navigation ──────────────────────────────────────── */
function initSwipeNav() {
  let xStart = null;
  const sections = ['home', 'map', 'report', 'people', 'messages'];
  document.addEventListener('touchstart', e => { xStart = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (xStart === null) return;
    const diff = xStart - e.changedTouches[0].clientX;
    xStart = null;
    if (Math.abs(diff) < 80) return;
    const idx = sections.indexOf(currentSection);
    if (diff > 0 && idx < sections.length - 1) goSection(sections[idx + 1]);
    else if (diff < 0 && idx > 0) goSection(sections[idx - 1]);
  }, { passive: true });
}

/* ── Adaptive Refresh Rate ─────────────────────────────────── */
const AdaptiveRefresh = {
  _intervals: {},
  set(key, fn, baseMsec) {
    this.clear(key);
    const ms = ConnectionMonitor.quality === 'poor' ? baseMsec * 3 :
               ConnectionMonitor.quality === 'fair' ? baseMsec * 1.5 : baseMsec;
    this._intervals[key] = setInterval(fn, ms);
  },
  clear(key) {
    if (this._intervals[key]) { clearInterval(this._intervals[key]); delete this._intervals[key]; }
  }
};

/* ── Network Monitor Integration ───────────────────────────── */
ConnectionMonitor.onChange(() => {
  AdaptiveRefresh.set('stats', loadTopBarStats, 20000);
  AdaptiveRefresh.set('alerts', loadAlerts, 30000);
});

/* ── Initialize All v7.1 Features ─────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI enhancements
  setTimeout(() => {
    initScrollToTop();
    initKeyboardNav();
    initSwipeNav();
    ConnectionMonitor.init();
    prefetchOnIdle();
    loadTopBarStats();
    loadEnhancedStats();
    loadTrendingTopics();
    loadWeatherWidget();
    loadPrayerWidget();
    checkUrgentHelp();
    observeLazy(document);
  }, 1000);

  // Setup adaptive refresh
  AdaptiveRefresh.set('stats', loadTopBarStats, 20000);
  AdaptiveRefresh.set('enhanced_stats', loadEnhancedStats, 30000);
  AdaptiveRefresh.set('trending', loadTrendingTopics, 120000);
  AdaptiveRefresh.set('weather', loadWeatherWidget, 300000);

  // PTR on main content
  const content = document.getElementById('content');
  if (content) {
    initPullToRefresh('content', async () => {
      await Promise.all([loadStats(), loadAlerts(), loadTopBarStats()]);
      showEnhancedToast('✅ تم التحديث', 'success', 2000);
    });
  }
});

