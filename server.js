const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const compression = require('compression');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 10 * 1024 * 1024  // 10MB for media
});

/* ─── Performance: Gzip compression ─── */
app.use(compression({ level: 6, threshold: 1024 }));

/* ─── Security headers ─── */
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ─── Simple in-memory rate limiting ─── */
const _rateLimits = {};
function rateLimit(maxReqs, windowMs) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    if (!_rateLimits[key]) _rateLimits[key] = { count: 0, reset: now + windowMs };
    if (now > _rateLimits[key].reset) { _rateLimits[key] = { count: 0, reset: now + windowMs }; }
    _rateLimits[key].count++;
    if (_rateLimits[key].count > maxReqs) {
      return res.status(429).json({ error: 'طلبات كثيرة، حاول بعد قليل' });
    }
    next();
  };
}
// Clean rate limit map every 5 min
setInterval(() => {
  const now = Date.now();
  Object.keys(_rateLimits).forEach(k => { if (_rateLimits[k].reset < now) delete _rateLimits[k]; });
}, 5 * 60 * 1000);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* ─── Response time header ─── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    try {
      if (!res.headersSent) res.set('X-Response-Time', (Date.now() - start) + 'ms');
    } catch(e) { /* ignore */ }
  });
  next();
});

// Static files - but sw.js must not be cached
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Service-Worker-Allowed', '/');
    } else if (filePath.match(/\.(css|js)$/)) {
      res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    } else if (filePath.match(/\.(png|jpg|svg|ico|webp|woff2?)$/)) {
      res.set('Cache-Control', 'public, max-age=604800');
    }
  }
}));

/* ============================================================
   قاعدة بيانات المناطق الجغرافية الشاملة
   ============================================================ */
const GEO = {
  sudan: [
    { state:'الخرطوم', lat:15.5007, lng:32.5599, cities:[
      { name:'الخرطوم',    lat:15.5007, lng:32.5599, hoods:['الرياض','العمارات','الموردة','الديوم','حي العرب','السجانة','الطائف','المنطقة الصناعية','الخرطوم 2','بري','الكلاكلة','مايو','جبرة','المقرن','الصحافة','الهجرة','الثورة','النيل الأزرق','كلاكلة','عرب حرة','القرشي','حارة بيضاء'] },
      { name:'أم درمان',   lat:15.6447, lng:32.4776, hoods:['السوق الشعبي','الثورة','أبو روف','الملازمين','أبو سيد','المولية','الصحافة','ود نوباوي','الثورة الخضراء','البوستة','حي المهندسين','كرري الجنوبية','دار السلام','العليافة'] },
      { name:'بحري',       lat:15.6024, lng:32.5533, hoods:['كافوري','الحلفايا','شمبات','الجريف غرب','الحاج يوسف','الصافية','تمبول','شبشة','السجانة','الدرجة الثانية','بورتسودان'] },
      { name:'كرري',       lat:15.6950, lng:32.4600, hoods:['كرري','سوبا','ود البشير','الملازمين','اليرموك','كرري الشمالية'] },
      { name:'جبل أولياء', lat:15.3500, lng:32.4800, hoods:['جبل أولياء','مناقل','الشهيد الزبير','الفتيحاب'] },
      { name:'أم بدة',     lat:15.6200, lng:32.4000, hoods:['أم بدة','السكة حديد','البقعة','السلمة'] },
      { name:'الشجرة',     lat:15.5500, lng:32.5800, hoods:['الشجرة','الصافية','المنطقة الصناعية'] },
    ]},
    { state:'الجزيرة', lat:14.4000, lng:33.5000, cities:[
      { name:'مدني',           lat:14.4000, lng:33.5000, hoods:['وسط مدني','الحي الجديد','الصناعية','المطار','حي العمال','حي المحكمة','حي الجراية'] },
      { name:'رفاعة',          lat:14.7100, lng:33.2700, hoods:['وسط رفاعة','الشرق','الغرب'] },
      { name:'الحصاحيصا',      lat:14.6500, lng:33.3200, hoods:[] },
      { name:'كمبوني',         lat:14.4500, lng:33.5500, hoods:[] },
      { name:'الجعلية',        lat:15.3500, lng:33.1000, hoods:[] },
      { name:'الكاملين',       lat:14.2600, lng:33.3000, hoods:[] },
    ]},
    { state:'نهر النيل', lat:17.5500, lng:33.9700, cities:[
      { name:'عطبرة',    lat:17.6900, lng:34.0000, hoods:['وسط عطبرة','الصناعية','الشرق','الغرب'] },
      { name:'شندي',     lat:16.6900, lng:33.4300, hoods:['وسط شندي','الحصباي','الكبوشية'] },
      { name:'البربر',   lat:18.0200, lng:33.9700, hoods:[] },
      { name:'أبو حمد',  lat:19.5200, lng:33.3300, hoods:[] },
      { name:'الدامر',   lat:17.5500, lng:33.9700, hoods:[] },
      { name:'مروي',     lat:18.4700, lng:31.8200, hoods:[] },
    ]},
    { state:'الشمالية', lat:19.6200, lng:30.4200, cities:[
      { name:'دنقلا',     lat:19.1700, lng:30.4800, hoods:['وسط دنقلا','الزياده','الشلاق'] },
      { name:'كريمة',     lat:18.5500, lng:31.8500, hoods:[] },
      { name:'مروي',      lat:18.4700, lng:31.8200, hoods:[] },
      { name:'وادي حلفا', lat:21.7900, lng:31.3400, hoods:[] },
      { name:'أبري',      lat:20.7900, lng:30.3500, hoods:[] },
      { name:'دلقو',      lat:18.6500, lng:30.8000, hoods:[] },
    ]},
    { state:'كسلا', lat:15.4500, lng:36.4000, cities:[
      { name:'كسلا',           lat:15.4500, lng:36.4000, hoods:['وسط كسلا','الغرب','الشرق','ريفي'] },
      { name:'حلفا الجديدة',   lat:15.3000, lng:36.2000, hoods:[] },
      { name:'تسني',           lat:14.7500, lng:36.7500, hoods:[] },
      { name:'بورتسودان',      lat:19.6200, lng:37.2200, hoods:['شرق','غرب','الميناء','الضباب'] },
      { name:'القضارف',        lat:14.0300, lng:35.8900, hoods:[] },
    ]},
    { state:'القضارف', lat:14.0300, lng:35.8900, cities:[
      { name:'القضارف', lat:14.0300, lng:35.8900, hoods:['وسط القضارف','الشمال','الجنوب','الحديد'] },
      { name:'الفاو',   lat:13.6400, lng:35.7700, hoods:[] },
      { name:'دوكة',    lat:14.5000, lng:35.9000, hoods:[] },
      { name:'باسندة',  lat:14.2000, lng:35.5000, hoods:[] },
    ]},
    { state:'سنار', lat:13.5500, lng:33.5700, cities:[
      { name:'سنجة',   lat:13.5500, lng:33.5700, hoods:[] },
      { name:'الدندر', lat:12.8000, lng:34.0000, hoods:[] },
      { name:'سنار',   lat:13.5600, lng:33.5600, hoods:[] },
      { name:'الرهد',  lat:13.1000, lng:33.2000, hoods:[] },
    ]},
    { state:'النيل الأبيض', lat:13.1600, lng:32.6600, cities:[
      { name:'كوستي',  lat:13.1600, lng:32.6600, hoods:['وسط كوستي','الجنوب','الشمال','ريفي'] },
      { name:'ربك',    lat:12.4100, lng:31.8700, hoods:[] },
      { name:'الكوة',  lat:13.8200, lng:32.2600, hoods:[] },
      { name:'الدويم',  lat:14.0000, lng:32.5000, hoods:[] },
    ]},
    { state:'النيل الأزرق', lat:11.8700, lng:34.3800, cities:[
      { name:'الدمازين',  lat:11.7900, lng:34.3600, hoods:['وسط الدمازين','الصناعية'] },
      { name:'الروصيرص', lat:11.8700, lng:34.3800, hoods:[] },
      { name:'الكرمك',   lat:11.5500, lng:33.8500, hoods:[] },
    ]},
    { state:'جنوب كردفان', lat:11.0000, lng:29.7000, cities:[
      { name:'كادوقلي',    lat:11.0100, lng:29.7100, hoods:[] },
      { name:'الدلنج',     lat:11.5500, lng:29.7000, hoods:[] },
      { name:'أبو جبيهة', lat:11.5700, lng:31.2700, hoods:[] },
      { name:'الرشاد',    lat:11.8500, lng:30.6500, hoods:[] },
      { name:'هيبان',     lat:11.3500, lng:29.9500, hoods:[] },
    ]},
    { state:'شمال كردفان', lat:13.1800, lng:30.2200, cities:[
      { name:'الأبيض',    lat:13.1800, lng:30.2200, hoods:['وسط الأبيض','الحاج يوسف','الصناعية','الربيع','الفيحاء'] },
      { name:'بارا',      lat:13.7000, lng:30.3700, hoods:[] },
      { name:'أم روابة',  lat:12.9100, lng:31.2200, hoods:[] },
      { name:'الخوي',     lat:13.0500, lng:29.6500, hoods:[] },
      { name:'السودري',   lat:13.8500, lng:29.6000, hoods:[] },
    ]},
    { state:'غرب كردفان', lat:12.1900, lng:29.4100, cities:[
      { name:'الفولة',   lat:11.7200, lng:28.3500, hoods:[] },
      { name:'أبو زبد',  lat:12.1900, lng:29.4100, hoods:[] },
      { name:'العتيبة',  lat:12.7500, lng:29.1000, hoods:[] },
    ]},
    { state:'شمال دارفور', lat:13.8500, lng:24.8900, cities:[
      { name:'الفاشر',   lat:13.6300, lng:25.3400, hoods:['وسط الفاشر','الشرق','الغرب','الجنوب'] },
      { name:'مليط',     lat:15.0900, lng:25.8500, hoods:[] },
      { name:'كبكابية',  lat:13.9100, lng:24.1500, hoods:[] },
      { name:'كتم',      lat:15.0000, lng:24.6500, hoods:[] },
    ]},
    { state:'جنوب دارفور', lat:11.3000, lng:24.9000, cities:[
      { name:'نيالا',   lat:12.0500, lng:24.8800, hoods:['وسط نيالا','الشرق','الغرب','الجنوب','التجارية'] },
      { name:'كاس',     lat:11.6100, lng:24.6300, hoods:[] },
      { name:'الضعين',  lat:11.4600, lng:26.1200, hoods:[] },
      { name:'عد الفرسان',lat:12.8000, lng:25.0000, hoods:[] },
    ]},
    { state:'غرب دارفور', lat:13.0000, lng:22.8000, cities:[
      { name:'الجنينة', lat:13.4500, lng:22.4500, hoods:['وسط الجنينة','الشرق','الغرب'] },
      { name:'كرنوي',   lat:13.1400, lng:22.9000, hoods:[] },
      { name:'بيضة',    lat:12.3000, lng:22.6000, hoods:[] },
    ]},
    { state:'وسط دارفور', lat:12.8500, lng:24.3300, cities:[
      { name:'زالنجي',   lat:12.9100, lng:23.4700, hoods:[] },
      { name:'نيرتيتي',  lat:12.7000, lng:24.1000, hoods:[] },
    ]},
    { state:'شرق دارفور', lat:11.8000, lng:26.1000, cities:[
      { name:'الضعين',      lat:11.4600, lng:26.1200, hoods:[] },
      { name:'عد الفرسان',  lat:12.7800, lng:27.5000, hoods:[] },
      { name:'أبو كارنكا',  lat:12.2000, lng:26.8000, hoods:[] },
    ]},
    { state:'البحر الأحمر', lat:19.6200, lng:37.2200, cities:[
      { name:'بورتسودان', lat:19.6200, lng:37.2200, hoods:['شرق بورتسودان','غرب بورتسودان','الميناء','الدرجة الثانية','حي المديرية'] },
      { name:'سواكن',     lat:19.1100, lng:37.3300, hoods:[] },
      { name:'هيا',       lat:18.3300, lng:36.3900, hoods:[] },
      { name:'طوكر',      lat:18.4500, lng:37.7000, hoods:[] },
    ]},
  ],

  world: [
    // الدول العربية
    { name:'مصر',             lat:30.0444,  lng:31.2357,  region:'عربي' },
    { name:'السعودية',         lat:24.6877,  lng:46.7219,  region:'عربي' },
    { name:'الإمارات',         lat:24.4539,  lng:54.3773,  region:'عربي' },
    { name:'الكويت',           lat:29.3759,  lng:47.9774,  region:'عربي' },
    { name:'قطر',              lat:25.2854,  lng:51.5310,  region:'عربي' },
    { name:'البحرين',          lat:26.2235,  lng:50.5876,  region:'عربي' },
    { name:'عُمان',            lat:23.5880,  lng:58.3829,  region:'عربي' },
    { name:'اليمن',            lat:15.3694,  lng:44.1910,  region:'عربي' },
    { name:'ليبيا',            lat:32.9028,  lng:13.1805,  region:'عربي' },
    { name:'تونس',             lat:36.8190,  lng:10.1658,  region:'عربي' },
    { name:'الجزائر',          lat:36.7372,  lng:3.0865,   region:'عربي' },
    { name:'المغرب',           lat:34.0209,  lng:-6.8416,  region:'عربي' },
    { name:'موريتانيا',        lat:18.0735,  lng:-15.9582, region:'عربي' },
    { name:'الصومال',          lat:2.0469,   lng:45.3182,  region:'عربي' },
    { name:'العراق',           lat:33.3152,  lng:44.3661,  region:'عربي' },
    { name:'سوريا',            lat:33.5102,  lng:36.2913,  region:'عربي' },
    { name:'لبنان',            lat:33.8886,  lng:35.4955,  region:'عربي' },
    { name:'الأردن',           lat:31.9522,  lng:35.9333,  region:'عربي' },
    { name:'فلسطين',           lat:31.7683,  lng:35.2137,  region:'عربي' },
    { name:'جزر القمر',        lat:-11.6455, lng:43.3333,  region:'عربي' },
    { name:'جيبوتي',           lat:11.5720,  lng:43.1456,  region:'عربي' },
    // أفريقيا
    { name:'إثيوبيا',          lat:9.0320,   lng:38.7469,  region:'أفريقيا' },
    { name:'إريتريا',          lat:15.3229,  lng:38.9251,  region:'أفريقيا' },
    { name:'كينيا',            lat:-1.2921,  lng:36.8219,  region:'أفريقيا' },
    { name:'تشاد',             lat:12.1348,  lng:15.0557,  region:'أفريقيا' },
    { name:'نيجيريا',          lat:9.0579,   lng:7.4951,   region:'أفريقيا' },
    { name:'غانا',             lat:5.6037,   lng:-0.1870,  region:'أفريقيا' },
    { name:'جنوب أفريقيا',     lat:-25.7461, lng:28.1881,  region:'أفريقيا' },
    { name:'أوغندا',           lat:0.3476,   lng:32.5825,  region:'أفريقيا' },
    { name:'تنزانيا',          lat:-6.7924,  lng:39.2083,  region:'أفريقيا' },
    { name:'الكاميرون',        lat:3.8480,   lng:11.5021,  region:'أفريقيا' },
    { name:'رواندا',           lat:-1.9403,  lng:29.8739,  region:'أفريقيا' },
    { name:'زيمبابوي',         lat:-17.8252, lng:31.0335,  region:'أفريقيا' },
    { name:'موزمبيق',          lat:-18.6657, lng:35.5296,  region:'أفريقيا' },
    { name:'السنغال',          lat:14.4974,  lng:-14.4524, region:'أفريقيا' },
    { name:'مالي',             lat:17.5707,  lng:-3.9962,  region:'أفريقيا' },
    { name:'النيجر',           lat:17.6078,  lng:8.0817,   region:'أفريقيا' },
    { name:'بوركينا فاسو',     lat:12.3640,  lng:-1.5330,  region:'أفريقيا' },
    { name:'غينيا',            lat:11.8636,  lng:-15.1384, region:'أفريقيا' },
    { name:'كوت ديفوار',       lat:7.5400,   lng:-5.5471,  region:'أفريقيا' },
    { name:'الكونغو',          lat:-4.3217,  lng:15.3222,  region:'أفريقيا' },
    { name:'الكونغو الديمقراطية', lat:-4.0383, lng:21.7587, region:'أفريقيا' },
    { name:'أنغولا',           lat:-8.8383,  lng:13.2344,  region:'أفريقيا' },
    { name:'ناميبيا',          lat:-22.9576, lng:18.4904,  region:'أفريقيا' },
    { name:'بوتسوانا',         lat:-24.6282, lng:25.9231,  region:'أفريقيا' },
    { name:'زامبيا',           lat:-13.1339, lng:27.8493,  region:'أفريقيا' },
    { name:'مدغشقر',           lat:-18.7669, lng:46.8691,  region:'أفريقيا' },
    { name:'موريشيوس',         lat:-20.1609, lng:57.4977,  region:'أفريقيا' },
    { name:'ليسوتو',           lat:-29.6100, lng:28.2336,  region:'أفريقيا' },
    { name:'إسواتيني',         lat:-26.5225, lng:31.4659,  region:'أفريقيا' },
    { name:'بوروندي',          lat:-3.3731,  lng:29.9189,  region:'أفريقيا' },
    { name:'مالاوي',           lat:-13.2543, lng:34.3015,  region:'أفريقيا' },
    { name:'ليبيريا',          lat:6.4281,   lng:-9.4295,  region:'أفريقيا' },
    { name:'سيراليون',         lat:8.4606,   lng:-11.7799, region:'أفريقيا' },
    { name:'توغو',             lat:8.6195,   lng:0.8248,   region:'أفريقيا' },
    { name:'بنين',             lat:9.3077,   lng:2.3158,   region:'أفريقيا' },
    { name:'جمهورية أفريقيا الوسطى', lat:6.6111, lng:20.9394, region:'أفريقيا' },
    { name:'إريتريا',          lat:15.1794,  lng:39.7823,  region:'أفريقيا' },
    { name:'الصومال',          lat:5.1521,   lng:46.1996,  region:'أفريقيا' },
    { name:'جيبوتي',           lat:11.8251,  lng:42.5903,  region:'أفريقيا' },
    { name:'إثيوبيا',          lat:9.1450,   lng:40.4897,  region:'أفريقيا' },
    // آسيا
    { name:'تركيا',            lat:39.9334,  lng:32.8597,  region:'آسيا' },
    { name:'إيران',            lat:35.6892,  lng:51.3890,  region:'آسيا' },
    { name:'باكستان',          lat:33.7294,  lng:73.0931,  region:'آسيا' },
    { name:'الهند',            lat:28.6139,  lng:77.2090,  region:'آسيا' },
    { name:'الصين',            lat:39.9042,  lng:116.4074, region:'آسيا' },
    { name:'اليابان',          lat:35.6762,  lng:139.6503, region:'آسيا' },
    { name:'إندونيسيا',        lat:-6.2088,  lng:106.8456, region:'آسيا' },
    { name:'ماليزيا',          lat:3.1390,   lng:101.6869, region:'آسيا' },
    { name:'سنغافورة',         lat:1.3521,   lng:103.8198, region:'آسيا' },
    { name:'تايلاند',          lat:13.7563,  lng:100.5018, region:'آسيا' },
    { name:'فيتنام',           lat:21.0285,  lng:105.8542, region:'آسيا' },
    { name:'كوريا الجنوبية',   lat:37.5665,  lng:126.9780, region:'آسيا' },
    { name:'الفلبين',          lat:14.5995,  lng:120.9842, region:'آسيا' },
    { name:'بنغلاديش',         lat:23.6850,  lng:90.3563,  region:'آسيا' },
    { name:'سريلانكا',         lat:7.8731,   lng:80.7718,  region:'آسيا' },
    { name:'نيبال',            lat:28.3949,  lng:84.1240,  region:'آسيا' },
    { name:'أفغانستان',        lat:33.9391,  lng:67.7100,  region:'آسيا' },
    { name:'كمبوديا',          lat:11.5564,  lng:104.9282, region:'آسيا' },
    { name:'أذربيجان',         lat:40.4093,  lng:49.8671,  region:'آسيا' },
    { name:'جورجيا',           lat:42.3154,  lng:43.3569,  region:'آسيا' },
    { name:'أوزبكستان',        lat:41.2995,  lng:69.2401,  region:'آسيا' },
    { name:'كازاخستان',        lat:51.1811,  lng:71.4460,  region:'آسيا' },
    // أوروبا
    { name:'المملكة المتحدة',  lat:51.5074,  lng:-0.1278,  region:'أوروبا' },
    { name:'فرنسا',            lat:48.8566,  lng:2.3522,   region:'أوروبا' },
    { name:'ألمانيا',          lat:52.5200,  lng:13.4050,  region:'أوروبا' },
    { name:'إيطاليا',          lat:41.9028,  lng:12.4964,  region:'أوروبا' },
    { name:'إسبانيا',          lat:40.4168,  lng:-3.7038,  region:'أوروبا' },
    { name:'هولندا',           lat:52.3676,  lng:4.9041,   region:'أوروبا' },
    { name:'السويد',           lat:59.3293,  lng:18.0686,  region:'أوروبا' },
    { name:'النرويج',          lat:59.9139,  lng:10.7522,  region:'أوروبا' },
    { name:'الدنمارك',         lat:55.6761,  lng:12.5683,  region:'أوروبا' },
    { name:'فنلندا',           lat:60.1699,  lng:24.9384,  region:'أوروبا' },
    { name:'بولندا',           lat:52.2297,  lng:21.0122,  region:'أوروبا' },
    { name:'رومانيا',          lat:44.4268,  lng:26.1025,  region:'أوروبا' },
    { name:'اليونان',          lat:37.9838,  lng:23.7275,  region:'أوروبا' },
    { name:'البرتغال',         lat:38.7223,  lng:-9.1393,  region:'أوروبا' },
    { name:'النمسا',           lat:48.2082,  lng:16.3738,  region:'أوروبا' },
    { name:'سويسرا',           lat:46.9480,  lng:7.4474,   region:'أوروبا' },
    { name:'بلجيكا',           lat:50.8503,  lng:4.3517,   region:'أوروبا' },
    { name:'روسيا',            lat:55.7558,  lng:37.6173,  region:'أوروبا' },
    { name:'أوكرانيا',         lat:50.4501,  lng:30.5234,  region:'أوروبا' },
    { name:'المجر',            lat:47.4979,  lng:19.0402,  region:'أوروبا' },
    { name:'التشيك',           lat:50.0755,  lng:14.4378,  region:'أوروبا' },
    // أمريكا
    { name:'الولايات المتحدة', lat:38.9072,  lng:-77.0369, region:'أمريكا' },
    { name:'كندا',             lat:45.4215,  lng:-75.6919, region:'أمريكا' },
    { name:'البرازيل',         lat:-15.7942, lng:-47.8825, region:'أمريكا' },
    { name:'المكسيك',          lat:19.4326,  lng:-99.1332, region:'أمريكا' },
    { name:'الأرجنتين',        lat:-34.6037, lng:-58.3816, region:'أمريكا' },
    { name:'كولومبيا',         lat:4.7110,   lng:-74.0721, region:'أمريكا' },
    { name:'تشيلي',            lat:-33.4489, lng:-70.6693, region:'أمريكا' },
    { name:'بيرو',             lat:-12.0464, lng:-77.0428, region:'أمريكا' },
    { name:'فنزويلا',          lat:10.4806,  lng:-66.9036, region:'أمريكا' },
    { name:'الإكوادور',        lat:-0.1807,  lng:-78.4678, region:'أمريكا' },
    // أوقيانوسيا
    { name:'أستراليا',         lat:-35.2802, lng:149.1310, region:'أوقيانوسيا' },
    { name:'نيوزيلندا',        lat:-41.2866, lng:174.7756, region:'أوقيانوسيا' },
    { name:'بابوا غينيا الجديدة', lat:-9.4438, lng:147.1803, region:'أوقيانوسيا' },
    { name:'فيجي',             lat:-18.1416, lng:178.4419, region:'أوقيانوسيا' },
  ]
};

