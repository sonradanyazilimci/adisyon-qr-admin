// Service Worker kaydı — her rol sayfası (adisyon/garson/mutfak/menu/login)
// bunu import edip pwaBaslat() çağırır. Emülatör modunda veya localhost
// dışı olmayan güvensiz bağlamlarda sessizce atlar.
export function pwaBaslat() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (window.localStorage && window.localStorage.getItem("kullanEmulator") === "1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[pwa] Service worker kaydedilemedi:", err);
    });
  });
}
