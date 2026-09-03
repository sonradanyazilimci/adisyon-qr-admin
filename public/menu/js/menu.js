import { db } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, onSnapshot, query,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { siparisTaslakOlustur, garsonCagir, hesapIste, odemeBildir } from "../../shared/siparis.js";
import { pwaBaslat } from "../../shared/pwa.js";
import {
  paraFormat, escapeHtml, alerjenRozetleriHtml, ALERJEN_LISTESI, bildirimGoster, debounce,
  kategorilerSirali, kategoriVeAltlariIds, temaBaslat, urunSubedeAktifMi, urunSubeFiyati, urunTukendiMi,
} from "../../shared/utils.js";

temaBaslat();
pwaBaslat();

const params = new URLSearchParams(window.location.search);
const masaId = params.get("masa");
const subeIdParam = params.get("sube");

const durumMesajiEl = document.getElementById("durum-mesaji");
const sayfaEl = document.getElementById("sayfa");

let kategorilerCache = [];
let urunlerCache = [];
let aktifKategori = "";
let aramaMetni = "";
let masa = null;
let sube = null;
let subeIdEfektif = null; // ürünlerin şubeye özel aktiflik/fiyatını hesaplamak için

/** localStorage'da masaya özel sepet: sepet_<masaId> */
function sepetAnahtari() { return `sepet_${masaId}`; }
function sepetOku() {
  try { return JSON.parse(localStorage.getItem(sepetAnahtari())) || []; } catch { return []; }
}
function sepetYaz(sepet) {
  localStorage.setItem(sepetAnahtari(), JSON.stringify(sepet));
  sepetBarGuncelle();
}
let sepet = [];

// Bu cihazdan bu masa için GÖNDERİLEN siparişler (yerel kayıt) — müşteri
// ne ısmarladığını ve toplam borcunu görebilsin diye. Firestore'dan canlı
// durum okumak için müşteriye sipariş okuma izni gerekir (güvenlik tercihi);
// bu yüzden basit ve güvenli yol: kendi cihazında yerel liste.
function gonderilenAnahtari() { return `qr_gonderilen_${masaId}`; }
function gonderilenOku() {
  try { return JSON.parse(localStorage.getItem(gonderilenAnahtari())) || []; } catch { return []; }
}
function gonderilenEkle(kayit) {
  const liste = gonderilenOku();
  liste.push(kayit);
  localStorage.setItem(gonderilenAnahtari(), JSON.stringify(liste));
}
function gonderilenToplam() {
  return gonderilenOku().reduce((acc, k) => acc + (Number(k.tutar) || 0), 0);
}

async function baslat() {
  if (!masaId) {
    durumMesajiEl.textContent = "Geçersiz bağlantı: masa bilgisi bulunamadı. Lütfen masadaki QR kodu tekrar okutun.";
    return;
  }

  try {
    const masaSnap = await getDoc(doc(db, "masalar", masaId));
    if (!masaSnap.exists()) {
      durumMesajiEl.textContent = "Masa bulunamadı. Lütfen personelden yardım isteyin.";
      return;
    }
    masa = { id: masaSnap.id, ...masaSnap.data() };

    subeIdEfektif = subeIdParam || masa.subeId || null;
    if (subeIdEfektif) {
      const subeSnap = await getDoc(doc(db, "subeler", subeIdEfektif));
      if (subeSnap.exists()) sube = { id: subeSnap.id, ...subeSnap.data() };
    }
  } catch (err) {
    console.error(err);
    durumMesajiEl.textContent = "Menü yüklenirken bir hata oluştu.";
    return;
  }

  document.getElementById("restoran-adi").textContent = sube?.ad || "Restoran Menümüz";
  document.getElementById("sube-bilgi").textContent = sube?.adres || "";
  document.getElementById("masa-etiketi").textContent = masa.ad || "Masa";

  sepet = sepetOku();

  durumMesajiEl.hidden = true;
  sayfaEl.hidden = false;

  onSnapshot(query(collection(db, "kategoriler")), (snap) => {
    kategorilerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderKategoriSeritleri();
    renderUrunler();
  });

  onSnapshot(query(collection(db, "urunler")), (snap) => {
    urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => urunSubedeAktifMi(u, subeIdEfektif));
    renderUrunler();
  });

  document.getElementById("arama-input").addEventListener("input", debounce((e) => {
    aramaMetni = e.target.value.toLowerCase();
    renderUrunler();
  }, 200));

  document.getElementById("garson-cagir-buton").addEventListener("click", garsonCagirTiklandi);
  document.getElementById("hesap-iste-buton").addEventListener("click", hesapIsteTiklandi);
  document.getElementById("sepet-bar").addEventListener("click", sepetModalGoster);

  const odeButon = document.getElementById("ode-buton");
  if (sube?.odemeLinki || sube?.iban || gonderilenOku().length) odeButon.hidden = false;
  odeButon.addEventListener("click", odemeModalGoster);

  sepetBarGuncelle();
}