/* ============================================================
   DATA STORE  +  PERSISTENCE
   ============================================================ */
const DB_FILE = path.join(__dirname, 'nabdh_data.json');

function loadData() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const saved = JSON.parse(raw);
      return {
        alerts:       saved.alerts        || [],
        exchangeRates:saved.exchangeRates || [],
        medicines:    saved.medicines     || [],
        mapPins:      saved.mapPins       || [],
        voiceItems:   saved.voiceItems    || [],
        skills:       saved.skills        || [],
        marketplace:  saved.marketplace   || [],
        chatRooms:    saved.chatRooms     || {},
        onlineUsers:  {},
        profiles:     saved.profiles      || {},
        messages:     saved.messages      || {},
        bloodRequests:saved.bloodRequests || [],
        bloodDonors:  saved.bloodDonors   || [],
        powerSchedule:saved.powerSchedule || [],
        images:       saved.images        || {},
        hospitals:    saved.hospitals     || [],
        news:         saved.news          || [],
        rides:        saved.rides         || [],
        waterReports: saved.waterReports  || [],
        studyGroups:  saved.studyGroups   || {},
        helpRequests: saved.helpRequests  || [],
        polls:        saved.polls         || [],
        leaderboard:  saved.leaderboard   || [],
        referrals:    saved.referrals     || [],
        stats: { users:0, reports: saved.stats ? (saved.stats.reports||0) : 0,
                 lives_saved: saved.stats ? (saved.stats.lives_saved||0) : 0,
                 cities: saved.stats ? (saved.stats.cities||0) : 0 }
      };
    }
  } catch(e) { console.warn('⚠️ Could not load data:', e.message); }
  return {
    alerts:[], exchangeRates:[], medicines:[], mapPins:[], voiceItems:[],
    skills:[], marketplace:[], chatRooms:{}, onlineUsers:{}, profiles:{},
    messages:{}, bloodRequests:[], bloodDonors:[], powerSchedule:[],
    images:{}, hospitals:[], news:[], rides:[], waterReports:[],
    studyGroups:{}, helpRequests:[], polls:[],
    stats:{ users:0, reports:0, lives_saved:0, cities:0 }
  };
}

let data = loadData();
console.log(`📂 Data loaded: ${data.alerts.length} alerts, ${data.marketplace.length} market items, ${data.bloodDonors.length} blood donors`);

let _saveTimer = null;
function saveData() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const toSave = {
        alerts: data.alerts.slice(0,200),
        exchangeRates: data.exchangeRates.slice(0,100),
        medicines: data.medicines.slice(0,200),
        mapPins: data.mapPins.slice(0,300),
        voiceItems: data.voiceItems.slice(0,200),
        skills: data.skills.slice(0,200),
        marketplace: data.marketplace.slice(0,200),
        chatRooms: data.chatRooms,
        profiles: data.profiles,
        messages: data.messages,
        bloodRequests: data.bloodRequests.slice(0,200),
        bloodDonors: data.bloodDonors.slice(0,500),
        powerSchedule: data.powerSchedule.slice(0,300),
        images: data.images,
        hospitals:    data.hospitals.slice(0,300),
        news:         data.news.slice(0,200),
        rides:        data.rides.slice(0,200),
        waterReports: data.waterReports.slice(0,200),
        studyGroups:  data.studyGroups,
        helpRequests: data.helpRequests.slice(0,200),
        polls:        data.polls.slice(0,100),
        leaderboard:  (data.leaderboard||[]).slice(0,2000),
        referrals:    (data.referrals||[]).slice(0,5000),
        stats: { reports: data.stats.reports, lives_saved: data.stats.lives_saved, cities: data.stats.cities }
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(toSave), 'utf8');
    } catch(e) { console.warn('⚠️ Save error:', e.message); }
  }, 2000);
}

function updateCitiesCount() {
  const a = [
    ...data.alerts.map(x=>x.area),
    ...data.exchangeRates.map(x=>x.source),
    ...data.medicines.map(x=>x.area),
    ...data.voiceItems.map(x=>x.area),
    ...data.marketplace.map(x=>x.area),
  ];
  data.stats.cities = new Set(a.filter(Boolean)).size;
}

function haversine(la1,lo1,la2,lo2){
  const R=6371, dL=d=>d*Math.PI/180;
  const a=Math.sin(dL(la2-la1)/2)**2+Math.cos(dL(la1))*Math.cos(dL(la2))*Math.sin(dL(lo2-lo1)/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

/* ============================================================
   API - البيانات الجغرافية
   ============================================================ */
app.get('/api/geo/sudan', (_,res) => res.json(GEO.sudan));
app.get('/api/geo/world', (_,res) => res.json(GEO.world));

app.get('/api/geo/search', (req,res) => {
  const q = (req.query.q||'').trim().toLowerCase();
  if (!q || q.length < 1) return res.json([]);
  const results = [];
  for (const st of GEO.sudan) {
    if (st.state.includes(q))
      results.push({ label:`🇸🇩 ${st.state}`, name:st.state, lat:st.lat, lng:st.lng, type:'state' });
    for (const ct of st.cities) {
      if (ct.name.includes(q))
        results.push({ label:`🏙️ ${ct.name} - ${st.state}`, name:ct.name, state:st.state, lat:ct.lat, lng:ct.lng, type:'city' });
      for (const h of ct.hoods) {
        if (h.includes(q))
          results.push({ label:`🏘️ حي ${h} - ${ct.name}`, name:`حي ${h}`, city:ct.name, state:st.state, lat:ct.lat+(Math.random()-.5)*.02, lng:ct.lng+(Math.random()-.5)*.02, type:'hood' });
      }
    }
  }
  for (const c of GEO.world) {
    if (c.name.includes(q))
      results.push({ label:`🌍 ${c.name} (${c.region})`, name:c.name, lat:c.lat, lng:c.lng, type:'country' });
  }
  res.json(results.slice(0,15));
});

/* ============================================================
   API - الإحصاء
   ============================================================ */
app.get('/api/stats', (_,res) => {
  // حساب الإحصائيات الحية
  const areas = new Set([
    ...data.alerts.map(x=>x.area),
    ...data.exchangeRates.map(x=>x.source),
    ...data.voiceItems.map(x=>x.area),
    ...data.marketplace.map(x=>x.area),
  ].filter(Boolean));
  data.stats.cities = Math.max(areas.size, data.stats.cities || 0);
  data.stats.reports = Math.max(data.alerts.length, data.stats.reports || 0);
  const onlineCount = Object.keys(data.onlineUsers||{}).length;
  res.json({
    users:       onlineCount || data.stats.users || 0,
    reports:     data.stats.reports,
    lives_saved: data.stats.lives_saved || 0,
    cities:      data.stats.cities,
    total_alerts: data.alerts.length,
    market_items: data.marketplace.length,
    blood_donors: data.bloodDonors.filter(d=>d.available).length,
    online:       onlineCount
  });
});

/* ============================================================
   API - التنبيهات والخريطة
   ============================================================ */
app.get('/api/alerts', (_,res) => res.json(data.alerts.sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0))));
app.get('/api/map',    (_,res) => res.json(data.mapPins));

app.get('/api/alerts/nearby', (req,res) => {
  const lat=parseFloat(req.query.lat), lng=parseFloat(req.query.lng), km=parseFloat(req.query.km)||100;
  if (isNaN(lat)||isNaN(lng)) return res.json(data.alerts);
  res.json(data.alerts.filter(a=>a.lat&&a.lng&&haversine(lat,lng,a.lat,a.lng)<=km).sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0)));
});

// إحصاء كثافة المناطق (heatmap data)
app.get('/api/heatmap', (_,res) => {
  const pts = data.alerts.filter(a=>a.lat&&a.lng).map(a=>({ lat:a.lat, lng:a.lng, type:a.type, weight: a.votes+1 }));
  res.json(pts);
});

// المستخدمون النشطون القريبون (للـ P2P)
app.get('/api/users/nearby', (req,res) => {
  const lat=parseFloat(req.query.lat), lng=parseFloat(req.query.lng), km=parseFloat(req.query.km)||50;
  if (isNaN(lat)||isNaN(lng)) return res.json([]);
  const now = Date.now();
  const active = Object.values(data.onlineUsers).filter(u=>
    u.lat && u.lng && (now - u.time) < 300000 && haversine(lat,lng,u.lat,u.lng) <= km
  );
  res.json(active.map(u=>({ name:u.name||'مستخدم', area:u.area||'غير محدد', lat:u.lat, lng:u.lng, dist:Math.round(haversine(lat,lng,u.lat,u.lng)) })));
});

app.post('/api/alerts', (req,res) => {
  const { type, msg, area, lat, lng, imageId } = req.body;
  if (!msg?.trim()) return res.status(400).json({ error:'الرسالة مطلوبة' });
  const icons = { danger:'🔴', warning:'🟡', info:'🟢' };
  const alert = {
    id: uuidv4(), type:type||'warning', icon:icons[type]||'🟡',
    msg: msg.trim(), area: area||'غير محدد',
    lat: lat||null, lng: lng||null,
    imageId: imageId||null,
    votes:0, time: Date.now()
  };
  data.alerts.unshift(alert);
  data.mapPins.unshift({...alert});
  data.stats.reports++;
  updateCitiesCount();
  saveData();
  io.emit('new_alert', alert);
  io.emit('stats_update', data.stats);
  res.json({ success:true, alert });
});

app.post('/api/alerts/:id/vote', (req,res) => {
  const a = data.alerts.find(x=>x.id===req.params.id);
  if (!a) return res.status(404).json({ error:'غير موجود' });
  a.votes++;
  const pin = data.mapPins.find(x=>x.id===a.id);
  if (pin) pin.votes = a.votes;
  io.emit('vote_update', { id:a.id, votes:a.votes });
  res.json({ success:true, votes:a.votes });
});

/* ============================================================
   API - سعر الصرف
   ============================================================ */
app.get('/api/exchange', (_,res) => res.json(data.exchangeRates.sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0))));

