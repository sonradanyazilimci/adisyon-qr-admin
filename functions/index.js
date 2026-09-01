/**
 * QR Menü + Adisyon + Stok Takip — Cloud Functions (OPSİYONEL / BLAZE PLANI)
 *
 * ⚠️ Bu klasör şu anda DEPLOY EDİLMİYOR ve uygulama tarafından KULLANILMIYOR.
 * Proje şu an Blaze planı olmadan (Spark/ücretsiz plan) çalışacak şekilde
 * kurulu; sipariş oluşturma + stok düşümü client tarafında bir Firestore
 * transaction ile (bkz. public/shared/siparis.js), personel/rol yönetimi ise
 * doğrudan Firestore belgeleri ile (bkz. public/admin/js/personel.js,
 * public/login/login.js) yapılıyor. `firebase.json`'da da "functions" hedefi
 * tanımlı değil.
 *
 * İleride Blaze planına geçip daha güvenli (sunucu taraflı doğrulamalı) bir
 * mimariye dönmek isterseniz bu dosyadaki fonksiyonlar hazır bekliyor:
 *   1) siparisOlustur   → sipariş oluşturma + reçeteye göre ATOMİK stok düşümü
 *   2) createStaffUser / updateStaffUser / deleteStaffUser / bootstrapAdmin
 *      → rol bazlı Firebase Auth kullanıcı yönetimi (custom claims)
 *
 * Devreye almak için: `firebase.json`'a functions bloğunu geri ekleyin,
 * `firestore.rules`'ı custom-claim tabanlı sürüme döndürün (bkz. git geçmişi
 * veya bu dosyanın önceki hâli) ve `firebase deploy --only functions` çalıştırın.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ───────────────────────────── Yardımcılar ─────────────────────────────

function rolKontrol(auth, izinliRoller) {
  if (!auth || !izinliRoller.includes(auth.token.role)) {
    throw new HttpsError(
      "permission-denied",
      "Bu işlem için yetkiniz yok (" + izinliRoller.join("/") + " rolü gerekli)."
    );
  }
}

function paraYuvarla(n) {
  return Math.round(n * 100) / 100;
}

// ───────────────────────── 1) SİPARİŞ OLUŞTURMA ─────────────────────────
//
// data: {
//   masaId: string,
//   urunler: [ { urunId: string, adet: number, not?: string } ],
//   garsonId?: string, garsonAdi?: string
// }
exports.siparisOlustur = onCall(async (request) => {
  const data = request.data || {};
  const { masaId, urunler } = data;

  if (!masaId || typeof masaId !== "string") {
    throw new HttpsError("invalid-argument", "Masa bilgisi eksik.");
  }
  if (!Array.isArray(urunler) || urunler.length === 0) {
    throw new HttpsError("invalid-argument", "Sepet boş olamaz.");
  }
  for (const s of urunler) {
    if (!s.urunId || !(Number(s.adet) > 0)) {
      throw new HttpsError("invalid-argument", "Geçersiz ürün/adet.");
    }
  }

  // Masayı doğrula
  const masaRef = db.collection("masalar").doc(masaId);
  const masaSnap = await masaRef.get();
  if (!masaSnap.exists) {
    throw new HttpsError("not-found", "Masa bulunamadı.");
  }

  // Ürün belgelerini oku (reçete + fiyat + aktiflik için)
  const urunRefs = urunler.map((s) => db.collection("urunler").doc(s.urunId));
  const urunSnaps = await db.getAll(...urunRefs);

  const siparisKalemleri = [];
  let toplamTutar = 0;
  // hammaddeId -> toplam düşülecek miktar
  const hammaddeTuketimi = new Map();

  urunSnaps.forEach((snap, i) => {
    const istek = urunler[i];
    if (!snap.exists) {
      throw new HttpsError("not-found", `Ürün bulunamadı: ${istek.urunId}`);
    }
    const urun = snap.data();
    if (urun.aktif === false) {
      throw new HttpsError("failed-precondition", `"${urun.ad}" şu anda menüde aktif değil.`);
    }
    const adet = Number(istek.adet);
    const fiyat = Number(urun.fiyat) || 0;
    const kalemTutar = paraYuvarla(fiyat * adet);
    toplamTutar = paraYuvarla(toplamTutar + kalemTutar);

    siparisKalemleri.push({
      urunId: istek.urunId,
      ad: urun.ad,
      adet,
      fiyat,
      tutar: kalemTutar,
      not: istek.not || "",
    });

    (urun.recete || []).forEach((r) => {
      if (!r.hammaddeId || !(Number(r.miktar) > 0)) return;
      const toplam = Number(r.miktar) * adet;
      hammaddeTuketimi.set(
        r.hammaddeId,
        (hammaddeTuketimi.get(r.hammaddeId) || 0) + toplam
      );
    });
  });

  const hammaddeIdleri = Array.from(hammaddeTuketimi.keys());
  const hammaddeRefs = hammaddeIdleri.map((id) => db.collection("hammaddeler").doc(id));

  const siparisRef = db.collection("siparisler").doc();

  await db.runTransaction(async (tx) => {
    let hammaddeSnaps = [];
    if (hammaddeRefs.length > 0) {
      hammaddeSnaps = await tx.getAll(...hammaddeRefs);
    }

    // Stok yeterlilik kontrolü
    const guncellemeler = [];
    hammaddeSnaps.forEach((snap, i) => {
      const id = hammaddeIdleri[i];
      const tuketim = hammaddeTuketimi.get(id);
      if (!snap.exists) {
        console.warn(`Reçetede geçen hammadde bulunamadı: ${id}`);
        return;
      }
      const h = snap.data();
      const mevcut = Number(h.mevcutStok) || 0;
      const yeni = paraYuvarla(mevcut - tuketim);
      if (yeni < 0) {
        throw new HttpsError(
          "failed-precondition",
          `Yetersiz stok: "${h.ad}" (mevcut: ${mevcut} ${h.birim}, gereken: ${tuketim} ${h.birim})`
        );
      }
      guncellemeler.push({ ref: snap.ref, id, ad: h.ad, birim: h.birim, eski: mevcut, yeni, tuketim });
    });

    // Stok düşümü + hareket kaydı
    guncellemeler.forEach((g) => {
      tx.update(g.ref, {
        mevcutStok: g.yeni,
        guncellemeZamani: FieldValue.serverTimestamp(),
      });
      const hareketRef = db.collection("stokHareketleri").doc();
      tx.set(hareketRef, {
        hammaddeId: g.id,
        hammaddeAd: g.ad,
        birim: g.birim,
        degisim: -g.tuketim,
        eskiStok: g.eski,
        yeniStok: g.yeni,
        sebep: "siparis",
        siparisId: siparisRef.id,
        tarih: FieldValue.serverTimestamp(),
      });
    });

    // Sipariş belgesi
    tx.set(siparisRef, {
      masaId,
      masaAd: masaSnap.data().ad || masaId,
      subeId: masaSnap.data().subeId || null,
      urunler: siparisKalemleri,
      durum: "yeni",
      garsonId: data.garsonId || null,
      garsonAdi: data.garsonAdi || "Müşteri (QR Menü)",
      toplamTutar,
      olusturmaZamani: FieldValue.serverTimestamp(),
    });

    // Masa durumunu güncelle
    tx.update(masaRef, { durum: "dolu" });
  });

  return { basarili: true, siparisId: siparisRef.id, toplamTutar };
});

// Müşteri QR menüden "Garson Çağır" butonuna bastığında çağrılır.
// Auth gerektirmez; sadece masalar/{masaId} üzerinde sınırlı bir bayrak günceller
// (client'ın doğrudan masa durumu/diğer alanları değiştirmesini engellemek için
// bilerek Cloud Function üzerinden yapılır).
exports.garsonCagir = onCall(async (request) => {
  const { masaId } = request.data || {};
  if (!masaId || typeof masaId !== "string") {
    throw new HttpsError("invalid-argument", "Masa bilgisi eksik.");
  }
  const masaRef = db.collection("masalar").doc(masaId);
  const masaSnap = await masaRef.get();
  if (!masaSnap.exists) {
    throw new HttpsError("not-found", "Masa bulunamadı.");
  }
  await masaRef.update({
    garsonCagirildi: true,
    garsonCagriZamani: FieldValue.serverTimestamp(),
  });
  return { basarili: true };
});

// ───────────────────────── 2) PERSONEL YÖNETİMİ ─────────────────────────

// İlk kurulumda tek seferlik admin ataması. Sistemde hiç admin yoksa,
// o anda giriş yapmış kullanıcıyı admin yapar. Daha sonra tekrar
// çağrılamaz (ilk admin oluştuktan sonra reddedilir).
exports.bootstrapAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Önce Firebase Authentication ile giriş yapmalısınız.");
  }

  const mevcutAdminler = await db.collection("kullanicilar").where("rol", "==", "admin").limit(1).get();
  if (!mevcutAdminler.empty) {
    throw new HttpsError(
      "already-exists",
      "Sistemde zaten bir admin kullanıcı var. Yeni personel eklemek için admin panelini kullanın."
    );
  }

  const uid = request.auth.uid;
  await admin.auth().setCustomUserClaims(uid, { role: "admin", subeId: null });
  await db.collection("kullanicilar").doc(uid).set({
    ad: request.auth.token.name || request.auth.token.email || "Admin",
    email: request.auth.token.email || "",
    rol: "admin",
    subeId: null,
    aktif: true,
    olusturmaZamani: FieldValue.serverTimestamp(),
  });

  return { basarili: true };
});

// Admin tarafından yeni personel (garson/kasa/admin) hesabı oluşturma.
// subeId: garson/kasa için hangi şubede çalıştığı (admin için tüm şubeler
// anlamına gelecek şekilde null bırakılabilir).
exports.createStaffUser = onCall(async (request) => {
  rolKontrol(request.auth, ["admin"]);
  const { ad, email, password, rol, subeId } = request.data || {};

  if (!ad || !email || !password || !["admin", "garson", "kasa"].includes(rol)) {
    throw new HttpsError("invalid-argument", "Ad, e-posta, şifre ve geçerli bir rol (admin/garson/kasa) gerekli.");
  }
  if (String(password).length < 6) {
    throw new HttpsError("invalid-argument", "Şifre en az 6 karakter olmalı.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: ad });
  } catch (err) {
    throw new HttpsError("already-exists", "Kullanıcı oluşturulamadı: " + err.message);
  }

  const subeIdDeger = rol === "admin" ? null : subeId || null;
  await admin.auth().setCustomUserClaims(userRecord.uid, { role: rol, subeId: subeIdDeger });
  await db.collection("kullanicilar").doc(userRecord.uid).set({
    ad,
    email,
    rol,
    subeId: subeIdDeger,
    aktif: true,
    olusturmaZamani: FieldValue.serverTimestamp(),
  });

  return { basarili: true, uid: userRecord.uid };
});

// Admin tarafından personel rolü / şube / aktiflik güncelleme
exports.updateStaffUser = onCall(async (request) => {
  rolKontrol(request.auth, ["admin"]);
  const { uid, rol, aktif, ad, subeId } = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "uid gerekli.");

  const kullaniciRef = db.collection("kullanicilar").doc(uid);
  const mevcutSnap = await kullaniciRef.get();
  const mevcutRol = mevcutSnap.exists ? mevcutSnap.data().rol : null;
  const yeniRol = rol && ["admin", "garson", "kasa"].includes(rol) ? rol : mevcutRol;

  const guncelleme = {};
  if (rol || subeId !== undefined) {
    const subeIdDeger = yeniRol === "admin" ? null : subeId !== undefined ? subeId || null : mevcutSnap.data()?.subeId ?? null;
    await admin.auth().setCustomUserClaims(uid, { role: yeniRol, subeId: subeIdDeger });
    guncelleme.rol = yeniRol;
    guncelleme.subeId = subeIdDeger;
  }
  if (typeof aktif === "boolean") {
    await admin.auth().updateUser(uid, { disabled: !aktif });
    guncelleme.aktif = aktif;
  }
  if (ad) {
    await admin.auth().updateUser(uid, { displayName: ad });
    guncelleme.ad = ad;
  }
  if (Object.keys(guncelleme).length > 0) {
    await kullaniciRef.update(guncelleme);
  }
  return { basarili: true };
});

// Admin tarafından personel silme
exports.deleteStaffUser = onCall(async (request) => {
  rolKontrol(request.auth, ["admin"]);
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "uid gerekli.");
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Kendi hesabınızı silemezsiniz.");
  }

  await admin.auth().deleteUser(uid).catch(() => {});
  await db.collection("kullanicilar").doc(uid).delete();
  return { basarili: true };
});
