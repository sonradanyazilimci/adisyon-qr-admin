import { db, auth } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, updateDoc, addDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import { siparisOlustur, siparisiOnayla, siparisiGuncelle, siparisiIptalEt } from "../../shared/siparis.js";
import {
  paraFormat, escapeHtml, tarihFormat, saatFormat, tarihAnahtari, bildirimGoster, debounce,
  MASA_DURUMLARI, SIPARIS_DURUMLARI, ALERJEN_LISTESI, kategorilerSirali, kategoriVeAltlariIds, temaBaslat,
} from "../../shared/utils.js";

const ROL_ETIKET = { admin: "Admin", garson: "Garson", kasa: "Kasa", mutfak: "Mutfak" };

temaBaslat();

let kullanici = null;
let masalarCache = [];
let siparislerCache = [];
let kategorilerCache = [];
let urunlerCache = [];
let garsonlarCache = [];
let seciliMasaId = null;
let seciliOdemeYontemi = "nakit";
let menuAcik = false;
let aktifKategori = "";
let aramaMetni = "";
let sepet = [];
// Dokunmatik ekranda kolay masa taşıma/birleştirme: butona basınca "seçim
// modu" açılır, ekrandaki masalardan birine dokununca işlem tamamlanır —
// ayrı bir liste/modal açmaya gerek kalmaz.
// { tur: 'tasi', kaynakMasaId } | { tur: 'birlestir', hedefMasaId } | null
let eylemModu = null;
// Garson atama modu: bir garson (veya "kaldır") seçilince AÇIK KALIR — kasa
// art arda birçok masaya dokunarak hızlıca atama yapabilsin diye tek
// dokunuşta kapanmaz (masa taşımadan farklı olarak).
// { garsonId, garsonAdi } | 'kaldir' | null
let garsonAtamaModu = null;
let garsonAtamaPaneliAcik = false;

