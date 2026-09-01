import { db } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, updateDoc, addDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import {
  paraFormat, escapeHtml, tarihFormat, bildirimGoster, MASA_DURUMLARI, SIPARIS_DURUMLARI,
} from "../../shared/utils.js";

let kullanici = null;
let masalarCache = [];
let siparislerCache = [];
let seciliMasaId = null;
let seciliOdemeYontemi = "nakit";

async function baslat() {
  const { rol, subeId, ad } = await sayfaKorumaBaslat(["kasa", "admin"]);
  kullanici = { ad, subeId, rol };

  document.getElementById("yukleniyor-ekrani").remove();
  document.getElementById("sayfa").hidden = false;
  document.getElementById("kasa-baslik").textContent = `🧾 ${kullanici.ad}`;
  document.getElementById("cikis-buton").addEventListener("click", cikisYap);

  let subeAdi = "Tüm Şubeler";
  if (kullanici.subeId) {
    const subeSnap = await getDoc(doc(db, "subeler", kullanici.subeId));
    if (subeSnap.exists()) subeAdi = subeSnap.data().ad;
  }
  document.getElementById("kasa-alt-baslik").textContent = subeAdi;

  const masalarQuery = kullanici.subeId
    ? query(collection(db, "masalar"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "masalar"));
  onSnapshot(masalarQuery, (snap) => {
    masalarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMasalar();
    if (seciliMasaId) renderDetay();
  });

  const siparislerQuery = kullanici.subeId
    ? query(collection(db, "siparisler"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "siparisler"));
  onSnapshot(siparislerQuery, (snap) => {
    siparislerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMasalar();
    if (seciliMasaId) renderDetay();
  });
}

function masaninAcikSiparisleri(masaId) {
  return siparislerCache.filter((s) => s.masaId === masaId && s.durum !== "kapandi");
}
function siparisTutari(s) { return Number(s.toplamTutar) || 0; }

function renderMasalar() {
  const grid = document.getElementById("masalar-grid");
  const liste = masalarCache.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr", { numeric: true }));
  if (liste.length === 0) { grid.innerHTML = `<div class="bos-durum">Masa bulunamadı.</div>`; return; }

  grid.innerHTML = liste.map((m) => {
    const acikSiparisler = masaninAcikSiparisleri(m.id);
    const toplam = acikSiparisler.reduce((acc, s) => acc + siparisTutari(s), 0);
    const yeniSiparisVar = acikSiparisler.some((s) => s.durum === "yeni");
    return `
    <div class="masa-kart-adisyon ${m.durum || "bos"} ${m.id === seciliMasaId ? "secili" : ""} ${m.garsonCagirildi ? "cagirdi" : ""} ${yeniSiparisVar ? "yeni-siparis" : ""}" data-masa="${m.id}">
      ${escapeHtml(m.ad)}
      <div class="durum" style="color:${(MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos).renk}">${(MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos).etiket}</div>
      ${toplam > 0 ? `<div class="tutar">${paraFormat(toplam)}</div>` : ""}
    </div>`;
  }).join("");

  grid.querySelectorAll("[data-masa]").forEach((el) => el.addEventListener("click", () => { seciliMasaId = el.dataset.masa; seciliOdemeYontemi = "nakit"; renderMasalar(); renderDetay(); }));
}

