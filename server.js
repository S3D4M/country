import http from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent, ControlEvent, SignConfig } from 'tiktok-live-connector';

const USER = (process.env.TIKTOK_USER || '').replace('@', '').trim();
const KEY = process.env.SIGN_API_KEY || '';
const PORT = process.env.PORT || 3000;
// حدود الهدايا بالألماس: فوق MID = طيارة (تثبيت 45ث)، فوق BIG = أسد (تثبيت دقيقتين). عدّلها من هنا أو من المتغيرات
const MID = Number(process.env.GIFT_MID || 100);
const BIG = Number(process.env.GIFT_BIG || 1000);

if (KEY) SignConfig.apiKey = KEY;
if (!USER) console.error('ناقص المتغير TIKTOK_USER (اسم حسابك بدون @)');

const page = readFileSync(new URL('./index.html', import.meta.url));
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/health')) { res.end('ok'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
const wss = new WebSocketServer({ server, path: '/ws' });

let status = 'wait';
function send(o) {
  const s = JSON.stringify(o);
  wss.clients.forEach((c) => c.readyState === 1 && c.send(s));
}
function setStatus(s) { status = s; send({ t: 'status', s }); }
wss.on('connection', (ws) => ws.send(JSON.stringify({ t: 'status', s: status })));

let conn = null, retrying = false;
function retry(ms) {
  if (retrying) return;
  retrying = true; setStatus('wait');
  try { conn && conn.disconnect(); } catch (e) {}
  setTimeout(() => { retrying = false; start(); }, ms);
}

function start() {
  if (!USER) return;
  conn = new TikTokLiveConnection(USER, KEY ? { signApiKey: KEY } : {});
  conn.on(WebcastEvent.CHAT, (d) => {
    const cu = d.user?.uniqueId || d.uniqueId;
    console.log('تعليق من', cu, ':', d.comment);
    send({ t: 'chat', u: cu, c: d.comment });
  });
  conn.on(WebcastEvent.GIFT, (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return; // سلسلة هدايا لسا شغالة، ننتظر نهايتها
    const dc = (d.diamondCount || d.giftDetails?.diamondCount || 1) * (d.repeatCount || 1);
    console.log('هدية من', d.user?.uniqueId || d.uniqueId, ':', d.giftName, 'قيمتها', dc);
    const k = dc >= BIG ? 20 : dc >= MID ? 5 : 1;
    send({ t: 'gift', u: d.user?.uniqueId || d.uniqueId, k });
  });
  conn.on(ControlEvent.DISCONNECTED, () => retry(10000));
  conn.on(ControlEvent.ERROR, (e) => console.error('خطأ:', e?.message || e));
  conn.connect()
    .then(() => { console.log('متصل بالبث'); setStatus('live'); })
    .catch((e) => { console.error('فشل الاتصال (غالباً ما في بث الحين):', e?.message || e); retry(15000); });
}

server.listen(PORT, () => console.log('يعمل على المنفذ ' + PORT));
start();
