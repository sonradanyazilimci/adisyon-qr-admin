import { db, auth } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, updateDoc, onSnapshot, query, where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { siparisOlustur, siparisiOnayla, siparisiGuncelle, siparisiIptalEt } from "../../shared/siparis.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import {
  paraFormat, escapeHtml, alerjenRozetleriHtml, bildirimGoster, debounce, MASA_DURUMLARI,
  SIPARIS_DURUMLARI, tarihFormat, kategorilerSirali, kategoriVeAltlariIds, temaBaslat,
  urunSubedeAktifMi, urunSubeFiyati,
} from "../../shared/utils.js";

temaBaslat();

let kullanici = null; // {ad, subeId}
let masalarCache = [];
let kategorilerCache = [];
let urunlerCache = [];
let siparislerCache = [];
let seciliMasa = null;
let aktifKategori = "";
let aramaMetni = "";
let sepet = []; // her masa değişiminde sıfırlanır (masa bazlı sepet_<id> localStorage ile kalıcı)
let oncekiDurumlar = new Map(); // siparisId -> durum (mutfakta "hazır" olduğunda bildirim için)

function sepetAnahtari() { return `sepet_garson_${seciliMasa.id}`; }
function sepetOku() { try { return JSON.parse(localStorage.getItem(sepetAnahtari())) || []; } catch { return []; } }
function sepetYaz() { localStorage.setItem(sepetAnahtari(), JSON.stringify(sepet)); sepetBarGuncelle(); }

async function baslat() {
  const { subeId, ad } = await sayfaKorumaBaslat(["garson"]);
  kullanici = { ad, subeId };

  document.getElementById("yukleniyor-ekrani").remove();
  document.getElementById("sayfa").hidden = false;
  document.getElementById("garson-baslik").textContent = `${kullanici.ad.toUpperCase()} - GARSON`;
  document.getElementById("cikis-buton").addEventListener("click", cikisYap);

  let subeAdi = "Tüm Şubeler";
  if (kullanici.subeId) {
    const subeSnap = await getDoc(doc(db, "subeler", kullanici.subeId));
    if (subeSnap.exists()) subeAdi = subeSnap.data().ad;
  }
  document.getElementById("garson-alt-baslik").textContent = subeAdi;

  const masalarQuery = kullanici.subeId
    ? query(collection(db, "masalar"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "masalar"));
  onSnapshot(masalarQuery, (snap) => {
    masalarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMasalar();
  });

  onSnapshot(query(collection(db, "kategoriler")), (snap) => {
    kategorilerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderKategoriSeritleri();
    renderUrunler();
  });

  onSnapshot(query(collection(db, "urunler")), (snap) => {
    urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => urunSubedeAktifMi(u, kullanici.subeId));
    renderUrunler();
  });

  const siparislerQuery = kullanici.subeId
    ? query(collection(db, "siparisler"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "siparisler"));
  onSnapshot(siparislerQuery, (snap) => {
    const yeniListe = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.durum !== "kapandi");

    // Mutfak bir siparişi "hazır" yaptığında ve müşteri onay bekleyen yeni
    // bir sipariş gönderdiğinde garsona bildirim göster (ilk yüklemede eski
    // siparişler için değil, SADECE gerçek geçiş/yeni kayıtlarda).
    yeniListe.forEach((s) => {
      const onceki = oncekiDurumlar.get(s.id);
      if (s.durum === "hazir" && onceki && onceki !== "hazir") {
        bildirimGoster(`🍽️ ${s.masaAd || s.masaId} hazır! Servise götürün.`, "basari");
      }
      if (s.durum === "onay_bekliyor" && onceki === undefined) {
        bildirimGoster(`🔔 ${s.masaAd || s.masaId}: onay bekleyen yeni sipariş!`, "uyari");
      }
      oncekiDurumlar.set(s.id, s.durum);
    });

    siparislerCache = yeniListe;
    renderMasalar();
    renderMevcutSiparisler();
  });

  document.getElementById("masa-kapat-buton").addEventListener("click", () => {
    seciliMasa = null;
    document.getElementById("siparis-alani").hidden = true;
    document.getElementById("sepet-bar").hidden = true;
    document.getElementById("mevcut-siparisler").innerHTML = "";
    renderMasalar();
  });
  document.getElementById("arama-input").addEventListener("input", debounce((e) => { aramaMetni = e.target.value.toLowerCase(); renderUrunler(); }, 200));
  document.getElementById("sepet-bar").addEventListener("click", sepetModalGoster);
}

