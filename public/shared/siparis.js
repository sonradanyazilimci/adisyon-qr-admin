// ─────────────────────────────────────────────────────────────────────────
// Sipariş yaşam döngüsü + reçeteye göre ATOMİK stok düşümü/iadesi.
//
// AKIŞ:
//   • Personel (garson/kasa) sipariş oluşturursa   → siparisOlustur()
//     Zaten personel gözden geçirip girdiği için doğrudan "yeni" durumunda
//     açılır ve stok HEMEN düşülür.
//   • Müşteri QR menüden sipariş verirse           → siparisTaslakOlustur()
//     Doğrudan mutfağa düşmez — "onay_bekliyor" durumunda açılır, stok HENÜZ
//     düşülmez. Garson (veya kasa) inceleyip:
//       - onaylarsa      → siparisiOnayla()   (durum "yeni" olur, stok ŞİMDİ düşülür)
//       - düzenlerse     → siparisiGuncelle() (ürün/adet değişir, henüz onaylanmadıysa
//                          stok hâlâ düşülmez; onaylanmışsa fark kadar stok düşülür/iade edilir)
//       - iptal ederse   → siparisiIptalEt()  (durum "iptal" olur; stok daha önce
//                          düşülmüşse TAMAMEN iade edilir)
//   Revize/iptal SADECE sipariş "hazırlanıyor" aşamasına geçmeden (onay_bekliyor
//   veya yeni durumundayken) yapılabilir — mutfak hazırlamaya başladıktan sonra
//   değiştirilemez.
//
// NOT: Bu proje Blaze planı olmadan çalıştığı için bu işlemler Cloud Function
// yerine CLIENT'TAN çalışan Firestore transaction'lardır (runTransaction).
// Aynı anda gelen işlemlerde stok tutarsızlığı oluşmaz (transaction garantisi).
// ─────────────────────────────────────────────────────────────────────────
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, collection, runTransaction, serverTimestamp, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { urunSubedeAktifMi, urunSubeFiyati } from "./utils.js";

