import { db } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, updateDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import { pwaBaslat } from "../../shared/pwa.js";
import { escapeHtml, tarihFormat, bildirimGoster, snapshotHataYakala, baglantiDurumuBaslat, sesliUyari, sekmeDikkat } from "../../shared/utils.js";

pwaBaslat();
baglantiDurumuBaslat();

let siparislerCache = [];
// Sesli uyarı için: en son bilinen "yeni" (mutfağa yeni düşmüş) sipariş
// id'leri — sonraki snapshot'ta yeni bir id belirirse bip çalar.
let oncekiYeniIdler = new Set();
let ilkYuklemeYapildi = false;

// Hazırlama süresi eşiği (sipariş oluşturulduğundan bu yana geçen dakika):
// UYARI_DK'yı geçince kart turuncu, KRITIK_DK'yı geçince kırmızı + yanıp söner.
// "Hazır" sütununda ise sipariş hazır olduğundan beri SERVIS_UYARI_DK'dan
// fazla beklediyse (yemek soğuyor) kırmızı uyarı verilir.
const UYARI_DK = 15;
const KRITIK_DK = 25;
const SERVIS_UYARI_DK = 5;

async function baslat() {
  const { subeId, ad } = await sayfaKorumaBaslat(["mutfak", "admin"]);

  document.getElementById("yukleniyor-ekrani").remove();
  document.getElementById("sayfa").hidden = false;
  document.getElementById("mutfak-baslik").textContent = `🍳 ${ad}`;
  document.getElementById("cikis-buton").addEventListener("click", cikisYap);

  let subeAdi = "Tüm Şubeler";
  if (subeId) {
    const subeSnap = await getDoc(doc(db, "subeler", subeId));
    if (subeSnap.exists()) subeAdi = subeSnap.data().ad;
  }
  document.getElementById("mutfak-alt-baslik").textContent = subeAdi;

  const siparislerQuery = subeId
    ? query(collection(db, "siparisler"), where("subeId", "==", subeId))
    : query(collection(db, "siparisler"));

  onSnapshot(
    siparislerQuery,
    (snap) => {
      siparislerCache = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.durum === "yeni" || s.durum === "hazirlaniyor" || s.durum === "hazir");

      // Mutfağa YENİ düşen sipariş(ler) için sesli + görsel uyarı — ilk
      // yüklemede çalmaz (o an listedekilerin hepsi "yeni" gibi görünür).
      const yeniIdler = new Set(siparislerCache.filter((s) => s.durum === "yeni").map((s) => s.id));
      if (ilkYuklemeYapildi) {
        const taze = [...yeniIdler].filter((id) => !oncekiYeniIdler.has(id));
        if (taze.length > 0) {
          sesliUyari(2);
          sekmeDikkat(`${taze.length} yeni sipariş`);
          bildirimGoster(`🆕 ${taze.length} yeni sipariş geldi!`, "bilgi");
        }
      }
      oncekiYeniIdler = yeniIdler;
      ilkYuklemeYapildi = true;

      render();
    },
    snapshotHataYakala("mutfak-siparisler")
  );

  // Kartlardaki süre sayaçları/gecikme uyarısı, sipariş listesi değişmese de
  // saniyeler ilerledikçe güncellenmeli — her 15 sn'de bir tazele.
  setInterval(sureleriGuncelle, 15000);
}