// Personel puantajı / ön muhasebe / gün sonu için durum
let subePersoneliCache = [];
let puantajBugunCache = [];
let kasaHareketleriBugunCache = [];
let adisyonlarBugunCache = [];
let subeDokumani = null;
let gunSonuBugunKaydi = null;
let puantajPaneliAcik = false;
let kasaHareketPaneliAcik = false;

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

  onSnapshot(query(collection(db, "kullanicilar")), (snap) => {
    const tumPersonel = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    subePersoneliCache = tumPersonel.filter((p) => p.rol !== "admin" && p.aktif !== false && (!kullanici.subeId || p.subeId === kullanici.subeId));
    garsonlarCache = subePersoneliCache.filter((p) => p.rol === "garson");
    if (garsonAtamaPaneliAcik) renderGarsonAtamaPaneli();
    if (puantajPaneliAcik) renderPuantajPaneli();
  });

  if (kullanici.subeId) {
    onSnapshot(doc(db, "subeler", kullanici.subeId), (snap) => {
      subeDokumani = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    });
  }

  const puantajQuery = kullanici.subeId
    ? query(collection(db, "puantaj"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "puantaj"));
  onSnapshot(puantajQuery, (snap) => {
    const tumu = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    puantajBugunCache = tumu.filter((p) => p.tarih === tarihAnahtari());
    if (puantajPaneliAcik) renderPuantajPaneli();
  });

  const kasaHareketQuery = kullanici.subeId
    ? query(collection(db, "kasaHareketleri"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "kasaHareketleri"));
  onSnapshot(kasaHareketQuery, (snap) => {
    const tumu = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    kasaHareketleriBugunCache = tumu.filter((k) => k.tarih === tarihAnahtari());
    if (kasaHareketPaneliAcik) renderKasaHareketPaneli();
  });

  const adisyonlarQuery = kullanici.subeId
    ? query(collection(db, "adisyonlar"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "adisyonlar"));
  onSnapshot(adisyonlarQuery, (snap) => {
    const tumu = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    adisyonlarBugunCache = tumu.filter((a) => a.kapanmaZamani?.toDate && tarihAnahtari(a.kapanmaZamani.toDate()) === tarihAnahtari());
  });

  const gunSonuQuery = kullanici.subeId
    ? query(collection(db, "gunSonuKapanislari"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "gunSonuKapanislari"));
  onSnapshot(gunSonuQuery, (snap) => {
    const tumu = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    gunSonuBugunKaydi = tumu.find((g) => g.tarih === tarihAnahtari()) || null;
  });

  document.getElementById("garson-atama-goster-buton").addEventListener("click", () => {
    garsonAtamaPaneliAcik = !garsonAtamaPaneliAcik;
    if (!garsonAtamaPaneliAcik) { garsonAtamaModu = null; renderMasalar(); }
    document.getElementById("garson-atama-paneli").hidden = !garsonAtamaPaneliAcik;
    document.getElementById("garson-atama-goster-buton").textContent = garsonAtamaPaneliAcik ? "✕ Kapat" : "👥 Garson Ata";
    if (garsonAtamaPaneliAcik) renderGarsonAtamaPaneli();
  });

  document.getElementById("puantaj-goster-buton").addEventListener("click", () => {
    puantajPaneliAcik = !puantajPaneliAcik;
    document.getElementById("puantaj-paneli").hidden = !puantajPaneliAcik;
    if (puantajPaneliAcik) renderPuantajPaneli();
  });

  document.getElementById("kasa-hareket-goster-buton").addEventListener("click", () => {
    kasaHareketPaneliAcik = !kasaHareketPaneliAcik;
    document.getElementById("kasa-hareket-paneli").hidden = !kasaHareketPaneliAcik;
    if (kasaHareketPaneliAcik) renderKasaHareketPaneli();
  });

  document.getElementById("kasa-hareket-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const gonderButon = e.target.querySelector('button[type="submit"]');
    gonderButon.disabled = true;
    try {
      await addDoc(collection(db, "kasaHareketleri"), {
        subeId: kullanici.subeId || null,
        subeAdi: subeDokumani?.ad || "",
        tur: fd.get("tur"),
        tutar: Number(fd.get("tutar")) || 0,
        aciklama: fd.get("aciklama")?.trim() || "",
        tarih: tarihAnahtari(),
        zaman: serverTimestamp(),
        yapanKullanici: kullanici.ad,
        yapanKullaniciId: auth.currentUser?.uid || null,
      });
      bildirimGoster("Kasa hareketi eklendi.", "basari");
      e.target.reset();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    } finally {
      gonderButon.disabled = false;
    }
  });

  document.getElementById("gun-sonu-goster-buton").addEventListener("click", () => gunSonuModaliGoster());
}

function renderPuantajPaneli() {
  const el = document.getElementById("puantaj-listesi");
  if (subePersoneliCache.length === 0) {
    el.innerHTML = `<div class="bos-durum">Şubenize tanımlı personel bulunamadı.</div>`;
    return;
  }
  const liste = subePersoneliCache.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));
  el.innerHTML = liste.map((p) => {
    const kayit = puantajBugunCache.find((k) => k.personelId === p.id && !k.cikisZamani) || puantajBugunCache.filter((k) => k.personelId === p.id).sort((a, b) => (b.girisZamani?.toMillis?.() || 0) - (a.girisZamani?.toMillis?.() || 0))[0];
    let durumHtml;
    if (!kayit) {
      durumHtml = `<span class="puantaj-durum bekliyor">Henüz gelmedi</span><button class="btn-yesil btn-kucuk" data-giris="${p.id}">Giriş Yap</button>`;
    } else if (!kayit.cikisZamani) {
      durumHtml = `<span class="puantaj-durum geldi">${saatFormat(kayit.girisZamani)}'te geldi${kayit.gecGeldi ? ` <b class="puantaj-gec">(geç)</b>` : ""}</span><button class="btn-kirmizi btn-kucuk" data-cikis="${kayit.id}">Çıkış Yap</button>`;
    } else {
      durumHtml = `<span class="puantaj-durum tamam">${saatFormat(kayit.girisZamani)} → ${saatFormat(kayit.cikisZamani)}${kayit.gecGeldi ? ` <b class="puantaj-gec">geç geldi</b>` : ""}${kayit.erkenCikti ? ` <b class="puantaj-erken">erken çıktı</b>` : ""}</span>`;
    }
    return `
    <div class="liste-satir">
      <div class="ana-bilgi"><strong>${escapeHtml(p.ad)}</strong><span>${ROL_ETIKET[p.rol] || p.rol}</span></div>
      <div class="puantaj-eylem">${durumHtml}</div>
    </div>`;
  }).join("");

  el.querySelectorAll("[data-giris]").forEach((b) => b.addEventListener("click", () => girisKaydet(b.dataset.giris)));
  el.querySelectorAll("[data-cikis]").forEach((b) => b.addEventListener("click", () => cikisKaydet(b.dataset.cikis)));
}