function paraYuvarla(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Girdi listesinden (urunId+adet+not) fiyat/ad snapshot'lı sipariş kalemleri
 * üretir. `subeId` verilirse ürünün o şubeye özel aktiflik/fiyat ayarı
 * (bkz. shared/utils.js urunSubedeAktifMi/urunSubeFiyati) uygulanır — aynı
 * ürün bir şubede satılmıyor olabilir veya farklı fiyatlanabilir.
 */
async function kalemleriOlustur(urunlerGirdi, subeId = null) {
  if (!Array.isArray(urunlerGirdi) || urunlerGirdi.length === 0) {
    throw new Error("Sepet boş olamaz.");
  }
  for (const s of urunlerGirdi) {
    if (!s.urunId || !(Number(s.adet) > 0)) {
      throw new Error("Geçersiz ürün/adet.");
    }
  }
  const urunSnaps = await Promise.all(urunlerGirdi.map((s) => getDoc(doc(db, "urunler", s.urunId))));
  const siparisKalemleri = [];
  urunSnaps.forEach((snap, i) => {
    const istek = urunlerGirdi[i];
    if (!snap.exists()) throw new Error(`Ürün bulunamadı: ${istek.urunId}`);
    const urun = snap.data();
    if (!urunSubedeAktifMi(urun, subeId)) throw new Error(`"${urun.ad}" bu şubede menüde aktif değil.`);
    if (urun.tukendi === true) throw new Error(`"${urun.ad}" şu an tükendi (86). Sipariş alınamaz.`);
    const adet = Number(istek.adet);
    const fiyat = urunSubeFiyati(urun, subeId);
    siparisKalemleri.push({
      urunId: istek.urunId,
      ad: urun.ad,
      adet,
      fiyat,
      tutar: paraYuvarla(fiyat * adet),
      not: istek.not || "",
    });
  });
  return siparisKalemleri;
}

/** Kalem listesinin (urunId+adet) reçeteye göre toplam hammadde tüketimini hesaplar. */
async function tuketimHesapla(kalemler) {
  const tuketim = new Map();
  if (!kalemler || kalemler.length === 0) return tuketim;
  const urunSnaps = await Promise.all(kalemler.map((k) => getDoc(doc(db, "urunler", k.urunId))));
  urunSnaps.forEach((snap, i) => {
    if (!snap.exists()) return;
    const urun = snap.data();
    const adet = Number(kalemler[i].adet) || 0;
    (urun.recete || []).forEach((r) => {
      if (!r.hammaddeId || !(Number(r.miktar) > 0)) return;
      const toplam = Number(r.miktar) * adet;
      tuketim.set(r.hammaddeId, (tuketim.get(r.hammaddeId) || 0) + toplam);
    });
  });
  return tuketim;
}

/**
 * Bir siparişin ESKİ (zaten düşülmüş) ve YENİ (bu işlemden sonra düşülmüş
 * OLMASI gereken) hammadde tüketimi arasındaki FARKI tek bir transaction'da
 * stoğa uygular (fark pozitifse ek düşüm, negatifse iade) ve sipariş
 * belgesine `kaydedilecekUrunler`i yazar. Onaylama, düzenleme, iptal ve ilk
 * oluşturma — hepsi bu tek çekirdeği kullanır.
 *
 * ÖNEMLİ: `eskiStokKalemleri`/`yeniStokKalemleri` SADECE stok farkını
 * belirler; belgeye ne yazılacağını `kaydedilecekUrunler` belirler. Bunlar
 * kasıtlı olarak AYRI tutulur — örn. "onay_bekliyor" bir siparişi düzenlemek
 * ürün listesini değiştirir ama stoğa HİÇ dokunmaz (henüz onaylanmadı),
 * çünkü çağıran fonksiyon o durumda ikisini de [] geçer.
 */
async function stokFarkiUygulaVeKaydet({
  siparisRef, eskiStokKalemleri, yeniStokKalemleri, kaydedilecekUrunler, stokDusuldu, ekAlanlar, yeniKayit,
}) {
  const eskiTuketim = await tuketimHesapla(eskiStokKalemleri);
  const yeniTuketim = await tuketimHesapla(yeniStokKalemleri);
  const tumHammaddeIdleri = Array.from(new Set([...eskiTuketim.keys(), ...yeniTuketim.keys()]));
  const hammaddeRefs = tumHammaddeIdleri.map((id) => doc(db, "hammaddeler", id));

  await runTransaction(db, async (tx) => {
    // Firestore transaction kuralı: önce TÜM okumalar, sonra yazmalar.
    const hammaddeSnaps = [];
    for (const ref of hammaddeRefs) {
      hammaddeSnaps.push(await tx.get(ref));
    }

    const guncellemeler = [];
    hammaddeSnaps.forEach((snap, i) => {
      const id = tumHammaddeIdleri[i];
      const eski = eskiTuketim.get(id) || 0;
      const yeni = yeniTuketim.get(id) || 0;
      const fark = yeni - eski; // (+) ek düşüm, (-) iade
      if (fark === 0) return;
      if (!snap.exists()) { console.warn("Reçetede geçen hammadde bulunamadı:", id); return; }
      const h = snap.data();
      const mevcutStok = Number(h.mevcutStok) || 0;
      const yeniStok = paraYuvarla(mevcutStok - fark);
      if (yeniStok < 0) {
        throw new Error(`Yetersiz stok: "${h.ad}" (mevcut: ${mevcutStok} ${h.birim}, gereken ek: ${fark} ${h.birim})`);
      }
      guncellemeler.push({ ref: snap.ref, id, ad: h.ad, birim: h.birim, eski: mevcutStok, yeni: yeniStok, fark });
    });

    guncellemeler.forEach((g) => {
      tx.update(g.ref, { mevcutStok: g.yeni, guncellemeZamani: serverTimestamp() });
      const hareketRef = doc(collection(db, "stokHareketleri"));
      tx.set(hareketRef, {
        hammaddeId: g.id,
        hammaddeAd: g.ad,
        birim: g.birim,
        degisim: -g.fark,
        eskiStok: g.eski,
        yeniStok: g.yeni,
        sebep: yeniKayit ? "siparis" : "siparis_guncelleme",
        siparisId: siparisRef.id,
        tarih: serverTimestamp(),
      });
    });

    const siparisVerisi = {
      urunler: kaydedilecekUrunler,
      toplamTutar: paraYuvarla(kaydedilecekUrunler.reduce((acc, k) => acc + k.tutar, 0)),
      stokDusuldu,
      ...ekAlanlar,
    };
    if (yeniKayit) tx.set(siparisRef, siparisVerisi);
    else tx.update(siparisRef, siparisVerisi);
  });
}

async function masaBul(masaId) {
  const masaRef = doc(db, "masalar", masaId);
  const masaSnap = await getDoc(masaRef);
  if (!masaSnap.exists()) throw new Error("Masa bulunamadı.");
  return { masaRef, masa: masaSnap.data() };
}

// Stok düşen işlemler (yeni sipariş / onaylama) Firestore transaction'ı
// kullanır ve bunlar ÇEVRİMDIŞI çalışmaz (sunucu turu gerekir). Diğer
// yazmalar (durum güncelleme, taslak, hesap kapatma) kuyruğa alınıp
// bağlantı gelince otomatik gönderilir — bkz. firebase-config.js.
function cevrimdisiIseHata() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("İnternet bağlantısı yok. Stok düşen bu işlem çevrimdışı yapılamaz — bağlantı gelince tekrar deneyin.");
  }
}

