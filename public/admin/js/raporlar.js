import { db } from "../../shared/firebase-config.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { paraFormat, escapeHtml, tarihFormat, snapshotHataYakala, tarihAraligiBaslangici, urunSubeMaliyeti, urunStokTakipli, urunStokAdedi } from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

let siparislerCache = [];
let adisyonlarCache = [];
let urunlerCache = [];
const ozetEl = document.getElementById("rapor-ozet");
const karEl = document.getElementById("rapor-kar");
const stokEl = document.getElementById("rapor-stok");
const odemeKirilimEl = document.getElementById("rapor-odeme-kirilim");
const enCokSatanEl = document.getElementById("rapor-en-cok-satan");
const urunCiroEl = document.getElementById("rapor-urun-ciro");
const saatlikEl = document.getElementById("rapor-saatlik");
const personelEl = document.getElementById("rapor-personel");
const iptalIkramEl = document.getElementById("rapor-iptal-ikram");
const aralikEl = document.getElementById("rapor-aralik");
const ozelTarihEl = document.getElementById("rapor-ozel-tarih");
const baslangicEl = document.getElementById("rapor-baslangic");
const bitisEl = document.getElementById("rapor-bitis");
const subeEl = document.getElementById("rapor-sube");

// Ciroya SADECE gerçekten satışa dönüşen siparişler girer. "onay_bekliyor"
// henüz onaylanmamış bir taslak, "iptal" ise iptal edilmiş — ikisi de ciro
// dışıdır (iptaller ayrı bir "kayıp" bölümünde raporlanır).
const SATIS_DISI_DURUMLAR = ["onay_bekliyor", "iptal"];
function satisMi(s) {
  return s.durum !== undefined && !SATIS_DISI_DURUMLAR.includes(s.durum);
}

