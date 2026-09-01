// ─────────────────────────────────────────────────────────────────────────
// Ortak yardımcı fonksiyonlar — tüm arayüzlerde paylaşılır.
// ─────────────────────────────────────────────────────────────────────────

// Türkiye Gıda Kodeksi / AB alerjen listesi — { anahtar: {etiket, ikon} }
export const ALERJEN_LISTESI = {
  gluten: { etiket: "Gluten", ikon: "🌾" },
  sut: { etiket: "Süt / Laktoz", ikon: "🥛" },
  yumurta: { etiket: "Yumurta", ikon: "🥚" },
  findik: { etiket: "Fındık / Kabuklu Yemiş", ikon: "🌰" },
  soya: { etiket: "Soya", ikon: "🫘" },
  balik: { etiket: "Balık", ikon: "🐟" },
  kabuklu_deniz: { etiket: "Kabuklu Deniz Ürünleri", ikon: "🦐" },
  hardal: { etiket: "Hardal", ikon: "🌭" },
  susam: { etiket: "Susam", ikon: "🫙" },
  kereviz: { etiket: "Kereviz", ikon: "🥬" },
  sulfit: { etiket: "Sülfit", ikon: "🍷" },
  yer_fistigi: { etiket: "Yer Fıstığı", ikon: "🥜" },
  lupin: { etiket: "Acı Bakla (Lupin)", ikon: "🫛" },
};

export const SIPARIS_DURUMLARI = {
  yeni: { etiket: "Yeni", renk: "#e67e22" },
  hazirlaniyor: { etiket: "Hazırlanıyor", renk: "#3498db" },
  hazir: { etiket: "Hazır", renk: "#27ae60" },
  servis_edildi: { etiket: "Servis Edildi", renk: "#8e44ad" },
  kapandi: { etiket: "Kapandı", renk: "#7f8c8d" },
};

export const MASA_DURUMLARI = {
  bos: { etiket: "Boş", renk: "#27ae60" },
  dolu: { etiket: "Dolu", renk: "#e67e22" },
  odeme_bekliyor: { etiket: "Ödeme Bekliyor", renk: "#c0392b" },
};

export function paraFormat(n) {
  const sayi = Number(n) || 0;
  return sayi.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
}

export function tarihFormat(timestamp) {
  if (!timestamp) return "-";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function debounce(fn, gecikme = 250) {
  let zamanlayici;
  return (...args) => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(() => fn(...args), gecikme);
  };
}

export function idUret() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

// Küçük "toast" bildirimi — her sayfa kendi #toast-alani konteynerini
// (veya body'yi) kullanabilir; konteyner yoksa otomatik oluşturulur.
export function bildirimGoster(mesaj, tur = "bilgi") {
  let alan = document.getElementById("toast-alani");
  if (!alan) {
    alan = document.createElement("div");
    alan.id = "toast-alani";
    alan.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;";
    document.body.appendChild(alan);
  }
  const kutu = document.createElement("div");
  const renkler = { bilgi: "#2c3e50", basari: "#27ae60", hata: "#c0392b", uyari: "#e67e22" };
  kutu.textContent = mesaj;
  kutu.style.cssText = `background:${renkler[tur] || renkler.bilgi};color:#fff;padding:12px 18px;border-radius:8px;
    box-shadow:0 4px 14px rgba(0,0,0,.2);font-size:14px;max-width:320px;animation:qrFadeIn .2s ease-out;`;
  alan.appendChild(kutu);
  setTimeout(() => {
    kutu.style.opacity = "0";
    kutu.style.transition = "opacity .3s";
    setTimeout(() => kutu.remove(), 300);
  }, 3200);
}

// Ürün kartlarında / listelerinde kullanılan alerjen rozetlerini üretir.
export function alerjenRozetleriHtml(alerjenler = [], glutensiz = false) {
  const rozetler = (alerjenler || [])
    .map((a) => ALERJEN_LISTESI[a])
    .filter(Boolean)
    .map(
      (a) =>
        `<span class="alerjen-rozet" title="${escapeHtml(a.etiket)}">${a.ikon}</span>`
    )
    .join("");
  const glutensizRozet = glutensiz
    ? `<span class="glutensiz-rozet" title="Glutensiz">🚫🌾 Glutensiz</span>`
    : "";
  return glutensizRozet + rozetler;
}

// Bir masa için QR kod görselinin URL'sini üretir (harici, ücretsiz QR API).
// Üretilen QR, sitenin köküne göre `.../menu?sube=<subeId>&masa=<masaId>`
// adresine yönlendirir — çok şubeli yapıda her şubenin masa linkleri kendi
// şube kimliğini taşır. Bu fonksiyon admin panelinden (her zaman
// "<kök>/admin/..." derinliğinden) çağrıldığı için "../menu" göreceli
// referansı, site ister bir alan adının kökünde (Firebase Hosting) ister
// bir alt yolda (ör. GitHub Pages'te kullaniciadi.github.io/repo-adi/)
// yayınlansın doğru mutlak URL'yi üretir.
export function masaQrUrl(masaId, subeId = "", boyut = 300) {
  const parametreler = new URLSearchParams();
  if (subeId) parametreler.set("sube", subeId);
  parametreler.set("masa", masaId);
  const hedefUrl = new URL(`../menu?${parametreler.toString()}`, window.location.href).href;
  return {
    hedefUrl,
    qrGorselUrl: `https://api.qrserver.com/v1/create-qr-code/?size=${boyut}x${boyut}&data=${encodeURIComponent(
      hedefUrl
    )}`,
  };
}

// Firestore onSnapshot hata yakalayıcı — konsola yazar ve kullanıcıya toast gösterir.
export function snapshotHataYakala(baglam) {
  return (err) => {
    console.error(`[${baglam}]`, err);
    bildirimGoster(`Veri senkronizasyon hatası (${baglam}). Sayfayı yenileyin.`, "hata");
  };
}

// ───────────────────────── Kategori / alt kategori ağacı ─────────────────────────
// kategoriler/{id} → { ad, sira, ustKategoriId: string|null }
// (ustKategoriId boşsa/null ise üst düzey "ana kategori"dir.)

// Düz listeyi, üst kategori + hemen altındaki alt kategorileri sırayla içeren
// gösterim-sıralı bir diziye çevirir. Her öğeye `derinlik` (0=ana, 1=alt) eklenir.
export function kategorilerSirali(kategorilerCache) {
  const anaKategoriler = kategorilerCache
    .filter((k) => !k.ustKategoriId)
    .slice()
    .sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0));

  const sonuc = [];
  anaKategoriler.forEach((ana) => {
    sonuc.push({ ...ana, derinlik: 0 });
    kategorilerCache
      .filter((k) => k.ustKategoriId === ana.id)
      .sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0))
      .forEach((alt) => sonuc.push({ ...alt, derinlik: 1 }));
  });
  return sonuc;
}

// Bir kategori ana kategoriyse kendisi + tüm alt kategorilerinin id listesini,
// alt kategoriyse sadece kendi id'sini döner. Ürün filtrelemede kullanılır
// (bir ana kategori seçildiğinde altındaki tüm alt kategori ürünleri de gösterilsin diye).
export function kategoriVeAltlariIds(kategoriId, kategorilerCache) {
  const altlar = kategorilerCache.filter((k) => k.ustKategoriId === kategoriId).map((k) => k.id);
  return [kategoriId, ...altlar];
}