app.post('/api/exchange', (req,res) => {
  const { rate, source, lat, lng } = req.body;
  if (!rate||isNaN(rate)||Number(rate)<1) return res.status(400).json({ error:'سعر غير صحيح' });
  const entry = {
    id:uuidv4(), rate:Number(rate), source:source||'غير محدد',
    lat:lat||null, lng:lng||null, verified:false, time:Date.now()
  };
  data.exchangeRates.unshift(entry);
  updateCitiesCount();
  io.emit('new_rate', entry);
  res.json({ success:true, entry });
});

/* ============================================================
   API - الأدوية
   ============================================================ */
app.get('/api/medicines', (req,res) => {
  const q=(req.query.q||'').toLowerCase();
  res.json(q ? data.medicines.filter(m=>m.name.includes(q)||(m.nameEn||'').toLowerCase().includes(q)) : data.medicines);
});

app.post('/api/medicines', (req,res) => {
  const { name, nameEn, pharmacy, area, price, available, lat, lng } = req.body;
  if (!name?.trim()) return res.status(400).json({ error:'اسم الدواء مطلوب' });
  const med = {
    id:uuidv4(), name:name.trim(), nameEn:(nameEn||'').trim(),
    pharmacy:(pharmacy||'غير محدد').trim(), area:(area||'غير محدد').trim(),
    price:Number(price)||0, available:available===true||available==='true',
    lat:lat||null, lng:lng||null, time:Date.now()
  };
  data.medicines.unshift(med);
  updateCitiesCount();
  io.emit('new_medicine', med);
  res.json({ success:true, med });
});

/* ============================================================
   API - صوت الحي
   ============================================================ */
app.get('/api/voice', (_,res) => res.json(data.voiceItems.sort((a,b)=>b.votes-a.votes)));

app.post('/api/voice', (req,res) => {
  const { title, desc, area, category, lat, lng } = req.body;
  if (!title?.trim()) return res.status(400).json({ error:'العنوان مطلوب' });
  const item = {
    id:uuidv4(), title:title.trim(), desc:(desc||'').trim(),
    area:(area||'غير محدد').trim(), category:category||'أخرى',
    lat:lat||null, lng:lng||null, votes:0, time:Date.now()
  };
  data.voiceItems.unshift(item);
  data.stats.reports++;
  updateCitiesCount();
  io.emit('new_voice', item);
  io.emit('stats_update', data.stats);
  res.json({ success:true, item });
});

app.post('/api/voice/:id/vote', (req,res) => {
  const v = data.voiceItems.find(x=>x.id===req.params.id);
  if (!v) return res.status(404).json({ error:'غير موجود' });
  v.votes++;
  io.emit('voice_vote', { id:v.id, votes:v.votes });
  res.json({ success:true, votes:v.votes });
});

/* ============================================================
   API - بورصة المهارات
   ============================================================ */
app.get('/api/skills', (_,res) => res.json(data.skills));

app.post('/api/skills', (req,res) => {
  const { name, skill, offer, want, area, lat, lng, contact } = req.body;
  if (!name||!offer||!want) return res.status(400).json({ error:'بيانات ناقصة' });
  const s = {
    id:uuidv4(), name:name.trim(), skill:(skill||offer).trim(),
    offer:offer.trim(), want:want.trim(), area:(area||'غير محدد').trim(),
    lat:lat||null, lng:lng||null, contact:contact||'',
    rating:5.0, avatar:name.trim().substring(0,2).toUpperCase(), time:Date.now()
  };
  data.skills.unshift(s);
  io.emit('new_skill', s);
  res.json({ success:true, skill:s });
});

/* ============================================================
   API - سوق P2P
   ============================================================ */
app.get('/api/market', (_,res) => res.json(data.marketplace.sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0))));

app.get('/api/market/nearby', (req,res) => {
  const lat=parseFloat(req.query.lat), lng=parseFloat(req.query.lng), km=parseFloat(req.query.km)||50;
  if (isNaN(lat)||isNaN(lng)) return res.json(data.marketplace);
  res.json(data.marketplace.filter(m=>m.lat&&m.lng&&haversine(lat,lng,m.lat,m.lng)<=km).sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0)));
});

app.post('/api/market', (req,res) => {
  const { title, desc, type, price, currency, area, lat, lng, contact, category } = req.body;
  if (!title?.trim()) return res.status(400).json({ error:'عنوان المنتج مطلوب' });
  const item = {
    id:uuidv4(),
    title:title.trim(),
    desc:(desc||'').trim(),
    type:type||'sell',
    price:Number(price)||0,
    currency:currency||'ج.س',
    category:category||'أخرى',
    area:(area||'غير محدد').trim(),
    lat:lat||null, lng:lng||null,
    contact:(contact||'').trim(),
    views:0, likes:0,
    status:'active',
    time:Date.now()
  };
  data.marketplace.unshift(item);
  updateCitiesCount();
  io.emit('new_market_item', item);
  res.json({ success:true, item });
});

app.post('/api/market/:id/like', (req,res) => {
  const m = data.marketplace.find(x=>x.id===req.params.id);
  if (!m) return res.status(404).json({ error:'غير موجود' });
  m.likes++;
  io.emit('market_like', { id:m.id, likes:m.likes });
  res.json({ success:true, likes:m.likes });
});

app.post('/api/market/:id/view', (req,res) => {
  const m = data.marketplace.find(x=>x.id===req.params.id);
  if (m) m.views++;
  res.json({ success:true });
});

/* ============================================================
   API - دردشة P2P
   ============================================================ */
app.get('/api/chat/:room', (req,res) => {
  const msgs = data.chatRooms[req.params.room] || [];
  res.json(msgs.slice(-50));
});

app.post('/api/chat/:room', (req,res) => {
  const { text, sender, senderArea, mediaType=null, mediaData=null, mediaName=null } = req.body;
  if (!text?.trim() && !mediaData) return res.status(400).json({ error:'الرسالة فارغة' });
  const room = req.params.room;
  if (!data.chatRooms[room]) data.chatRooms[room] = [];
  const msg = {
    id: uuidv4(),
    text: (text||'').trim(),
    sender: sender||'مجهول',
    senderArea: senderArea||'',
    mediaType: mediaType||null,
    mediaData: mediaData||null,
    mediaName: mediaName||null,
    time: Date.now()
  };
  data.chatRooms[room].push(msg);
  if (data.chatRooms[room].length > 200) data.chatRooms[room] = data.chatRooms[room].slice(-200);
  saveData();
  io.to(`chat:${room}`).emit('chat_msg', { room, msg });
  res.json({ success:true, msg });
});

/* ============================================================
   API - الملف الشخصي (User Profiles) - Enhanced v2
   ============================================================ */

// إنشاء أو تحديث الملف الشخصي - مُحسَّن بإضافة رقم معلن وشركة وموقع
app.post('/api/profile', (req, res) => {
  const {
    userId, name, phone, email, bio, avatar, area, lat, lng,
    isPublic, showOnMap, publicPhone, company, website, jobTitle,
    whatsapp, telegram, instagram, twitter, profileImage
  } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId مطلوب' });
  const existing = data.profiles[userId] || {};
  const profile = {
    ...existing,
    userId,
    name:         (name        || existing.name        || '').trim(),
    phone:        (phone       || existing.phone       || '').trim(),
    publicPhone:  (publicPhone !== undefined ? publicPhone : existing.publicPhone) || '',  // الرقم المعلن
    email:        (email       || existing.email       || '').trim(),
    bio:          (bio         || existing.bio         || '').trim(),
    avatar:       (avatar      || existing.avatar      || ''),
    profileImage: (profileImage|| existing.profileImage|| ''),
    area:         (area        || existing.area        || 'غير محدد').trim(),
    lat:          lat  != null ? Number(lat)  : (existing.lat  || null),
    lng:          lng  != null ? Number(lng)  : (existing.lng  || null),
    isPublic:     isPublic  != null ? (isPublic === true || isPublic === 'true')  : (existing.isPublic  !== false),
    showOnMap:    showOnMap != null ? (showOnMap === true || showOnMap === 'true') : (existing.showOnMap !== false),
    // معلومات الشركة/المهنة
    company:      (company   || existing.company  || '').trim(),
    website:      (website   || existing.website  || '').trim(),
    jobTitle:     (jobTitle  || existing.jobTitle || '').trim(),
    // وسائل التواصل
    whatsapp:     (whatsapp  || existing.whatsapp  || '').trim(),
    telegram:     (telegram  || existing.telegram  || '').trim(),
    instagram:    (instagram || existing.instagram || '').trim(),
    twitter:      (twitter   || existing.twitter   || '').trim(),
    verified:     existing.verified || false,
    joinDate:     existing.joinDate || Date.now(),
    lastSeen:     Date.now(),
    reports:      existing.reports  || 0,
  };
  data.profiles[userId] = profile;
  // Broadcast profile update to nearby users
  saveData();
  io.emit('profile_updated', { userId, name: profile.name, avatar: profile.avatar, area: profile.area });
  res.json({ success: true, profile });
});

// جلب ملف شخصي بـ userId
app.get('/api/profile/:userId', (req, res) => {
  const p = data.profiles[req.params.userId];
  if (!p) return res.status(404).json({ error: 'الملف الشخصي غير موجود' });
  res.json(p);
});

// جلب قائمة ملفات شخصية عامة
app.get('/api/profiles', (req, res) => {
  const list = Object.values(data.profiles)
    .filter(p => p.isPublic)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 100);
  res.json(list);
});

/* ============================================================
   API - البحث عن الأشخاص (Truecaller-style) - مُحسَّن
   ============================================================ */
app.get('/api/search/people', (req, res) => {
  const q     = (req.query.q || '').trim().toLowerCase();
  const type  = req.query.type || 'all'; // name | phone | email | company | all
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  if (!q || q.length < 2) return res.json([]);

  // Search across profiles
  const profileResults = Object.values(data.profiles).filter(p => {
    if (!p.isPublic) return false;
    const matchName    = p.name     && p.name.toLowerCase().includes(q);
    const matchPhone   = p.phone    && p.phone.replace(/\s/g,'').includes(q.replace(/\s/g,''));
    const matchPubPhone= p.publicPhone && p.publicPhone.replace(/\s/g,'').includes(q.replace(/\s/g,''));
    const matchEmail   = p.email    && p.email.toLowerCase().includes(q);
    const matchArea    = p.area     && p.area.toLowerCase().includes(q);
    const matchCompany = p.company  && p.company.toLowerCase().includes(q);
    const matchJob     = p.jobTitle && p.jobTitle.toLowerCase().includes(q);
    const matchWebsite = p.website  && p.website.toLowerCase().includes(q);
    if (type === 'name')    return matchName;
    if (type === 'phone')   return matchPhone || matchPubPhone;
    if (type === 'email')   return matchEmail;
    if (type === 'company') return matchCompany || matchJob || matchWebsite;
    return matchName || matchPhone || matchPubPhone || matchEmail || matchArea || matchCompany || matchJob;
  }).map(p => {
    const exactPhone = (p.phone    && p.phone.replace(/\s/g,'') === q.replace(/\s/g,'')) ||
                       (p.publicPhone && p.publicPhone.replace(/\s/g,'') === q.replace(/\s/g,''));
    const exactEmail = p.email && p.email.toLowerCase() === q;
    return {
      userId:      p.userId,
      name:        p.name,
      bio:         p.bio,
      area:        p.area,
      avatar:      p.avatar,
      profileImage:p.profileImage,
      verified:    p.verified,
      joinDate:    p.joinDate,
      lastSeen:    p.lastSeen,
      lat:         p.lat,
      lng:         p.lng,
      company:     p.company,
      jobTitle:    p.jobTitle,
      website:     p.website,
      whatsapp:    p.whatsapp,
      telegram:    p.telegram,
      // الرقم المعلن يُظهر دائماً
      publicPhone: p.publicPhone || '',
      // الرقم الشخصي يُخفى جزئياً ما لم يكن بحثاً تاماً
      phone:       exactPhone ? p.phone : (p.phone ? p.phone.replace(/\d(?=\d{4})/g, '*') : ''),
      email:       exactEmail ? p.email : (p.email ? p.email.replace(/(?<=.{2}).(?=[^@]*@)/g, '*') : ''),
      type:        'person',
    };
  });

  // Also search market listings for companies/businesses
  const marketResults = data.marketplace.filter(m => {
    const qLow = q;
    return m.title.toLowerCase().includes(qLow) || (m.area && m.area.toLowerCase().includes(qLow));
  }).slice(0, 5).map(m => ({
    userId:   null,
    name:     m.title,
    bio:      m.desc,
    area:     m.area,
    avatar:   '🛒',
    verified: false,
    lat:      m.lat,
    lng:      m.lng,
    publicPhone: m.contact,
    phone:    m.contact,
    email:    '',
    company:  m.category,
    type:     'listing',
    listingId: m.id,
    price:    m.price,
    currency: m.currency,
  }));

  // Also search skills (freelancers/companies)
  const skillResults = data.skills.filter(s => {
    const qLow = q;
    return s.name.toLowerCase().includes(qLow) || s.skill.toLowerCase().includes(qLow) ||
           s.offer.toLowerCase().includes(qLow) || (s.area && s.area.toLowerCase().includes(qLow));
  }).slice(0, 5).map(s => ({
    userId:   null,
    name:     s.name,
    bio:      s.offer + ' ↔ ' + s.want,
    area:     s.area,
    avatar:   '🤝',
    verified: false,
    lat:      s.lat,
    lng:      s.lng,
    publicPhone: s.contact,
    phone:    s.contact,
    email:    '',
    company:  s.skill,
    type:     'skill',
  }));

  const combined = [...profileResults, ...marketResults, ...skillResults].slice(0, limit);
  res.json(combined);
});

// بحث سريع بالرقم المُعلن
app.get('/api/search/phone/:phone', (req, res) => {
  const phone = req.params.phone.replace(/\s/g, '');
  const profile = Object.values(data.profiles).find(p =>
    (p.phone && p.phone.replace(/\s/g,'') === phone) ||
    (p.publicPhone && p.publicPhone.replace(/\s/g,'') === phone) ||
    (p.whatsapp && p.whatsapp.replace(/\s/g,'') === phone)
  );
  if (!profile) {
    const onlineMatch = Object.values(data.onlineUsers).find(u =>
      u.phone && u.phone.replace(/\s/g,'') === phone
    );
    if (onlineMatch) return res.json({ found: true, name: onlineMatch.name, area: onlineMatch.area, online: true });
    return res.json({ found: false });
  }
  if (!profile.isPublic) return res.json({ found: false });
  res.json({ found: true, ...profile });
});

// تحديث الرقم المعلن فقط
app.post('/api/profile/:userId/public-phone', (req, res) => {
  const { publicPhone } = req.body;
  const p = data.profiles[req.params.userId];
  if (!p) return res.status(404).json({ error: 'الملف غير موجود' });
  p.publicPhone = (publicPhone || '').trim();
  res.json({ success: true, publicPhone: p.publicPhone });
});

// تحديد موقع شخص محدد على الخريطة
app.get('/api/people/locate/:userId', (req, res) => {
  const uid = req.params.userId;
  // Check online users first (real-time location)
  const onlineEntry = Object.values(data.onlineUsers).find(u => u.userId === uid);
  if (onlineEntry && onlineEntry.lat) {
    return res.json({
      found: true, live: true,
      lat: onlineEntry.lat, lng: onlineEntry.lng,
      area: onlineEntry.area, name: onlineEntry.name,
      lastSeen: onlineEntry.time,
    });
  }
  // Fallback to profile location
  const profile = data.profiles[uid];
  if (profile && profile.lat && profile.isPublic && profile.showOnMap !== false) {
    return res.json({
      found: true, live: false,
      lat: profile.lat, lng: profile.lng,
      area: profile.area, name: profile.name,
      lastSeen: profile.lastSeen,
    });
  }
  res.json({ found: false });
});

/* ============================================================
   API - المراسلة المباشرة (Direct Messaging)
   ============================================================ */

// جلب المحادثات
app.get('/api/dm/:userId', (req, res) => {
  const uid = req.params.userId;
  const convs = Object.entries(data.messages)
    .filter(([id]) => id.includes(uid))
    .map(([id, msgs]) => {
      const other = id.split('__').find(p => p !== uid) || 'unknown';
      const otherProfile = data.profiles[other] || { name: 'مستخدم', userId: other };
      return {
        conversationId: id,
        otherUser: { userId: other, name: otherProfile.name, avatar: otherProfile.avatar, area: otherProfile.area },
        lastMsg: msgs[msgs.length - 1] || null,
        unread: msgs.filter(m => !m.read && m.senderId !== uid).length,
      };
    })
    .sort((a, b) => (b.lastMsg?.time || 0) - (a.lastMsg?.time || 0));
  res.json(convs);
});

// جلب رسائل محادثة معينة
app.get('/api/dm/:userId/:otherId', (req, res) => {
  const { userId, otherId } = req.params;
  const convId = [userId, otherId].sort().join('__');
  const msgs = data.messages[convId] || [];
  // Mark as read
  msgs.forEach(m => { if (m.senderId !== userId) m.read = true; });
  res.json(msgs.slice(-80));
});

