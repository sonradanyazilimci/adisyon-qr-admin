// ─────────────────────────────────────────────────────────────────────────
// Service Worker — PWA kabuk önbelleği + çevrimdışı açılış
//
// Amaç: adisyon / garson / mutfak / menü ekranları bir kez açıldıktan sonra
// internet kesilse bile YÜKLENEBİLSİN (uygulama kabuğu önbellekten gelir).
// Canlı veriyi Firestore'un kendi çevrimdışı önbelleği sağlar
// (bkz. shared/firebase-config.js persistentLocalCache). Bu SW yalnızca
// STATİK dosyaları (HTML/CSS/JS) ve Firebase SDK modüllerini önbelleğe alır;
// Firestore/Auth ağ isteklerine (googleapis.com) hiç dokunmaz.
// ─────────────────────────────────────────────────────────────────────────
const SURUM = "v1";
const KABUK = `kabuk-${SURUM}`;

// İlk kurulumda önbelleğe alınacak kendi dosyalarımız. Biri erişilemezse
// kurulum bozulmasın diye tek tek, hataya dayanıklı eklenir.
const ON_YUKLE = [
  "/adisyon", "/adisyon/css/adisyon.css", "/adisyon/js/adisyon.js",
  "/garson", "/garson/css/garson.css", "/garson/js/garson.js",
  "/mutfak", "/mutfak/css/mutfak.css", "/mutfak/js/mutfak.js",
  "/menu", "/menu/css/menu.css", "/menu/js/menu.js",
  "/login", "/login/login.js",
  "/shared/common.css", "/shared/utils.js", "/shared/auth.js",
  "/shared/firebase-config.js", "/shared/siparis.js", "/shared/fis.js", "/shared/pwa.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(KABUK)
      .then((c) => Promise.all(ON_YUKLE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== KABUK).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

function firebaseAgIstegiMi(url) {
  return /googleapis\.com|firebaseio\.com|identitytoolkit|firebaseinstallations|firebase\.googleapis/.test(url);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;                    // yazma istekleri: dokunma
  const url = new URL(request.url);
  if (firebaseAgIstegiMi(url.hostname)) return;            // Firestore/Auth: dokunma

  // Sayfa gezinmeleri: önce ağ, başarısızsa önbellekteki kabuk.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((yanit) => {
          const kopya = yanit.clone();
          caches.open(KABUK).then((c) => c.put(request, kopya));
          return yanit;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match(url.pathname) || caches.match("/login")))
    );
    return;
  }

  // Diğer GET (kendi statik dosyalarımız + gstatic Firebase SDK modülleri):
  // önbellek öncelikli, arka planda tazele (stale-while-revalidate).
  const ayniKaynak = url.origin === self.location.origin;
  const gstatic = url.hostname === "www.gstatic.com";
  if (!ayniKaynak && !gstatic) return;

  e.respondWith(
    caches.match(request).then((onbellek) => {
      const agdan = fetch(request)
        .then((yanit) => {
          if (yanit && yanit.status === 200) {
            const kopya = yanit.clone();
            caches.open(KABUK).then((c) => c.put(request, kopya));
          }
          return yanit;
        })
        .catch(() => onbellek);
      return onbellek || agdan;
    })
  );
});