function masaninAcikSiparisleri(masaId) {
  return siparislerCache.filter((s) => s.masaId === masaId);
}

function renderMasalar() {
  const grid = document.getElementById("masalar-grid");
  const liste = masalarCache.slice().sort((a, b) => {
    const benimA = a.sorumluGarsonId && a.sorumluGarsonId === auth.currentUser?.uid ? 0 : 1;
    const benimB = b.sorumluGarsonId && b.sorumluGarsonId === auth.currentUser?.uid ? 0 : 1;
    if (benimA !== benimB) return benimA - benimB;
    return (a.ad || "").localeCompare(b.ad || "", "tr", { numeric: true });
  });
  if (liste.length === 0) {
    grid.innerHTML = `<div class="bos-durum">Şubenize tanımlı masa bulunamadı.</div>`;
    return;
  }
  grid.innerHTML = liste.map((m) => {
    const acikSiparisler = masaninAcikSiparisleri(m.id);
    const yeniSiparisVar = acikSiparisler.some((s) => s.durum === "yeni");
    const hazirSiparisVar = acikSiparisler.some((s) => s.durum === "hazir");
    const onayBekliyorVar = acikSiparisler.some((s) => s.durum === "onay_bekliyor");
    const benimMasam = m.sorumluGarsonId && m.sorumluGarsonId === auth.currentUser?.uid;
    const seciliMi = seciliMasa && m.id === seciliMasa.id;
    return `
    <div class="masa-kart-mini ${m.durum || "bos"} ${seciliMi ? "secili" : ""} ${m.garsonCagirildi ? "cagirdi" : ""} ${yeniSiparisVar ? "yeni-siparis" : ""} ${hazirSiparisVar ? "hazir-siparis" : ""} ${onayBekliyorVar ? "onay-bekliyor" : ""}" data-masa="${m.id}">
      ${benimMasam ? `<span class="benim-masam-etiketi">👤</span>` : ""}
      ${escapeHtml(m.ad)}
      <div class="durum" style="color:${(MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos).renk}">${(MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos).etiket}</div>
      ${onayBekliyorVar ? `<div class="onay-etiketi">⏳ Onay Bekliyor</div>` : ""}
      ${hazirSiparisVar ? `<div class="hazir-etiketi">✅ Hazır</div>` : ""}
    </div>`;
  }).join("");
  grid.querySelectorAll("[data-masa]").forEach((el) => el.addEventListener("click", () => masaSec(el.dataset.masa)));
}

function masaSec(masaId) {
  seciliMasa = masalarCache.find((m) => m.id === masaId);
  if (!seciliMasa) return;
  sepet = sepetOku();
  document.getElementById("secili-masa-baslik").textContent = seciliMasa.ad;
  document.getElementById("siparis-alani").hidden = false;
  renderMasalar();
  renderMevcutSiparisler();
  sepetBarGuncelle();
  document.getElementById("siparis-alani").scrollIntoView({ behavior: "smooth" });

  // Garson çağrısı varsa gördü işareti koy
  if (seciliMasa.garsonCagirildi) {
    updateDoc(doc(db, "masalar", masaId), { garsonCagirildi: false }).catch(() => {});
  }
}

