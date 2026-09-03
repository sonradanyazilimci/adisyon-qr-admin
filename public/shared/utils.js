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
  onay_bekliyor: { etiket: "Onay Bekliyor", renk: "#9b59b6" },
  yeni: { etiket: "Yeni", renk: "#e67e22" },
  hazirlaniyor: { etiket: "Hazırlanıyor", renk: "#3498db" },
  hazir: { etiket: "Hazır", renk: "#27ae60" },
  servis_edildi: { etiket: "Servis Edildi", renk: "#8e44ad" },
  iptal: { etiket: "İptal Edildi", renk: "#95a5a6" },
  kapandi: { etiket: "Kapandı", renk: "#7f8c8d" },
};

export const MASA_DURUMLARI = {
  bos: { etiket: "Boş", renk: "#27ae60" },
  dolu: { etiket: "Dolu", renk: "#e67e22" },
  odeme_bekliyor: { etiket: "Ödeme Bekliyor", renk: "#c0392b" },
};

// Yaygın Türkiye yemek çeki markaları — hesap kapatırken "Yemek Çeki" ödeme
// yöntemi seçildiğinde hangi markayla ödendiği de kaydedilsin diye.
export const YEMEK_CEKI_MARKALARI = ["Sodexo", "Multinet", "Setcard", "Edenred (Ticket)", "Metropol Card", "Winwin"];

// Kasa hareketlerinde (manuel giriş/çıkış) "hangi hesap" — basit bir ön
// muhasebe: kasadaki nakit, bankadaki para ve kart hesabı ayrı ayrı takip
// edilir.
export const KASA_HESAP_ETIKET = { nakit: "💵 Nakit Kasa", banka: "🏦 Banka", kart: "💳 Kredi Kartı" };