// إرسال رسالة مباشرة
app.post('/api/dm/:userId/:otherId', (req, res) => {
  const { userId, otherId } = req.params;
  const { text, senderName } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'الرسالة فارغة' });
  const convId = [userId, otherId].sort().join('__');
  if (!data.messages[convId]) data.messages[convId] = [];
  const msg = {
    id: uuidv4(),
    senderId: userId,
    senderName: senderName || data.profiles[userId]?.name || 'مستخدم',
    text: text.trim(),
    time: Date.now(),
    read: false,
  };
  data.messages[convId].push(msg);
  if (data.messages[convId].length > 500) data.messages[convId] = data.messages[convId].slice(-500);
  saveData();
  // Emit to the recipient via socket
  const recipientSocket = Object.entries(data.onlineUsers).find(([, u]) => u.userId === otherId);
  if (recipientSocket) {
    io.to(recipientSocket[0]).emit('dm_msg', { conversationId: convId, msg, from: userId });
  }
  res.json({ success: true, msg });
});

/* ============================================================
   API - المستخدمون على الخريطة (Live People Map)
   ============================================================ */
app.get('/api/people/map', (req, res) => {
  const now = Date.now();
  const people = Object.values(data.onlineUsers)
    .filter(u => u.lat && u.lng && u.showOnMap && (now - u.time) < 600000) // 10 min
    .map(u => ({
      socketId: u.socketId,
      userId:   u.userId || null,
      name:     u.name || 'مستخدم',
      area:     u.area || '',
      lat:      u.lat,
      lng:      u.lng,
      avatar:   u.avatar || '',
      lastSeen: u.time,
    }));
  res.json(people);
});

/* ============================================================
   API - نداء الاستغاثة SOS
   ============================================================ */
app.post('/api/sos', (req,res) => {
  const { lat, lng, name, area } = req.body;
  if (!lat || !lng) return res.status(400).json({ error:'الموقع مطلوب' });
  const sos = { id:uuidv4(), lat:Number(lat), lng:Number(lng), name:name||'مستخدم', area:area||'غير محدد', time:Date.now() };
  // Broadcast to all nearby users
  const nearby = Object.values(data.onlineUsers).filter(u =>
    u.lat && u.lng && haversine(lat,lng,u.lat,u.lng) <= 100
  );
  nearby.forEach(u => {
    io.to(u.socketId).emit('sos_alert', { ...sos, dist: Math.round(haversine(lat,lng,u.lat,u.lng)) });
  });
  io.emit('sos_alert', sos); // broadcast to all
  // Also add as a danger alert
  const icons = { danger:'🆘' };
  const alert = {
    id: uuidv4(), type:'danger', icon:'🆘',
    msg: `🆘 نداء استغاثة من ${name||'مستخدم'}`,
    area: area||'غير محدد', lat:Number(lat), lng:Number(lng), votes:0, time:Date.now()
  };
  data.alerts.unshift(alert);
  data.mapPins.unshift({...alert});
  data.stats.reports++;
  updateCitiesCount();
  io.emit('new_alert', alert);
  io.emit('stats_update', data.stats);
  res.json({ success:true, sos, notified: nearby.length });
});



/* ============================================================
   SOCKET.IO
   ============================================================ */
io.on('connection', socket => {
  data.stats.users++;
  io.emit('stats_update', data.stats);

  // تسجيل موقع المستخدم (يُستدعى تلقائياً كلما تحرّك المستخدم)
  socket.on('user_location', ({ lat, lng, name, area, userId, showOnMap, avatar, phone }) => {
    data.onlineUsers[socket.id] = {
      lat, lng, name:name||'مستخدم', area:area||'غير محدد',
      time:Date.now(), socketId:socket.id,
      userId: userId || null,
      showOnMap: showOnMap !== false,
      avatar: avatar || '',
      phone: phone || '',
    };
    // تحديث lastSeen في الملف الشخصي
    if (userId && data.profiles[userId]) {
      data.profiles[userId].lastSeen = Date.now();
      data.profiles[userId].lat = lat;
      data.profiles[userId].lng = lng;
      data.profiles[userId].area = area || data.profiles[userId].area;
    }
    // إرسال المستخدمين القريبين لهذا المستخدم
    if (lat && lng) {
      const nearby = Object.values(data.onlineUsers)
        .filter(u => u.socketId !== socket.id && u.lat && u.lng && haversine(lat,lng,u.lat,u.lng) <= 50);
      socket.emit('nearby_users', nearby.map(u=>({
        name:u.name, area:u.area, lat:u.lat, lng:u.lng,
        userId:u.userId, avatar:u.avatar,
        dist:Math.round(haversine(lat,lng,u.lat,u.lng))
      })));
      // Broadcast updated people map to nearby
      io.emit('people_map_update');
    }
  });

  socket.on('disconnect', () => {
    data.stats.users = Math.max(0, data.stats.users-1);
    delete data.onlineUsers[socket.id];
    io.emit('stats_update', data.stats);
  });

  // P2P direct message
  socket.on('p2p_msg', msg => io.to(msg.to).emit('p2p_msg', msg));

  // DM via socket (real-time)
  socket.on('dm_send', ({ toUserId, text, senderName, fromUserId, mediaType=null, mediaData=null, mediaName=null }) => {
    if ((!text?.trim() && !mediaData) || !toUserId || !fromUserId) return;
    const convId = [fromUserId, toUserId].sort().join('__');
    if (!data.messages[convId]) data.messages[convId] = [];
    const msg = {
      id:         uuidv4(),
      senderId:   fromUserId,
      senderName: senderName || 'مستخدم',
      text:       (text || '').trim(),
      mediaType:  mediaType  || null,
      mediaData:  mediaData  || null,
      mediaName:  mediaName  || null,
      time:       Date.now(),
      read:       false
    };
    data.messages[convId].push(msg);
    if (data.messages[convId].length > 500) data.messages[convId] = data.messages[convId].slice(-500);
    saveData();
    // Send to recipient (real-time)
    const recipientEntry = Object.entries(data.onlineUsers).find(([, u]) => u.userId === toUserId);
    if (recipientEntry) io.to(recipientEntry[0]).emit('dm_msg', { conversationId: convId, msg, from: fromUserId });
    // Confirm to sender
    socket.emit('dm_sent', { conversationId: convId, msg });
  });

  // انضمام لغرفة
  socket.on('join_room', room => socket.join(room));

  // دردشة غرفة عامة
  socket.on('join_chat', room => socket.join(`chat:${room}`));
  socket.on('leave_chat', room => socket.leave(`chat:${room}`));

  // ======================================================
  // 🎓 STUDY GROUP REAL-TIME ROOMS
  // ======================================================
  socket.on('join_study', groupId => {
    socket.join('study:' + groupId);
  });
  socket.on('leave_study', groupId => {
    socket.leave('study:' + groupId);
  });

  // Typing indicator for group chat
  socket.on('study_typing', ({ groupId, name }) => {
    socket.to('study:' + groupId).emit('study_typing', { name });
  });

  // ======================================================
  // 🎙️ WebRTC SIGNALING - إشارة WebRTC للمكالمات
  // ======================================================

  // بدء مكالمة (إلى مستخدم محدد أو مجموعة)
  socket.on('call_request', ({ to, from, fromName, type, groupId }) => {
    // to: socket.id أو 'group:groupId'
    if (groupId) {
      socket.to('study:' + groupId).emit('call_request', { from: socket.id, fromName, type, groupId });
    } else if (to) {
      io.to(to).emit('call_request', { from: socket.id, fromName, type });
    }
  });

  socket.on('call_accept', ({ to, groupId }) => {
    if (groupId) {
      socket.to('study:' + groupId).emit('call_accept', { from: socket.id });
    } else {
      io.to(to).emit('call_accept', { from: socket.id });
    }
  });

  socket.on('call_reject', ({ to }) => {
    io.to(to).emit('call_reject', { from: socket.id });
  });

  socket.on('call_end', ({ to, groupId }) => {
    if (groupId) {
      socket.to('study:' + groupId).emit('call_end', { from: socket.id });
    } else if (to) {
      io.to(to).emit('call_end', { from: socket.id });
    }
  });

  // WebRTC SDP offer / answer / ICE candidates
  socket.on('webrtc_offer', ({ to, offer, groupId }) => {
    if (groupId) {
      socket.to('study:' + groupId).emit('webrtc_offer', { from: socket.id, offer });
    } else {
      io.to(to).emit('webrtc_offer', { from: socket.id, offer });
    }
  });

  socket.on('webrtc_answer', ({ to, answer }) => {
    io.to(to).emit('webrtc_answer', { from: socket.id, answer });
  });

  socket.on('webrtc_ice', ({ to, candidate, groupId }) => {
    if (groupId) {
      socket.to('study:' + groupId).emit('webrtc_ice', { from: socket.id, candidate });
    } else {
      io.to(to).emit('webrtc_ice', { from: socket.id, candidate });
    }
  });

  // ======================================================
  // 💬 DM TYPING
  // ======================================================
  socket.on('dm_typing', ({ toUserId }) => {
    // Find target socket
    const targetEntry = Object.entries(data.onlineUsers).find(([sid, u]) => u.userId === toUserId);
    if (targetEntry) {
      io.to(targetEntry[0]).emit('dm_typing', { fromSocketId: socket.id });
    }
  });

  // Ping لإبقاء المستخدم نشطاً
  socket.on('ping_alive', () => {
    if (data.onlineUsers[socket.id]) {
      data.onlineUsers[socket.id].time = Date.now();
    }
  });
});

/* ============================================================
   🩸 بنك الدم
   ============================================================ */
// data.bloodRequests and data.bloodDonors initialized in loadData()

app.get('/api/blood/requests', (req,res) => {
  const { type, lat, lng, km=100 } = req.query;
  let list = [...data.bloodRequests].sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (type) list = list.filter(r => r.bloodType === type);
  if (lat && lng) list = list.map(r=>({...r, dist:Math.round(haversine(lat,lng,r.lat,r.lng))}))
                              .filter(r=>r.dist <= Number(km))
                              .sort((a,b)=>a.dist-b.dist);
  res.json(list.slice(0,50));
});

app.get('/api/blood/donors', (req,res) => {
  const { type, lat, lng, km=50 } = req.query;
  let list = [...data.bloodDonors].filter(d=>d.available).sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (type) list = list.filter(d => d.bloodType === type);
  if (lat && lng) list = list.map(d=>({...d, dist:Math.round(haversine(lat,lng,d.lat,d.lng))}))
                              .filter(d=>d.dist <= Number(km))
                              .sort((a,b)=>a.dist-b.dist);
  res.json(list.slice(0,30));
});

app.post('/api/blood/request', (req,res) => {
  const { bloodType, patientName, hospital, contact, area, lat, lng, urgent, userId } = req.body;
  if (!bloodType || !contact) return res.status(400).json({error:'فصيلة الدم وجهة الاتصال مطلوبان'});
  const req2 = {
    id: uuidv4(), bloodType, patientName: patientName||'مريض', hospital: hospital||'',
    contact, area: area||'غير محدد', lat: Number(lat)||0, lng: Number(lng)||0,
    urgent: !!urgent, userId: userId||null, fulfilled: false,
    time: Date.now()
  };
  data.bloodRequests.unshift(req2);
  if (data.bloodRequests.length > 200) data.bloodRequests = data.bloodRequests.slice(0,200);
  io.emit('new_blood_request', req2);
  updateCitiesCount();
  saveData();
  res.json({success:true, data:req2});
});

app.post('/api/blood/donor', (req,res) => {
  const { bloodType, name, contact, area, lat, lng, userId } = req.body;
  if (!bloodType || !contact) return res.status(400).json({error:'فصيلة الدم وجهة الاتصال مطلوبان'});
  const existing = data.bloodDonors.findIndex(d=>d.userId===userId||d.contact===contact);
  const donor = {
    id: uuidv4(), bloodType, name: name||'متبرع', contact,
    area: area||'غير محدد', lat: Number(lat)||0, lng: Number(lng)||0,
    userId: userId||null, available: true, time: Date.now()
  };
  if (existing>=0) { data.bloodDonors[existing] = {...data.bloodDonors[existing],...donor}; }
  else { data.bloodDonors.unshift(donor); }
  if (data.bloodDonors.length > 500) data.bloodDonors = data.bloodDonors.slice(0,500);
  io.emit('new_blood_donor', donor);
  saveData();
  res.json({success:true, data:donor});
});

app.post('/api/blood/request/:id/fulfill', (req,res) => {
  const r = data.bloodRequests.find(r=>r.id===req.params.id);
  if (!r) return res.status(404).json({error:'الطلب غير موجود'});
  r.fulfilled = true;
  saveData();
  io.emit('blood_fulfilled', {id:r.id});
  res.json({success:true});
});

/* ============================================================
   ⚡ جدول الكهرباء التشاركي
   ============================================================ */
// data.powerSchedule initialized in loadData()

app.get('/api/power', (req,res) => {
  const { area, lat, lng, km=30 } = req.query;
  let list = [...data.powerSchedule].sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (area) list = list.filter(p => p.area.includes(area) || p.district.includes(area));
  if (lat && lng) list = list.map(p=>({...p, dist:Math.round(haversine(lat,lng,p.lat||0,p.lng||0))}))
                              .filter(p=>p.dist <= Number(km));
  res.json(list.slice(0,60));
});

app.post('/api/power', (req,res) => {
  const { area, district, cutStart, cutEnd, lat, lng, userId } = req.body;
  if (!area || !cutStart) return res.status(400).json({error:'المنطقة ووقت الانقطاع مطلوبان'});
  const entry = {
    id: uuidv4(), area, district: district||area,
    cutStart, cutEnd: cutEnd||'غير محدد',
    lat: Number(lat)||0, lng: Number(lng)||0,
    status: 'مقطوع', votes: 1, confirms: 1, denies: 0,
    userId: userId||null, time: Date.now()
  };
  data.powerSchedule.unshift(entry);
  if (data.powerSchedule.length > 300) data.powerSchedule = data.powerSchedule.slice(0,300);
  io.emit('new_power_report', entry);
  saveData();
  res.json({success:true, data:entry});
});

app.post('/api/power/:id/vote', (req,res) => {
  const { vote } = req.body; // 'confirm' | 'deny'
  const entry = data.powerSchedule.find(p=>p.id===req.params.id);
  if (!entry) return res.status(404).json({error:'السجل غير موجود'});
  if (vote==='confirm') { entry.confirms++; entry.votes++; }
  else if (vote==='deny') { entry.denies++; }
  if (entry.denies > entry.confirms * 2) entry.status = 'غير مؤكد';
  else if (entry.confirms >= 3) entry.status = 'مؤكد';
  io.emit('power_vote_update', {id:entry.id, confirms:entry.confirms, denies:entry.denies, status:entry.status});
  saveData();
  res.json({success:true, data:entry});
});

/* ============================================================
   🕌 أوقات الصلاة - خوارزمية PrayTimes (MWL / Umm Al-Qura)
   ============================================================ */
