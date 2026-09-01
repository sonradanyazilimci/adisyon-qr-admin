import { db, auth } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, updateDoc, addDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import { siparisOlustur } from "../../shared/siparis.js";
import {
  paraFormat, escapeHtml, tarihFormat, bildirimGoster, debounce, MASA_DURUMLARI, SIPARIS_DURUMLARI,
  ALERJEN_LISTESI, kategorilerSirali, kategoriVeAltlariIds, temaBaslat,
} from "../../shared/utils.js";

temaBaslat();

let kullanici = null;
let masalarCache = [];
let siparislerCache = [];
let kategorilerCache = [];
let urunlerCache = [];
let seciliMasaId = null;
let seciliOdemeYontemi = "nakit";
let menuAcik = false;
let aktifKategori = "";
let aramaMetni = "";
let sepet = [];

function sepetAnahtari() { return `sepet_kasa_${seciliMasaId}`; }
function sepetOku() { try { return JSON.parse(localStorage.getItem(sepetAnahtari())) || []; } catch { return []; } }
function sepetYaz() { localStorage.setItem(sepetAnahtari(), JSON.stringify(sepet)); sepetBarGuncelle(); }

async function baslat() {
  const { rol, subeId, ad } = await sayfaKorumaBaslat(["kasa", "admin"]);
  kullanici = { ad, subeId, rol };

  document.getElementById("yukleniyor-ekrani").remove();
  document.getElementById("sayfa").hidden = false;
  document.getElementById("kasa-baslik").textContent = `🧾 ${kullanici.ad}`;
  document.getElementById("cikis-buton").addEventListener("click", cikisYap);
  document.getElementById("sepet-bar").addEventListener("click", sepetModalGoster);

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

  onSnapshot(query(collection(db, "kategoriler")), (snap) => {
    kategorilerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (seciliMasaId && menuAcik) renderDetay();
  });

  onSnapshot(query(collection(db, "urunler")), (snap) => {
    urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.aktif !== false);
    if (seciliMasaId && menuAcik) renderDetay();
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

  grid.querySelectorAll("[data-masa]").forEach((el) => el.addEventListener("click", () => {
    seciliMasaId = el.dataset.masa;
    seciliOdemeYontemi = "nakit";
    menuAcik = false;
    aktifKategori = "";
    aramaMetni = "";
    sepet = sepetOku();
    renderMasalar();
    renderDetay();
  }));
}

function renderDetay() {
  const panel = document.getElementById("detay-panel");
  const masa = masalarCache.find((m) => m.id === seciliMasaId);
  if (!masa) { panel.innerHTML = `<div class="bos-durum">Detaylarını görmek için bir masa seçin.</div>`; return; }

  const acikSiparisler = masaninAcikSiparisleri(masa.id).sort((a, b) => (a.olusturmaZamani?.toMillis?.() || 0) - (b.olusturmaZamani?.toMillis?.() || 0));
  const toplamTutar = acikSiparisler.reduce((acc, s) => acc + siparisTutari(s), 0);

  panel.innerHTML = `
    <div class="detay-panel-baslik">
      <h2>${escapeHtml(masa.ad)}</h2>
      <div class="masa-eylem-satir">
        <button id="masa-tasi-buton" class="btn-ikincil btn-kucuk">↪️ Masa Taşı</button>
        <button id="masa-birlestir-buton" class="btn-ikincil btn-kucuk">🔗 Masa Birleştir</button>
      </div>
    </div>
    ${acikSiparisler.length === 0
      ? `<div class="bos-durum">Bu masada açık sipariş yok.</div>`
      : `
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
      `}

    <button id="menu-goster-buton" class="btn-ikincil btn-tam" style="margin-top:14px;">
      ${menuAcik ? "▲ Menüyü Gizle" : "+ Ürün Ekle"}
    </button>
    <div id="adisyon-menu-alani" ${menuAcik ? "" : "hidden"}>
      <div class="arama-alani" style="padding:12px 0 8px;"><input class="adisyon-menu-arama" type="search" placeholder="Menüde ara..." value="${escapeHtml(aramaMetni)}" /></div>
      <nav class="kategori-seritler adisyon-menu-kategoriler" style="padding:4px 0 12px;"></nav>
      <div class="pos-urun-grid adisyon-menu-urunler"></div>
    </div>
  `;

  panel.querySelector("#masa-tasi-buton").addEventListener("click", () => {
    masaSeciciGoster("Bu masadaki siparişler hangi masaya taşınsın?", seciliMasaId, async (hedefId) => {
      await siparisleriTasi(seciliMasaId, hedefId);
      seciliMasaId = hedefId;
      renderMasalar();
      renderDetay();
    });
  });
  panel.querySelector("#masa-birlestir-buton").addEventListener("click", () => {
    masaSeciciGoster("Hangi masa bu masayla birleştirilsin?", seciliMasaId, async (kaynakId) => {
      await siparisleriTasi(kaynakId, seciliMasaId);
      renderMasalar();
      renderDetay();
    });
  });

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
  panel.querySelector("#fis-yazdir-buton")?.addEventListener("click", () => fisYazdir(masa, acikSiparisler, toplamTutar));
  panel.querySelector("#hesap-kapat-buton")?.addEventListener("click", () => hesabiKapat(masa, acikSiparisler, toplamTutar));

  panel.querySelector("#menu-goster-buton").addEventListener("click", () => {
    menuAcik = !menuAcik;
    renderDetay();
  });

  if (menuAcik) {
    panel.querySelector(".adisyon-menu-arama").addEventListener("input", debounce((e) => {
      aramaMetni = e.target.value.toLowerCase();
      renderMenuKategorileri();
      renderMenuUrunleri();
    }, 200));
    renderMenuKategorileri();
    renderMenuUrunleri();
  }

  sepetBarGuncelle();
}

function renderMenuKategorileri() {
  const el = document.querySelector(".adisyon-menu-kategoriler");
  if (!el) return;
  el.innerHTML = `<div class="kategori-cip ${aktifKategori === "" ? "aktif" : ""}" data-kategori="">Tümü</div>` +
    kategorilerSirali(kategorilerCache)
      .map((k) => `<div class="kategori-cip ${k.derinlik ? "alt-kategori-cip" : ""} ${aktifKategori === k.id ? "aktif" : ""}" data-kategori="${k.id}">${k.derinlik ? "↳ " : ""}${escapeHtml(k.ad)}</div>`)
      .join("");
  el.querySelectorAll(".kategori-cip").forEach((cip) => cip.addEventListener("click", () => {
    aktifKategori = cip.dataset.kategori;
    renderMenuKategorileri();
    renderMenuUrunleri();
  }));
}

// Kasa için POS tarzı yoğun ızgara: tüm ürünler tek bakışta görünür, karta
// tıklamak 1 adet olarak DOĞRUDAN sepete ekler (hız için — not/adet girmek
// isterseniz kart üzerindeki ✏️ ikonunu kullanın).
function renderMenuUrunleri() {
  const el = document.querySelector(".adisyon-menu-urunler");
  if (!el) return;
  let liste = urunlerCache;
  if (aktifKategori) {
    const idler = kategoriVeAltlariIds(aktifKategori, kategorilerCache);
    liste = liste.filter((u) => idler.includes(u.kategoriId));
  }
  if (aramaMetni) liste = liste.filter((u) => u.ad?.toLowerCase().includes(aramaMetni));
  if (liste.length === 0) { el.innerHTML = `<div class="bos-durum">Ürün bulunamadı.</div>`; return; }

  liste = liste.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));

  el.innerHTML = liste.map((u) => `
    <div class="pos-urun-kart" data-urun="${u.id}">
      <button class="pos-not-buton" data-not="${u.id}" title="Not / adet ekleyerek ekle">✏️</button>
      <div class="ad">${escapeHtml(u.ad)}</div>
      <div class="fiyat">${paraFormat(u.fiyat)}</div>
    </div>`).join("");

  el.querySelectorAll(".pos-urun-kart").forEach((kart) => kart.addEventListener("click", (e) => {
    const urun = urunlerCache.find((u) => u.id === kart.dataset.urun);
    if (e.target.closest(".pos-not-buton")) {
      urunEkleModali(urun);
      return;
    }
    const mevcut = sepet.find((s) => s.urunId === urun.id && !s.not);
    if (mevcut) mevcut.adet += 1; else sepet.push({ urunId: urun.id, ad: urun.ad, fiyat: urun.fiyat, adet: 1, not: "" });
    sepetYaz();
    bildirimGoster(`${urun.ad} eklendi.`, "basari");
  }));
}