// Seçili masada zaten gönderilmiş (mutfağa/adisyona düşmüş) siparişleri
// SADECE GÖRÜNTÜLEMEK için gösterir — garson bunları buradan değiştiremez,
// sadece yeni ürün ekleyip ayrı bir sipariş olarak gönderebilir.
function renderMevcutSiparisler() {
  const el = document.getElementById("mevcut-siparisler");
  if (!seciliMasa) { el.innerHTML = ""; return; }
  const siparisler = masaninAcikSiparisleri(seciliMasa.id)
    .slice()
    .sort((a, b) => (a.olusturmaZamani?.toMillis?.() || 0) - (b.olusturmaZamani?.toMillis?.() || 0));

  if (siparisler.length === 0) {
    el.innerHTML = `<div class="bos-durum" style="padding:14px;">Bu masada henüz gönderilmiş sipariş yok.</div>`;
    return;
  }

  el.innerHTML = siparisler.map((s) => {
    const durum = SIPARIS_DURUMLARI[s.durum] || SIPARIS_DURUMLARI.yeni;
    const revizeEdilebilir = s.durum === "onay_bekliyor" || s.durum === "yeni";
    return `
    <div class="mevcut-siparis-blok ${s.durum === "hazir" ? "hazir-vurgu" : ""} ${s.durum === "onay_bekliyor" ? "onay-vurgu" : ""} ${s.durum === "iptal" ? "iptal-vurgu" : ""}">
      <div class="ust">
        <span>${tarihFormat(s.olusturmaZamani)} · ${escapeHtml(s.garsonAdi || "—")}</span>
        <span class="rozet" style="background:${durum.renk}">${durum.etiket}</span>
      </div>
      ${(s.urunler || []).map((k) => `
        <div class="kalem">
          <span>${k.adet}x ${escapeHtml(k.ad)} ${k.not ? `<span class="not">(${escapeHtml(k.not)})</span>` : ""}</span>
          <span>${paraFormat(k.tutar ?? k.adet * k.fiyat)}</span>
        </div>`).join("")}
      ${s.durum === "iptal" && s.iptalNotu ? `<div class="iptal-notu">📝 ${escapeHtml(s.iptalNotu)}</div>` : ""}
      ${s.durum === "hazir" ? `<button class="btn-yesil btn-kucuk servis-et-buton" data-siparis="${s.id}">✅ Servis Et</button>` : ""}
      ${revizeEdilebilir ? `
        <div class="siparis-eylem-satir">
          ${s.durum === "onay_bekliyor" ? `<button class="btn-birincil btn-kucuk onayla-buton" data-siparis="${s.id}">✅ Onayla</button>` : ""}
          <button class="btn-ikincil btn-kucuk duzenle-buton" data-siparis="${s.id}">✏️ Düzenle</button>
          <button class="btn-kirmizi btn-kucuk iptal-buton" data-siparis="${s.id}">❌ İptal Et</button>
        </div>` : ""}
    </div>`;
  }).join("");

  el.querySelectorAll(".servis-et-buton").forEach((b) => b.addEventListener("click", async () => {
    try {
      await updateDoc(doc(db, "siparisler", b.dataset.siparis), { durum: "servis_edildi" });
      bildirimGoster("Servis edildi olarak işaretlendi.", "basari");
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
  }));

  el.querySelectorAll(".onayla-buton").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await siparisiOnayla(b.dataset.siparis);
      bildirimGoster("Sipariş onaylandı, mutfağa düştü.", "basari");
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      b.disabled = false;
    }
  }));

  el.querySelectorAll(".duzenle-buton").forEach((b) => b.addEventListener("click", () => {
    duzenlemeModaliGoster(siparisler.find((s) => s.id === b.dataset.siparis));
  }));

  el.querySelectorAll(".iptal-buton").forEach((b) => b.addEventListener("click", () => {
    iptalModaliGoster(siparisler.find((s) => s.id === b.dataset.siparis));
  }));
}