function calcPrayerTimes(lat, lng, date, method, tz) {
  // Methods: 2=MWL, 4=Umm Al-Qura, 5=Egyptian, 3=ISNA
  const M = {
    2:  { fajr: 18.0, isha: 17.0 },   // MWL
    3:  { fajr: 15.0, isha: 15.0 },   // ISNA
    4:  { fajr: 18.5, ishaMin: 90 },   // Umm Al-Qura (isha = maghrib + 90 min)
    5:  { fajr: 19.5, isha: 17.5 },   // Egyptian
  };
  const conf = M[Number(method)] || M[4];
  const D2R = Math.PI / 180;
  const d = date || new Date();

  // Julian date
  function julianDate(year, month, day) {
    if (month <= 2) { year--; month += 12; }
    const A = Math.floor(year / 100);
    const B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
  }

  const JD = julianDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const T = (JD - 2451545.0) / 36525.0;

  // Sun position
  const L0 = (280.46646 + 36000.76983 * T) % 360;
  const M0 = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360;
  const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M0 * D2R)
           + (0.019993 - 0.000101 * T) * Math.sin(2 * M0 * D2R)
           +  0.000289 * Math.sin(3 * M0 * D2R);
  const SunLon = L0 + C;
  const omega  = 125.04 - 1934.136 * T;
  const lambda = SunLon - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const epsilon = 23.0 + 26.0 / 60.0 + 21.448 / 3600.0
               - (46.8150 / 3600.0) * T
               - (0.00059 / 3600.0) * T * T
               + (0.001813 / 3600.0) * T * T * T;
  const epsilonApp = epsilon + 0.00256 * Math.cos(omega * D2R);

  // Equation of time (minutes)
  const y    = Math.tan((epsilonApp / 2) * D2R) ** 2;
  const L0r  = L0 * D2R;
  const M0r  = M0 * D2R;
  const eot  = 4 * (y * Math.sin(2 * L0r)
             - 2 * 0.016708634 * Math.sin(M0r)
             + 4 * 0.016708634 * y * Math.sin(M0r) * Math.cos(2 * L0r)
             - 0.5 * y * y * Math.sin(4 * L0r)
             - 1.25 * 0.016708634 * 0.016708634 * Math.sin(2 * M0r)) * (180 / Math.PI);

  // Declination
  const decl = Math.asin(Math.sin(epsilonApp * D2R) * Math.sin(lambda * D2R)) / D2R;

  // Timezone offset (use passed tz or compute from longitude)
  const tzOffset = (tz !== undefined) ? Number(tz) : Math.round(lng / 15);
  const noon = 12 + tzOffset - lng / 15 - eot / 60;

  function hourAngle(altitude) {
    const cosH = (Math.sin(altitude * D2R) - Math.sin(lat * D2R) * Math.sin(decl * D2R))
               / (Math.cos(lat * D2R) * Math.cos(decl * D2R));
    if (cosH < -1 || cosH > 1) return null;
    return Math.acos(cosH) / D2R / 15;
  }

  function toTime(h) {
    if (h === null || isNaN(h)) return '--:--';
    h = ((h % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    const hh2 = mm === 60 ? hh + 1 : hh;
    const mm2 = mm === 60 ? 0 : mm;
    return String(hh2 % 24).padStart(2, '0') + ':' + String(mm2).padStart(2, '0');
  }

  const fajrHA    = hourAngle(-conf.fajr);
  const sunriseHA = hourAngle(-0.8333);
  const asrHA     = (function() {
    const shadowFactor = 1; // Shafi'i (1), Hanafi (2)
    const a = Math.atan(1 / (shadowFactor + Math.tan(Math.abs(lat - decl) * D2R))) / D2R;
    const cosH = (Math.sin(a * D2R) - Math.sin(lat * D2R) * Math.sin(decl * D2R))
               / (Math.cos(lat * D2R) * Math.cos(decl * D2R));
    if (cosH < -1 || cosH > 1) return null;
    return Math.acos(cosH) / D2R / 15;
  })();
  const ishaHA    = conf.ishaMin ? null : hourAngle(-conf.isha);

  const fajr   = toTime(noon - (fajrHA || 1.5));
  const sunrise = toTime(noon - (sunriseHA || 0.0889));
  const dhuhr  = toTime(noon + 0.0167); // +1 min
  const asr    = toTime(noon + (asrHA || 3.5));
  const maghrib = toTime(noon + (sunriseHA || 0.0889));
  const isha   = conf.ishaMin
    ? toTime(noon + (sunriseHA || 0.0889) + conf.ishaMin / 60)
    : toTime(noon + (ishaHA || 1.5));

  return { fajr, sunrise, dhuhr, asr, maghrib, isha, date: d.toLocaleDateString('ar-SA') };
}

app.get('/api/prayer', (req,res) => {
  const { lat=15.5007, lng=32.5599, method=4, tz=3 } = req.query;
  try {
    const times = calcPrayerTimes(Number(lat), Number(lng), new Date(), method, Number(tz));
    res.json({success:true, times, lat:Number(lat), lng:Number(lng)});
  } catch(e) {
    console.error('Prayer error:', e);
    res.status(500).json({error:'خطأ في حساب الأوقات'});
  }
});

/* ============================================================
   📸 رفع الصور (base64 — للعروض التجريبية)
   ============================================================ */
// data.images initialized in loadData()

app.post('/api/upload/image', (req,res) => {
  const { imageData, type='report', userId, refId } = req.body;
  if (!imageData) return res.status(400).json({error:'البيانات مطلوبة'});
  if (imageData.length > 2*1024*1024) return res.status(413).json({error:'الصورة كبيرة جداً (الحد 1.5 ميغابايت)'});
  const id = uuidv4();
  data.images[id] = { id, data: imageData, type, userId: userId||null, refId: refId||null, time: Date.now() };
  // cleanup old images > 100
  const keys = Object.keys(data.images);
  if (keys.length > 100) { delete data.images[keys[0]]; }
  res.json({success:true, imageId: id, url: '/api/image/'+id});
});

app.get('/api/image/:id', (req,res) => {
  const img = data.images[req.params.id];
  if (!img) return res.status(404).json({error:'الصورة غير موجودة'});
  const matches = img.data.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({error:'بيانات غير صالحة'});
  const buf = Buffer.from(matches[2], 'base64');
  res.set('Content-Type', matches[1]);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buf);
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const cities = GEO.sudan.reduce((s,st)=>s+st.cities.length,0);
  const hoods  = GEO.sudan.reduce((s,st)=>s+st.cities.reduce((ss,c)=>ss+c.hoods.length,0),0);
  const world  = GEO.world.length;
  console.log(`🚀 نبض يعمل على المنفذ ${PORT}`);
  console.log(`🇸🇩 ${GEO.sudan.length} ولاية | ${cities} مدينة | ${hoods} حي`);
  console.log(`🌍 ${world} دولة عالمية`);
  console.log(`✅ لا توجد بيانات وهمية - كل شيء حقيقي من المستخدمين`);
  console.log(`🛒 P2P سوق + دردشة + تتبع مباشر مفعّل`);
});

/* ============================================================
   🏥 HOSPITALS - دليل المستشفيات
   ============================================================ */
app.get('/api/hospitals', (req,res) => {
  const { area, type, lat, lng, r=30 } = req.query;
  let list = [...data.hospitals].sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (area) list = list.filter(h => (h.area||'').includes(area));
  if (type) list = list.filter(h => h.type === type);
  if (lat && lng) {
    list = list.map(h => ({ ...h, dist: h.lat && h.lng ? haversine(Number(lat),Number(lng),h.lat,h.lng) : 9999 }))
               .filter(h => h.dist <= Number(r))
               .sort((a,b) => a.dist - b.dist);
  }
  res.json(list.slice(0,60));
});

app.post('/api/hospitals', (req,res) => {
  const { name, type='مستشفى', area, address, phone, emergency=false, lat, lng, services=[] } = req.body;
  if (!name || !area) return res.status(400).json({error:'الاسم والمنطقة مطلوبان'});
  const h = { id: uuidv4(), name: name.trim(), type, area: area.trim(), address: address||'', phone: phone||'',
    emergency: !!emergency, lat: lat||null, lng: lng||null, services,
    rating: 0, ratingCount: 0, userId: req.body.userId||null,
    createdAt: new Date().toISOString(), time: Date.now() };
  data.hospitals.unshift(h);
  if (data.hospitals.length > 300) data.hospitals = data.hospitals.slice(0,300);
  saveData();
  io.emit('new_hospital', h);
  res.json({success:true, id:h.id, hospital:h});
});

app.post('/api/hospitals/:id/rate', (req,res) => {
  const h = data.hospitals.find(x=>x.id===req.params.id);
  if (!h) return res.status(404).json({error:'غير موجود'});
  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({error:'تقييم 1-5'});
  h.rating = ((h.rating * h.ratingCount) + Number(rating)) / (h.ratingCount + 1);
  h.ratingCount++;
  saveData();
  res.json({success:true, rating: h.rating.toFixed(1), count: h.ratingCount});
});

/* ============================================================
   📰 NEWS - الأخبار المحلية
   ============================================================ */
app.get('/api/news', (req,res) => {
  const { area, cat } = req.query;
  let list = [...data.news].sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (area) list = list.filter(n=>(n.area||'').includes(area));
  if (cat)  list = list.filter(n=>n.category===cat);
  res.json(list.slice(0,50));
});

app.post('/api/news', (req,res) => {
  const { title, body, category='عام', area, lat, lng, source } = req.body;
  if (!title||!body) return res.status(400).json({error:'العنوان والمحتوى مطلوبان'});
  const item = { id: uuidv4(), title: title.trim(), body: body.trim(), category,
    area: area||'', source: source||'مستخدم', lat: lat||null, lng: lng||null,
    upvotes: 0, downvotes: 0, views: 0,
    author: req.body.author||'مجهول', userId: req.body.userId||null,
    createdAt: new Date().toISOString(), time: Date.now() };
  data.news.unshift(item);
  if (data.news.length > 200) data.news = data.news.slice(0,200);
  saveData();
  io.emit('new_news', item);
  res.json({success:true, id:item.id, item});
});

app.post('/api/news/:id/vote', (req,res) => {
  const item = data.news.find(x=>x.id===req.params.id);
  if (!item) return res.status(404).json({error:'غير موجود'});
  const { dir, vote } = req.body;
  if (dir === 'up' || vote === 'credible') item.upvotes = (item.upvotes||0)+1;
  else { item.downvotes = (item.downvotes||0)+1; item.notCredible = (item.notCredible||0)+1; }
  saveData();
  io.emit('news_vote', {id:item.id, upvotes:item.upvotes, downvotes:item.downvotes});
  res.json({success:true, upvotes:item.upvotes, downvotes:item.downvotes});
});

/* ============================================================
   🚗 CARPOOLING - مشاركة التنقل
   ============================================================ */
app.get('/api/rides', (req,res) => {
  const { from, to, date } = req.query;
  let list = data.rides.filter(r=>r.status==='active').sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (from) list = list.filter(r=>(r.from||'').includes(from));
  if (to)   list = list.filter(r=>(r.to||'').includes(to));
  if (date) list = list.filter(r=>r.date===date);
  res.json(list.slice(0,60));
});

app.post('/api/rides', (req,res) => {
  const { from, to, date, time: rtime, seats=1, price=0, currency='SDG', contact, notes, lat, lng } = req.body;
  if (!from||!to||!contact) return res.status(400).json({error:'من/إلى/التواصل مطلوبة'});
  const ride = { id: uuidv4(), from: from.trim(), to: to.trim(), date: date||'', time: rtime||'',
    seats: Number(seats), seatsLeft: Number(seats), price: Number(price), currency,
    contact: contact.trim(), notes: notes||'', lat: lat||null, lng: lng||null,
    status: 'active', requests: [], userId: req.body.userId||null,
    author: req.body.author||'مجهول', createdAt: new Date().toISOString(), postedAt: Date.now() };
  data.rides.unshift(ride);
  if (data.rides.length > 200) data.rides = data.rides.slice(0,200);
  saveData();
  io.emit('new_ride', ride);
  res.json({success:true, id:ride.id, ride});
});

app.post('/api/rides/:id/request', (req,res) => {
  const ride = data.rides.find(r=>r.id===req.params.id);
  if (!ride) return res.status(404).json({error:'الرحلة غير موجودة'});
  if (ride.seatsLeft < 1) return res.status(400).json({error:'لا توجد مقاعد متاحة'});
  ride.seatsLeft = Math.max(0, ride.seatsLeft - 1);
  if (ride.seatsLeft === 0) ride.status = 'full';
  ride.requests.push({ name: req.body.name||'مستخدم', contact: req.body.contact||'', time: Date.now() });
  saveData();
  io.emit('ride_update', {id:ride.id, seatsLeft:ride.seatsLeft, status:ride.status});
  res.json({success:true, seatsLeft:ride.seatsLeft});
});

/* ============================================================
   💧 WATER REPORTS - تقارير المياه
   ============================================================ */
app.get('/api/water', (req,res) => {
  const { area, lat, lng, r=25 } = req.query;
  let list = [...data.waterReports].sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (area) list = list.filter(w=>(w.area||'').includes(area));
  if (lat && lng) {
    list = list.map(w=>({...w, dist: w.lat&&w.lng ? haversine(Number(lat),Number(lng),w.lat,w.lng):9999}))
               .filter(w=>w.dist<=Number(r)).sort((a,b)=>a.dist-b.dist);
  }
  res.json(list.slice(0,60));
});

app.post('/api/water', (req,res) => {
  const { type='cut', area, duration, notes, lat, lng } = req.body;
  if (!area) return res.status(400).json({error:'المنطقة مطلوبة'});
  const item = { id: uuidv4(), type, area: area.trim(), duration: duration||'',
    notes: notes||'', lat: lat||null, lng: lng||null,
    upvotes: 1, downvotes: 0, status: 'active',
    userId: req.body.userId||null, createdAt: new Date().toISOString(), time: Date.now() };
  data.waterReports.unshift(item);
  if (data.waterReports.length > 200) data.waterReports = data.waterReports.slice(0,200);
  saveData(); io.emit('new_water_report', item);
  res.json({success:true, id:item.id, item});
});

app.post('/api/water/:id/vote', (req,res) => {
  const item = data.waterReports.find(x=>x.id===req.params.id);
  if (!item) return res.status(404).json({error:'غير موجود'});
  const dir = req.body.dir || req.body.vote;
  if (dir === 'up' || dir === 'confirm') item.upvotes = (item.upvotes||0)+1;
  else item.downvotes = (item.downvotes||0)+1;
  saveData();
  res.json({success:true, upvotes:item.upvotes, downvotes:item.downvotes});
});

/* ============================================================
   🎓 STUDY GROUPS - مجموعات التعلم
   ============================================================ */
app.get('/api/study', (req,res) => {
  const groups = Object.values(data.studyGroups).sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  res.json(groups.slice(0,50));
});

app.post('/api/study', (req,res) => {
  const { name, subject, level, area, maxMembers=20, schedule, contact } = req.body;
  if (!name||!subject) return res.status(400).json({error:'اسم المجموعة والمادة مطلوبان'});
  const id = uuidv4();
  const userId = req.body.userId||null;
  const group = { id, name: name.trim(), subject: subject.trim(), level: level||'عام',
    area: area||'', maxMembers: Number(maxMembers), members: userId ? [userId] : [],
    schedule: schedule||'', contact: contact||'', messages: [],
    userId, author: req.body.author||'مجهول', createdAt: new Date().toISOString(), time: Date.now() };
  data.studyGroups[id] = group;
  saveData(); io.emit('new_study_group', group);
  res.json({success:true, id, group});
});

app.post('/api/study/:id/join', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'المجموعة غير موجودة'});
  if (!Array.isArray(g.members)) g.members = [];
  const uid = req.body.userId;
  if (uid && !g.members.includes(uid)) {
    if (g.members.length >= g.maxMembers) return res.status(400).json({error:'المجموعة ممتلئة'});
    g.members.push(uid);
  }
  saveData();
  io.emit('study_join', {id:g.id, members:g.members});
  res.json({success:true, members:g.members});
});

// Join via invite token - MUST be before /:id routes
app.post('/api/study/join-invite/:token', (req,res) => {
  const g = Object.values(data.studyGroups).find(g=>g.inviteToken===req.params.token);
  if (!g) return res.status(404).json({error:'رابط الدعوة غير صالح'});
  if (!Array.isArray(g.members)) g.members=[];
  const uid = req.body.userId;
  if (uid && !g.members.includes(uid)) {
    if (g.members.length >= (g.maxMembers||20)) return res.status(400).json({error:'المجموعة ممتلئة'});
    g.members.push(uid);
  }
  saveData();
  io.emit('study_join', {id:g.id, members:g.members});
  res.json({success:true, group: g});
});

/* ============================================================
   📎 GROUP ADVANCED MSG (with media, replies, reactions)
   NOTE: Must come BEFORE :id/msg to avoid route collision
   ============================================================ */
app.post('/api/study/:id/msg/advanced', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  const { text='', author='عضو', userId=null, replyTo=null, mediaType=null, mediaData=null, mediaName=null } = req.body;
  const msg = {
    id: uuidv4(),
    text: text.trim(),
    author,
    userId,
    replyTo,          // { id, text, author }
    mediaType,        // 'image' | 'video' | 'audio' | null
    mediaData,        // base64 data URL or null
    mediaName,
    reactions: {},    // { emoji: [userId, ...] }
    createdAt: new Date().toISOString(),
    time: Date.now()
  };
  if (!g.messages) g.messages = [];
  g.messages.push(msg);
  if (g.messages.length > 200) g.messages = g.messages.slice(-200);
  saveData();
  io.to('study:' + req.params.id).emit('study_msg', { groupId: req.params.id, msg });
  res.json({ success: true, msg });
});

// Basic msg route (kept for backward compat, after advanced to avoid conflict)
app.post('/api/study/:id/msg', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  const { text='', author, name, userId=null, mediaType=null, mediaData=null, mediaName=null } = req.body;
  const msg = {
    id: uuidv4(),
    text: text.trim(),
    author: author || name || 'عضو',
    userId,
    mediaType: mediaType || null,
    mediaData: mediaData || null,
    mediaName: mediaName || null,
    createdAt: new Date().toISOString(),
    time: Date.now(),
    reactions: {}
  };
  if (!g.messages) g.messages=[];
  g.messages.push(msg);
  if (g.messages.length>200) g.messages=g.messages.slice(-200);
  saveData();
  io.to('study:'+req.params.id).emit('study_msg', {groupId:req.params.id, msg});
  res.json({success:true, msg});
});

// Messages alias
app.get('/api/study/:id/messages', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.json([]);
  res.json(g.messages || []);
});

app.post('/api/study/:id/message', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  const msg = { id:uuidv4(), text:req.body.text||'', author:req.body.author||'عضو', userId:req.body.userId||null, createdAt:new Date().toISOString(), time:Date.now(), reactions:{} };
  if (!g.messages) g.messages=[];
  g.messages.push(msg);
  if (g.messages.length>200) g.messages=g.messages.slice(-200);
  saveData();
  io.to('study:'+req.params.id).emit('study_msg', {groupId:req.params.id, msg});
  res.json({success:true, msg});
});