/**
 * PERSONEL (garson/kasa) sipariş oluşturur — zaten staff onayladığı için
 * doğrudan "yeni" durumunda açılır, stok HEMEN düşülür.
 * @param {{masaId:string, urunler:Array, garsonId?:string|null, garsonAdi?:string}} girdi
 */
export async function siparisOlustur({ masaId, urunler, garsonId = null, garsonAdi = "Müşteri (QR Menü)" }) {
  if (!masaId || typeof masaId !== "string") throw new Error("Masa bilgisi eksik.");
  cevrimdisiIseHata();
  const { masaRef, masa } = await masaBul(masaId);
  const siparisKalemleri = await kalemleriOlustur(urunler, masa.subeId || null);
  const siparisRef = doc(collection(db, "siparisler"));

  await stokFarkiUygulaVeKaydet({
    siparisRef,
    eskiStokKalemleri: [],
    yeniStokKalemleri: siparisKalemleri,
    kaydedilecekUrunler: siparisKalemleri,
    stokDusuldu: true,
    yeniKayit: true,
    ekAlanlar: {
      masaId, masaAd: masa.ad || masaId, subeId: masa.subeId || null,
      durum: "yeni", garsonId, garsonAdi, olusturmaZamani: serverTimestamp(),
    },
  });
  await updateDoc(masaRef, { durum: "dolu" });
  return { siparisId: siparisRef.id };
}

/**
 * MÜŞTERİ (QR menü) sipariş taslağı oluşturur — "onay_bekliyor" durumunda
 * açılır, stok HENÜZ düşülmez. Garson onaylayana kadar mutfağa düşmez.
 */
export async function siparisTaslakOlustur({ masaId, urunler, garsonAdi = "Müşteri (QR Menü)" }) {
  if (!masaId || typeof masaId !== "string") throw new Error("Masa bilgisi eksik.");
  const { masaRef, masa } = await masaBul(masaId);
  const siparisKalemleri = await kalemleriOlustur(urunler, masa.subeId || null);
  const siparisRef = doc(collection(db, "siparisler"));

  await setDoc(siparisRef, {
    masaId, masaAd: masa.ad || masaId, subeId: masa.subeId || null,
    urunler: siparisKalemleri,
    toplamTutar: paraYuvarla(siparisKalemleri.reduce((acc, k) => acc + k.tutar, 0)),
    durum: "onay_bekliyor",
    stokDusuldu: false,
    garsonId: null,
    garsonAdi,
    olusturmaZamani: serverTimestamp(),
  });
  await updateDoc(masaRef, { durum: "dolu" });
  return { siparisId: siparisRef.id };
}

/** Garson/kasa "onay_bekliyor" bir siparişi onaylar → durum "yeni" olur, stok ŞİMDİ düşülür. */
export async function siparisiOnayla(siparisId) {
  cevrimdisiIseHata();
  const siparisRef = doc(db, "siparisler", siparisId);
  const snap = await getDoc(siparisRef);
  if (!snap.exists()) throw new Error("Sipariş bulunamadı.");
  const s = snap.data();
  if (s.durum !== "onay_bekliyor") throw new Error("Bu sipariş zaten onaylanmış veya iptal edilmiş.");

  const kalemler = s.urunler || [];
  await stokFarkiUygulaVeKaydet({
    siparisRef,
    eskiStokKalemleri: [], // stokDusuldu false idi, hiç düşülmemişti
    yeniStokKalemleri: kalemler,
    kaydedilecekUrunler: kalemler,
    stokDusuldu: true,
    yeniKayit: false,
    ekAlanlar: { durum: "yeni", onaylanmaZamani: serverTimestamp() },
  });
}