// Sipariş "hazırlanıyor"a geçmeden önce (onay_bekliyor/yeni durumundayken)
// ürün adedi değiştirmek, ürün eklemek/çıkarmak için düzenleme ekranı.
function duzenlemeModaliGoster(siparis) {
  if (!siparis) return;
  let kalemler = (siparis.urunler || []).map((k) => ({ ...k }));
  const katman = document.createElement("div");
  katman.className = "alt-sayfa-katman";

  function icerik() {
    const toplam = kalemler.reduce((acc, k) => acc + k.adet * k.fiyat, 0);
    return `
      <div class="alt-sayfa-tutamac"></div>
      <h2>${escapeHtml(siparis.masaAd || "")} — Siparişi Düzenle</h2>
      <div class="sepet-listesi">
        ${kalemler.length === 0 ? `<div class="bos-durum">Tüm ürünler çıkarıldı.</div>` : kalemler.map((k, i) => `
          <div class="sepet-satir">
            <div class="ad">${escapeHtml(k.ad)}${k.not ? ` <span style="color:var(--renk-yazi-soluk);">(${escapeHtml(k.not)})</span>` : ""}</div>
            <div class="adet-kontrol"><button data-eksi="${i}">−</button><span>${k.adet}</span><button data-arti="${i}">+</button></div>
            <div style="width:70px;text-align:right;font-weight:700;">${paraFormat(k.adet * k.fiyat)}</div>
          </div>`).join("")}
      </div>
      <button type="button" id="duzenle-urun-ekle-buton" class="btn-ikincil btn-tam" style="margin-bottom:12px;">+ Ürün Ekle</button>
      <div class="sepet-toplam-satir"><span>Toplam</span><span>${paraFormat(toplam)}</span></div>
      <button id="duzenle-kaydet-buton" class="btn-birincil btn-tam" ${kalemler.length === 0 ? "disabled" : ""}>Değişiklikleri Kaydet</button>
    `;
  }

  katman.innerHTML = `<div class="alt-sayfa" id="duzenle-icerik">${icerik()}</div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  function bagla() {
    const icerikEl = katman.querySelector("#duzenle-icerik");
    icerikEl.querySelectorAll("[data-arti]").forEach((b) => b.addEventListener("click", () => { kalemler[b.dataset.arti].adet++; icerikEl.innerHTML = icerik(); bagla(); }));
    icerikEl.querySelectorAll("[data-eksi]").forEach((b) => b.addEventListener("click", () => { const i = b.dataset.eksi; if (--kalemler[i].adet <= 0) kalemler.splice(i, 1); icerikEl.innerHTML = icerik(); bagla(); }));
    icerikEl.querySelector("#duzenle-urun-ekle-buton").addEventListener("click", () => {
      duzenlemeUrunSeciciGoster((urun) => {
        const mevcut = kalemler.find((k) => k.urunId === urun.id && !k.not);
        if (mevcut) mevcut.adet += 1; else kalemler.push({ urunId: urun.id, ad: urun.ad, fiyat: urunSubeFiyati(urun, kullanici.subeId), adet: 1, not: "" });
        icerikEl.innerHTML = icerik();
        bagla();
      });
    });
    const kaydetButon = icerikEl.querySelector("#duzenle-kaydet-buton");
    kaydetButon?.addEventListener("click", async () => {
      kaydetButon.disabled = true;
      kaydetButon.textContent = "Kaydediliyor...";
      try {
        await siparisiGuncelle(siparis.id, kalemler.map((k) => ({ urunId: k.urunId, adet: k.adet, not: k.not || "" })));
        bildirimGoster("Sipariş güncellendi.", "basari");
        katman.remove();
      } catch (err) {
        bildirimGoster("Hata: " + err.message, "hata");
        kaydetButon.disabled = false;
        kaydetButon.textContent = "Değişiklikleri Kaydet";
      }
    });
  }
  bagla();
}

// Düzenleme ekranından yeni ürün eklemek için basit bir katalog seçici.
function duzenlemeUrunSeciciGoster(secilinceCallback) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h3>Ürün Ekle</h3>
      <input id="duzenle-urun-ara" type="search" placeholder="Ürün ara..." style="margin-bottom:10px;" />
      <div class="liste-alani" id="duzenle-urun-liste" style="max-height:50vh;overflow-y:auto;"></div>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  function listeyiCiz(filtre = "") {
    const el = katman.querySelector("#duzenle-urun-liste");
    const liste = urunlerCache.filter((u) => !filtre || u.ad?.toLowerCase().includes(filtre));
    el.innerHTML = liste.map((u) => `
      <div class="liste-satir" data-urun="${u.id}" style="cursor:pointer;">
        <div class="ana-bilgi"><strong>${escapeHtml(u.ad)}</strong><span>${paraFormat(urunSubeFiyati(u, kullanici.subeId))}</span></div>
      </div>`).join("");
    el.querySelectorAll("[data-urun]").forEach((satir) => satir.addEventListener("click", () => {
      secilinceCallback(urunlerCache.find((u) => u.id === satir.dataset.urun));
      katman.remove();
    }));
  }
  listeyiCiz();
  katman.querySelector("#duzenle-urun-ara").addEventListener("input", debounce((e) => listeyiCiz(e.target.value.toLowerCase()), 200));
}

// Sipariş "hazırlanıyor"a geçmeden önce iptal — kısa bir not zorunlu.
function iptalModaliGoster(siparis) {
  if (!siparis) return;
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h3>${escapeHtml(siparis.masaAd || "")} — Siparişi İptal Et</h3>
      <div class="form-alan"><label>İptal nedeni (kısa not, zorunlu)</label><input id="iptal-not" placeholder="Örn: müşteri vazgeçti" required /></div>
      <button id="iptal-onayla-buton" class="btn-kirmizi btn-tam">İptal Et</button>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });
  katman.querySelector("#iptal-onayla-buton").addEventListener("click", async () => {
    const not = katman.querySelector("#iptal-not").value.trim();
    if (!not) { bildirimGoster("İptal için kısa bir not yazmalısınız.", "uyari"); return; }
    const buton = katman.querySelector("#iptal-onayla-buton");
    buton.disabled = true;
    try {
      await siparisiIptalEt(siparis.id, not);
      bildirimGoster("Sipariş iptal edildi.", "basari");
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      buton.disabled = false;
    }
  });
}

function renderKategoriSeritleri() {
  const el = document.getElementById("kategori-seritler");
  el.innerHTML = `<div class="kategori-cip ${aktifKategori === "" ? "aktif" : ""}" data-kategori="">Tümü</div>` +
    kategorilerSirali(kategorilerCache)
      .map((k) => `<div class="kategori-cip ${k.derinlik ? "alt-kategori-cip" : ""} ${aktifKategori === k.id ? "aktif" : ""}" data-kategori="${k.id}">${k.derinlik ? "↳ " : ""}${escapeHtml(k.ad)}</div>`)
      .join("");
  el.querySelectorAll(".kategori-cip").forEach((cip) => cip.addEventListener("click", () => { aktifKategori = cip.dataset.kategori; renderKategoriSeritleri(); renderUrunler(); }));
}

function renderUrunler() {
  const listeEl = document.getElementById("urun-listesi");
  let liste = urunlerCache;
  if (aktifKategori) {
    const idler = kategoriVeAltlariIds(aktifKategori, kategorilerCache);
    liste = liste.filter((u) => idler.includes(u.kategoriId));
  }
  if (aramaMetni) liste = liste.filter((u) => u.ad?.toLowerCase().includes(aramaMetni));
  if (liste.length === 0) { listeEl.innerHTML = `<div class="bos-durum">Ürün bulunamadı.</div>`; return; }

  listeEl.innerHTML = liste.map((u) => `
    <div class="urun-kare-kart" data-urun="${u.id}">
      <img src="${u.gorselUrl || "https://placehold.co/300x300?text=%F0%9F%8D%BD"}" alt="" loading="lazy" />
      <div class="ukk-govde">
        <h3>${escapeHtml(u.ad)}</h3>
        <span class="fiyat">${paraFormat(urunSubeFiyati(u, kullanici.subeId))}</span>
        <div class="ukk-rozet">${u.kalori ?? "-"} kcal ${alerjenRozetleriHtml(u.alerjenler, u.glutensiz)}</div>
      </div>
    </div>`).join("");

  listeEl.querySelectorAll("[data-urun]").forEach((satir) => satir.addEventListener("click", () => {
    if (!seciliMasa) { bildirimGoster("Önce bir masa seçin.", "uyari"); return; }
    urunEkleModali(urunlerCache.find((u) => u.id === satir.dataset.urun));
  }));
}

function urunEkleModali(urun) {
  let adet = 1;
  const fiyat = urunSubeFiyati(urun, kullanici.subeId);
  const katman = document.createElement("div");
  katman.className = "alt-sayfa-katman";
  katman.innerHTML = `
    <div class="alt-sayfa">
      <div class="alt-sayfa-tutamac"></div>
      <h2>${escapeHtml(urun.ad)}</h2>
      <div class="detay-fiyat">${paraFormat(fiyat)}</div>
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
    if (mevcut) mevcut.adet += adet; else sepet.push({ urunId: urun.id, ad: urun.ad, fiyat, adet, not });
    sepetYaz();
    katman.remove();
  });
}

function sepetBarGuncelle() {
  const bar = document.getElementById("sepet-bar");
  if (!seciliMasa) { bar.hidden = true; return; }
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
  function icerik() {
    const toplam = sepet.reduce((acc, s) => acc + s.adet * s.fiyat, 0);
    return `
      <div class="alt-sayfa-tutamac"></div>
      <h2>${escapeHtml(seciliMasa.ad)} — Sepet</h2>
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
      masaId: seciliMasa.id,
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

baslat().catch((err) => {
  console.error(err);
  document.getElementById("yukleniyor-ekrani").textContent = "Hata: " + err.message;
});