// React to a message
app.post('/api/study/:id/msg/:msgId/react', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  const msg = (g.messages||[]).find(m=>m.id===req.params.msgId);
  if (!msg) return res.status(404).json({error:'الرسالة غير موجودة'});
  const { emoji, userId } = req.body;
  if (!emoji||!userId) return res.status(400).json({error:'مطلوب'});
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
  const idx = msg.reactions[emoji].indexOf(userId);
  if (idx>=0) msg.reactions[emoji].splice(idx,1); else msg.reactions[emoji].push(userId);
  if (msg.reactions[emoji].length===0) delete msg.reactions[emoji];
  saveData();
  io.to('study:'+req.params.id).emit('study_react', {groupId:req.params.id, msgId:req.params.msgId, reactions:msg.reactions});
  res.json({success:true, reactions:msg.reactions});
});

// Get single group info
app.get('/api/study/:id', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  res.json(g);
});

// Generate invite link (returns token stored on group)
app.post('/api/study/:id/invite', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  if (!g.inviteToken) g.inviteToken = uuidv4().replace(/-/g,'').slice(0,12);
  saveData();
  res.json({success:true, token: g.inviteToken, groupId: g.id});
});

// Update group info
app.put('/api/study/:id', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  const allowed = ['name','subject','level','area','maxMembers','schedule','contact','description','avatar'];
  allowed.forEach(k=>{ if (req.body[k]!==undefined) g[k]=req.body[k]; });
  saveData();
  io.emit('study_updated', g);
  res.json({success:true, group:g});
});

// Leave group
app.post('/api/study/:id/leave', (req,res) => {
  const g = data.studyGroups[req.params.id];
  if (!g) return res.status(404).json({error:'غير موجود'});
  const uid = req.body.userId;
  if (uid && Array.isArray(g.members)) g.members = g.members.filter(m=>m!==uid);
  saveData();
  io.emit('study_join', {id:g.id, members:g.members});
  res.json({success:true, members:g.members});
});

/* ============================================================
   🎙️ WebRTC SIGNALING (Socket-based but REST fallback)
   ============================================================ */
// These are handled via socket.io events: webrtc_offer, webrtc_answer, webrtc_ice, call_request, call_accept, call_reject, call_end

/* ============================================================
   📦 HELP REQUESTS - طلبات المساعدة
   ============================================================ */
app.get('/api/help', (req,res) => {
  const { type, area } = req.query;
  let list = data.helpRequests.filter(h=>h.status!=='closed').sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0));
  if (type) list = list.filter(h=>h.type===type);
  if (area) list = list.filter(h=>(h.area||'').includes(area));
  res.json(list.slice(0,60));
});

app.post('/api/help', (req,res) => {
  const { type='other', title, desc, area, contact, urgent=false, lat, lng } = req.body;
  if (!title||!contact) return res.status(400).json({error:'العنوان والتواصل مطلوبان'});
  const item = { id:uuidv4(), type, title:title.trim(), desc:desc||'',
    area:area||'', contact:contact.trim(), urgent:!!urgent,
    lat:lat||null, lng:lng||null, offers:0, status:'open',
    author:req.body.author||'مجهول', userId:req.body.userId||null,
    createdAt: new Date().toISOString(), time:Date.now() };
  data.helpRequests.unshift(item);
  if (data.helpRequests.length>200) data.helpRequests=data.helpRequests.slice(0,200);
  saveData(); io.emit('new_help_request', item);
  res.json({success:true, id:item.id, item});
});

app.post('/api/help/:id/offer', (req,res) => {
  const item = data.helpRequests.find(x=>x.id===req.params.id);
  if (!item) return res.status(404).json({error:'غير موجود'});
  item.offers = (item.offers||0)+1;
  saveData();
  io.emit('help_offer', {id:item.id, offers:item.offers});
  res.json({success:true, offers:item.offers});
});

app.post('/api/help/:id/close', (req,res) => {
  const item = data.helpRequests.find(x=>x.id===req.params.id);
  if (!item) return res.status(404).json({error:'غير موجود'});
  item.status = 'closed';
  data.stats.lives_saved = (data.stats.lives_saved||0)+1;
  saveData();
  io.emit('stats_update', data.stats);
  res.json({success:true});
});

/* ============================================================
   🗳️ POLLS - استطلاعات الرأي
   ============================================================ */
app.get('/api/polls', (req,res) => {
  res.json([...data.polls].sort((a,b)=>(b.time||b.ts||0)-(a.time||a.ts||0)).slice(0,30));
});

app.post('/api/polls', (req,res) => {
  const { question, options=[], area } = req.body;
  const expiresIn = Number(req.body.expiry || req.body.expiresIn || 24);
  if (!question || options.length < 2) return res.status(400).json({error:'السؤال وخيارين على الأقل مطلوبان'});
  const poll = { id:uuidv4(), question:question.trim(),
    options: options.slice(0,8).map(o=>({text:String(o).trim(), votes:0})),
    voters:{}, area:area||'', totalVotes:0,
    expiresAt: Date.now()+(expiresIn*3600000),
    userId:req.body.userId||null, author:req.body.author||'مجهول',
    createdAt: new Date().toISOString(), time:Date.now() };
  data.polls.unshift(poll);
  if (data.polls.length>100) data.polls=data.polls.slice(0,100);
  saveData(); io.emit('new_poll', poll);
  res.json({success:true, id:poll.id, poll});
});

app.post('/api/polls/:id/vote', (req,res) => {
  const poll = data.polls.find(x=>x.id===req.params.id);
  if (!poll) return res.status(404).json({error:'غير موجود'});
  if (poll.expiresAt < Date.now()) return res.status(400).json({error:'انتهى الاستطلاع'});
  const idx = Number(req.body.optionIndex !== undefined ? req.body.optionIndex : req.body.option);
  if (isNaN(idx)||!poll.options[idx]) return res.status(400).json({error:'خيار غير صالح'});
  const uid = req.body.userId;
  if (!poll.voters) poll.voters={};
  if (uid && poll.voters[uid] !== undefined) return res.status(400).json({error:'لقد صوّتت مسبقاً'});
  poll.options[idx].votes++;
  poll.totalVotes = (poll.totalVotes||0)+1;
  if (uid) poll.voters[uid] = idx;
  saveData();
  io.emit('poll_vote', {id:poll.id, options:poll.options, totalVotes:poll.totalVotes});
  res.json({success:true, options:poll.options, totalVotes:poll.totalVotes});
});

/* ============================================================
   🌦️ WEATHER - الطقس (local estimation based on Sudan climate)
   ============================================================ */
app.get('/api/weather', (req, res) => {
  const lat = parseFloat(req.query.lat) || 15.5;
  const lng = parseFloat(req.query.lng) || 32.56;
  // Sudan climate simulation based on month
  const month = new Date().getMonth(); // 0-11
  // Khartoum climate averages
  const monthData = [
    { temp:29, tempMax:35, tempMin:23, humidity:15, condition:'Clear', description:'صحو ومشمس' },   // Jan
    { temp:31, tempMax:38, tempMin:24, humidity:12, condition:'Clear', description:'صحو ومشمس' },   // Feb
    { temp:35, tempMax:42, tempMin:28, humidity:10, condition:'Clear', description:'حار وجاف' },    // Mar
    { temp:39, tempMax:44, tempMin:33, humidity:10, condition:'Clear', description:'حار جداً' },    // Apr
    { temp:41, tempMax:46, tempMin:36, humidity:12, condition:'Clear', description:'حار جداً' },    // May
    { temp:39, tempMax:43, tempMin:34, humidity:25, condition:'Clouds', description:'غائم جزئياً' }, // Jun
    { temp:35, tempMax:39, tempMin:30, humidity:50, condition:'Rain', description:'ممطر' },          // Jul
    { temp:33, tempMax:37, tempMin:29, humidity:60, condition:'Rain', description:'ممطر' },          // Aug
    { temp:34, tempMax:39, tempMin:29, humidity:45, condition:'Clouds', description:'غائم جزئياً' }, // Sep
    { temp:36, tempMax:41, tempMin:31, humidity:22, condition:'Clear', description:'صحو' },          // Oct
    { temp:33, tempMax:39, tempMin:27, humidity:15, condition:'Clear', description:'صحو لطيف' },     // Nov
    { temp:29, tempMax:35, tempMin:22, humidity:14, condition:'Clear', description:'صحو ولطيف' },    // Dec
  ];
  const base = monthData[month];
  // Add some variation based on location
  const variation = Math.sin(lat * lng) * 2;
  const sunrise = '06:' + String(20 + Math.floor(Math.abs(variation))).padStart(2,'0');
  const sunset = '18:' + String(10 + Math.floor(Math.abs(variation))).padStart(2,'0');
  // City name lookup (simple)
  const cities = {
    'الخرطوم': [15.5, 32.56], 'أم درمان': [15.64, 32.48], 'الخرطوم بحري': [15.61, 32.55],
    'بورتسودان': [19.6, 37.22], 'كسلا': [15.45, 36.4], 'القضارف': [14.03, 35.39],
    'ود مدني': [14.4, 33.52], 'عطبرة': [17.7, 33.97], 'الأبيض': [13.18, 30.22]
  };
  let city = 'الخرطوم';
  let minDist = 999;
  Object.entries(cities).forEach(([name, [clat, clng]]) => {
    const d = Math.sqrt(Math.pow(lat-clat,2) + Math.pow(lng-clng,2));
    if (d < minDist) { minDist = d; city = name; }
  });
  res.json({
    city,
    temp: Math.round(base.temp + variation),
    tempMax: Math.round(base.tempMax + variation),
    tempMin: Math.round(base.tempMin + variation),
    feelsLike: Math.round(base.temp + variation + 2),
    humidity: base.humidity,
    windSpeed: Math.round(10 + Math.abs(variation) * 3),
    visibility: 10000,
    condition: base.condition,
    description: base.description,
    sunrise,
    sunset,
    source: 'estimate'
  });
});

/* ============================================================
   📊 STATS DASHBOARD - لوحة الإحصاءات
   ============================================================ */
app.get('/api/dashboard', (_,res) => {
  const now = Date.now();
  const day = 24*3600000;
  const topAreas = (() => {
    const all = [
      ...data.alerts, ...data.marketplace, ...data.medicines,
      ...data.voiceItems, ...(data.helpRequests||[]), ...(data.news||[])
    ].map(x=>x.area||x.district).filter(Boolean);
    const cnt = {};
    all.forEach(a=>{ cnt[a]=(cnt[a]||0)+1; });
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([area,count])=>({area,count}));
  })();
  const onlineCount = Object.keys(data.onlineUsers||{}).length;
  res.json({
    stats: {
      online:      onlineCount,
      users:       data.stats.users || onlineCount,
      reports:     data.stats.reports,
      lives:       data.stats.lives_saved,
      cities:      data.stats.cities,
      exchange:    data.exchangeRates.length,
      medicines:   data.medicines.length,
      voice:       data.voiceItems.length,
      skills:      data.skills.length,
      market:      data.marketplace.length,
      bloodDonors: data.bloodDonors.length,
      power:       data.powerSchedule.length,
      hospitals:   (data.hospitals||[]).length,
      news:        (data.news||[]).length,
      rides:       (data.rides||[]).filter(r=>r.status==='active').length,
      water:       (data.waterReports||[]).length,
      study:       Object.keys(data.studyGroups||{}).length,
      help:        (data.helpRequests||[]).filter(h=>h.status!=='closed').length,
      polls:       (data.polls||[]).filter(p=>p.expiresAt>now).length,
    },
    topAreas: topAreas.slice(0,10).map(({area,count})=>({name:area,count})),
    last24h: {
      '🗺️ بلاغات':  data.alerts.filter(x=>x.time>now-day).length,
      '🛒 إعلانات': data.marketplace.filter(x=>x.time>now-day).length,
      '📰 أخبار':   (data.news||[]).filter(x=>x.time>now-day).length,
      '📦 مساعدة':  (data.helpRequests||[]).filter(x=>x.time>now-day).length,
    }
  });
});

/* ================================================================
   🔥 VIRAL FEATURES SERVER ENDPOINTS
   نقاط | متصدرون | إحالة | إحصاءات حية | بلاغات فيروسية
================================================================ */

// ── In-memory leaderboard store (persisted to data.leaderboard) ─
if (!data.leaderboard)  data.leaderboard  = [];
if (!data.referrals)    data.referrals    = [];
if (!data.pointEvents)  data.pointEvents  = [];

// ── GET /api/leaderboard ──────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const tab   = req.query.tab   || 'weekly';
  const limit = parseInt(req.query.limit) || 50;
  const now   = Date.now();
  const week  = 7 * 24 * 3600 * 1000;

  let list = [...(data.leaderboard || [])];

  if (tab === 'weekly') {
    list = list.filter(u => u.lastActivity && now - u.lastActivity < week);
    list.sort((a, b) => (b.weekPts || 0) - (a.weekPts || 0));
  } else if (tab === 'city') {
    const userId = req.query.userId;
    const user   = userId && data.leaderboard.find(u => u.userId === userId);
    const city   = user ? user.area : null;
    if (city) list = list.filter(u => u.area === city);
    list.sort((a, b) => (b.pts || 0) - (a.pts || 0));
  } else {
    list.sort((a, b) => (b.pts || 0) - (a.pts || 0));
  }

  const trimmed = list.slice(0, limit).map((u, i) => ({
    rank: i + 1,
    userId: u.userId,
    name:   u.name   || 'مستخدم',
    area:   u.area   || '',
    pts:    tab === 'weekly' ? (u.weekPts || 0) : (u.pts || 0),
    avatar: u.avatar || null,
    badges: u.badges || []
  }));

  const userId  = req.query.userId;
  const myEntry = userId ? data.leaderboard.find(u => u.userId === userId) : null;
  const myRank  = myEntry ? {
    rank: list.findIndex(u => u.userId === userId) + 1,
    pts:  tab === 'weekly' ? (myEntry.weekPts || 0) : (myEntry.pts || 0)
  } : null;

  res.json({ list: trimmed, myRank, total: list.length });
});

// ── POST /api/points/add ───────────────────────────────────────
app.post('/api/points/add', (req, res) => {
  const { userId, action, pts, name, area, avatar } = req.body;
  if (!userId || !pts) return res.json({ ok: false });

  if (!data.leaderboard) data.leaderboard = [];
  let user = data.leaderboard.find(u => u.userId === userId);
  if (!user) {
    user = { userId, name: name || 'مستخدم', area: area || '', pts: 0, weekPts: 0, badges: [], lastActivity: Date.now() };
    data.leaderboard.push(user);
  }
  user.pts          = (user.pts || 0) + pts;
  user.weekPts      = (user.weekPts || 0) + pts;
  user.lastActivity = Date.now();
  if (name)   user.name   = name;
  if (area)   user.area   = area;
  if (avatar) user.avatar = avatar;

  // Keep leaderboard lean
  if (data.leaderboard.length > 5000) {
    data.leaderboard.sort((a, b) => (b.pts||0)-(a.pts||0));
    data.leaderboard = data.leaderboard.slice(0, 2000);
  }

  saveData();
  io.emit('points_update', { userId, pts: user.pts, weekPts: user.weekPts });
  res.json({ ok: true, total: user.pts, weekPts: user.weekPts });
});

// ── POST /api/referral ─────────────────────────────────────────
app.post('/api/referral', (req, res) => {
  const { ref, newUser } = req.body;
  if (!ref || !newUser) return res.json({ ok: false });

  // Find referrer user by partial id
  const referrer = data.leaderboard ? data.leaderboard.find(u => u.userId && u.userId.startsWith(ref)) : null;
  if (!referrer) return res.json({ ok: false, msg: 'referrer not found' });

  // Prevent duplicate rewards
  if (!data.referrals) data.referrals = [];
  if (data.referrals.find(r => r.ref === ref && r.newUser === newUser)) {
    return res.json({ ok: false, msg: 'already rewarded' });
  }

  data.referrals.push({ ref, newUser, time: Date.now() });
  referrer.pts     = (referrer.pts     || 0) + 20;
  referrer.weekPts = (referrer.weekPts || 0) + 20;
  saveData();
  io.emit('points_update', { userId: referrer.userId, pts: referrer.pts });
  res.json({ ok: true, referrerName: referrer.name });
});

// ── GET /api/stats/live ────────────────────────────────────────
app.get('/api/stats/live', (req, res) => {
  const now  = Date.now();
  const hour = 3600 * 1000;
  const day  = 24 * hour;

  const activeAlerts  = data.alerts.filter(a => now - (a.time||0) < 2*hour).length;
  const todayReports  = data.alerts.filter(a => now - (a.time||0) < day).length;
  const activeZones   = new Set(data.alerts.filter(a => now - (a.time||0) < 2*hour).map(a => a.area).filter(Boolean)).size;

  // Find trending topic (most common area in last 2h)
  const areaCounts = {};
  data.alerts.filter(a => now - (a.time||0) < 2*hour).forEach(a => {
    if (a.area) areaCounts[a.area] = (areaCounts[a.area]||0) + 1;
  });
  const trending = Object.entries(areaCounts).sort((a,b)=>b[1]-a[1])[0];

  res.json({
    online:       data.stats.users || 0,
    users:        data.stats.users || 0,
    todayReports,
    activeAlerts,
    activeZones,
    lives_saved:  data.stats.lives_saved || 0,
    trending:     trending ? trending[0] : '---',
    cities:       data.stats.cities || 0
  });
});