function urunEkleModali(urun) {
  let adet = 1;
  const katman = document.createElement("div");
  katman.className = "alt-sayfa-katman";
  const alerjenDetayHtml = (urun.alerjenler || [])
    .map((a) => ALERJEN_LISTESI[a])
    .filter(Boolean)
    .map((a) => `<span class="detay-bilgi-rozet">${a.ikon} ${escapeHtml(a.etiket)}</span>`)
    .join("");
  katman.innerHTML = `
    <div class="alt-sayfa">
      <div class="alt-sayfa-tutamac"></div>
      <h2>${escapeHtml(urun.ad)}</h2>
      <div class="detay-fiyat">${paraFormat(urun.fiyat)}</div>
      <div class="detay-bilgi-satir">
        <span class="detay-bilgi-rozet">🔥 ${urun.kalori ?? "-"} kcal</span>
      </div>
      <div class="detay-etiket">Alerjenler</div>
      <div class="detay-bilgi-satir">
        ${alerjenDetayHtml || `<span class="detay-bilgi-rozet">Bilinen alerjen yok</span>`}
      </div>
      <div class="form-alan"><label>Not (opsiyonel)</label><input id="detay-not" placeholder="Örn: az pişmiş, soğansız" /></div>
      <div class="adet-secici">
        <button id="detay-eksi">−</button><span id="detay-adet">1</span><button id="detay-arti">+</button>
      </div>
      <button id="detay-sepete-ekle" class="btn-birincil btn-tam">Sepete Ekle</button>
    </div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });
  const adetEl = katman.querySelector("#detay-adet");
  katman.querySelector("#detay-eksi").addEventListener("click", () => { if (adet > 1) adetEl.textContent = --adet; });
  katman.querySelector("#detay-arti").addEventListener("click", () => { adetEl.textContent = ++adet; });
  katman.querySelector("#detay-sepete-ekle").addEventListener("click", () => {
    const not = katman.querySelector("#detay-not").value.trim();
    const mevcut = sepet.find((s) => s.urunId === urun.id && s.not === not);
    if (mevcut) mevcut.adet += adet; else sepet.push({ urunId: urun.id, ad: urun.ad, fiyat: urun.fiyat, adet, not });
    sepetYaz();
    bildirimGoster(`${urun.ad} sepete eklendi.`, "basari");
    katman.remove();
  });
}

// Başka bir masa seçmek için basit bir liste modalı gösterir; seçilince
// callback(hedefMasaId) çağrılır. `haricTutId` listeye dahil edilmeyecek masa.
function masaSeciciGoster(baslik, haricTutId, callback) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  const secenekler = masalarCache
    .filter((m) => m.id !== haricTutId)
    .sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr", { numeric: true }));

  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h3>${escapeHtml(baslik)}</h3>
      <div class="liste-alani">
        ${secenekler.length === 0
          ? `<div class="bos-durum">Başka masa bulunamadı.</div>`
          : secenekler.map((m) => {
              const acik = masaninAcikSiparisleri(m.id);
              const toplam = acik.reduce((acc, s) => acc + siparisTutari(s), 0);
              const durum = MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos;
              return `
              <div class="liste-satir" data-hedef="${m.id}" style="cursor:pointer;">
                <div class="ana-bilgi">
                  <strong>${escapeHtml(m.ad)}</strong>
                  <span style="color:${durum.renk}">${durum.etiket}${toplam > 0 ? " · " + paraFormat(toplam) : ""}</span>
                </div>
              </div>`;
            }).join("")}
      </div>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });
  katman.querySelectorAll("[data-hedef]").forEach((el) => el.addEventListener("click", () => {
    callback(el.dataset.hedef);
    katman.remove();
  }));
}

// Bir masadaki tüm açık siparişleri başka bir masaya taşır (masa taşıma ve
// masa birleştirme aynı işlemin iki farklı yönüdür).
async function siparisleriTasi(kaynakMasaId, hedefMasaId) {
  const kaynakSiparisler = masaninAcikSiparisleri(kaynakMasaId);
  if (kaynakSiparisler.length === 0) {
    bildirimGoster("Taşınacak açık sipariş yok.", "uyari");
    return;
  }
  const hedefMasa = masalarCache.find((m) => m.id === hedefMasaId);
  try {
    await Promise.all(
      kaynakSiparisler.map((s) =>
        updateDoc(doc(db, "siparisler", s.id), { masaId: hedefMasaId, masaAd: hedefMasa?.ad || hedefMasaId })
      )
    );
    await updateDoc(doc(db, "masalar", kaynakMasaId), { durum: "bos", garsonCagirildi: false });
    await updateDoc(doc(db, "masalar", hedefMasaId), { durum: "dolu" });
    bildirimGoster("Siparişler taşındı.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

function sepetBarGuncelle() {
  const bar = document.getElementById("sepet-bar");
  if (!seciliMasaId) { bar.hidden = true; return; }
  const toplamAdet = sepet.reduce((acc, s) => acc + s.adet, 0);
  const toplamTutar = sepet.reduce((acc, s) => acc + s.adet * s.fiyat, 0);
  if (toplamAdet === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById("sepet-bar-adet").textContent = `${toplamAdet} ürün`;
  document.getElementById("sepet-bar-tutar").textContent = paraFormat(toplamTutar);
}

function sepetModalGoster() {
  if (!seciliMasaId) return;
  const masa = masalarCache.find((m) => m.id === seciliMasaId);
  const katman = document.createElement("div");
  katman.className = "alt-sayfa-katman";
  function icerik() {
    const toplam = sepet.reduce((acc, s) => acc + s.adet * s.fiyat, 0);
    return `
      <div class="alt-sayfa-tutamac"></div>
      <h2>${escapeHtml(masa?.ad || "")} — Yeni Sipariş</h2>
      <div class="sepet-listesi">
        ${sepet.length === 0 ? `<div class="bos-durum">Sepet boş.</div>` : sepet.map((s, i) => `
          <div class="sepet-satir">
            <div class="ad">${escapeHtml(s.ad)}${s.not ? ` <span style="color:var(--renk-yazi-soluk);">(${escapeHtml(s.not)})</span>` : ""}</div>
            <div class="adet-kontrol"><button data-eksi="${i}">−</button><span>${s.adet}</span><button data-arti="${i}">+</button></div>
            <div style="width:70px;text-align:right;font-weight:700;">${paraFormat(s.adet * s.fiyat)}</div>
          </div>`).join("")}
      </div>
      ${sepet.length > 0 ? `<div class="sepet-toplam-satir"><span>Toplam</span><span>${paraFormat(toplam)}</span></div>
        <button id="siparis-gonder-buton" class="btn-birincil btn-tam">Siparişi Gönder</button>` : ""}
    `;
  }
  katman.innerHTML = `<div class="alt-sayfa" id="sepet-icerik">${icerik()}</div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });
  function bagla() {
    const icerikEl = katman.querySelector("#sepet-icerik");
    icerikEl.querySelectorAll("[data-arti]").forEach((b) => b.addEventListener("click", () => { sepet[b.dataset.arti].adet++; sepetYaz(); icerikEl.innerHTML = icerik(); bagla(); }));
    icerikEl.querySelectorAll("[data-eksi]").forEach((b) => b.addEventListener("click", () => { const i = b.dataset.eksi; if (--sepet[i].adet <= 0) sepet.splice(i, 1); sepetYaz(); icerikEl.innerHTML = icerik(); bagla(); }));
    const gonderButon = icerikEl.querySelector("#siparis-gonder-buton");
    if (gonderButon) gonderButon.addEventListener("click", () => siparisGonder(katman));
  }
  bagla();
}

async function siparisGonder(katman) {
  const buton = katman.querySelector("#siparis-gonder-buton");
  buton.disabled = true;
  buton.textContent = "Gönderiliyor...";
  try {
    await siparisOlustur({
      masaId: seciliMasaId,
      urunler: sepet.map((s) => ({ urunId: s.urunId, adet: s.adet, not: s.not || "" })),
      garsonId: auth.currentUser?.uid || null,
      garsonAdi: kullanici.ad,
    });
    sepet = [];
    sepetYaz();
    bildirimGoster("Sipariş gönderildi!", "basari");
    katman.remove();
  } catch (err) {
    console.error(err);
    bildirimGoster("Sipariş gönderilemedi: " + err.message, "hata");
    buton.disabled = false;
    buton.textContent = "Siparişi Gönder";
  }
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