// Kasa hareketinin NE İÇİN yapıldığı (opsiyonel) — raporlarda personele
// ödenen paralar / genel giderler gibi kalemleri ayırt edebilmek için.
export const KASA_HAREKET_KATEGORILERI = {
  "": "Diğer",
  personel_odemesi: "👤 Personel Ödemesi",
  genel_gider: "🧾 Genel Gider",
  banka_transferi: "🏦 Banka Transferi",
  tedarikci_odemesi: "📦 Tedarikçi Ödemesi",
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

export function saatFormat(timestamp) {
  if (!timestamp) return "-";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

// Yerel (cihaz saat dilimi) tarihini "YYYY-MM-DD" biçiminde döner — puantaj/
// gün sonu kayıtları GÜN bazlı gruplanırken anahtar olarak kullanılır.
export function tarihAnahtari(date = new Date()) {
  const yil = date.getFullYear();
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const gun = String(date.getDate()).padStart(2, "0");
  return `${yil}-${ay}-${gun}`;
}

// "bugun" | "hafta" | "ay" | "tumu" değerine göre aralığın başlangıç
// tarihini (Date) döner — "tumu" için null. Raporlar/puantaj/muhasebe
// ekranlarındaki tarih aralığı filtrelerinde ortak kullanılır.
export function tarihAraligiBaslangici(aralik) {
  const now = new Date();
  if (aralik === "bugun") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (aralik === "hafta") {
    const gun = now.getDay() === 0 ? 7 : now.getDay(); // Pazartesi=1..Pazar=7
    const pazartesi = new Date(now);
    pazartesi.setDate(now.getDate() - (gun - 1));
    return new Date(pazartesi.getFullYear(), pazartesi.getMonth(), pazartesi.getDate());
  }
  if (aralik === "ay") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return null; // tümü
}

export function tarihAnahtariniOku(anahtar) {
  const [yil, ay, gun] = anahtar.split("-").map(Number);
  return new Date(yil, ay - 1, gun).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
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

// ── Çevrimdışı (offline) göstergesi ─────────────────────────────────────
// Bağlantı kesildiğinde sabit bir uyarı şeridi gösterir; geri geldiğinde
// kısa bir "tekrar çevrimiçi" bilgisi verir. Firestore yazmaları zaten
// kuyruğa alınıp otomatik gönderildiği için (bkz. firebase-config.js) bu
// sadece personeli bilgilendirir. Her sayfa baslat()'ında bir kez çağrılır.
export function baglantiDurumuBaslat() {
  if (typeof window === "undefined" || window.__baglantiIzleniyor) return;
  window.__baglantiIzleniyor = true;

  const serit = document.createElement("div");
  serit.id = "baglanti-serit";
  serit.className = "yazdirma-gizle";
  serit.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#c0392b;color:#fff;" +
    "text-align:center;padding:8px 14px;font-size:13px;font-weight:700;transform:translateY(100%);" +
    "transition:transform .25s ease;";
  serit.textContent = "⚠ Çevrimdışı — internet yok. Yaptığınız işlemler bağlantı gelince gönderilecek.";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(serit));
  if (document.body) document.body.appendChild(serit);

  const guncelle = () => {
    const cevrimdisi = !navigator.onLine;
    serit.style.transform = cevrimdisi ? "translateY(0)" : "translateY(100%)";
    if (!cevrimdisi && window.__ilkBaglantiKontroluGecti) {
      bildirimGoster("Bağlantı geri geldi, bekleyen işlemler gönderiliyor…", "basari");
    }
    window.__ilkBaglantiKontroluGecti = true;
  };
  window.addEventListener("online", guncelle);
  window.addEventListener("offline", guncelle);
  guncelle();
}

// ── Sesli / görsel uyarı (yeni sipariş, garson çağrısı, hazır sipariş) ──
// Harici ses dosyası yok — WebAudio ile kısa bir "bip" üretilir. İlk kez
// bir kullanıcı etkileşiminden sonra çalışır (tarayıcı otomatik ses
// engeli); mutfak/garson ekranında ilk dokunuştan sonra sorunsuz çalışır.
let __sesBaglami = null;
export function sesliUyari(tekrar = 2) {
  try {
    __sesBaglami = __sesBaglami || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = __sesBaglami;
    if (ctx.state === "suspended") ctx.resume();
    for (let i = 0; i < tekrar; i++) {
      const osc = ctx.createOscillator();
      const kaz = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      kaz.gain.value = 0.0001;
      osc.connect(kaz).connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.28;
      kaz.gain.setValueAtTime(0.0001, t0);
      kaz.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      kaz.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.start(t0);
      osc.stop(t0 + 0.24);
    }
  } catch { /* ses desteklenmiyorsa sessizce geç */ }
}

// Sekme arka plandayken başlığı yanıp söndürerek dikkat çeker; sekmeye
// dönülünce eski başlığa döner.
let __baslikYanip = null;
export function sekmeDikkat(metin) {
  if (typeof document === "undefined" || !document.hidden) return;
  const eski = document.title;
  if (__baslikYanip) { clearInterval(__baslikYanip.zamanlayici); document.title = __baslikYanip.eski; }
  let acik = false;
  const zamanlayici = setInterval(() => {
    document.title = acik ? eski : `🔔 ${metin}`;
    acik = !acik;
  }, 1000);
  __baslikYanip = { zamanlayici, eski };
  const durdur = () => {
    if (!__baslikYanip) return;
    clearInterval(__baslikYanip.zamanlayici);
    document.title = __baslikYanip.eski;
    __baslikYanip = null;
    document.removeEventListener("visibilitychange", durdur);
  };
  document.addEventListener("visibilitychange", durdur);
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

// ───────────────────────── Karanlık / aydınlık tema ─────────────────────────
// Tercih localStorage'da saklanır; kayıtlı tercih yoksa cihazın sistem temasına
// (prefers-color-scheme) bakılır. <html data-tema="karanlik|aydinlik"> ile
// common.css'teki CSS değişkenleri devreye girer.
const TEMA_ANAHTARI = "tema";

export function temaBaslat(butonId = "tema-degistir-buton") {
  const kayitli = localStorage.getItem(TEMA_ANAHTARI);
  const sistemKaranlik = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const tema = kayitli || (sistemKaranlik ? "karanlik" : "aydinlik");
  document.documentElement.setAttribute("data-tema", tema);

  const buton = document.getElementById(butonId);
  if (buton) {
    guncelleButonIkonu(buton, tema);
    buton.addEventListener("click", () => temaDegistir(butonId));
  }
}

export function temaDegistir(butonId = "tema-degistir-buton") {
  const mevcut = document.documentElement.getAttribute("data-tema") === "karanlik" ? "karanlik" : "aydinlik";
  const yeni = mevcut === "karanlik" ? "aydinlik" : "karanlik";
  document.documentElement.setAttribute("data-tema", yeni);
  localStorage.setItem(TEMA_ANAHTARI, yeni);
  const buton = document.getElementById(butonId);
  if (buton) guncelleButonIkonu(buton, yeni);
}

function guncelleButonIkonu(buton, tema) {
  buton.textContent = tema === "karanlik" ? "☀️" : "🌙";
  buton.title = tema === "karanlik" ? "Aydınlık temaya geç" : "Karanlık temaya geç";
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

// ── Şubeye özel ürün ayarları ────────────────────────────────────────────
// Bir ürün varsayılan olarak TÜM şubelerde aynıdır (aktif + tek fiyat) —
// zincirin çoğu ürünü için ekstra veri girmeye gerek yok. `subeAyarlari`
// alanı SADECE farklılık olan şubeler için { aktif?, fiyat? } tutar (admin
// panelinde girildiği şekilde), diğer şubelerde genel ayar geçerlidir.
export function urunSubedeAktifMi(urun, subeId) {
  if (urun.aktif === false) return false; // genel pasifse hiçbir şubede görünmez
  const ozel = subeId ? urun.subeAyarlari?.[subeId] : null;
  return !ozel || ozel.aktif !== false;
}

export function urunSubeFiyati(urun, subeId) {
  const ozel = subeId ? urun.subeAyarlari?.[subeId] : null;
  return typeof ozel?.fiyat === "number" ? ozel.fiyat : Number(urun.fiyat) || 0;
}

// "86 / tükendi": kasa veya garson bir ürünü geçici olarak satışa kapatabilir
// (mutfakta malzemesi bitti). Ürün menüde görünmeye devam eder ama "TÜKENDİ"
// etiketiyle işaretlenir ve sepete eklenemez. Admin panelinden "aktif"
// kaldırmaktan farklıdır (o menüden tamamen gizler).
export function urunTukendiMi(urun) {
  return urun?.tukendi === true;
}