function dakikaMetni(dk) {
  if (dk < 1) return "az önce";
  if (dk < 60) return `${dk} dk`;
  return `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
}

// Kart HTML'ini yeniden üretmeden (buton dinleyicileri korunur) yalnızca süre
// rozetlerini ve gecikme sınıflarını günceller.
function sureleriGuncelle() {
  const simdi = Date.now();
  document.querySelectorAll(".siparis-karti").forEach((kart) => {
    const durum = kart.dataset.durum;
    const basla = Number(kart.dataset.basla) || 0;
    const sureChip = kart.querySelector(".sure-chip");
    if (basla && sureChip) {
      const dk = Math.floor((simdi - basla) / 60000);
      sureChip.textContent = `⏱️ ${dakikaMetni(dk)}`;
      const kritik = durum !== "hazir" && dk >= KRITIK_DK;
      const uyari = durum !== "hazir" && !kritik && dk >= UYARI_DK;
      sureChip.classList.toggle("sure-uyari", uyari);
      sureChip.classList.toggle("sure-kritik", kritik);
      kart.classList.toggle("gecikme-uyari", uyari);
      kart.classList.toggle("gecikme-kritik", kritik);
    }
    const hazir = Number(kart.dataset.hazir) || 0;
    const servisChip = kart.querySelector(".servis-bekleme-chip");
    if (hazir && servisChip) {
      const dk = Math.floor((simdi - hazir) / 60000);
      servisChip.textContent = `🍽️ ${dakikaMetni(dk)} servis bekliyor`;
      servisChip.classList.toggle("sure-kritik", dk >= SERVIS_UYARI_DK);
    }
  });
}

function siraliListe(durum) {
  return siparislerCache
    .filter((s) => s.durum === durum)
    .sort((a, b) => (a.olusturmaZamani?.toMillis?.() || 0) - (b.olusturmaZamani?.toMillis?.() || 0));
}

const SONRAKI_DURUM = { yeni: "hazirlaniyor", hazirlaniyor: "hazir", hazir: "servis_edildi" };
const ONCEKI_DURUM = { hazirlaniyor: "yeni", hazir: "hazirlaniyor", servis_edildi: "hazir" };
const ILERI_BUTON_METNI = { yeni: "🔥 Hazırlamaya Başla", hazirlaniyor: "✅ Hazırlandı", hazir: "🍽️ Servis Edildi" };

function render() {
  const yeniListe = siraliListe("yeni");
  const hazirlaniyorListe = siraliListe("hazirlaniyor");
  const hazirListe = siraliListe("hazir");

  document.getElementById("yeni-sayisi").textContent = yeniListe.length || "";
  document.getElementById("hazirlaniyor-sayisi").textContent = hazirlaniyorListe.length || "";
  document.getElementById("hazir-sayisi").textContent = hazirListe.length || "";

  renderSutun("yeni-liste", yeniListe, "yeni");
  renderSutun("hazirlaniyor-liste", hazirlaniyorListe, "hazirlaniyor");
  renderSutun("hazir-liste", hazirListe, "hazir");

  sureleriGuncelle();
}

function renderSutun(elementId, liste, durum) {
  const el = document.getElementById(elementId);
  if (liste.length === 0) {
    el.innerHTML = `<div class="bos-durum">Bekleyen sipariş yok.</div>`;
    return;
  }

  el.innerHTML = liste
    .map(
      (s) => `
    <div class="siparis-karti ${durum} ${durum === "yeni" ? "yeni-vurgu" : ""}" data-siparis="${s.id}" data-durum="${durum}" data-basla="${(s.onaylanmaZamani || s.olusturmaZamani)?.toMillis?.() || 0}" data-hazir="${s.hazirZamani?.toMillis?.() || 0}">
      <div class="ust">
        <span class="masa-adi">${escapeHtml(s.masaAd || s.masaId)}</span>
        <span class="saat">${tarihFormat(s.olusturmaZamani)}</span>
      </div>
      <div class="sure-satir">
        <span class="sure-chip">⏱️ —</span>
        ${durum === "hazir" && s.hazirZamani ? `<span class="servis-bekleme-chip">🍽️ —</span>` : ""}
      </div>
      <div class="garson">Garson: ${escapeHtml(s.garsonAdi || "—")}</div>
      <div class="kalemler">
        ${(s.urunler || [])
          .map(
            (k) => `
          <div class="kalem">
            <span><span class="adet">${k.adet}x</span> ${escapeHtml(k.ad)}${k.not ? `<span class="not">📝 ${escapeHtml(k.not)}</span>` : ""}</span>
          </div>`
          )
          .join("")}
      </div>
      <div class="siparis-karti-eylemler">
        ${ONCEKI_DURUM[durum] ? `<button class="btn-ikincil btn-kucuk" data-geri="${s.id}">◀ Geri Al</button>` : ""}
        ${SONRAKI_DURUM[durum] ? `<button class="${durum === "yeni" ? "btn-birincil" : "btn-yesil"}" data-ileri="${s.id}">${ILERI_BUTON_METNI[durum]}</button>` : ""}
      </div>
    </div>`
    )
    .join("");

  el.querySelectorAll("[data-ileri]").forEach((b) =>
    b.addEventListener("click", () => durumGuncelle(b.dataset.ileri, SONRAKI_DURUM[durum]))
  );
  el.querySelectorAll("[data-geri]").forEach((b) =>
    b.addEventListener("click", () => durumGuncelle(b.dataset.geri, ONCEKI_DURUM[durum]))
  );
}

async function durumGuncelle(siparisId, yeniDurum) {
  try {
    const guncelleme = { durum: yeniDurum };
    // "Hazır" olduğu anı kaydet ki servis bekleme süresi ("yemek soğuyor")
    // hesaplanabilsin. Geri alınırsa temizlenir.
    if (yeniDurum === "hazir") guncelleme.hazirZamani = serverTimestamp();
    else if (yeniDurum === "hazirlaniyor") guncelleme.hazirZamani = null;
    await updateDoc(doc(db, "siparisler", siparisId), guncelleme);
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

baslat().catch((err) => {
  console.error(err);
  document.getElementById("yukleniyor-ekrani").textContent = "Hata: " + err.message;
});
