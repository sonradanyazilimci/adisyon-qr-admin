// ─────────────────────────────────────────────────────────────────────────
// Sipariş oluşturma + reçeteye göre ATOMİK stok düşümü.
//
// NOT: Bu proje Blaze planı olmadan çalıştığı için bu işlem artık bir Cloud
// Function yerine CLIENT'TAN çalışan bir Firestore transaction'dır
// (runTransaction). Aynı anda gelen siparişlerde stok tutarsızlığı
// oluşmaz (Firestore transaction garantisi), fakat sunucu tarafı doğrulama
// olmadığından fiyat/adet gibi alanlar sadece Firestore güvenlik kuralları
// (firestore.rules) ile sınırlı ölçüde doğrulanabilir. Blaze planına
// geçildiğinde functions/index.js içindeki sunucu taraflı eşdeğeri
// (siparisOlustur Cloud Function) yeniden devreye alınabilir.
// ─────────────────────────────────────────────────────────────────────────
import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, runTransaction, serverTimestamp, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function paraYuvarla(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {Object} girdi
 * @param {string} girdi.masaId
 * @param {Array<{urunId:string, adet:number, not?:string}>} girdi.urunler
 * @param {string|null} [girdi.garsonId]
 * @param {string} [girdi.garsonAdi]
 * @returns {Promise<{siparisId:string, toplamTutar:number}>}
 */
export async function siparisOlustur({ masaId, urunler, garsonId = null, garsonAdi = "Müşteri (QR Menü)" }) {
  if (!masaId || typeof masaId !== "string") {
    throw new Error("Masa bilgisi eksik.");
  }
  if (!Array.isArray(urunler) || urunler.length === 0) {
    throw new Error("Sepet boş olamaz.");
  }
  for (const s of urunler) {
    if (!s.urunId || !(Number(s.adet) > 0)) {
      throw new Error("Geçersiz ürün/adet.");
    }
  }

  const masaRef = doc(db, "masalar", masaId);
  const masaSnap = await getDoc(masaRef);
  if (!masaSnap.exists()) {
    throw new Error("Masa bulunamadı.");
  }
  const masa = masaSnap.data();

  // Ürün belgelerini oku (reçete + fiyat + aktiflik için)
  const urunSnaps = await Promise.all(urunler.map((s) => getDoc(doc(db, "urunler", s.urunId))));

  const siparisKalemleri = [];
  let toplamTutar = 0;
  const hammaddeTuketimi = new Map(); // hammaddeId -> toplam düşülecek miktar

  urunSnaps.forEach((snap, i) => {
    const istek = urunler[i];
    if (!snap.exists()) {
      throw new Error(`Ürün bulunamadı: ${istek.urunId}`);
    }
    const urun = snap.data();
    if (urun.aktif === false) {
      throw new Error(`"${urun.ad}" şu anda menüde aktif değil.`);
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
      hammaddeTuketimi.set(r.hammaddeId, (hammaddeTuketimi.get(r.hammaddeId) || 0) + toplam);
    });
  });

  const hammaddeIdleri = Array.from(hammaddeTuketimi.keys());
  const hammaddeRefs = hammaddeIdleri.map((id) => doc(db, "hammaddeler", id));
  const siparisRef = doc(collection(db, "siparisler"));

  await runTransaction(db, async (tx) => {
    // Firestore transaction kuralı: önce TÜM okumalar, sonra yazmalar.
    const hammaddeSnaps = [];
    for (const ref of hammaddeRefs) {
      hammaddeSnaps.push(await tx.get(ref));
    }

    const guncellemeler = [];
    hammaddeSnaps.forEach((snap, i) => {
      const id = hammaddeIdleri[i];
      const tuketim = hammaddeTuketimi.get(id);
      if (!snap.exists()) {
        console.warn("Reçetede geçen hammadde bulunamadı:", id);
        return;
      }
      const h = snap.data();
      const mevcut = Number(h.mevcutStok) || 0;
      const yeni = paraYuvarla(mevcut - tuketim);
      if (yeni < 0) {
        throw new Error(`Yetersiz stok: "${h.ad}" (mevcut: ${mevcut} ${h.birim}, gereken: ${tuketim} ${h.birim})`);
      }
      guncellemeler.push({ ref: snap.ref, id, ad: h.ad, birim: h.birim, eski: mevcut, yeni, tuketim });
    });

    guncellemeler.forEach((g) => {
      tx.update(g.ref, { mevcutStok: g.yeni, guncellemeZamani: serverTimestamp() });
      const hareketRef = doc(collection(db, "stokHareketleri"));
      tx.set(hareketRef, {
        hammaddeId: g.id,
        hammaddeAd: g.ad,
        birim: g.birim,
        degisim: -g.tuketim,
        eskiStok: g.eski,
        yeniStok: g.yeni,
        sebep: "siparis",
        siparisId: siparisRef.id,
        tarih: serverTimestamp(),
      });
    });

    tx.set(siparisRef, {
      masaId,
      masaAd: masa.ad || masaId,
      subeId: masa.subeId || null,
      urunler: siparisKalemleri,
      durum: "yeni",
      garsonId,
      garsonAdi,
      toplamTutar,
      olusturmaZamani: serverTimestamp(),
    });

    tx.update(masaRef, { durum: "dolu" });
  });

  return { siparisId: siparisRef.id, toplamTutar };
}

/** Müşteri QR menüden "Garson Çağır" butonuna bastığında çağrılır. */
export async function garsonCagir(masaId) {
  if (!masaId) throw new Error("Masa bilgisi eksik.");
  await updateDoc(doc(db, "masalar", masaId), {
    garsonCagirildi: true,
    garsonCagriZamani: serverTimestamp(),
  });
}
