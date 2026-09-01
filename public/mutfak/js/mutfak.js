import { db } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, updateDoc, onSnapshot, query, where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import { escapeHtml, tarihFormat, bildirimGoster, snapshotHataYakala } from "../../shared/utils.js";

let siparislerCache = [];

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
      render();
    },
    snapshotHataYakala("mutfak-siparisler")
  );
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
    <div class="siparis-karti ${durum} ${durum === "yeni" ? "yeni-vurgu" : ""}" data-siparis="${s.id}">
      <div class="ust">
        <span class="masa-adi">${escapeHtml(s.masaAd || s.masaId)}</span>
        <span class="saat">${tarihFormat(s.olusturmaZamani)}</span>
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
    await updateDoc(doc(db, "siparisler", siparisId), { durum: yeniDurum });
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

baslat().catch((err) => {
  console.error(err);
  document.getElementById("yukleniyor-ekrani").textContent = "Hata: " + err.message;
});