function renderKategoriSeritleri() {
  const el = document.getElementById("kategori-seritler");
  el.innerHTML = `<div class="kategori-cip ${aktifKategori === "" ? "aktif" : ""}" data-kategori="">Tümü</div>` +
    kategorilerSirali(kategorilerCache)
      .map((k) => `<div class="kategori-cip ${k.derinlik ? "alt-kategori-cip" : ""} ${aktifKategori === k.id ? "aktif" : ""}" data-kategori="${k.id}">${k.derinlik ? "↳ " : ""}${escapeHtml(k.ad)}</div>`)
      .join("");
  el.querySelectorAll(".kategori-cip").forEach((cip) => {
    cip.addEventListener("click", () => {
      aktifKategori = cip.dataset.kategori;
      renderKategoriSeritleri();
      renderUrunler();
    });
  });
}

function renderUrunler() {
  const listeEl = document.getElementById("urun-listesi");
  let liste = urunlerCache;
  if (aktifKategori) {
    const idler = kategoriVeAltlariIds(aktifKategori, kategorilerCache);
    liste = liste.filter((u) => idler.includes(u.kategoriId));
  }
  if (aramaMetni) liste = liste.filter((u) => u.ad?.toLowerCase().includes(aramaMetni));

  if (liste.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Ürün bulunamadı.</div>`;
    return;
  }

  // Kategoriye/alt kategoriye göre grupla (sadece "Tümü" seçiliyken başlık göster)
  if (!aktifKategori && !aramaMetni) {
    listeEl.innerHTML = kategorilerSirali(kategorilerCache)
      .map((k) => {
        const kUrunleri = liste.filter((u) => u.kategoriId === k.id);
        if (kUrunleri.length === 0) return "";
        return `<div class="kategori-basligi ${k.derinlik ? "alt-kategori-basligi" : ""}">${k.derinlik ? "↳ " : ""}${escapeHtml(k.ad)}</div>` + kUrunleri.map(urunSatiriHtml).join("");
      })
      .join("");
  } else {
    listeEl.innerHTML = liste.map(urunSatiriHtml).join("");
  }

  listeEl.querySelectorAll("[data-urun]").forEach((satir) => {
    satir.addEventListener("click", () => {
      const urun = urunlerCache.find((u) => u.id === satir.dataset.urun);
      if (urunTukendiMi(urun)) { bildirimGoster(`${urun.ad} şu an tükendi.`, "uyari"); return; }
      detayGoster(urun);
    });
  });
}

function urunSatiriHtml(u) {
  const tukendi = urunTukendiMi(u);
  return `
    <div class="urun-satir ${tukendi ? "tukendi" : ""}" data-urun="${u.id}">
      <div class="metin">
        <h3>${escapeHtml(u.ad)}</h3>
        <p class="aciklama">${escapeHtml(u.aciklama || "")}</p>
        <div class="alt-satir">
          <span class="fiyat">${tukendi ? `<span class="urun-tukendi-rozet">TÜKENDİ</span>` : paraFormat(urunSubeFiyati(u, subeIdEfektif))}</span>
          <span class="rozet-satir">${u.kalori ?? "-"} kcal ${alerjenRozetleriHtml(u.alerjenler, u.glutensiz)}</span>
        </div>
      </div>
      <img src="${u.gorselUrl || "https://placehold.co/160x160?text=%F0%9F%8D%BD"}" alt="${escapeHtml(u.ad)}" loading="lazy" />
    </div>`;
}

function detayGoster(urun) {
  if (!urun) return;
  let adet = 1;
  const fiyat = urunSubeFiyati(urun, subeIdEfektif);
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
      <img class="detay-gorsel" src="${urun.gorselUrl || "https://placehold.co/500x300?text=%F0%9F%8D%BD"}" alt="${escapeHtml(urun.ad)}" />
      <h2>${escapeHtml(urun.ad)}</h2>
      <div class="detay-fiyat">${paraFormat(fiyat)}</div>
      <div class="detay-bilgi-satir">
        <span class="detay-bilgi-rozet">🔥 ${urun.kalori ?? "-"} kcal</span>
        ${urun.glutensiz ? `<span class="detay-bilgi-rozet" style="color:var(--renk-yesil);border-color:var(--renk-yesil);">🚫🌾 Glutensiz</span>` : ""}
      </div>
      <p class="detay-aciklama">${escapeHtml(urun.aciklama || "")}</p>
      <div class="detay-etiket">Alerjenler</div>
      <div class="detay-bilgi-satir">
        ${alerjenDetayHtml || `<span class="detay-bilgi-rozet">Bilinen alerjen yok</span>`}
      </div>
      <div class="form-alan"><label>Not (opsiyonel)</label><input id="detay-not" placeholder="Örn: az pişmiş, soğansız" /></div>
      <div class="adet-secici">
        <button id="detay-eksi">−</button>
        <span id="detay-adet">1</span>
        <button id="detay-arti">+</button>
      </div>
      <button id="detay-sepete-ekle" class="btn-birincil btn-tam">Sepete Ekle — ${paraFormat(fiyat)}</button>
    </div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  const adetEl = katman.querySelector("#detay-adet");
  const ekleButon = katman.querySelector("#detay-sepete-ekle");
  function fiyatGuncelle() {
    adetEl.textContent = adet;
    ekleButon.textContent = `Sepete Ekle — ${paraFormat(fiyat * adet)}`;
  }
  katman.querySelector("#detay-eksi").addEventListener("click", () => { if (adet > 1) { adet--; fiyatGuncelle(); } });
  katman.querySelector("#detay-arti").addEventListener("click", () => { adet++; fiyatGuncelle(); });

  ekleButon.addEventListener("click", () => {
    const not = katman.querySelector("#detay-not").value.trim();
    const mevcutSatir = sepet.find((s) => s.urunId === urun.id && s.not === not);
    if (mevcutSatir) {
      mevcutSatir.adet += adet;
    } else {
      sepet.push({ urunId: urun.id, ad: urun.ad, fiyat, adet, not });
    }
    sepetYaz(sepet);
    bildirimGoster(`${urun.ad} sepete eklendi.`, "basari");
    katman.remove();
  });
}

function sepetBarGuncelle() {
  const bar = document.getElementById("sepet-bar");
  const toplamAdet = sepet.reduce((acc, s) => acc + s.adet, 0);
  const toplamTutar = sepet.reduce((acc, s) => acc + s.adet * s.fiyat, 0);
  if (toplamAdet === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById("sepet-bar-adet").textContent = `${toplamAdet} ürün`;
  document.getElementById("sepet-bar-tutar").textContent = paraFormat(toplamTutar);
}

function sepetModalGoster() {
  const katman = document.createElement("div");
  katman.className = "alt-sayfa-katman";

  function icerikOlustur() {
    const toplamTutar = sepet.reduce((acc, s) => acc + s.adet * s.fiyat, 0);
    return `
      <div class="alt-sayfa-tutamac"></div>
      <h2>Sepetiniz</h2>
      <div class="sepet-listesi">
        ${sepet.length === 0 ? `<div class="bos-durum">Sepetiniz boş.</div>` : sepet.map((s, i) => `
          <div class="sepet-satir">
            <div class="ad">${escapeHtml(s.ad)}${s.not ? ` <span style="color:var(--renk-yazi-soluk);font-weight:400;">(${escapeHtml(s.not)})</span>` : ""}</div>
            <div class="adet-kontrol">
              <button data-eksi="${i}">−</button>
              <span>${s.adet}</span>
              <button data-arti="${i}">+</button>
            </div>
            <div style="width:70px;text-align:right;font-weight:700;">${paraFormat(s.adet * s.fiyat)}</div>
          </div>`).join("")}
      </div>
      ${sepet.length > 0 ? `
        <div class="sepet-toplam-satir"><span>Toplam</span><span>${paraFormat(toplamTutar)}</span></div>
        <button id="siparis-gonder-buton" class="btn-birincil btn-tam">Siparişi Gönder</button>
      ` : ""}
    `;
  }

  katman.innerHTML = `<div class="alt-sayfa" id="sepet-icerik">${icerikOlustur()}</div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  function bagla() {
    const icerikEl = katman.querySelector("#sepet-icerik");
    icerikEl.querySelectorAll("[data-arti]").forEach((b) => b.addEventListener("click", () => {
      sepet[b.dataset.arti].adet++;
      sepetYaz(sepet);
      icerikEl.innerHTML = icerikOlustur();
      bagla();
    }));
    icerikEl.querySelectorAll("[data-eksi]").forEach((b) => b.addEventListener("click", () => {
      const i = b.dataset.eksi;
      sepet[i].adet--;
      if (sepet[i].adet <= 0) sepet.splice(i, 1);
      sepetYaz(sepet);
      icerikEl.innerHTML = icerikOlustur();
      bagla();
    }));
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
    await siparisTaslakOlustur({
      masaId,
      urunler: sepet.map((s) => ({ urunId: s.urunId, adet: s.adet, not: s.not || "" })),
      garsonAdi: "Müşteri (QR Menü)",
    });
    gonderilenEkle({
      zaman: Date.now(),
      tutar: sepet.reduce((acc, s) => acc + s.adet * s.fiyat, 0),
      urunler: sepet.map((s) => ({ ad: s.ad, adet: s.adet, fiyat: s.fiyat, not: s.not || "" })),
    });
    document.getElementById("ode-buton").hidden = false;
    sepet = [];
    sepetYaz(sepet);
    bildirimGoster("Siparişiniz garsonumuza iletildi, onaylandıktan sonra hazırlanmaya başlanacak! 🎉", "basari");
    katman.remove();
  } catch (err) {
    console.error(err);
    bildirimGoster("Sipariş gönderilemedi: " + err.message, "hata");
    buton.disabled = false;
    buton.textContent = "Siparişi Gönder";
  }
}

async function garsonCagirTiklandi() {
  const buton = document.getElementById("garson-cagir-buton");
  buton.disabled = true;
  try {
    await garsonCagir(masaId);
    bildirimGoster("Garson çağırıldı, birazdan gelecek! 🔔", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  } finally {
    setTimeout(() => (buton.disabled = false), 5000);
  }
}

async function hesapIsteTiklandi() {
  const buton = document.getElementById("hesap-iste-buton");
  buton.disabled = true;
  try {
    await hesapIste(masaId);
    bildirimGoster("Hesap istendi, birazdan getirilecek! 🧾", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  } finally {
    setTimeout(() => (buton.disabled = false), 5000);
  }
}

// "💳 Öde" — bu cihazdan gönderilen siparişlerin toplamı + şubenin ödeme
// linki / IBAN'ı + "Ödedim, bildir" butonu. (Tam entegre online ödeme sunucu
// tarafı gerektirir — bkz. functions/index.js; bu sürüm link/havale odaklı.)
function odemeModalGoster() {
  const gonderilenler = gonderilenOku();
  const toplam = gonderilenToplam();
  const katman = document.createElement("div");
  katman.className = "alt-sayfa-katman";
  const ibanBlok = sube?.iban ? `
    <div class="odeme-iban-kutu">
      <div style="font-size:12px;color:var(--renk-yazi-soluk);">IBAN${sube.ibanAdi ? ` — ${escapeHtml(sube.ibanAdi)}` : ""}</div>
      <div style="font-weight:800;letter-spacing:.5px;word-break:break-all;">${escapeHtml(sube.iban)}</div>
      <button id="iban-kopya" class="btn-ikincil btn-tam" style="margin-top:8px;">📋 IBAN'ı Kopyala</button>
    </div>` : "";
  const linkBlok = sube?.odemeLinki ? `
    <a href="${escapeHtml(sube.odemeLinki)}" target="_blank" rel="noopener" class="btn-birincil btn-tam" style="display:block;text-align:center;text-decoration:none;margin-bottom:10px;">💳 Ödeme Sayfasını Aç</a>` : "";

  katman.innerHTML = `
    <div class="alt-sayfa">
      <div class="alt-sayfa-tutamac"></div>
      <h2>Ödeme</h2>
      ${gonderilenler.length ? `
        <div class="odeme-siparis-liste">
          ${gonderilenler.flatMap((k) => k.urunler).map((u) => `
            <div class="sepet-satir"><div class="ad">${u.adet}x ${escapeHtml(u.ad)}</div>
            <div style="font-weight:700;">${paraFormat(u.adet * u.fiyat)}</div></div>`).join("")}
        </div>
        <div class="sepet-toplam-satir"><span>Bu cihazdan gönderilen toplam</span><span>${paraFormat(toplam)}</span></div>
        <p style="font-size:11px;color:var(--renk-yazi-soluk);margin-top:-4px;">Not: Bu tutar yalnızca bu telefondan verdiğiniz siparişleri kapsar. Masadaki kesin tutar için garsonunuzdan hesap isteyin.</p>
      ` : `<p style="color:var(--renk-yazi-soluk);">Bu telefondan henüz sipariş gönderilmedi.</p>`}
      ${linkBlok}
      ${ibanBlok}
      ${(linkBlok || ibanBlok) ? "" : `<p style="color:var(--renk-yazi-soluk);">Bu şube için çevrimiçi ödeme bilgisi tanımlı değil — lütfen kasadan ödeyin.</p>`}
      <button id="odedim-bildir" class="btn-yesil btn-tam" style="margin-top:12px;">✅ Ödedim, kasaya bildir</button>
    </div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#iban-kopya")?.addEventListener("click", () => {
    navigator.clipboard.writeText(sube.iban).then(() => bildirimGoster("IBAN kopyalandı.", "basari"));
  });
  katman.querySelector("#odedim-bildir").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await odemeBildir(masaId);
      bildirimGoster("Ödeme bildiriminiz kasaya iletildi. Teşekkürler! 🙏", "basari");
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      e.target.disabled = false;
    }
  });
}

baslat();