// ── GET /api/alerts/viral ──────────────────────────────────────
app.get('/api/alerts/viral', (req, res) => {
  const now = Date.now();
  const day = 24 * 3600 * 1000;

  // Score = votes*3 + shares*5 + views*0.5
  const scored = data.alerts
    .filter(a => now - (a.time||0) < day)
    .map(a => ({
      ...a,
      _score: (a.votes||0)*3 + (a.shares||0)*5 + (a.views||0)*0.5
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 10)
    .map(({ _score, ...a }) => a);

  res.json(scored);
});

// ── POST /api/alerts/:id/view ──────────────────────────────────
app.post('/api/alerts/:id/view', (req, res) => {
  const alert = data.alerts.find(a => a.id === req.params.id);
  if (!alert) return res.json({ ok: false });
  alert.views = (alert.views || 0) + 1;
  saveData();
  res.json({ ok: true, views: alert.views });
});

// ── POST /api/alerts/:id/share ─────────────────────────────────
app.post('/api/alerts/:id/share', (req, res) => {
  const alert = data.alerts.find(a => a.id === req.params.id);
  if (!alert) return res.json({ ok: false });
  alert.shares = (alert.shares || 0) + 1;
  saveData();
  io.emit('alert_shared', { id: alert.id, shares: alert.shares });
  res.json({ ok: true, shares: alert.shares });
});

// ── Weekly reset (every Monday midnight) ─────────────────────
setInterval(() => {
  const d = new Date();
  if (d.getDay() === 1 && d.getHours() === 0 && d.getMinutes() < 5) {
    if (data.leaderboard) {
      data.leaderboard.forEach(u => { u.weekPts = 0; });
      saveData();
      io.emit('leaderboard_reset', { msg: 'تمت إعادة تعيين نقاط الأسبوع!' });
    }
  }
}, 5 * 60 * 1000); // check every 5 min


/* ============================================================
   🚀 ADVANCED FEATURES v7 — نبض المستقبل
   ============================================================ */

// ── Global Search API ──────────────────────────────────────────
app.get('/api/search', rateLimit(60, 60000), (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json({ results: [] });
  const results = [];
  // Alerts
  data.alerts.filter(a => (a.msg||'').toLowerCase().includes(q) || (a.area||'').toLowerCase().includes(q))
    .slice(0,5).forEach(a => results.push({ type:'alert', icon:a.icon||'🔴', title:a.msg, sub:a.area, id:a.id, section:'map' }));
  // Market
  data.marketplace.filter(m => (m.title||'').toLowerCase().includes(q) || (m.desc||'').toLowerCase().includes(q))
    .slice(0,5).forEach(m => results.push({ type:'market', icon:'🛒', title:m.title, sub:m.area||'', id:m.id, section:'market' }));
  // Medicine
  data.medicines.filter(m => (m.name||'').toLowerCase().includes(q) || (m.pharmacy||'').toLowerCase().includes(q))
    .slice(0,3).forEach(m => results.push({ type:'medicine', icon:'💊', title:m.name, sub:m.pharmacy||'', section:'medicine' }));
  // News
  (data.news||[]).filter(n => (n.title||n.text||'').toLowerCase().includes(q))
    .slice(0,3).forEach(n => results.push({ type:'news', icon:'📰', title:n.title||n.text, sub:n.area||'', section:'news' }));
  // Blood donors
  data.bloodDonors.filter(d => (d.name||'').toLowerCase().includes(q) || (d.type||'').toLowerCase().includes(q))
    .slice(0,3).forEach(d => results.push({ type:'blood', icon:'🩸', title:d.name+' — '+d.type, sub:d.area||'', section:'blood' }));
  // People profiles
  Object.values(data.profiles).filter(p => (p.name||'').toLowerCase().includes(q) || (p.area||'').toLowerCase().includes(q))
    .slice(0,5).forEach(p => results.push({ type:'person', icon:'👤', title:p.name||'مستخدم', sub:p.area||'', userId:p.userId, section:'people' }));
  res.json({ results: results.slice(0, 20) });
});

// ── Notifications Center API ────────────────────────────────────
if (!data.notifications) data.notifications = {};
app.get('/api/notifications/:userId', (req, res) => {
  const notifs = (data.notifications[req.params.userId] || []).slice(-50).reverse();
  res.json(notifs);
});
app.post('/api/notifications/:userId/read', (req, res) => {
  if (data.notifications[req.params.userId]) {
    data.notifications[req.params.userId].forEach(n => n.read = true);
    saveData();
  }
  res.json({ ok: true });
});
app.delete('/api/notifications/:userId', (req, res) => {
  data.notifications[req.params.userId] = [];
  saveData();
  res.json({ ok: true });
});

// ── Market Advanced Search ──────────────────────────────────────
app.get('/api/market/search', rateLimit(120, 60000), (req, res) => {
  const { q='', type='all', cat='all', minPrice, maxPrice, area='', sort='newest' } = req.query;
  let list = [...data.marketplace];
  if (q) list = list.filter(m => (m.title||'').toLowerCase().includes(q.toLowerCase()) || (m.desc||'').toLowerCase().includes(q.toLowerCase()));
  if (type !== 'all') list = list.filter(m => m.type === type);
  if (cat !== 'all') list = list.filter(m => m.category === cat);
  if (area) list = list.filter(m => (m.area||'').includes(area));
  if (minPrice) list = list.filter(m => parseFloat(m.price||0) >= parseFloat(minPrice));
  if (maxPrice) list = list.filter(m => parseFloat(m.price||0) <= parseFloat(maxPrice));
  if (sort === 'newest') list.sort((a,b) => (b.time||0)-(a.time||0));
  else if (sort === 'price_asc') list.sort((a,b) => parseFloat(a.price||0)-parseFloat(b.price||0));
  else if (sort === 'price_desc') list.sort((a,b) => parseFloat(b.price||0)-parseFloat(a.price||0));
  else if (sort === 'popular') list.sort((a,b) => (b.likes||0)-(a.likes||0));
  res.json(list.slice(0, 50));
});

// ── Blood Emergency Notify ──────────────────────────────────────
app.post('/api/blood/emergency', rateLimit(5, 60000), (req, res) => {
  const { type, area, hospital, contactPhone, urgent=true } = req.body;
  if (!type) return res.status(400).json({ error: 'فصيلة الدم مطلوبة' });
  const alert = {
    id: uuidv4(),
    type: 'blood_emergency',
    bloodType: type,
    area: area || 'غير محدد',
    hospital,
    contactPhone,
    urgent,
    time: Date.now()
  };
  io.emit('blood_emergency', alert);
  // Notify matching donors
  const donors = data.bloodDonors.filter(d => d.type === type);
  donors.forEach(d => {
    if (d.userId && data.onlineUsers) {
      const sock = Object.values(data.onlineUsers).find(u => u.userId === d.userId);
      if (sock) io.to(sock.socketId).emit('blood_needed', alert);
    }
  });
  res.json({ ok: true, notified: donors.length });
});

// ── Live Stats SSE endpoint ──────────────────────────────────────
app.get('/api/stats/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.flushHeaders();
  const send = () => {
    const stats = {
      online: Object.keys(data.onlineUsers||{}).length,
      reports: data.stats.reports,
      lives: data.stats.lives_saved,
      cities: data.stats.cities,
      market: data.marketplace.length,
      blood: data.bloodDonors.length,
      ts: Date.now()
    };
    res.write(`data: ${JSON.stringify(stats)}\n\n`);
  };
  send();
  const interval = setInterval(send, 15000);
  req.on('close', () => clearInterval(interval));
});

// ── Enhanced Alerts with media ──────────────────────────────────
app.get('/api/alerts/filter', rateLimit(60, 60000), (req, res) => {
  const { type='all', area='', hours=24, sort='newest', limit=30 } = req.query;
  const cutoff = Date.now() - (parseFloat(hours)*3600000);
  let list = data.alerts.filter(a => (a.time||0) >= cutoff);
  if (type !== 'all') list = list.filter(a => a.type === type);
  if (area) list = list.filter(a => (a.area||'').includes(area));
  if (sort === 'votes') list.sort((a,b) => (b.votes||0)-(a.votes||0));
  else if (sort === 'views') list.sort((a,b) => (b.views||0)-(a.views||0));
  else list.sort((a,b) => (b.time||0)-(a.time||0));
  res.json(list.slice(0, parseInt(limit)));
});

// ── News categories ──────────────────────────────────────────────
app.get('/api/news/categories', (req, res) => {
  const cats = {};
  (data.news||[]).forEach(n => { const c = n.category||'عام'; cats[c]=(cats[c]||0)+1; });
  res.json(Object.entries(cats).map(([cat,count]) => ({ cat, count })).sort((a,b)=>b.count-a.count));
});

// ── Trending Topics ──────────────────────────────────────────────
app.get('/api/trending', (req, res) => {
  const now = Date.now();
  const h6 = 6 * 3600000;
  const recent = [
    ...data.alerts.filter(a => now-(a.time||0)<h6).map(a=>({ text:a.msg, type:'alert', score:(a.votes||0)*3+(a.views||0) })),
    ...(data.news||[]).filter(n => now-(n.time||0)<h6).map(n=>({ text:n.title||n.text, type:'news', score:(n.upvotes||0)*2+(n.views||0) })),
    ...(data.voiceItems||[]).filter(v => now-(v.time||0)<h6).map(v=>({ text:v.text, type:'voice', score:v.votes||0 }))
  ].sort((a,b)=>b.score-a.score).slice(0,10);
  res.json(recent);
});

// ── User Activity Feed ────────────────────────────────────────────
app.get('/api/feed/:userId', rateLimit(30, 60000), (req, res) => {
  const userId = req.params.userId;
  const profile = data.profiles[userId];
  const area = profile?.area || '';
  const now = Date.now();
  const day = 24*3600000;
  let feed = [];
  // Nearby alerts
  data.alerts.filter(a => now-(a.time||0)<day && (!area || (a.area||'').includes(area.split(' ')[0]))).slice(0,5)
    .forEach(a => feed.push({ type:'alert', icon:a.icon||'🔴', title:a.msg, sub:a.area, time:a.time, id:a.id }));
  // Market items
  data.marketplace.filter(m => now-(m.time||0)<day).slice(0,5)
    .forEach(m => feed.push({ type:'market', icon:'🛒', title:m.title, sub:m.area, time:m.time, id:m.id }));
  // News
  (data.news||[]).filter(n => now-(n.time||0)<day).slice(0,5)
    .forEach(n => feed.push({ type:'news', icon:'📰', title:n.title||n.text, sub:n.area, time:n.time, id:n.id }));
  feed.sort((a,b)=>(b.time||0)-(a.time||0));
  res.json(feed.slice(0, 20));
});

// ── Health Check endpoint ─────────────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    version: '7.0',
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed/1024/1024) + 'MB',
    online: Object.keys(data.onlineUsers||{}).length,
    ts: new Date().toISOString()
  });
});

// ── Bulk data prefetch for PWA ────────────────────────────────────
app.get('/api/prefetch', (req, res) => {
  const now = Date.now();
  const day = 24*3600000;
  res.json({
    alerts: data.alerts.filter(a=>now-(a.time||0)<day*7).slice(0,50),
    exchange: data.exchangeRates.slice(0,20),
    market: data.marketplace.slice(0,30),
    news: (data.news||[]).slice(0,20),
    ts: now
  });
});

// ── Auto-cleanup old data daily ───────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const month = 30 * 24 * 3600000;
  const week  = 7  * 24 * 3600000;
  let changed = false;
  // Remove alerts older than 30 days
  const alertsBefore = data.alerts.length;
  data.alerts = data.alerts.filter(a => now - (a.time||0) < month);
  if (data.alerts.length !== alertsBefore) changed = true;
  // Remove market items older than 30 days
  data.marketplace = data.marketplace.filter(m => now - (m.time||0) < month);
  // Remove expired polls
  if (data.polls) data.polls = data.polls.filter(p => !p.expiresAt || new Date(p.expiresAt) > new Date(now - week));
  if (changed) saveData();
}, 6 * 3600000); // every 6 hours

/* ============================================================
   🚀 ADVANCED FEATURES v7.0 - Final additions
============================================================ */

// ── User stats by area ────────────────────────────────────────
app.get('/api/stats/areas', (req, res) => {
  const areaCounts = {};
  data.alerts.forEach(a => {
    const area = (a.area || '').split(' ')[0];
    if (area) areaCounts[area] = (areaCounts[area] || 0) + 1;
  });
  const sorted = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([area, count]) => ({ area, count }));
  res.json(sorted);
});

// ── Get online users count ────────────────────────────────────
app.get('/api/users/count', (req, res) => {
  res.json({ online: Object.keys(data.onlineUsers || {}).length, total: Object.keys(data.profiles || {}).length });
});

// ── Search alerts ─────────────────────────────────────────────
app.get('/api/alerts/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json([]);
  const results = data.alerts
    .filter(a => (a.msg || '').toLowerCase().includes(q) || (a.area || '').toLowerCase().includes(q))
    .slice(0, 20);
  res.json(results);
});

// ── Market categories ─────────────────────────────────────────
app.get('/api/market/categories', (req, res) => {
  const cats = {};
  data.marketplace.forEach(m => { const c = m.category || m.type || 'عام'; cats[c] = (cats[c] || 0) + 1; });
  res.json(Object.entries(cats).map(([cat, count]) => ({ cat, count })).sort((a, b) => b.count - a.count));
});

// ── Quick stats for topbar ────────────────────────────────────
app.get('/api/stats/quick', (req, res) => {
  const now = Date.now();
  const day = 24 * 3600000;
  const todayAlerts = data.alerts.filter(a => now - (a.time || 0) < day).length;
  const usdRate = data.exchangeRates.find(r => (r.currency || '').includes('دولار') || (r.currency || '').toLowerCase() === 'usd');
  res.json({
    users:        Object.keys(data.onlineUsers || {}).length,
    reports:      data.alerts.length,
    todayReports: todayAlerts,
    lives_saved:  data.stats?.lives_saved || 0,
    cities:       data.stats?.cities || 1,
    usdRate:      usdRate ? (usdRate.buy || usdRate.rate || 0) : 0
  });
});

// ── Save/bookmark an alert (local profile feature) ───────────
app.post('/api/alerts/:id/bookmark', rateLimit(20, 60000), (req, res) => {
  const { userId } = req.body;
  const alert = data.alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'not found' });
  if (userId && data.profiles[userId]) {
    if (!data.profiles[userId].bookmarks) data.profiles[userId].bookmarks = [];
    const idx = data.profiles[userId].bookmarks.indexOf(req.params.id);
    if (idx === -1) data.profiles[userId].bookmarks.push(req.params.id);
    else data.profiles[userId].bookmarks.splice(idx, 1);
    saveData();
    res.json({ ok: true, bookmarked: idx === -1 });
  } else {
    res.json({ ok: true });
  }
});

// ── Get user bookmarks ────────────────────────────────────────
app.get('/api/profile/:userId/bookmarks', rateLimit(30, 60000), (req, res) => {
  const profile = data.profiles[req.params.userId];
  if (!profile) return res.json([]);
  const bookmarkIds = profile.bookmarks || [];
  const bookmarked = data.alerts.filter(a => bookmarkIds.includes(a.id));
  res.json(bookmarked);
});

// ── Report abuse/spam ─────────────────────────────────────────
app.post('/api/alerts/:id/report-abuse', rateLimit(5, 60000), (req, res) => {
  const alert = data.alerts.find(a => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'not found' });
  alert.abuseReports = (alert.abuseReports || 0) + 1;
  // Auto-hide if 5+ abuse reports
  if (alert.abuseReports >= 5) alert.hidden = true;
  saveData();
  res.json({ ok: true, reports: alert.abuseReports });
});

// ── Get market item by ID ─────────────────────────────────────
app.get('/api/market/:id', (req, res) => {
  const item = data.marketplace.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.views = (item.views || 0) + 1;
  res.json(item);
});

// ── Update market item (seller only) ──────────────────────────
app.put('/api/market/:id', rateLimit(10, 60000), (req, res) => {
  const { userId, title, price, desc } = req.body;
  const item = data.marketplace.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (item.userId !== userId) return res.status(403).json({ error: 'غير مصرح' });
  if (title) item.title = title.substring(0, 80);
  if (price !== undefined) item.price = price;
  if (desc)  item.desc  = desc.substring(0, 300);
  item.updatedAt = Date.now();
  saveData();
  res.json({ ok: true, item });
});

// ── Delete market item ────────────────────────────────────────
app.delete('/api/market/:id', rateLimit(5, 60000), (req, res) => {
  const { userId } = req.body;
  const idx = data.marketplace.findIndex(m => m.id === req.params.id && m.userId === userId);
  if (idx === -1) return res.status(403).json({ error: 'غير مصرح أو غير موجود' });
  data.marketplace.splice(idx, 1);
  saveData();
  res.json({ ok: true });
});