export function baslat() {
  onSnapshot(
    query(collection(db, "siparisler")),
    (snap) => {
      siparislerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("raporlar")
  );
  onSnapshot(
    query(collection(db, "adisyonlar")),
    (snap) => {
      adisyonlarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("raporlar-adisyonlar")
  );
  onSnapshot(
    query(collection(db, "urunler")),
    (snap) => {
      urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("raporlar-urunler")
  );
  subelerDegisti(() => { renderSubeSecim(); render(); });
  aralikEl.addEventListener("change", () => {
    ozelTarihEl.hidden = aralikEl.value !== "ozel";
    render();
  });
  baslangicEl.addEventListener("change", render);
  bitisEl.addEventListener("change", render);
  subeEl.addEventListener("change", render);
}

function renderSubeSecim() {
  const secili = subeEl.value;
  subeEl.innerHTML = `<option value="">Tüm Şubeler</option>` + subelerCache.map((s) => `<option value="${s.id}">${escapeHtml(s.ad)}</option>`).join("");
  subeEl.value = secili;
}

// Seçili aralığın { baslangic, bitis } sınırlarını döner. Hazır seçenekler
// için bitis = null (bugüne kadar); "ozel" için tarih kutularından okunur.
function araligiHesapla() {
  if (aralikEl.value === "ozel") {
    const b = baslangicEl.value ? new Date(baslangicEl.value + "T00:00:00") : null;
    const s = bitisEl.value ? new Date(bitisEl.value + "T23:59:59.999") : null;
    return { baslangic: b, bitis: s };
  }
  return { baslangic: tarihAraligiBaslangici(aralikEl.value), bitis: null };
}

function aralikAdi() {
  if (aralikEl.value === "ozel") {
    const b = baslangicEl.value ? new Date(baslangicEl.value).toLocaleDateString("tr-TR") : "başlangıç";
    const s = bitisEl.value ? new Date(bitisEl.value).toLocaleDateString("tr-TR") : "bugün";
    return `${b} – ${s}`;
  }
  return { bugun: "Bugün", hafta: "Bu Hafta", ay: "Bu Ay", tumu: "Tüm Zamanlar" }[aralikEl.value] || "";
}

function tarihField(kayit) {
  const t = kayit.olusturmaZamani || kayit.kapanmaZamani;
  return t?.toDate ? t.toDate() : null;
}

function aralikFiltrele(liste, subeFiltre, baslangic, bitis) {
  return liste.filter((k) => {
    if (subeFiltre && k.subeId !== subeFiltre) return false;
    if (baslangic || bitis) {
      const t = tarihField(k);
      if (!t) return false;
      if (baslangic && t < baslangic) return false;
      if (bitis && t > bitis) return false;
    }
    return true;
  });
}

function render() {
  const { baslangic, bitis } = araligiHesapla();
  const subeFiltre = subeEl.value;

  const tumSiparis = aralikFiltrele(siparislerCache, subeFiltre, baslangic, bitis);
  const satislar = tumSiparis.filter(satisMi);
  const adisyonlar = aralikFiltrele(adisyonlarCache, subeFiltre, baslangic, bitis);

  renderOzet(satislar);
  renderKar(satislar, baslangic, bitis);
  renderStok(subeFiltre);
  renderOdemeKirilim(adisyonlar);
  renderEnCokSatan(satislar);
  renderUrunCiro(satislar);
  renderSaatlik(satislar);
  renderPersonel(satislar);
  renderIptalIkram(tumSiparis, adisyonlar);
}

// ── Brüt Kâr: Ciro − Ürün Maliyeti (COGS) ──────────────────────────────
// Her satılan kalemin birim maliyeti, ürünün (şubeye özel varsa o) maliyet
// alanından okunur. Maliyeti girilmemiş ürünler ayrıca uyarılır.
function renderKar(satislar, baslangic, bitis) {
  let toplamCiro = 0;
  let toplamMaliyet = 0;
  let maliyetsizAdet = 0;
  const urunMap = new Map(); // ad -> { adet, ciro, maliyet }

  satislar.forEach((s) => {
    (s.urunler || []).forEach((k) => {
      const adet = Number(k.adet) || 0;
      const ciro = Number(k.tutar ?? adet * (k.fiyat || 0)) || 0;
      const urun = urunlerCache.find((u) => u.id === k.urunId);
      const birimMaliyet = urun ? urunSubeMaliyeti(urun, s.subeId) : 0;
      const maliyet = birimMaliyet * adet;
      if (birimMaliyet <= 0) maliyetsizAdet += adet;

      toplamCiro += ciro;
      toplamMaliyet += maliyet;
      const m = urunMap.get(k.ad) || { adet: 0, ciro: 0, maliyet: 0 };
      m.adet += adet; m.ciro += ciro; m.maliyet += maliyet;
      urunMap.set(k.ad, m);
    });
  });

  const brutKar = toplamCiro - toplamMaliyet;
  const marj = toplamCiro > 0 ? (brutKar / toplamCiro) * 100 : 0;

  // Günlük ortalama brüt kâr — aralığın gün sayısına böl.
  const ilk = baslangic || satislar.reduce((min, s) => {
    const t = s.olusturmaZamani?.toDate?.();
    return t && (!min || t < min) ? t : min;
  }, null);
  const son = bitis || new Date();
  const gunSayisi = ilk ? Math.max(1, Math.ceil((son - ilk) / 86400000)) : 1;
  const gunlukKar = brutKar / gunSayisi;

  const sirali = Array.from(urunMap.entries())
    .map(([ad, v]) => ({ ad, ...v, kar: v.ciro - v.maliyet }))
    .sort((a, b) => b.kar - a.kar);

  karEl.innerHTML = `
    <h3>💰 Brüt Kâr <span class="tablo-soluk">(${aralikAdi()})</span></h3>
    <div class="panel-kart-grid" style="margin-bottom:14px;">
      <div class="panel-kart"><div class="etiket">Toplam Ciro</div><div class="deger">${paraFormat(toplamCiro)}</div></div>
      <div class="panel-kart"><div class="etiket">Ürün Maliyeti (COGS)</div><div class="deger">${paraFormat(toplamMaliyet)}</div></div>
      <div class="panel-kart"><div class="etiket">Brüt Kâr</div><div class="deger" style="color:${brutKar >= 0 ? "var(--renk-yesil)" : "var(--renk-kirmizi)"};">${paraFormat(brutKar)} <span class="tablo-soluk" style="font-size:14px;">%${marj.toFixed(0)}</span></div></div>
      <div class="panel-kart"><div class="etiket">Günlük Ort. Brüt Kâr</div><div class="deger">${paraFormat(gunlukKar)}</div></div>
    </div>
    ${maliyetsizAdet > 0 ? `<p style="font-size:12px;color:var(--renk-ana);margin:0 0 12px;">⚠️ ${maliyetsizAdet} adet ürünün maliyeti girilmemiş — kâr olduğundan yüksek görünüyor. Ürünler sekmesinden "Genel Maliyet" girin.</p>` : ""}
    ${sirali.length === 0
      ? `<div class="bos-durum">Seçilen aralıkta satış yok.</div>`
      : `<div style="overflow-x:auto;"><table class="veri-tablo">
          <thead><tr><th>Ürün</th><th style="text-align:right;">Adet</th><th style="text-align:right;">Ciro</th><th style="text-align:right;">Maliyet</th><th style="text-align:right;">Kâr</th><th style="text-align:right;">Marj</th></tr></thead>
          <tbody>${sirali.map((v) => `
            <tr>
              <td>${escapeHtml(v.ad)}</td>
              <td style="text-align:right;">${v.adet}</td>
              <td style="text-align:right;">${paraFormat(v.ciro)}</td>
              <td style="text-align:right;">${paraFormat(v.maliyet)}</td>
              <td style="text-align:right;font-weight:700;color:${v.kar >= 0 ? "var(--renk-yesil)" : "var(--renk-kirmizi)"};">${paraFormat(v.kar)}</td>
              <td style="text-align:right;" class="tablo-soluk">${v.ciro > 0 ? "%" + ((v.kar / v.ciro) * 100).toFixed(0) : "—"}</td>
            </tr>`).join("")}
          </tbody></table></div>`}
  `;
}

// ── Anlık Stok Durumu (stok takibi açık ürünler) ──────────────────────
function renderStok(subeFiltre) {
  const takipli = urunlerCache.filter(urunStokTakipli).sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));
  const subeler = subeFiltre ? subelerCache.filter((s) => s.id === subeFiltre) : subelerCache;

  if (takipli.length === 0) {
    stokEl.innerHTML = `<h3>📦 Anlık Stok Durumu</h3><div class="bos-durum">Stok takibi açık ürün yok. Ürünler sekmesinden bir üründe "Stok takibi yap" seçin.</div>`;
    return;
  }

  stokEl.innerHTML = `
    <h3>📦 Anlık Stok Durumu <span class="tablo-soluk">(şu an — tarih filtresinden bağımsız)</span></h3>
    <div style="overflow-x:auto;"><table class="veri-tablo">
      <thead><tr><th>Ürün</th>${subeler.map((s) => `<th style="text-align:right;">${escapeHtml(s.ad)}</th>`).join("")}<th style="text-align:right;">Toplam</th></tr></thead>
      <tbody>${takipli.map((u) => {
        const adetler = subeler.map((s) => urunStokAdedi(u, s.id));
        const toplam = adetler.reduce((a, b) => a + b, 0);
        return `<tr>
          <td>${escapeHtml(u.ad)}</td>
          ${adetler.map((a) => `<td style="text-align:right;${a <= 0 ? "color:var(--renk-kirmizi);font-weight:700;" : ""}">${a}</td>`).join("")}
          <td style="text-align:right;font-weight:700;">${toplam}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
  `;
}

function renderOzet(satislar) {
  const toplamCiro = satislar.reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
  const siparisSayisi = satislar.length;
  const ortalamaFis = siparisSayisi ? toplamCiro / siparisSayisi : 0;
  const toplamAdet = satislar.reduce((acc, s) => acc + (s.urunler || []).reduce((a, k) => a + Number(k.adet || 0), 0), 0);

  ozetEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">Toplam Ciro <span class="tablo-soluk">(${aralikAdi()})</span></div><div class="deger">${paraFormat(toplamCiro)}</div></div>
    <div class="panel-kart"><div class="etiket">Sipariş Sayısı</div><div class="deger">${siparisSayisi}</div></div>
    <div class="panel-kart"><div class="etiket">Ortalama Sipariş Tutarı</div><div class="deger">${paraFormat(ortalamaFis)}</div></div>
    <div class="panel-kart"><div class="etiket">Satılan Ürün Adedi</div><div class="deger">${toplamAdet}</div></div>
  `;
}

// Ödeme yöntemi kırılımı — kapatılan adisyonların "odemeler" parçalarından.
function renderOdemeKirilim(adisyonlar) {
  const yontemler = { nakit: 0, kart: 0, yemek_ceki: 0, ikram: 0 };
  adisyonlar.forEach((a) => {
    if (a.odemeYontemi === "ikram") { yontemler.ikram += Number(a.toplamTutar) || 0; return; }
    if (Array.isArray(a.odemeler) && a.odemeler.length) {
      a.odemeler.forEach((o) => { yontemler[o.yontem] = (yontemler[o.yontem] || 0) + (Number(o.tutar) || 0); });
    } else {
      yontemler[a.odemeYontemi] = (yontemler[a.odemeYontemi] || 0) + (Number(a.toplamTutar) || 0);
    }
  });
  const toplam = yontemler.nakit + yontemler.kart + yontemler.yemek_ceki;
  const satir = (etiket, tutar, renk) => {
    const yuzde = toplam > 0 ? (tutar / toplam) * 100 : 0;
    return `
      <div class="bar-satir">
        <span class="ad">${etiket}</span>
        <div class="bar-dis"><div class="bar-ic" style="width:${yuzde}%;background:${renk};"></div></div>
        <span class="adet">${paraFormat(tutar)} <span class="tablo-soluk">${yuzde ? `%${yuzde.toFixed(0)}` : ""}</span></span>
      </div>`;
  };
  odemeKirilimEl.innerHTML = `<h3>Ödeme Yöntemi Kırılımı</h3>` + (adisyonlar.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta kapatılmış adisyon yok.</div>`
    : satir("💵 Nakit", yontemler.nakit, "#27ae60")
      + satir("💳 Kart", yontemler.kart, "#2980b9")
      + satir("🎫 Yemek Çeki", yontemler.yemek_ceki, "#e67e22")
      + (yontemler.ikram > 0 ? `<div class="bar-satir"><span class="ad">🎁 İkram</span><div class="bar-dis"></div><span class="adet" style="color:var(--renk-kirmizi);">${paraFormat(yontemler.ikram)}</span></div>` : ""));
}

function renderEnCokSatan(satislar) {
  const urunAdet = new Map();
  satislar.forEach((s) => (s.urunler || []).forEach((k) => {
    urunAdet.set(k.ad, (urunAdet.get(k.ad) || 0) + Number(k.adet || 0));
  }));
  const sirali = Array.from(urunAdet.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const enYuksek = sirali[0]?.[1] || 1;
  enCokSatanEl.innerHTML = `<h3>En Çok Satan Ürünler (Adet)</h3>` + (sirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta veri yok.</div>`
    : sirali.map(([ad, adet]) => `
        <div class="bar-satir">
          <span class="ad" title="${escapeHtml(ad)}">${escapeHtml(ad)}</span>
          <div class="bar-dis"><div class="bar-ic" style="width:${(adet / enYuksek) * 100}%"></div></div>
          <span class="adet">${adet} adet</span>
        </div>`).join(""));
}

// Ürün bazlı CİRO — adet değil, hangi ürün ne kadar para getirdi.
function renderUrunCiro(satislar) {
  const map = new Map(); // ad -> { adet, ciro }
  satislar.forEach((s) => (s.urunler || []).forEach((k) => {
    const mevcut = map.get(k.ad) || { adet: 0, ciro: 0 };
    mevcut.adet += Number(k.adet || 0);
    mevcut.ciro += Number(k.tutar ?? (k.adet * k.fiyat) ?? 0) || 0;
    map.set(k.ad, mevcut);
  }));
  const sirali = Array.from(map.entries()).sort((a, b) => b[1].ciro - a[1].ciro).slice(0, 15);
  urunCiroEl.innerHTML = `<h3>Ürün Bazlı Ciro</h3>` + (sirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta veri yok.</div>`
    : `<div style="overflow-x:auto;"><table class="veri-tablo">
        <thead><tr><th>Ürün</th><th style="text-align:right;">Adet</th><th style="text-align:right;">Ciro</th></tr></thead>
        <tbody>${sirali.map(([ad, v]) => `
          <tr><td>${escapeHtml(ad)}</td><td style="text-align:right;">${v.adet}</td><td style="text-align:right;font-weight:700;">${paraFormat(v.ciro)}</td></tr>`).join("")}
        </tbody></table></div>`);
}

// Saatlik yoğunluk — günün hangi saatinde kaç sipariş / ne kadar ciro.
function renderSaatlik(satislar) {
  const saatAdet = new Array(24).fill(0);
  const saatCiro = new Array(24).fill(0);
  satislar.forEach((s) => {
    const t = s.olusturmaZamani?.toDate ? s.olusturmaZamani.toDate() : null;
    if (!t) return;
    const h = t.getHours();
    saatAdet[h] += 1;
    saatCiro[h] += Number(s.toplamTutar) || 0;
  });
  const enYuksek = Math.max(1, ...saatAdet);
  const doluSaatler = saatAdet.map((v, h) => ({ h, v, ciro: saatCiro[h] })).filter((x) => x.v > 0);
  saatlikEl.innerHTML = `<h3>Saatlik Yoğunluk</h3>` + (doluSaatler.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta veri yok.</div>`
    : doluSaatler.map(({ h, v, ciro }) => `
        <div class="bar-satir">
          <span class="ad">${String(h).padStart(2, "0")}:00</span>
          <div class="bar-dis"><div class="bar-ic" style="width:${(v / enYuksek) * 100}%"></div></div>
          <span class="adet">${v} sipariş <span class="tablo-soluk">· ${paraFormat(ciro)}</span></span>
        </div>`).join(""));
}

// Personel bazlı ciro — siparişi giren garson/kasa adına göre.
function renderPersonel(satislar) {
  const map = new Map(); // ad -> { adet, ciro }
  satislar.forEach((s) => {
    const ad = s.garsonAdi || "—";
    const mevcut = map.get(ad) || { adet: 0, ciro: 0 };
    mevcut.adet += 1;
    mevcut.ciro += Number(s.toplamTutar) || 0;
    map.set(ad, mevcut);
  });
  const sirali = Array.from(map.entries()).sort((a, b) => b[1].ciro - a[1].ciro);
  personelEl.innerHTML = `<h3>Personel Bazlı Ciro</h3>` + (sirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta veri yok.</div>`
    : `<div style="overflow-x:auto;"><table class="veri-tablo">
        <thead><tr><th>Personel</th><th style="text-align:right;">Sipariş</th><th style="text-align:right;">Ciro</th><th style="text-align:right;">Ort. Sipariş</th></tr></thead>
        <tbody>${sirali.map(([ad, v]) => `
          <tr><td>${escapeHtml(ad)}</td><td style="text-align:right;">${v.adet}</td><td style="text-align:right;font-weight:700;">${paraFormat(v.ciro)}</td><td style="text-align:right;" class="tablo-soluk">${paraFormat(v.adet ? v.ciro / v.adet : 0)}</td></tr>`).join("")}
        </tbody></table></div>`);
}

// İkram & iptal — "kayıp / kaçak" görünürlüğü. İptaller siparişlerden
// (durum === "iptal"), ikramlar kapatılan adisyonlardan (odemeYontemi === "ikram").
function renderIptalIkram(tumSiparis, adisyonlar) {
  const iptaller = tumSiparis.filter((s) => s.durum === "iptal")
    .sort((a, b) => (b.iptalZamani?.toMillis?.() || 0) - (a.iptalZamani?.toMillis?.() || 0));
  const iptalToplam = iptaller.reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
  const ikramlar = adisyonlar.filter((a) => a.odemeYontemi === "ikram")
    .sort((a, b) => (b.kapanmaZamani?.toMillis?.() || 0) - (a.kapanmaZamani?.toMillis?.() || 0));
  const ikramToplam = ikramlar.reduce((acc, a) => acc + (Number(a.toplamTutar) || 0), 0);

  iptalIkramEl.innerHTML = `
    <h3>İkram & İptal (Kayıp Takibi)</h3>
    <div class="panel-kart-grid" style="margin-bottom:14px;">
      <div class="panel-kart"><div class="etiket">❌ İptal Edilen Sipariş</div><div class="deger">${iptaller.length} <span class="tablo-soluk" style="font-size:14px;">/ ${paraFormat(iptalToplam)}</span></div></div>
      <div class="panel-kart"><div class="etiket">🎁 İkram Edilen Hesap</div><div class="deger">${ikramlar.length} <span class="tablo-soluk" style="font-size:14px;">/ ${paraFormat(ikramToplam)}</span></div></div>
    </div>
    ${iptaller.length === 0 ? "" : `
      <h4 style="margin:0 0 6px;">Son İptaller</h4>
      <div style="overflow-x:auto;margin-bottom:14px;"><table class="veri-tablo">
        <thead><tr><th>Zaman</th><th>Masa</th><th>Ürünler</th><th style="text-align:right;">Tutar</th><th>Neden</th><th>İptal Eden</th></tr></thead>
        <tbody>${iptaller.slice(0, 30).map((s) => `
          <tr>
            <td class="tablo-soluk">${tarihFormat(s.iptalZamani || s.olusturmaZamani)}</td>
            <td>${escapeHtml(s.masaAd || "")}</td>
            <td>${escapeHtml((s.urunler || []).map((k) => `${k.adet}x ${k.ad}`).join(", "))}</td>
            <td style="text-align:right;">${paraFormat(s.toplamTutar)}</td>
            <td>${escapeHtml(s.iptalNotu || "—")}</td>
            <td class="tablo-soluk">${escapeHtml(s.iptalEden || "—")}</td>
          </tr>`).join("")}
        </tbody></table></div>`}
    ${ikramlar.length === 0 ? "" : `
      <h4 style="margin:0 0 6px;">Son İkramlar</h4>
      <div style="overflow-x:auto;"><table class="veri-tablo">
        <thead><tr><th>Zaman</th><th>Masa</th><th style="text-align:right;">Tutar</th><th>Neden</th><th>Kapatan</th></tr></thead>
        <tbody>${ikramlar.slice(0, 30).map((a) => `
          <tr>
            <td class="tablo-soluk">${tarihFormat(a.kapanmaZamani)}</td>
            <td>${escapeHtml(a.masaAd || "")}</td>
            <td style="text-align:right;">${paraFormat(a.toplamTutar)}</td>
            <td>${escapeHtml(a.ikramNotu || "—")}</td>
            <td class="tablo-soluk">${escapeHtml(a.kapananKullanici || "—")}</td>
          </tr>`).join("")}
        </tbody></table></div>`}
  `;
}
