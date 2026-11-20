// Push-Dienst von JD Vertrieb (Cloudflare Worker, kostenlos), gebaut wie der von Dayliner.
// Merkt sich nichts: Das Google-Skript schickt die Geräte mit, der Dienst verschlüsselt und verschickt.
// Nur wer das Geheimnis kennt (das Skript, Skripteigenschaft PUSH_GEHEIMNIS), darf senden.
//   POST /send  { abos: [Push-Abo…], title, body, url }  →  { weg: [endpoint…] }  (abgemeldete Geräte)
// Geheimnisse (wrangler secret put …): VAPID_PRIVATE (privater VAPID-Schlüssel, base64url), GEHEIMNIS.

const VAPID_PUBLIC = 'BBwu63Ow659Pf2usYbfTzsyorECngHUxD1P_Z8TrggWHDYfXmY3ivuQW8CFvfs83cd7pRvfmwgalEz1mcWpnlIM';

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// ---------- Web Push (RFC 8291 Verschlüsselung, RFC 8292 VAPID) ----------
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encrypt(sub, payload) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, concat(enc.encode('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([as.length]), as, ct);
}
async function vapid(endpoint, env) {
  const pub = unb64u(VAPID_PUBLIC);
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://jdbrueder-collab.github.io/jd-vertrieb/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID_PUBLIC}`;
}
async function push(sub, data, env) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapid(sub.endpoint, env), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: await encrypt(sub, JSON.stringify(data)),
  });
  return r.status;
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/send') return new Response('JD Vertrieb Push', { status: 404 });
    if (!env.GEHEIMNIS || req.headers.get('Authorization') !== 'Bearer ' + env.GEHEIMNIS) return Response.json({ error: 'nicht erlaubt' }, { status: 401 });
    const b = await req.json().catch(() => ({}));
    const data = { title: String(b.title || 'JD Vertrieb'), body: String(b.body || ''), url: String(b.url || './') };
    const weg = [];
    for (const s of Array.isArray(b.abos) ? b.abos : []) {
      const status = await push(s, data, env).catch(() => 0);
      if (status === 404 || status === 410) weg.push(s.endpoint);   // Gerät hat sich abgemeldet
    }
    return Response.json({ weg });
  },
};