// ── User profile public view (enhanced) ──────────────────────
app.get('/api/profile/:userId', rateLimit(60, 60000), (req, res) => {
  const p = data.profiles[req.params.userId];
  if (!p) return res.status(404).json({ error: 'not found' });
  // Return public fields only
  res.json({
    id:         req.params.userId,
    name:       p.name || 'مستخدم',
    avatar:     p.avatar,
    area:       p.area,
    jobTitle:   p.jobTitle,
    company:    p.company,
    bio:        p.bio,
    publicPhone: p.publicPhone,
    website:    p.website,
    reports:    p.reports || 0,
    points:     p.points  || 0,
    badges:     p.badges  || [],
    joinedAt:   p.joinedAt,
    lastSeen:   p.lastSeen
  });
});

// ── Nearby alerts with radius ─────────────────────────────────
app.get('/api/alerts/radius', (req, res) => {
  const { lat, lng, km } = req.query;
  if (!lat || !lng) return res.json(data.alerts.slice(0, 30));
  const R = 6371;
  const lat1 = parseFloat(lat) * Math.PI / 180;
  const lng1 = parseFloat(lng) * Math.PI / 180;
  const maxKm = parseFloat(km) || 50;
  const nearby = data.alerts.filter(a => {
    if (!a.lat || !a.lng) return false;
    const lat2 = a.lat * Math.PI / 180;
    const lng2 = a.lng * Math.PI / 180;
    const dLat = lat2 - lat1, dLng = lng2 - lng1;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(x));
    return d <= maxKm;
  });
  res.json(nearby.slice(0, 50));
});

// ── Batch update - mark many alerts as read ───────────────────
app.post('/api/alerts/batch-view', rateLimit(10, 60000), (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
  ids.slice(0, 50).forEach(id => {
    const a = data.alerts.find(x => x.id === id);
    if (a) a.views = (a.views || 0) + 1;
  });
  res.json({ ok: true, updated: ids.length });
});

// ── Get active users in an area ───────────────────────────────
app.get('/api/users/area/:area', (req, res) => {
  const area = decodeURIComponent(req.params.area).toLowerCase();
  const users = Object.values(data.onlineUsers || {})
    .filter(u => (u.area || '').toLowerCase().includes(area))
    .slice(0, 20)
    .map(u => ({ name: u.name, area: u.area }));
  res.json({ count: users.length, users });
});

// ── Global search ─────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// ── App Version Info (v7.0)  ─────────────────────────────────
app.get('/api/version', (_, res) => {
  res.json({
    version: '7.0.0',
    codename: 'Nabdh-Complete',
    build:   Date.now(),
    features: [
      'media-chat','study-groups','dm','pwa','offline',
      'trending','leaderboard','blood-bank','prayer-times',
      'weather','market-p2p','voice','skills','exchange',
      'news','polls','rides','water','help','hospitals',
      'global-search','bookmarks','notifications','live-stats'
    ],
    minClientVersion: '5.0'
  });
});


/* ============================================================
   ⚡ ADVANCED FEATURES v7.1 - محرك الأداء المتقدم
   ============================================================ */

// ── Smart Cache Layer ─────────────────────────────────────────
const _cache = new Map();
function cacheGet(key) {
  const item = _cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) { _cache.delete(key); return null; }
  return item.data;
}
function cacheSet(key, data, ttlMs = 30000) {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) { if (now > v.expires) _cache.delete(k); }
}, 60000);

// ── Real-time stats SSE (Server-Sent Events) ──────────────────
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.flushHeaders();
  const send = () => {
    const payload = JSON.stringify({
      online: Object.keys(data.onlineUsers || {}).length,
      alerts: data.alerts.length,
      time: Date.now()
    });
    res.write(`data: ${payload}\n\n`);
  };
  send();
  const iv = setInterval(send, 10000);
  req.on('close', () => clearInterval(iv));
});

// ── Leaderboard API ───────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const cached = cacheGet('leaderboard');
  if (cached) return res.json(cached);
  const profiles = Object.entries(data.profiles || {});
  const board = profiles
    .map(([uid, p]) => ({
      uid,
      name: p.name || 'مجهول',
      avatar: p.avatar || '👤',
      area: p.area || '',
      points: p.points || 0,
      level: p.level || 1,
      badges: (p.badges || []).slice(0, 3),
      reports: p.reports || 0
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 50);
  cacheSet('leaderboard', { board, total: board.length }, 60000);
  res.json({ board, total: board.length });
});

// ── Prayer times calculator ───────────────────────────────────
app.get('/api/prayer/:lat/:lng', (req, res) => {
  const lat = parseFloat(req.params.lat) || 15.5;
  const lng = parseFloat(req.params.lng) || 32.5;
  const now = new Date();
  // Simple prayer time calculation (Khartoum approximate)
  const base = { fajr:'04:45', dhuhr:'12:10', asr:'15:30', maghrib:'18:15', isha:'19:45' };
  res.json({ prayers: base, lat, lng, date: now.toISOString().split('T')[0], timezone: 'Africa/Khartoum' });
});

// ── Weather API ───────────────────────────────────────────────
app.get('/api/weather/:area', (req, res) => {
  const area = req.params.area || 'الخرطوم';
  const cached = cacheGet(`weather_${area}`);
  if (cached) return res.json(cached);
  // Simulated weather (replace with real API in production)
  const conditions = ['مشمس','غائم جزئياً','غائم','رياح خفيفة','حار وجاف'];
  const weather = {
    area,
    temp: Math.floor(Math.random() * 15) + 30,
    feels_like: Math.floor(Math.random() * 15) + 33,
    humidity: Math.floor(Math.random() * 30) + 20,
    wind: Math.floor(Math.random() * 20) + 5,
    condition: conditions[Math.floor(Math.random() * conditions.length)],
    icon: '☀️',
    updated: new Date().toISOString()
  };
  cacheSet(`weather_${area}`, weather, 300000); // 5 min cache
  res.json(weather);
});

// ── Notifications system ──────────────────────────────────────
app.post('/api/notify/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'missing fields' });
  if (!data.pushSubs) data.pushSubs = {};
  data.pushSubs[userId] = { subscription, ts: Date.now() };
  res.json({ ok: true });
});

// ── Reports by category stats ─────────────────────────────────
app.get('/api/stats/categories', (req, res) => {
  const cats = {};
  data.alerts.forEach(a => {
    const t = a.type || 'general';
    cats[t] = (cats[t] || 0) + 1;
  });
  const sorted = Object.entries(cats)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  res.json({ categories: sorted, total: data.alerts.length });
});

// ── Hot topics / trending tags ────────────────────────────────
app.get('/api/tags/trending', (req, res) => {
  const cached = cacheGet('trending_tags');
  if (cached) return res.json(cached);
  const tagCounts = {};
  const sixHours = Date.now() - 6 * 3600000;
  data.alerts.filter(a => a.time > sixHours).forEach(a => {
    const words = (a.msg || '').split(/\s+/).filter(w => w.length > 3);
    words.forEach(w => { tagCounts[w] = (tagCounts[w] || 0) + 1; });
  });
  const tags = Object.entries(tagCounts)
    .filter(([, c]) => c > 1)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));
  cacheSet('trending_tags', { tags }, 120000);
  res.json({ tags });
});

// ── Blood donors by blood type ────────────────────────────────
app.get('/api/blood/stats', (req, res) => {
  const stats = {};
  (data.bloodDonors || []).forEach(d => {
    const t = d.bloodType || 'غير محدد';
    stats[t] = (stats[t] || 0) + 1;
  });
  res.json({ stats, total: (data.bloodDonors || []).length });
});

// ── Nearby services (hospitals, markets, etc.) ───────────────
app.get('/api/nearby/services', (req, res) => {
  const { lat, lng, type, radius = 10 } = req.query;
  if (!lat || !lng) return res.json({ services: [] });
  const R = parseFloat(radius);
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  let services = [];
  // Add hospitals
  if (!type || type === 'hospital') {
    services = services.concat(
      (data.hospitals || []).map(h => ({ ...h, serviceType: 'hospital', icon: '🏥' }))
    );
  }
  // Add market items with location
  if (!type || type === 'market') {
    services = services.concat(
      (data.marketplace || [])
        .filter(m => m.lat && m.lng)
        .map(m => ({ ...m, serviceType: 'market', icon: '🛒' }))
    );
  }
  // Filter by radius
  const haversine = (la1, ln1, la2, ln2) => {
    const R2 = 6371;
    const dLat = (la2 - la1) * Math.PI / 180;
    const dLon = (ln2 - ln1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R2 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };
  const filtered = services
    .filter(s => s.lat && s.lng && haversine(userLat, userLng, s.lat, s.lng) <= R)
    .slice(0, 20);
  res.json({ services: filtered, count: filtered.length });
});

// ── Market advanced filter ────────────────────────────────────
app.get('/api/market/filter', rateLimit(60, 60000), (req, res) => {
  const { type, area, minPrice, maxPrice, sort = 'time', page = 1, limit = 20 } = req.query;
  let items = [...(data.marketplace || [])];
  if (type) items = items.filter(m => m.type === type);
  if (area) items = items.filter(m => (m.area || '').toLowerCase().includes(area.toLowerCase()));
  if (minPrice) items = items.filter(m => (m.price || 0) >= parseFloat(minPrice));
  if (maxPrice) items = items.filter(m => (m.price || 0) <= parseFloat(maxPrice));
  if (sort === 'price_asc') items.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (sort === 'price_desc') items.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (sort === 'likes') items.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  else items.sort((a, b) => b.time - a.time);
  const pg = parseInt(page), lm = Math.min(parseInt(limit), 50);
  const total = items.length;
  items = items.slice((pg - 1) * lm, pg * lm);
  res.json({ items, total, page: pg, pages: Math.ceil(total / lm) });
});

// ── Voice posts ───────────────────────────────────────────────
app.get('/api/voice/trending', (req, res) => {
  const voices = (data.voicePosts || [])
    .sort((a, b) => ((b.votes || 0) + (b.plays || 0)) - ((a.votes || 0) + (a.plays || 0)))
    .slice(0, 10);
  res.json({ voices, total: voices.length });
});

// ── Skills marketplace ────────────────────────────────────────
app.get('/api/skills/categories', (req, res) => {
  const cats = {};
  (data.skills || []).forEach(s => {
    const c = s.category || 'عام';
    cats[c] = (cats[c] || 0) + 1;
  });
  const categories = Object.entries(cats)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json({ categories });
});

// ── Polls voting stats ────────────────────────────────────────
app.get('/api/polls/active', (req, res) => {
  const now = Date.now();
  const active = (data.polls || [])
    .filter(p => !p.expiresAt || p.expiresAt > now)
    .sort((a, b) => (b.totalVotes || 0) - (a.totalVotes || 0))
    .slice(0, 10);
  res.json({ polls: active, count: active.length });
});

// ── Study groups by subject ───────────────────────────────────
app.get('/api/study/subjects', (req, res) => {
  const subjects = {};
  (data.studyGroups || []).forEach(g => {
    const s = g.subject || 'عام';
    subjects[s] = (subjects[s] || 0) + 1;
  });
  res.json({
    subjects: Object.entries(subjects).map(([name, count]) => ({ name, count })),
    total: (data.studyGroups || []).length
  });
});

// ── SOS history ───────────────────────────────────────────────
app.get('/api/sos/recent', rateLimit(20, 60000), (req, res) => {
  const recent = (data.sosAlerts || [])
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)
    .map(s => ({ id: s.id, area: s.area, time: s.time, resolved: s.resolved || false }));
  res.json({ sos: recent, count: recent.length });
});

// ── Rides board ───────────────────────────────────────────────
app.get('/api/rides/active', (req, res) => {
  const now = Date.now();
  const active = (data.rides || [])
    .filter(r => r.time > now - 24 * 3600000)
    .sort((a, b) => b.time - a.time)
    .slice(0, 20);
  res.json({ rides: active, count: active.length });
});

// ── Help requests urgent ──────────────────────────────────────
app.get('/api/help/urgent', (req, res) => {
  const urgent = (data.helpRequests || [])
    .filter(h => h.urgent || h.priority === 'high')
    .sort((a, b) => b.time - a.time)
    .slice(0, 10);
  res.json({ requests: urgent, count: urgent.length });
});

// ── Water reports map ─────────────────────────────────────────
app.get('/api/water/heatmap', (req, res) => {
  const points = (data.waterReports || [])
    .filter(w => w.lat && w.lng)
    .map(w => ({ lat: w.lat, lng: w.lng, weight: w.severity || 1 }));
  res.json({ points, count: points.length });
});

// ── Power outages heatmap ─────────────────────────────────────
app.get('/api/power/heatmap', (req, res) => {
  const points = (data.powerSchedules || [])
    .filter(p => p.lat && p.lng && p.status === 'off')
    .map(p => ({ lat: p.lat, lng: p.lng, weight: 1, area: p.area }));
  res.json({ points, count: points.length });
});

// ── User activity feed enhanced ───────────────────────────────
app.get('/api/feed/enhanced/:userId', rateLimit(30, 60000), (req, res) => {
  const userId = req.params.userId;
  const profile = (data.profiles || {})[userId];
  const userArea = profile?.area || '';
  const now = Date.now();
  const oneDay = 24 * 3600000;

  let feed = [];

  // Alerts in user's area (higher priority)
  const areaAlerts = data.alerts
    .filter(a => a.time > now - oneDay && (userArea ? (a.area || '').includes(userArea) : true))
    .map(a => ({ ...a, feedType: 'alert', priority: 2 }));

  // Market items
  const market = (data.marketplace || [])
    .filter(m => m.time > now - oneDay)
    .map(m => ({ ...m, feedType: 'market', priority: 1 }));

  // Trending voice posts
  const voice = (data.voicePosts || [])
    .filter(v => v.time > now - oneDay && (v.votes || 0) > 0)
    .map(v => ({ ...v, feedType: 'voice', priority: 1 }));

  // News
  const news = (data.news || [])
    .filter(n => n.time > now - oneDay)
    .map(n => ({ ...n, feedType: 'news', priority: 1 }));

  feed = [...areaAlerts, ...market.slice(0, 5), ...voice.slice(0, 3), ...news.slice(0, 5)];
  feed.sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.time - a.time);

  res.json({ feed: feed.slice(0, 30), total: feed.length });
});

// ── Online users map data ─────────────────────────────────────
app.get('/api/users/map', (req, res) => {
  const users = Object.values(data.onlineUsers || {})
    .filter(u => u.lat && u.lng)
    .map(u => ({ name: u.name, lat: u.lat, lng: u.lng, area: u.area }));
  res.json({ users, count: users.length });
});

// ── Exchange rates history ────────────────────────────────────
app.get('/api/exchange/history', (req, res) => {
  const history = (data.exchangeRates || [])
    .sort((a, b) => b.time - a.time)
    .slice(0, 30);
  res.json({ history, count: history.length });
});

// ── Medicine availability by area ────────────────────────────
app.get('/api/medicine/by-area', (req, res) => {
  const { area } = req.query;
  let meds = data.medicines || [];
  if (area) meds = meds.filter(m => (m.area || '').toLowerCase().includes(area.toLowerCase()));
  const byArea = {};
  meds.forEach(m => {
    const a = m.area || 'غير محدد';
    if (!byArea[a]) byArea[a] = [];
    byArea[a].push({ name: m.name, available: m.available, price: m.price });
  });
  res.json({ areas: byArea, total: meds.length });
});

// ── Dashboard full stats ──────────────────────────────────────
app.get('/api/dashboard/full', (req, res) => {
  const cached = cacheGet('dashboard_full');
  if (cached) return res.json(cached);
  const now = Date.now();
  const today = now - 24 * 3600000;
  const week = now - 7 * 24 * 3600000;

  const stats = {
    online: Object.keys(data.onlineUsers || {}).length,
    reports: data.alerts.length,
    reports_today: data.alerts.filter(a => a.time > today).length,
    reports_week: data.alerts.filter(a => a.time > week).length,
    lives_saved: data.livesSaved || 0,
    cities: new Set(data.alerts.map(a => a.area?.split('،')[0]).filter(Boolean)).size,
    market_items: (data.marketplace || []).length,
    blood_donors: (data.bloodDonors || []).length,
    study_groups: (data.studyGroups || []).length,
    voice_posts: (data.voicePosts || []).length,
    skills: (data.skills || []).length,
    polls: (data.polls || []).length,
    help_requests: (data.helpRequests || []).length,
    water_reports: (data.waterReports || []).length,
    power_reports: (data.powerSchedules || []).length,
    registered_users: Object.keys(data.profiles || {}).length
  };

  const top_areas = Object.entries(
    data.alerts.reduce((acc, a) => {
      const area = a.area?.split('،')[0] || 'غير محدد';
      acc[area] = (acc[area] || 0) + 1;
      return acc;
    }, {})
  ).sort(([, a], [, b]) => b - a).slice(0, 5).map(([area, count]) => ({ area, count }));

  const result = { stats, top_areas, updated: now };
  cacheSet('dashboard_full', result, 30000);
  res.json(result);
});

// ── Ping / heartbeat ──────────────────────────────────────────
app.get('/ping', (_, res) => res.json({ pong: true, ts: Date.now() }));