async function girisKaydet(personelId) {
  const p = subePersoneliCache.find((x) => x.id === personelId);
  if (!p) return;
  const simdi = new Date();
  let gecGeldi = false;
  if (p.mesaiBaslangic) {
    const [hh, mm] = p.mesaiBaslangic.split(":").map(Number);
    const beklenen = new Date(simdi);
    beklenen.setHours(hh, mm + 5, 0, 0); // 5 dk tolerans
    gecGeldi = simdi > beklenen;
  }
  try {
    await addDoc(collection(db, "puantaj"), {
      personelId: p.id,
      personelAdi: p.ad,
      rol: p.rol,
      subeId: kullanici.subeId || p.subeId || null,
      subeAdi: subeDokumani?.ad || "",
      tarih: tarihAnahtari(),
      girisZamani: serverTimestamp(),
      cikisZamani: null,
      gecGeldi,
      erkenCikti: false,
    });
    bildirimGoster(`${p.ad} giriş yaptı.`, "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

async function cikisKaydet(puantajId) {
  const kayit = puantajBugunCache.find((k) => k.id === puantajId);
  const p = subePersoneliCache.find((x) => x.id === kayit?.personelId);
  const simdi = new Date();
  let erkenCikti = false;
  if (p?.mesaiBitis) {
    const [hh, mm] = p.mesaiBitis.split(":").map(Number);
    const beklenen = new Date(simdi);
    beklenen.setHours(hh, mm, 0, 0);
    erkenCikti = simdi < beklenen;
  }
  try {
    await updateDoc(doc(db, "puantaj", puantajId), { cikisZamani: serverTimestamp(), erkenCikti });
    bildirimGoster("Çıkış kaydedildi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

function renderKasaHareketPaneli() {
  const el = document.getElementById("kasa-hareket-listesi");
  const toplamGiris = kasaHareketleriBugunCache.filter((k) => k.tur === "nakit_giris").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const toplamCikis = kasaHareketleriBugunCache.filter((k) => k.tur === "nakit_cikis").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const siraliListe = kasaHareketleriBugunCache.slice().sort((a, b) => (b.zaman?.toMillis?.() || 0) - (a.zaman?.toMillis?.() || 0));

  el.innerHTML = `
    <div class="kasa-hareket-ozet">
      <span>Bugün Giriş: <b style="color:var(--renk-yesil)">${paraFormat(toplamGiris)}</b></span>
      <span>Bugün Çıkış: <b style="color:var(--renk-kirmizi)">${paraFormat(toplamCikis)}</b></span>
    </div>
    <div class="liste-alani">
      ${siraliListe.length === 0 ? `<div class="bos-durum">Bugün henüz kasa hareketi yok.</div>` : siraliListe.map((k) => `
        <div class="liste-satir">
          <div class="ana-bilgi">
            <strong style="color:${k.tur === "nakit_giris" ? "var(--renk-yesil)" : "var(--renk-kirmizi)"}">${k.tur === "nakit_giris" ? "⬆️ Giriş" : "⬇️ Çıkış"} — ${paraFormat(k.tutar)}</strong>
            <span>${escapeHtml(k.aciklama || "")} ${k.aciklama ? "· " : ""}${escapeHtml(k.yapanKullanici || "")} · ${saatFormat(k.zaman)}</span>
          </div>
        </div>`).join("")}
    </div>
  `;
}

function gunSonuModaliGoster() {
  if (!kullanici.subeId) {
    bildirimGoster("Gün sonu işlemi için bir şubeye bağlı olmalısınız.", "uyari");
    return;
  }
  const katman = document.createElement("div");
  katman.className = "modal-katman";

  if (gunSonuBugunKaydi) {
    const g = gunSonuBugunKaydi;
    katman.innerHTML = `
      <div class="modal-kutu" style="position:relative;">
        <button class="modal-kapat">&times;</button>
        <h2>🌙 Gün Sonu — Bugün Kapatıldı</h2>
        <div class="gun-sonu-ozet">
          <div class="gs-satir"><span>Devir (dünden)</span><span>${paraFormat(g.devirTutari)}</span></div>
          <div class="gs-satir"><span>Nakit Satış</span><span>${paraFormat(g.nakitSatisToplam)}</span></div>
          <div class="gs-satir"><span>Kart Satış</span><span>${paraFormat(g.kartSatisToplam)}</span></div>
          <div class="gs-satir"><span>Manuel Nakit Giriş</span><span>${paraFormat(g.manuelNakitGiris)}</span></div>
          <div class="gs-satir"><span>Manuel Nakit Çıkış</span><span>${paraFormat(g.manuelNakitCikis)}</span></div>
          <div class="gs-satir gs-vurgu"><span>Beklenen Nakit</span><span>${paraFormat(g.beklenenNakit)}</span></div>
          <div class="gs-satir gs-vurgu"><span>Sayılan Nakit</span><span>${paraFormat(g.sayilanNakit)}</span></div>
          <div class="gs-satir gs-vurgu" style="color:${g.fark === 0 ? "var(--renk-yesil)" : "var(--renk-kirmizi)"}"><span>Fark</span><span>${paraFormat(g.fark)}</span></div>
        </div>
        <p style="font-size:12px;color:var(--renk-yazi-soluk);">Kapatan: ${escapeHtml(g.kapatanKullanici || "")} · ${tarihFormat(g.kapanmaZamani)}</p>
      </div>`;
    document.body.appendChild(katman);
    katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
    katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });
    return;
  }

  const nakitSatis = adisyonlarBugunCache.filter((a) => a.odemeYontemi === "nakit").reduce((acc, a) => acc + Number(a.toplamTutar || 0), 0);
  const kartSatis = adisyonlarBugunCache.filter((a) => a.odemeYontemi === "kart").reduce((acc, a) => acc + Number(a.toplamTutar || 0), 0);
  const manuelGiris = kasaHareketleriBugunCache.filter((k) => k.tur === "nakit_giris").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const manuelCikis = kasaHareketleriBugunCache.filter((k) => k.tur === "nakit_cikis").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const devir = Number(subeDokumani?.sonKasaDevri) || 0;
  const beklenenNakit = Math.round((devir + nakitSatis + manuelGiris - manuelCikis) * 100) / 100;

  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>🌙 Gün Sonu — Kasa Sayımı</h2>
      <div class="gun-sonu-ozet">
        <div class="gs-satir"><span>Devir (dünden)</span><span>${paraFormat(devir)}</span></div>
        <div class="gs-satir"><span>Bugünkü Nakit Satış</span><span>${paraFormat(nakitSatis)}</span></div>
        <div class="gs-satir"><span>Bugünkü Kart Satış</span><span>${paraFormat(kartSatis)}</span></div>
        <div class="gs-satir"><span>Manuel Nakit Giriş</span><span>${paraFormat(manuelGiris)}</span></div>
        <div class="gs-satir"><span>Manuel Nakit Çıkış</span><span>${paraFormat(manuelCikis)}</span></div>
        <div class="gs-satir gs-vurgu"><span>Beklenen Nakit (kasada olması gereken)</span><span>${paraFormat(beklenenNakit)}</span></div>
      </div>
      <div class="form-alan"><label>Sayılan Nakit Tutar (fiilen kasada sayılan)</label><input id="sayilan-tutar" type="number" step="0.01" min="0" required /></div>
      <button id="gun-sonu-kapat-buton" class="btn-birincil btn-tam">Gün Sonunu Kapat</button>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#gun-sonu-kapat-buton").addEventListener("click", async () => {
    const sayilanInput = katman.querySelector("#sayilan-tutar");
    const sayilan = Number(sayilanInput.value);
    if (!(sayilan >= 0)) { bildirimGoster("Geçerli bir tutar girin.", "uyari"); return; }
    const fark = Math.round((sayilan - beklenenNakit) * 100) / 100;
    if (!confirm(`Gün sonu kapatılacak.\n\nBeklenen: ${paraFormat(beklenenNakit)}\nSayılan: ${paraFormat(sayilan)}\nFark: ${paraFormat(fark)}\n\nDevam edilsin mi? Bu işlem geri alınamaz.`)) return;
    const buton = katman.querySelector("#gun-sonu-kapat-buton");
    buton.disabled = true;
    try {
      await addDoc(collection(db, "gunSonuKapanislari"), {
        subeId: kullanici.subeId,
        subeAdi: subeDokumani?.ad || "",
        tarih: tarihAnahtari(),
        devirTutari: devir,
        nakitSatisToplam: nakitSatis,
        kartSatisToplam: kartSatis,
        manuelNakitGiris: manuelGiris,
        manuelNakitCikis: manuelCikis,
        beklenenNakit,
        sayilanNakit: sayilan,
        fark,
        kapatanKullanici: kullanici.ad,
        kapatanKullaniciId: auth.currentUser?.uid || null,
        kapanmaZamani: serverTimestamp(),
      });
      await updateDoc(doc(db, "subeler", kullanici.subeId), { sonKasaDevri: sayilan, sonGunSonuTarihi: tarihAnahtari() });
      bildirimGoster("Gün sonu kapatıldı.", "basari");
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      buton.disabled = false;
    }
  });
}

function renderGarsonAtamaPaneli() {
  const el = document.getElementById("garson-atama-cipler");
  if (garsonlarCache.length === 0) {
    el.innerHTML = `<div class="bos-durum" style="padding:10px;">Şubenize tanımlı garson bulunamadı.</div>`;
    return;
  }
  const aktifGarsonId = garsonAtamaModu && garsonAtamaModu !== "kaldir" ? garsonAtamaModu.garsonId : null;
  el.innerHTML = garsonlarCache.map((g) => `
    <div class="garson-atama-cip ${aktifGarsonId === g.id ? "aktif" : ""}" data-garson="${g.id}">${escapeHtml(g.ad)}</div>
  `).join("") + `
    <div class="garson-atama-cip garson-atama-kaldir ${garsonAtamaModu === "kaldir" ? "aktif" : ""}" data-kaldir="1">🚫 Atamayı Kaldır</div>
  `;

  el.querySelectorAll("[data-garson]").forEach((cip) => cip.addEventListener("click", () => {
    const g = garsonlarCache.find((x) => x.id === cip.dataset.garson);
    garsonAtamaModu = (garsonAtamaModu && garsonAtamaModu !== "kaldir" && garsonAtamaModu.garsonId === g.id)
      ? null
      : { garsonId: g.id, garsonAdi: g.ad };
    renderGarsonAtamaPaneli();
    renderMasalar();
  }));
  el.querySelector("[data-kaldir]").addEventListener("click", () => {
    garsonAtamaModu = garsonAtamaModu === "kaldir" ? null : "kaldir";
    renderGarsonAtamaPaneli();
    renderMasalar();
  });
}

function masaninAcikSiparisleri(masaId) {
  return siparislerCache.filter((s) => s.masaId === masaId && s.durum !== "kapandi");
}
function siparisTutari(s) { return Number(s.toplamTutar) || 0; }

function renderEylemBanner() {
  const banner = document.getElementById("eylem-modu-banner");
  if (!eylemModu) { banner.hidden = true; return; }
  const kaynakId = eylemModu.tur === "tasi" ? eylemModu.kaynakMasaId : eylemModu.hedefMasaId;
  const kaynakMasa = masalarCache.find((m) => m.id === kaynakId);
  banner.hidden = false;
  banner.innerHTML = `
    <span>${eylemModu.tur === "tasi" ? "↪️" : "🔗"} <b>${escapeHtml(kaynakMasa?.ad || "")}</b> — ${eylemModu.tur === "tasi" ? "taşınacak masaya dokunun" : "birleştirilecek masaya dokunun"}</span>
    <button id="eylem-iptal-buton" class="btn-ikincil btn-kucuk">✕ İptal</button>
  `;
  banner.querySelector("#eylem-iptal-buton").addEventListener("click", () => {
    eylemModu = null;
    renderMasalar();
  });
}

function renderMasalar() {
  renderEylemBanner();
  const grid = document.getElementById("masalar-grid");
  const liste = masalarCache.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr", { numeric: true }));
  if (liste.length === 0) { grid.innerHTML = `<div class="bos-durum">Masa bulunamadı.</div>`; return; }

  const eylemKaynakId = eylemModu ? (eylemModu.tur === "tasi" ? eylemModu.kaynakMasaId : eylemModu.hedefMasaId) : null;

  grid.innerHTML = liste.map((m) => {
    const acikSiparisler = masaninAcikSiparisleri(m.id);
    const toplam = acikSiparisler.reduce((acc, s) => acc + siparisTutari(s), 0);
    const yeniSiparisVar = acikSiparisler.some((s) => s.durum === "yeni");
    const onayBekliyorVar = acikSiparisler.some((s) => s.durum === "onay_bekliyor");
    const eylemModunda = !!eylemModu;
    const buMasaEylemKaynagi = m.id === eylemKaynakId;
    const buMasaGarsonAyni = garsonAtamaModu && garsonAtamaModu !== "kaldir" && m.sorumluGarsonId === garsonAtamaModu.garsonId;
    return `
    <div class="masa-kart-adisyon ${m.durum || "bos"} ${m.id === seciliMasaId ? "secili" : ""} ${m.garsonCagirildi ? "cagirdi" : ""} ${yeniSiparisVar ? "yeni-siparis" : ""} ${onayBekliyorVar ? "onay-bekliyor-var" : ""} ${eylemModunda ? "eylem-modu-aktif" : ""} ${buMasaEylemKaynagi ? "eylem-kaynagi" : ""} ${garsonAtamaModu ? "atama-modu-aktif" : ""} ${buMasaGarsonAyni ? "atama-ayni-garson" : ""}" data-masa="${m.id}">
      ${escapeHtml(m.ad)}
      <div class="durum" style="color:${(MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos).renk}">${(MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos).etiket}</div>
      <div class="sorumlu-etiket">${m.sorumluGarsonAdi ? `👤 ${escapeHtml(m.sorumluGarsonAdi)}` : "Sorumlu yok"}</div>
      ${onayBekliyorVar ? `<div class="tutar" style="color:#9b59b6;">⏳ Onay Bekliyor</div>` : toplam > 0 ? `<div class="tutar">${paraFormat(toplam)}</div>` : ""}
    </div>`;
  }).join("");

  grid.querySelectorAll("[data-masa]").forEach((el) => el.addEventListener("click", () => masaKartiTiklandi(el.dataset.masa)));
}

async function masaKartiTiklandi(tiklananId) {
  if (garsonAtamaModu) {
    const masa = masalarCache.find((m) => m.id === tiklananId);
    try {
      if (garsonAtamaModu === "kaldir") {
        await updateDoc(doc(db, "masalar", tiklananId), { sorumluGarsonId: null, sorumluGarsonAdi: null });
        bildirimGoster(`${masa?.ad || ""}: sorumlu ataması kaldırıldı.`, "basari");
      } else {
        await updateDoc(doc(db, "masalar", tiklananId), {
          sorumluGarsonId: garsonAtamaModu.garsonId,
          sorumluGarsonAdi: garsonAtamaModu.garsonAdi,
        });
        bildirimGoster(`${masa?.ad || ""} → ${garsonAtamaModu.garsonAdi}`, "basari");
      }
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
    return; // mod açık kalır — kasa art arda başka masalara da atayabilsin
  }
  if (eylemModu) {
    if (eylemModu.tur === "tasi") {
      if (tiklananId === eylemModu.kaynakMasaId) { eylemModu = null; renderMasalar(); return; }
      const kaynakId = eylemModu.kaynakMasaId;
      eylemModu = null;
      await siparisleriTasi(kaynakId, tiklananId);
      seciliMasaId = tiklananId;
      renderMasalar();
      renderDetay();
    } else {
      if (tiklananId === eylemModu.hedefMasaId) { eylemModu = null; renderMasalar(); return; }
      const hedefId = eylemModu.hedefMasaId;
      eylemModu = null;
      await siparisleriTasi(tiklananId, hedefId);
      seciliMasaId = hedefId;
      renderMasalar();
      renderDetay();
    }
    return;
  }
  seciliMasaId = tiklananId;
  seciliOdemeYontemi = "nakit";
  menuAcik = false;
  aktifKategori = "";
  aramaMetni = "";
  sepet = sepetOku();
  renderMasalar();
  renderDetay();
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
        ${acikSiparisler.map((s) => {
          const revizeEdilebilir = s.durum === "onay_bekliyor" || s.durum === "yeni";
          return `
          <div class="siparis-blok ${s.durum === "onay_bekliyor" ? "onay-vurgu" : ""}">
            <div class="siparis-blok-ust">
              <span>${tarihFormat(s.olusturmaZamani)} · ${escapeHtml(s.garsonAdi || "—")}</span>
              ${revizeEdilebilir
                ? `<span class="rozet" style="background:${(SIPARIS_DURUMLARI[s.durum] || SIPARIS_DURUMLARI.yeni).renk}">${(SIPARIS_DURUMLARI[s.durum] || SIPARIS_DURUMLARI.yeni).etiket}</span>`
                : `<select class="siparis-durum-select" data-siparis="${s.id}">
                    ${["hazirlaniyor", "hazir", "servis_edildi"].map((k) => `<option value="${k}" ${s.durum === k ? "selected" : ""}>${SIPARIS_DURUMLARI[k].etiket}</option>`).join("")}
                  </select>`}
            </div>
            ${(s.urunler || []).map((k) => `
              <div class="siparis-kalem">
                <span>${k.adet}x ${escapeHtml(k.ad)} ${k.not ? `<span class="not">(${escapeHtml(k.not)})</span>` : ""}</span>
                <span>${paraFormat(k.tutar ?? k.adet * k.fiyat)}</span>
              </div>`).join("")}
            ${revizeEdilebilir ? `
              <div class="siparis-eylem-satir">
                ${s.durum === "onay_bekliyor" ? `<button class="btn-birincil btn-kucuk onayla-buton" data-siparis="${s.id}">✅ Onayla</button>` : ""}
                <button class="btn-ikincil btn-kucuk duzenle-buton" data-siparis="${s.id}">✏️ Düzenle</button>
                <button class="btn-kirmizi btn-kucuk iptal-buton" data-siparis="${s.id}">❌ İptal Et</button>
              </div>` : ""}
          </div>`;
        }).join("")}

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
    eylemModu = { tur: "tasi", kaynakMasaId: seciliMasaId };
    renderMasalar();
    document.getElementById("masalar-grid").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  panel.querySelector("#masa-birlestir-buton").addEventListener("click", () => {
    eylemModu = { tur: "birlestir", hedefMasaId: seciliMasaId };
    renderMasalar();
    document.getElementById("masalar-grid").scrollIntoView({ behavior: "smooth", block: "start" });
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

  panel.querySelectorAll(".onayla-buton").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await siparisiOnayla(b.dataset.siparis);
      bildirimGoster("Sipariş onaylandı, mutfağa düştü.", "basari");
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      b.disabled = false;
    }
  }));
  panel.querySelectorAll(".duzenle-buton").forEach((b) => b.addEventListener("click", () => {
    duzenlemeModaliGoster(acikSiparisler.find((s) => s.id === b.dataset.siparis));
  }));
  panel.querySelectorAll(".iptal-buton").forEach((b) => b.addEventListener("click", () => {
    iptalModaliGoster(acikSiparisler.find((s) => s.id === b.dataset.siparis));
  }));

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
        if (mevcut) mevcut.adet += 1; else kalemler.push({ urunId: urun.id, ad: urun.ad, fiyat: urun.fiyat, adet: 1, not: "" });
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
        <div class="ana-bilgi"><strong>${escapeHtml(u.ad)}</strong><span>${paraFormat(u.fiyat)}</span></div>
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