/**
 * Bir siparişi düzenler (ürün/adet ekleme-çıkarma) — SADECE "onay_bekliyor"
 * veya "yeni" durumundayken (mutfak hazırlamaya başlamadan önce) yapılabilir.
 * @param {string} siparisId
 * @param {Array<{urunId:string, adet:number, not?:string}>} yeniKalemlerGirdi
 */
export async function siparisiGuncelle(siparisId, yeniKalemlerGirdi) {
  cevrimdisiIseHata();
  const siparisRef = doc(db, "siparisler", siparisId);
  const snap = await getDoc(siparisRef);
  if (!snap.exists()) throw new Error("Sipariş bulunamadı.");
  const s = snap.data();
  if (!["onay_bekliyor", "yeni"].includes(s.durum)) {
    throw new Error("Bu sipariş artık düzenlenemez (hazırlanmaya başlanmış).");
  }
  const siparisKalemleri = await kalemleriOlustur(yeniKalemlerGirdi, s.subeId || null);

  // KRİTİK: Sipariş henüz onaylanmadıysa (stokDusuldu==false) stoğa HİÇ
  // dokunulmaz — sadece ürün listesi güncellenir. Stok, ancak onaylanmış
  // (stokDusuldu==true) bir siparişte, ESKİ ile YENİ liste arasındaki farka
  // göre düzeltilir.
  const stokEtkisiVarMi = s.stokDusuldu === true;

  await stokFarkiUygulaVeKaydet({
    siparisRef,
    eskiStokKalemleri: stokEtkisiVarMi ? (s.urunler || []) : [],
    yeniStokKalemleri: stokEtkisiVarMi ? siparisKalemleri : [],
    kaydedilecekUrunler: siparisKalemleri,
    stokDusuldu: stokEtkisiVarMi,
    yeniKayit: false,
    ekAlanlar: { duzenlenmeZamani: serverTimestamp() },
  });
}

/**
 * Bir siparişi iptal eder — SADECE "onay_bekliyor" veya "yeni" durumundayken
 * yapılabilir. Stok daha önce düşülmüşse (durum "yeni" idiyse) TAMAMEN iade
 * edilir. Orijinal ürün listesi geçmiş için korunur, sadece durum değişir.
 */
export async function siparisiIptalEt(siparisId, not, iptalEden = "") {
  cevrimdisiIseHata();
  const siparisRef = doc(db, "siparisler", siparisId);
  const snap = await getDoc(siparisRef);
  if (!snap.exists()) throw new Error("Sipariş bulunamadı.");
  const s = snap.data();
  if (!["onay_bekliyor", "yeni"].includes(s.durum)) {
    throw new Error("Bu sipariş artık iptal edilemez (hazırlanmaya başlanmış).");
  }
  const eskiStokKalemleri = s.stokDusuldu ? (s.urunler || []) : [];

  await stokFarkiUygulaVeKaydet({
    siparisRef,
    eskiStokKalemleri,
    yeniStokKalemleri: [], // stoğun tamamı iade edilir
    kaydedilecekUrunler: s.urunler || [], // geçmiş için orijinal liste korunur
    stokDusuldu: false,
    yeniKayit: false,
    ekAlanlar: {
      durum: "iptal",
      iptalNotu: not || "",
      iptalEden: iptalEden || "",
      iptalZamani: serverTimestamp(),
    },
  });
}

/** Müşteri QR menüden "Garson Çağır" butonuna bastığında çağrılır. */
export async function garsonCagir(masaId) {
  if (!masaId) throw new Error("Masa bilgisi eksik.");
  await updateDoc(doc(db, "masalar", masaId), {
    garsonCagirildi: true,
    garsonCagriZamani: serverTimestamp(),
  });
}

/** Müşteri QR menüden "Hesap İste" butonuna bastığında çağrılır. */
export async function hesapIste(masaId) {
  if (!masaId) throw new Error("Masa bilgisi eksik.");
  await updateDoc(doc(db, "masalar", masaId), {
    hesapIstendi: true,
    hesapIstemeZamani: serverTimestamp(),
  });
}

/** Müşteri QR menüden "Ödedim / Ödemeyi bildir" butonuna bastığında çağrılır
 * (havale/EFT veya ödeme linkiyle ödedikten sonra kasayı haberdar eder). */
export async function odemeBildir(masaId) {
  if (!masaId) throw new Error("Masa bilgisi eksik.");
  await updateDoc(doc(db, "masalar", masaId), {
    odemeBildirildi: true,
    odemeBildirimZamani: serverTimestamp(),
  });
}
