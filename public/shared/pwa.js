// Service Worker kaydı — her rol sayfası pwaBaslat() çağırır.
//
// ÖNEMLİ: PWA/Service Worker yalnızca OPT-IN. Bir service worker yanlış
// yapılandırılmış hosting'de (ör. dosya 404) veya eski sürüm önbellekte
// takılı kalırsa "site tuhaf davranıyor / güncellenmiyor" gibi teşhisi zor
// sorunlara yol açabilir. Bu yüzden varsayılan KAPALI. Açmak için tarayıcı
// konsoluna: localStorage.setItem('pwaAktif','1') yazıp sayfayı yenileyin.
export function pwaBaslat() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!window.localStorage || window.localStorage.getItem("pwaAktif") !== "1") return;
  if (window.localStorage.getItem("kullanEmulator") === "1") return;
  window.addEventListener("load", () => {
    // sw.js her zaman site kökündedir; alt yolda yayınlanan projeler için
    // kök göreli ("/sw.js") kaydı doğru kapsamı verir.
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.info("[pwa] Service worker kaydedilemedi (opsiyonel):", err.message);
    });
  });
}

// PWA'yı tamamen devreden çıkarır: kayıtlı SW'leri siler ve önbellekleri
// temizler. Konsoldan pwaTemizle() diye çağrılabilir (hata ayıklama için).
export async function pwaTemizle() {
  try {
    if ("serviceWorker" in navigator) {
      const kayitlar = await navigator.serviceWorker.getRegistrations();
      await Promise.all(kayitlar.map((r) => r.unregister()));
    }
    if (window.caches) {
      const adlar = await caches.keys();
      await Promise.all(adlar.map((a) => caches.delete(a)));
    }
    console.info("[pwa] Service worker ve önbellekler temizlendi. Sayfayı yenileyin.");
  } catch (err) {
    console.warn("[pwa] Temizlik başarısız:", err);
  }
}
if (typeof window !== "undefined") window.pwaTemizle = pwaTemizle;