function renderDetay() {
  const panel = document.getElementById("detay-panel");
  const masa = masalarCache.find((m) => m.id === seciliMasaId);
  if (!masa) { panel.innerHTML = `<div class="bos-durum">Detaylarını görmek için bir masa seçin.</div>`; return; }

  const acikSiparisler = masaninAcikSiparisleri(masa.id).sort((a, b) => (a.olusturmaZamani?.toMillis?.() || 0) - (b.olusturmaZamani?.toMillis?.() || 0));
  const toplamTutar = acikSiparisler.reduce((acc, s) => acc + siparisTutari(s), 0);

  if (acikSiparisler.length === 0) {
    panel.innerHTML = `<h2>${escapeHtml(masa.ad)}</h2><div class="bos-durum">Bu masada açık sipariş yok.</div>`;
    return;
  }

  panel.innerHTML = `
    <h2>${escapeHtml(masa.ad)}</h2>
    ${acikSiparisler.map((s) => `
      <div class="siparis-blok">
        <div class="siparis-blok-ust">
          <span>${tarihFormat(s.olusturmaZamani)} · ${escapeHtml(s.garsonAdi || "—")}</span>
          <select class="siparis-durum-select" data-siparis="${s.id}">
            ${Object.entries(SIPARIS_DURUMLARI).filter(([k]) => k !== "kapandi").map(([k, v]) => `<option value="${k}" ${s.durum === k ? "selected" : ""}>${v.etiket}</option>`).join("")}
          </select>
        </div>
        ${(s.urunler || []).map((k) => `
          <div class="siparis-kalem">
            <span>${k.adet}x ${escapeHtml(k.ad)} ${k.not ? `<span class="not">(${escapeHtml(k.not)})</span>` : ""}</span>
            <span>${paraFormat(k.tutar ?? k.adet * k.fiyat)}</span>
          </div>`).join("")}
      </div>`).join("")}

    <div class="toplam-satir"><span>Genel Toplam</span><span>${paraFormat(toplamTutar)}</span></div>

    <div class="odeme-secim">
      <button data-odeme="nakit" class="${seciliOdemeYontemi === "nakit" ? "secili" : ""}">💵 Nakit</button>
      <button data-odeme="kart" class="${seciliOdemeYontemi === "kart" ? "secili" : ""}">💳 Kart</button>
    </div>

    <div class="detay-eylemler">
      <button id="fis-yazdir-buton" class="btn-ikincil btn-tam">🖨️ Fiş Yazdır</button>
      <button id="hesap-kapat-buton" class="btn-yesil btn-tam">Hesabı Kapat</button>
    </div>
  `;

  panel.querySelectorAll(".siparis-durum-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "siparisler", sel.dataset.siparis), { durum: sel.value });
        bildirimGoster("Sipariş durumu güncellendi.", "basari");
      } catch (err) {
        bildirimGoster("Hata: " + err.message, "hata");
      }
    });
  });

  panel.querySelectorAll("[data-odeme]").forEach((b) => b.addEventListener("click", () => { seciliOdemeYontemi = b.dataset.odeme; renderDetay(); }));
  panel.querySelector("#fis-yazdir-buton").addEventListener("click", () => fisYazdir(masa, acikSiparisler, toplamTutar));
  panel.querySelector("#hesap-kapat-buton").addEventListener("click", () => hesabiKapat(masa, acikSiparisler, toplamTutar));
}

function fisYazdir(masa, siparisler, toplam) {
  const fisEl = document.getElementById("fis-yazdirma");
  fisEl.innerHTML = `
    <h2>ADİSYON FİŞİ</h2>
    <h3>${escapeHtml(masa.ad)}</h3>
    <div class="cizgi"></div>
    <table>
      ${siparisler.flatMap((s) => (s.urunler || []).map((k) => `
        <tr><td>${k.adet}x ${escapeHtml(k.ad)}</td><td style="text-align:right;">${paraFormat(k.tutar ?? k.adet * k.fiyat)}</td></tr>
      `)).join("")}
    </table>
    <div class="cizgi"></div>
    <table><tr><td><b>TOPLAM</b></td><td style="text-align:right;"><b>${paraFormat(toplam)}</b></td></tr></table>
    <div class="cizgi"></div>
    <p style="text-align:center;font-size:12px;">${new Date().toLocaleString("tr-TR")}</p>
    <p style="text-align:center;font-size:12px;">Afiyet olsun, bizi tercih ettiğiniz için teşekkürler!</p>
  `;
  window.print();
}

async function hesabiKapat(masa, siparisler, toplam) {
  if (!confirm(`${masa.ad} hesabını ${seciliOdemeYontemi === "nakit" ? "NAKİT" : "KART"} olarak ${paraFormat(toplam)} tutarında kapatmak istediğinize emin misiniz?`)) return;
  try {
    await addDoc(collection(db, "adisyonlar"), {
      masaId: masa.id,
      masaAd: masa.ad,
      subeId: masa.subeId || null,
      siparisIdler: siparisler.map((s) => s.id),
      toplamTutar: toplam,
      odemeYontemi: seciliOdemeYontemi,
      kapananKullanici: kullanici.ad,
      kapanmaZamani: serverTimestamp(),
    });
    await Promise.all(siparisler.map((s) => updateDoc(doc(db, "siparisler", s.id), { durum: "kapandi" })));
    await updateDoc(doc(db, "masalar", masa.id), { durum: "bos", garsonCagirildi: false });
    bildirimGoster("Hesap kapatıldı.", "basari");
    seciliMasaId = null;
    renderMasalar();
    renderDetay();
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

baslat().catch((err) => {
  console.error(err);
  document.getElementById("yukleniyor-ekrani").textContent = "Hata: " + err.message;
});
