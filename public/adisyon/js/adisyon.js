import { db, auth } from "../../shared/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, updateDoc, addDoc, onSnapshot, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";
import { siparisOlustur, siparisiOnayla, siparisiGuncelle, siparisiIptalEt } from "../../shared/siparis.js";
import { mutfakFisiYazdir, musteriFisiYazdir } from "../../shared/fis.js";
import {
  paraFormat, escapeHtml, tarihFormat, saatFormat, tarihAnahtari, bildirimGoster, debounce,
  MASA_DURUMLARI, SIPARIS_DURUMLARI, ALERJEN_LISTESI, kategorilerSirali, kategoriVeAltlariIds, temaBaslat,
  urunSubedeAktifMi, urunSubeFiyati, YEMEK_CEKI_MARKALARI, KASA_HESAP_ETIKET, KASA_HAREKET_KATEGORILERI,
} from "../../shared/utils.js";

const ROL_ETIKET = { admin: "Admin", garson: "Garson", kasa: "Kasa", mutfak: "Mutfak" };
const ODEME_YONTEMI_ETIKET = { nakit: "NAKİT", kart: "KART", yemek_ceki: "YEMEK ÇEKİ" };

temaBaslat();

let kullanici = null;
let masalarCache = [];
let siparislerCache = [];
let kategorilerCache = [];
let urunlerCache = [];
let garsonlarCache = [];
let seciliMasaId = null;
// Hesap kapatma artık TEK ödeme yöntemiyle sınırlı değil — bölüm bölüm
// (parça parça, farklı yöntemlerle) ödenebilir. Her satır bir "parça":
// { yontem: 'nakit'|'kart'|'yemek_ceki', tutar: number, marka?: string }.
// Toplam tutara ulaşılınca "Hesabı Kapat" aktif olur. Masa değişince/hesap
// kapanınca sıfırlanır (renderDetay boşsa varsayılan tek satırı kurar).
let odemeSatirlari = [];
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
let puantajTumKayitlarCache = []; // şubenin TÜM puantaj kayıtları (tarihe göre burada filtrelenmez, renderPuantajPaneli seçili tarihe göre filtreler)
// TÜM (tarihe/vardiyaya göre burada filtrelenmemiş) kasa hareketi ve adisyon
// kayıtları — "bu vardiyaya ait olanlar" vardiyaKasaHareketleri()/
// vardiyaAdisyonlari() ile ANLIK hesaplanır (bkz. aşağıdaki yorum).
let kasaHareketleriTumCache = [];
let adisyonlarTumCache = [];
let subeDokumani = null;
// Müşteri fişinin üst kısmında görünen işletme bilgileri (admin > Ayarlar'da
// girilir) — bir kez yüklenip fiş yazdırılırken kullanılır.
let isletmeBilgisi = {};
// Ana içerik artık sekmeli: 'masalar' | 'puantaj' | 'kasahareket'
let aktifSekme = "masalar";
// Puantaj sekmesinde görüntülenen tarih — varsayılan bugün, ama geçmiş
// günlerin kaydını görüntülemek/manuel düzeltmek için değiştirilebilir.
let puantajSeciliTarih = tarihAnahtari();

function sepetAnahtari() { return `sepet_kasa_${seciliMasaId}`; }
function sepetOku() { try { return JSON.parse(localStorage.getItem(sepetAnahtari())) || []; } catch { return []; } }
function sepetYaz() { localStorage.setItem(sepetAnahtari(), JSON.stringify(sepet)); sepetBarGuncelle(); }

// Admin hesabının subeId'si YOKTUR (tüm şubeleri yönetir) — ama adisyon
// terminali tek bir şubeye ait masalar/siparişler/kasa/gün sonu üzerinde
// çalışır. Admin (veya şubesiz herhangi bir hesap) bu terminale girerse,
// hangi şube için çalıştığını seçmesi istenir; aksi halde masalar/gün sonu
// TÜM şubeler karışık görünür ve gün sonu "şubeye bağlı olmalısınız"
// uyarısıyla hiç kapatılamaz.
async function subeSeciciGoster() {
  const snap = await getDocs(collection(db, "subeler"));
  const subeler = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (subeler.length <= 1) return subeler[0]?.id || null;

  return new Promise((resolve) => {
    const katman = document.createElement("div");
    katman.className = "modal-katman";
    katman.innerHTML = `
      <div class="modal-kutu" style="position:relative;">
        <h2>🏬 Hangi şube için çalışıyorsunuz?</h2>
        <p style="font-size:13px;color:var(--renk-yazi-soluk);">Hesabınız belirli bir şubeye bağlı değil. Bu adisyon terminalinin hangi şubeye ait olduğunu seçin — bu seçim sadece bu oturum için geçerlidir.</p>
        <div id="sube-secici-liste" class="liste-alani"></div>
      </div>`;
    document.body.appendChild(katman);
    const listeEl = katman.querySelector("#sube-secici-liste");
    listeEl.innerHTML = subeler.map((s) => `<div class="liste-satir" data-sube="${s.id}" style="cursor:pointer;"><div class="ana-bilgi"><strong>${escapeHtml(s.ad)}</strong></div></div>`).join("");
    listeEl.querySelectorAll("[data-sube]").forEach((satir) => satir.addEventListener("click", () => {
      katman.remove();
      resolve(satir.dataset.sube);
    }));
  });
}

async function baslat() {
  const { rol, subeId, ad } = await sayfaKorumaBaslat(["kasa", "admin"]);
  kullanici = { ad, subeId, rol };
  if (!kullanici.subeId) {
    kullanici.subeId = await subeSeciciGoster();
  }

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

  const isletmeSnap = await getDoc(doc(db, "ayarlar", "genel"));
  if (isletmeSnap.exists()) isletmeBilgisi = isletmeSnap.data();

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
    urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => urunSubedeAktifMi(u, kullanici.subeId));
    if (seciliMasaId && menuAcik) renderDetay();
  });

  onSnapshot(query(collection(db, "kullanicilar")), (snap) => {
    const tumPersonel = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    subePersoneliCache = tumPersonel.filter((p) => p.rol !== "admin" && p.aktif !== false && (!kullanici.subeId || p.subeId === kullanici.subeId));
    garsonlarCache = subePersoneliCache.filter((p) => p.rol === "garson");
    if (garsonAtamaPaneliAcik) renderGarsonAtamaPaneli();
    if (aktifSekme === "puantaj") renderPuantajPaneli();
  });

  if (kullanici.subeId) {
    onSnapshot(doc(db, "subeler", kullanici.subeId), (snap) => {
      subeDokumani = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      // Vardiya sınırı (son kapanış zamanı) şube belgesinde tutulur — o
      // değiştiğinde bu vardiyaya ait hareket listesi de yeniden hesaplanmalı.
      if (aktifSekme === "kasahareket") renderKasaHareketPaneli();
    });
  }

  const puantajQuery = kullanici.subeId
    ? query(collection(db, "puantaj"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "puantaj"));
  onSnapshot(puantajQuery, (snap) => {
    puantajTumKayitlarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (aktifSekme === "puantaj") renderPuantajPaneli();
  });

  // NOT: kasaHareketleri/adisyonlar artık TAKVİM GÜNÜNE göre değil, "son gün
  // sonu kapanışından bu yana" (VARDİYA) mantığıyla filtrelenir — bkz.
  // vardiyaKasaHareketleri()/vardiyaAdisyonlari(). Böylece aynı takvim
  // gününde birden fazla vardiya (personel değişimi) art arda kapanabilir;
  // her kapanış sadece KENDİ vardiyasının hareketlerini kapsar.
  const kasaHareketQuery = kullanici.subeId
    ? query(collection(db, "kasaHareketleri"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "kasaHareketleri"));
  onSnapshot(kasaHareketQuery, (snap) => {
    kasaHareketleriTumCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (aktifSekme === "kasahareket") renderKasaHareketPaneli();
  });

  const adisyonlarQuery = kullanici.subeId
    ? query(collection(db, "adisyonlar"), where("subeId", "==", kullanici.subeId))
    : query(collection(db, "adisyonlar"));
  onSnapshot(adisyonlarQuery, (snap) => {
    adisyonlarTumCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  document.getElementById("garson-atama-goster-buton").addEventListener("click", () => {
    garsonAtamaPaneliAcik = !garsonAtamaPaneliAcik;
    if (!garsonAtamaPaneliAcik) { garsonAtamaModu = null; renderMasalar(); }
    document.getElementById("garson-atama-paneli").hidden = !garsonAtamaPaneliAcik;
    document.getElementById("garson-atama-goster-buton").textContent = garsonAtamaPaneliAcik ? "✕ Kapat" : "👥 Garson Ata";
    if (garsonAtamaPaneliAcik) renderGarsonAtamaPaneli();
  });

  document.querySelectorAll(".adisyon-sekme-buton").forEach((btn) => {
    btn.addEventListener("click", () => {
      aktifSekme = btn.dataset.sekme;
      document.querySelectorAll(".adisyon-sekme-buton").forEach((b) => b.classList.toggle("aktif", b === btn));
      document.querySelectorAll(".adisyon-sekme-icerik").forEach((s) => { s.hidden = s.id !== `adisyon-sekme-${aktifSekme}`; });
      if (aktifSekme === "puantaj") renderPuantajPaneli();
      if (aktifSekme === "kasahareket") renderKasaHareketPaneli();
    });
  });

  document.getElementById("puantaj-tarih-input").value = puantajSeciliTarih;
  document.getElementById("puantaj-tarih-input").addEventListener("change", (e) => {
    puantajSeciliTarih = e.target.value || tarihAnahtari();
    renderPuantajPaneli();
  });
  document.getElementById("puantaj-bugun-buton").addEventListener("click", () => {
    puantajSeciliTarih = tarihAnahtari();
    document.getElementById("puantaj-tarih-input").value = puantajSeciliTarih;
    renderPuantajPaneli();
  });
  document.getElementById("puantaj-manuel-ekle-buton").addEventListener("click", () => puantajManuelModaliGoster());

  document.getElementById("kasa-hareket-hesap-secim").innerHTML = Object.entries(KASA_HESAP_ETIKET)
    .map(([deger, etiket]) => `<option value="${deger}">${etiket}</option>`).join("");
  document.getElementById("kasa-hareket-kategori-secim").innerHTML = Object.entries(KASA_HAREKET_KATEGORILERI)
    .map(([deger, etiket]) => `<option value="${deger}">${etiket}</option>`).join("");

  document.getElementById("kasa-hareket-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const gonderButon = e.target.querySelector('button[type="submit"]');
    gonderButon.disabled = true;
    try {
      await addDoc(collection(db, "kasaHareketleri"), {
        subeId: kullanici.subeId || null,
        subeAdi: subeDokumani?.ad || "",
        hesap: fd.get("hesap"),
        yon: fd.get("yon"),
        kategori: fd.get("kategori") || "",
        tutar: Number(fd.get("tutar")) || 0,
        aciklama: fd.get("aciklama")?.trim() || "",
        tarih: tarihAnahtari(),
        zaman: serverTimestamp(),
        yapanKullanici: kullanici.ad,
        yapanKullaniciId: auth.currentUser?.uid || null,
      });
      bildirimGoster("Hareket eklendi.", "basari");
      e.target.reset();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    } finally {
      gonderButon.disabled = false;
    }
  });

  document.getElementById("gun-sonu-goster-buton").addEventListener("click", () => gunSonuModaliGoster());
}

// Seçili tarih için bir personelin puantaj kaydını bulur (o gün için tek
// kayıt varsayılır — açık kalan varsa o, yoksa en son kapanmış olan).
function personelinGunlukKaydi(personelId, tarih) {
  const gununKayitlari = puantajTumKayitlarCache.filter((k) => k.personelId === personelId && k.tarih === tarih);
  return gununKayitlari.find((k) => !k.cikisZamani)
    || gununKayitlari.sort((a, b) => (b.girisZamani?.toMillis?.() || 0) - (a.girisZamani?.toMillis?.() || 0))[0]
    || null;
}

function renderPuantajPaneli() {
  const el = document.getElementById("puantaj-listesi");
  if (subePersoneliCache.length === 0) {
    el.innerHTML = `<div class="bos-durum">Şubenize tanımlı personel bulunamadı.</div>`;
    return;
  }
  const bugunMu = puantajSeciliTarih === tarihAnahtari();
  const liste = subePersoneliCache.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));
  el.innerHTML = liste.map((p) => {
    const kayit = personelinGunlukKaydi(p.id, puantajSeciliTarih);
    let durumHtml;
    if (!kayit) {
      durumHtml = bugunMu
        ? `<span class="puantaj-durum bos-kayit">Henüz gelmedi</span><button class="btn-yesil btn-kucuk" data-giris="${p.id}">Giriş Yap</button>`
        : `<span class="puantaj-durum bos-kayit">Kayıt yok</span><button class="btn-ikincil btn-kucuk" data-manuel-ekle="${p.id}">+ Ekle</button>`;
    } else if (!kayit.cikisZamani) {
      durumHtml = `<span class="puantaj-durum geldi">${saatFormat(kayit.girisZamani)}'te geldi${kayit.gecGeldi ? ` <b class="puantaj-gec">(geç)</b>` : ""}</span>` +
        (bugunMu ? `<button class="btn-kirmizi btn-kucuk" data-cikis="${kayit.id}">Çıkış Yap</button>` : "") +
        `<button class="btn-ikincil btn-kucuk" data-duzenle="${kayit.id}">✏️ Düzenle</button>`;
    } else {
      durumHtml = `<span class="puantaj-durum tamam">${saatFormat(kayit.girisZamani)} → ${saatFormat(kayit.cikisZamani)}${kayit.gecGeldi ? ` <b class="puantaj-gec">geç geldi</b>` : ""}${kayit.erkenCikti ? ` <b class="puantaj-erken">erken çıktı</b>` : ""}</span>` +
        `<button class="btn-ikincil btn-kucuk" data-duzenle="${kayit.id}">✏️ Düzenle</button>`;
    }
    return `
    <div class="liste-satir">
      <div class="ana-bilgi"><strong>${escapeHtml(p.ad)}</strong><span>${ROL_ETIKET[p.rol] || p.rol}</span></div>
      <div class="puantaj-eylem">${durumHtml}</div>
    </div>`;
  }).join("");

  el.querySelectorAll("[data-giris]").forEach((b) => b.addEventListener("click", () => girisKaydet(b.dataset.giris)));
  el.querySelectorAll("[data-cikis]").forEach((b) => b.addEventListener("click", () => cikisKaydet(b.dataset.cikis)));
  el.querySelectorAll("[data-manuel-ekle]").forEach((b) => b.addEventListener("click", () => puantajManuelModaliGoster(null, b.dataset.manuelEkle)));
  el.querySelectorAll("[data-duzenle]").forEach((b) => b.addEventListener("click", () => {
    puantajManuelModaliGoster(puantajTumKayitlarCache.find((k) => k.id === b.dataset.duzenle));
  }));
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
  const kayit = puantajTumKayitlarCache.find((k) => k.id === puantajId);
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

// Manuel puantaj ekleme/düzenleme: "bugün şu saatte geldi, şu saatte çıktı"
// şeklinde geçmiş/mevcut bir günü elle girebilmek veya düzeltebilmek için.
// mevcutKayit verilirse düzenleme modu (personel/tarih sabit); verilmezse
// yeni kayıt eklenir (onPersonelId ile personel önceden seçilmiş olabilir).
function puantajManuelModaliGoster(mevcutKayit = null, onPersonelId = null) {
  const duzenlemeModu = !!mevcutKayit;
  const secilecekPersonelId = mevcutKayit?.personelId || onPersonelId || "";
  const saatDegeriAl = (zamanAlani) => {
    if (!zamanAlani?.toDate) return "";
    const t = zamanAlani.toDate();
    return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  };

  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h3>${duzenlemeModu ? "✏️ Puantaj Kaydını Düzenle" : "+ Manuel Puantaj Kaydı"}</h3>
      <form id="puantaj-manuel-form">
        <div class="form-alan">
          <label>Personel</label>
          <select name="personelId" required ${duzenlemeModu ? "disabled" : ""}>
            <option value="">Seçin...</option>
            ${subePersoneliCache.map((p) => `<option value="${p.id}" ${p.id === secilecekPersonelId ? "selected" : ""}>${escapeHtml(p.ad)}</option>`).join("")}
          </select>
        </div>
        <div class="form-alan"><label>Tarih</label><input name="tarih" type="date" value="${mevcutKayit?.tarih || puantajSeciliTarih}" required /></div>
        <div class="puantaj-manuel-satir">
          <div class="form-alan"><label>Giriş Saati</label><input name="girisSaat" type="time" value="${saatDegeriAl(mevcutKayit?.girisZamani)}" required /></div>
          <div class="form-alan"><label>Çıkış Saati (opsiyonel)</label><input name="cikisSaat" type="time" value="${saatDegeriAl(mevcutKayit?.cikisZamani)}" /></div>
        </div>
        <button type="submit" class="btn-birincil btn-tam">${duzenlemeModu ? "Kaydet" : "Ekle"}</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#puantaj-manuel-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const personelId = duzenlemeModu ? mevcutKayit.personelId : fd.get("personelId");
    const p = subePersoneliCache.find((x) => x.id === personelId);
    if (!p) { bildirimGoster("Personel seçin.", "uyari"); return; }
    const tarih = fd.get("tarih");
    const girisSaat = fd.get("girisSaat");
    const cikisSaat = fd.get("cikisSaat");
    if (!tarih || !girisSaat) { bildirimGoster("Tarih ve giriş saati zorunludur.", "uyari"); return; }

    const girisZamani = new Date(`${tarih}T${girisSaat}:00`);
    const cikisZamani = cikisSaat ? new Date(`${tarih}T${cikisSaat}:00`) : null;
    if (cikisZamani && cikisZamani <= girisZamani) { bildirimGoster("Çıkış saati girişten sonra olmalıdır.", "uyari"); return; }

    let gecGeldi = false;
    if (p.mesaiBaslangic) {
      const [hh, mm] = p.mesaiBaslangic.split(":").map(Number);
      const beklenen = new Date(girisZamani);
      beklenen.setHours(hh, mm + 5, 0, 0);
      gecGeldi = girisZamani > beklenen;
    }
    let erkenCikti = false;
    if (cikisZamani && p.mesaiBitis) {
      const [hh, mm] = p.mesaiBitis.split(":").map(Number);
      const beklenen = new Date(cikisZamani);
      beklenen.setHours(hh, mm, 0, 0);
      erkenCikti = cikisZamani < beklenen;
    }

    const gonderButon = e.target.querySelector('button[type="submit"]');
    gonderButon.disabled = true;
    try {
      if (duzenlemeModu) {
        await updateDoc(doc(db, "puantaj", mevcutKayit.id), {
          tarih, girisZamani, cikisZamani, gecGeldi, erkenCikti, manuelDuzenlendi: true,
        });
        bildirimGoster("Puantaj kaydı güncellendi.", "basari");
      } else {
        await addDoc(collection(db, "puantaj"), {
          personelId: p.id,
          personelAdi: p.ad,
          rol: p.rol,
          subeId: kullanici.subeId || p.subeId || null,
          subeAdi: subeDokumani?.ad || "",
          tarih, girisZamani, cikisZamani, gecGeldi, erkenCikti,
          manuelGirildi: true,
        });
        bildirimGoster("Puantaj kaydı eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      gonderButon.disabled = false;
    }
  });
}

// Son gün sonu kapanışının kesin zamanı (Firestore Timestamp → ms). Hiç
// kapanış yapılmamışsa 0 — yani "başlangıçtan bu yana" her şey bu vardiyaya
// sayılır (ilk vardiya).
function sonKapanisZamaniMs() {
  return subeDokumani?.sonGunSonuZamani?.toMillis?.() || 0;
}
// Bu vardiyaya (son kapanıştan bu yana) ait kasa hareketleri/adisyonlar.
// TAKVİM GÜNÜ değil, kapanış zamanı sınır alınır — böylece aynı gün içinde
// birden fazla personel değişimi/vardiya art arda kapanabilir; bir sonraki
// vardiya bir öncekinin hareketlerini bir daha görmez/saymaz.
function vardiyaKasaHareketleri() {
  const sinir = sonKapanisZamaniMs();
  return kasaHareketleriTumCache.filter((k) => (k.zaman?.toMillis?.() || 0) > sinir);
}
function vardiyaAdisyonlari() {
  const sinir = sonKapanisZamaniMs();
  return adisyonlarTumCache.filter((a) => (a.kapanmaZamani?.toMillis?.() || 0) > sinir);
}

// Eski kayıtlar `tur: "nakit_giris"/"nakit_cikis"` alanıyla tutuluyordu; yeni
// kayıtlar `hesap`+`yon` kullanır. Geriye dönük uyumluluk için: hesap/yön
// belirtilmemişse eski `tur` alanından çıkarılır (hepsi nakitti).
function hareketHesap(k) { return k.hesap || "nakit"; }
function hareketYon(k) { return k.yon || (k.tur === "nakit_cikis" ? "cikis" : "giris"); }
function hareketTutari(hesap, yon, liste = vardiyaKasaHareketleri()) {
  return liste.filter((k) => hareketHesap(k) === hesap && hareketYon(k) === yon).reduce((acc, k) => acc + Number(k.tutar || 0), 0);
}

// Bir adisyon (kapanmış hesap) kaydının belirli bir ödeme yöntemiyle ne
// kadarının ödendiğini döner — "bölüm bölüm" (odemeler[]) kayıtlarda ilgili
// parçalar toplanır; eski (tekli odemeYontemi/toplamTutar) kayıtlarda tüm
// tutar o tek yönteme aittir.
function adisyonOdemeToplami(a, yontem) {
  if (Array.isArray(a.odemeler)) {
    return a.odemeler.filter((o) => o.yontem === yontem).reduce((acc, o) => acc + Number(o.tutar || 0), 0);
  }
  return a.odemeYontemi === yontem ? Number(a.toplamTutar || 0) : 0;
}

function renderKasaHareketPaneli() {
  const el = document.getElementById("kasa-hareket-listesi");
  const ozetEl = document.getElementById("kasa-hareket-ozet-panel");
  const vardiyaListesi = vardiyaKasaHareketleri();

  const nakitGiris = hareketTutari("nakit", "giris", vardiyaListesi);
  const nakitCikis = hareketTutari("nakit", "cikis", vardiyaListesi);
  const bankaGiris = hareketTutari("banka", "giris", vardiyaListesi);
  const bankaCikis = hareketTutari("banka", "cikis", vardiyaListesi);
  const kartGiris = hareketTutari("kart", "giris", vardiyaListesi);
  const kartCikis = hareketTutari("kart", "cikis", vardiyaListesi);
  const personelOdeme = vardiyaListesi.filter((k) => k.kategori === "personel_odemesi").reduce((acc, k) => acc + Number(k.tutar || 0), 0);

  ozetEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">💵 Nakit (Giriş − Çıkış)</div><div class="deger">${paraFormat(nakitGiris - nakitCikis)}</div></div>
    <div class="panel-kart"><div class="etiket">🏦 Banka (Giriş − Çıkış)</div><div class="deger">${paraFormat(bankaGiris - bankaCikis)}</div></div>
    <div class="panel-kart"><div class="etiket">💳 Kart Hesabı (Giriş − Çıkış)</div><div class="deger">${paraFormat(kartGiris - kartCikis)}</div></div>
    <div class="panel-kart"><div class="etiket">👤 Personele Ödenen</div><div class="deger" style="color:var(--renk-kirmizi);">${paraFormat(personelOdeme)}</div></div>
  `;

  const siraliListe = vardiyaListesi.slice().sort((a, b) => (b.zaman?.toMillis?.() || 0) - (a.zaman?.toMillis?.() || 0));
  el.innerHTML = `
    <div class="liste-alani">
      ${siraliListe.length === 0 ? `<div class="bos-durum">Bu vardiyada henüz hareket yok.</div>` : siraliListe.map((k) => {
        const hesap = hareketHesap(k);
        const yon = hareketYon(k);
        const renk = yon === "giris" ? "var(--renk-yesil)" : "var(--renk-kirmizi)";
        const kategoriEtiket = KASA_HAREKET_KATEGORILERI[k.kategori] || "";
        return `
        <div class="liste-satir">
          <div class="ana-bilgi">
            <strong style="color:${renk}">${yon === "giris" ? "⬆️" : "⬇️"} ${KASA_HESAP_ETIKET[hesap] || hesap} — ${paraFormat(k.tutar)}</strong>
            <span>${kategoriEtiket && k.kategori ? `${kategoriEtiket} · ` : ""}${escapeHtml(k.aciklama || "")} ${k.aciklama ? "· " : ""}${escapeHtml(k.yapanKullanici || "")} · ${saatFormat(k.zaman)}</span>
          </div>
        </div>`;
      }).join("")}
    </div>
  `;
}

// Gün sonu artık TAKVİM GÜNÜ başına bir kez değil, VARDİYA başına bir kez
// yapılır: bir personel işini bitirip kasayı sayıp "Gün Sonunu Kapat"a
// bastığında SADECE kendi vardiyasının (bir önceki kapanıştan bu yana
// birikmiş) hareketleri raporlanır, kasa devri güncellenir ve oturum
// kapatılır. Aynı takvim günü içinde bir sonraki personel kendi şifresiyle
// girip AYNI şekilde kendi vardiyasını kapatabilir — "bugün zaten kapatıldı"
// diye bir engel YOKTUR (aksi halde tek terminali paylaşan ardışık
// vardiyalardan sadece ilki hiç kasa raporu veremezdi).
function gunSonuModaliGoster() {
  if (!kullanici.subeId) {
    bildirimGoster("Gün sonu işlemi için bir şubeye bağlı olmalısınız.", "uyari");
    return;
  }
  const katman = document.createElement("div");
  katman.className = "modal-katman";

  const vAdisyonlar = vardiyaAdisyonlari();
  const vHareketler = vardiyaKasaHareketleri();
  // Hesap "bölüm bölüm" (karma) ödenmiş olabilir — her adisyon kaydının
  // odemeler[] dizisindeki HER PARÇA ayrı ayrı sayılır. Eski (tekli
  // ödemeYontemi/toplamTutar) kayıtlar için geriye dönük uyumluluk korunur.
  const nakitSatis = vAdisyonlar.reduce((acc, a) => acc + adisyonOdemeToplami(a, "nakit"), 0);
  const kartSatis = vAdisyonlar.reduce((acc, a) => acc + adisyonOdemeToplami(a, "kart"), 0);
  const yemekCekiSatis = vAdisyonlar.reduce((acc, a) => acc + adisyonOdemeToplami(a, "yemek_ceki"), 0);
  const yemekCekiMarkaBazinda = {};
  vAdisyonlar.forEach((a) => {
    if (Array.isArray(a.odemeler)) {
      a.odemeler.filter((o) => o.yontem === "yemek_ceki").forEach((o) => {
        const marka = o.marka || "Diğer";
        yemekCekiMarkaBazinda[marka] = (yemekCekiMarkaBazinda[marka] || 0) + Number(o.tutar || 0);
      });
    } else if (a.odemeYontemi === "yemek_ceki") {
      const marka = a.yemekCekiMarkasi || "Diğer";
      yemekCekiMarkaBazinda[marka] = (yemekCekiMarkaBazinda[marka] || 0) + Number(a.toplamTutar || 0);
    }
  });
  const manuelGiris = hareketTutari("nakit", "giris", vHareketler);
  const manuelCikis = hareketTutari("nakit", "cikis", vHareketler);
  const bankaGiris = hareketTutari("banka", "giris", vHareketler);
  const bankaCikis = hareketTutari("banka", "cikis", vHareketler);
  const kartHareketGiris = hareketTutari("kart", "giris", vHareketler);
  const kartHareketCikis = hareketTutari("kart", "cikis", vHareketler);
  const personelOdemeToplam = vHareketler.filter((k) => k.kategori === "personel_odemesi").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const devir = Number(subeDokumani?.sonKasaDevri) || 0;
  const beklenenNakit = Math.round((devir + nakitSatis + manuelGiris - manuelCikis) * 100) / 100;
  const yemekCekiOzetSatiri = Object.entries(yemekCekiMarkaBazinda).map(([m, t]) => `${escapeHtml(m)}: ${paraFormat(t)}`).join(", ");

  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>🌙 Gün Sonu — Kasa Sayımı</h2>
      <p style="font-size:12px;color:var(--renk-yazi-soluk);margin-top:-8px;">Bu vardiyada (son kapanıştan bu yana) birikmiş hareketler.</p>
      <div class="gun-sonu-ozet">
        <div class="gs-satir"><span>Devir (önceki vardiyadan)</span><span>${paraFormat(devir)}</span></div>
        <div class="gs-satir"><span>Bu Vardiya Nakit Satış</span><span>${paraFormat(nakitSatis)}</span></div>
        <div class="gs-satir"><span>Bu Vardiya Kart Satış</span><span>${paraFormat(kartSatis)}</span></div>
        <div class="gs-satir"><span>Manuel Nakit Giriş</span><span>${paraFormat(manuelGiris)}</span></div>
        <div class="gs-satir"><span>Manuel Nakit Çıkış</span><span>${paraFormat(manuelCikis)}</span></div>
        <div class="gs-satir gs-vurgu"><span>Beklenen Nakit (kasada olması gereken)</span><span>${paraFormat(beklenenNakit)}</span></div>
      </div>
      ${yemekCekiSatis > 0 || bankaGiris || bankaCikis || kartHareketGiris || kartHareketCikis || personelOdemeToplam ? `
      <div class="gun-sonu-ozet" style="border-top:1px dashed var(--renk-kenar);padding-top:10px;">
        ${yemekCekiSatis > 0 ? `<div class="gs-satir"><span>🎫 Yemek Çeki Satış${yemekCekiOzetSatiri ? ` <span style="font-weight:400;color:var(--renk-yazi-soluk);">(${yemekCekiOzetSatiri})</span>` : ""}</span><span>${paraFormat(yemekCekiSatis)}</span></div>` : ""}
        ${bankaGiris || bankaCikis ? `<div class="gs-satir"><span>🏦 Banka Giriş / Çıkış</span><span>${paraFormat(bankaGiris)} / ${paraFormat(bankaCikis)}</span></div>` : ""}
        ${kartHareketGiris || kartHareketCikis ? `<div class="gs-satir"><span>💳 Kart Hesabı Giriş / Çıkış</span><span>${paraFormat(kartHareketGiris)} / ${paraFormat(kartHareketCikis)}</span></div>` : ""}
        ${personelOdemeToplam ? `<div class="gs-satir"><span>👤 Personele Ödenen</span><span>${paraFormat(personelOdemeToplam)}</span></div>` : ""}
      </div>` : ""}
      <div class="form-alan"><label>Sayılan Nakit Tutar (fiilen kasada sayılan)</label><input id="sayilan-tutar" type="number" step="0.01" min="0" required /></div>
      <button id="gun-sonu-kapat-buton" class="btn-birincil btn-tam">Gün Sonunu Kapat ve Merkeze Gönder</button>
      <p style="font-size:11px;color:var(--renk-yazi-soluk);margin-top:8px;">Kasayı kapatan tüm nakdi teslim alır — bir sonraki vardiya sıfır devirle başlar. Gönderdikten sonra bu vardiyanın kaydı üzerinde değişiklik yapılamaz.</p>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#gun-sonu-kapat-buton").addEventListener("click", async () => {
    const sayilanInput = katman.querySelector("#sayilan-tutar");
    const sayilan = Number(sayilanInput.value);
    if (!(sayilan >= 0)) { bildirimGoster("Geçerli bir tutar girin.", "uyari"); return; }
    const fark = Math.round((sayilan - beklenenNakit) * 100) / 100;
    if (!confirm(`Vardiya kapatılıp merkeze gönderilecek.\n\nBeklenen: ${paraFormat(beklenenNakit)}\nSayılan: ${paraFormat(sayilan)}\nFark: ${paraFormat(fark)}\n\nSayılan nakdin tamamı kasadan çıkar (bir sonraki vardiya 0 devirle başlar). Gönderdikten sonra bu kayıt üzerinde değişiklik yapılamaz. Devam edilsin mi?`)) return;
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
        yemekCekiSatisToplam: yemekCekiSatis,
        yemekCekiMarkaBazinda,
        manuelNakitGiris: manuelGiris,
        manuelNakitCikis: manuelCikis,
        bankaGiris,
        bankaCikis,
        kartHareketGiris,
        kartHareketCikis,
        personelOdemeToplam,
        beklenenNakit,
        sayilanNakit: sayilan,
        fark,
        kapatanKullanici: kullanici.ad,
        kapatanKullaniciId: auth.currentUser?.uid || null,
        kapanmaZamani: serverTimestamp(),
      });
      // Kasayı kapatan tüm nakdi teslim alır (bankaya yatırır / işletme
      // sahibine verir) — bu yüzden bir sonraki vardiya devirsiz (0) başlar,
      // sayılan tutar bir sonrakine "borç" olarak aktarılmaz.
      await updateDoc(doc(db, "subeler", kullanici.subeId), {
        sonKasaDevri: 0,
        sonGunSonuZamani: serverTimestamp(),
        sonGunSonuTarihi: tarihAnahtari(),
      });
      bildirimGoster("Vardiya kapatıldı ve merkeze gönderildi. Oturum kapatılıyor, yeni gelen personel kendi şifresiyle giriş yapmalı...", "basari");
      katman.remove();
      // Gün sonu kapandıktan sonra terminal yeniden kullanılabilir olmamalı —
      // her gelen personel adisyon hesabını kendi şifresiyle devralmalı.
      setTimeout(() => { cikisYap(); }, 1500);
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

function odemeSatirlariToplami() {
  return Math.round(odemeSatirlari.reduce((acc, o) => acc + (Number(o.tutar) || 0), 0) * 100) / 100;
}

// Hesap kapatma ekranındaki "bölüm bölüm ödeme" satırları: her satır bir
// yöntem+tutar (yemek çekiyse marka da). Toplam girilen tutar, hesabın genel
// toplamına eşitlenene kadar "Hesabı Kapat" pasif kalır.
function odemeSatirlariHtml(toplamTutar) {
  const girilen = odemeSatirlariToplami();
  const kalan = Math.round((toplamTutar - girilen) * 100) / 100;
  return `
    <div class="odeme-satirlari-baslik">
      <span>Ödeme (bölüm bölüm ödenebilir)</span>
      <button type="button" id="hesap-bol-kisayol-buton" class="btn-ikincil btn-kucuk">➗ Eşit Böl</button>
    </div>
    <div id="odeme-satirlari-liste">
      ${odemeSatirlari.map((o, i) => `
        <div class="odeme-satiri">
          <select class="odeme-yontem-select" data-index="${i}">
            <option value="nakit" ${o.yontem === "nakit" ? "selected" : ""}>💵 Nakit</option>
            <option value="kart" ${o.yontem === "kart" ? "selected" : ""}>💳 Kart</option>
            <option value="yemek_ceki" ${o.yontem === "yemek_ceki" ? "selected" : ""}>🎫 Yemek Çeki</option>
          </select>
          ${o.yontem === "yemek_ceki" ? `
          <select class="odeme-marka-select" data-index="${i}">
            ${YEMEK_CEKI_MARKALARI.map((m) => `<option value="${escapeHtml(m)}" ${o.marka === m ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}
          </select>` : ""}
          <input type="number" class="odeme-tutar-input" data-index="${i}" step="0.01" min="0" value="${o.tutar}" />
          ${odemeSatirlari.length > 1 ? `<button type="button" class="odeme-satiri-sil" data-index="${i}">✕</button>` : ""}
        </div>`).join("")}
    </div>
    <button type="button" id="odeme-satiri-ekle-buton" class="btn-ikincil btn-kucuk" style="margin:6px 0 10px;">+ Ödeme Satırı Ekle</button>
    <div class="odeme-kalan-satir ${Math.abs(kalan) <= 0.01 ? "tamam" : "eksik"}">
      <span>Girilen Toplam</span><span id="odeme-girilen-tutar">${paraFormat(girilen)}</span>
    </div>
    <div class="odeme-kalan-satir ${Math.abs(kalan) <= 0.01 ? "tamam" : "eksik"}">
      <span>Kalan</span><span id="odeme-kalan-tutar">${paraFormat(kalan)}</span>
    </div>
  `;
}

// Tutar inputuna her yazışta TÜM paneli yeniden çizmek yerine (klavye/odak
// kaybolur) sadece özet satırlarını ve "Hesabı Kapat" butonunun aktifliğini
// günceller.
function odemeOzetGuncelle(toplamTutar) {
  const girilen = odemeSatirlariToplami();
  const kalan = Math.round((toplamTutar - girilen) * 100) / 100;
  const girilenEl = document.getElementById("odeme-girilen-tutar");
  const kalanEl = document.getElementById("odeme-kalan-tutar");
  if (girilenEl) girilenEl.textContent = paraFormat(girilen);
  if (kalanEl) {
    kalanEl.textContent = paraFormat(kalan);
    const tamamMi = Math.abs(kalan) <= 0.01;
    kalanEl.closest(".odeme-kalan-satir")?.classList.toggle("tamam", tamamMi);
    kalanEl.closest(".odeme-kalan-satir")?.classList.toggle("eksik", !tamamMi);
    girilenEl.closest(".odeme-kalan-satir")?.classList.toggle("tamam", tamamMi);
    girilenEl.closest(".odeme-kalan-satir")?.classList.toggle("eksik", !tamamMi);
  }
  const kapatButon = document.getElementById("hesap-kapat-buton");
  if (kapatButon) kapatButon.disabled = Math.abs(kalan) > 0.01;
}

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
  odemeSatirlari = [];
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

  // Ödeme satırları henüz kurulmadıysa (masa yeni seçildi/hesap az önce
  // kapandı) tek satır olarak tüm tutarı varsayılan Nakit'e koy — kasa
  // isterse bölüp yöntemleri değiştirebilir.
  if (odemeSatirlari.length === 0 && toplamTutar > 0) {
    odemeSatirlari = [{ yontem: "nakit", tutar: toplamTutar }];
  }

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

        ${odemeSatirlariHtml(toplamTutar)}

        <div class="detay-eylemler">
          <button id="hesap-bol-buton" class="btn-ikincil btn-tam">➗ Hesabı Böl</button>
          <button id="fis-yazdir-buton" class="btn-ikincil btn-tam">🖨️ Fiş Yazdır</button>
        </div>
        <button id="hesap-kapat-buton" class="btn-yesil btn-tam" style="margin-top:8px;" ${Math.abs(toplamTutar - odemeSatirlariToplami()) > 0.01 ? "disabled" : ""}>Hesabı Kapat</button>
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
      const onaylanan = acikSiparisler.find((s) => s.id === b.dataset.siparis);
      if (onaylanan) mutfakFisiYazdir({ masaAd: onaylanan.masaAd || masa.ad, gonderenAdi: kullanici.ad, urunler: onaylanan.urunler || [] });
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

  panel.querySelectorAll(".odeme-yontem-select").forEach((sel) => sel.addEventListener("change", (e) => {
    const i = Number(e.target.dataset.index);
    odemeSatirlari[i].yontem = e.target.value;
    if (e.target.value === "yemek_ceki" && !odemeSatirlari[i].marka) odemeSatirlari[i].marka = YEMEK_CEKI_MARKALARI[0];
    renderDetay();
  }));
  panel.querySelectorAll(".odeme-marka-select").forEach((sel) => sel.addEventListener("change", (e) => {
    odemeSatirlari[Number(e.target.dataset.index)].marka = e.target.value;
  }));
  panel.querySelectorAll(".odeme-tutar-input").forEach((inp) => inp.addEventListener("input", (e) => {
    odemeSatirlari[Number(e.target.dataset.index)].tutar = Number(e.target.value) || 0;
    odemeOzetGuncelle(toplamTutar);
  }));
  panel.querySelectorAll(".odeme-satiri-sil").forEach((b) => b.addEventListener("click", () => {
    odemeSatirlari.splice(Number(b.dataset.index), 1);
    renderDetay();
  }));
  panel.querySelector("#odeme-satiri-ekle-buton")?.addEventListener("click", () => {
    const kalan = Math.round((toplamTutar - odemeSatirlariToplami()) * 100) / 100;
    odemeSatirlari.push({ yontem: "nakit", tutar: kalan > 0 ? kalan : 0 });
    renderDetay();
  });
  panel.querySelector("#hesap-bol-kisayol-buton")?.addEventListener("click", () => hesabiBolModaliGoster(toplamTutar, acikSiparisler, "esit"));
  panel.querySelector("#hesap-bol-buton")?.addEventListener("click", () => hesabiBolModaliGoster(toplamTutar, acikSiparisler, "esit"));
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

// Hesabı Böl: masadaki toplam hesabı birden fazla kişiye paylaştırma
// yardımcısı. İki mod: "Eşit Böl" (kişi sayısına böler) ve "Ürün Bazlı Böl"
// (her ürünü tek tek bir kişiye atayarak kişi başı tutarı hesaplar). Sonuçta
// üretilen tutarlar, ana paneldeki "ödeme satırları"na yazılır — her kişi
// kendi payını istediği yöntemle (nakit/kart/yemek çeki) ödeyebilir.
function hesabiBolModaliGoster(toplamTutar, acikSiparisler, baslangicMod) {
  let mod = baslangicMod || "esit";
  let kisiSayisi = 2;
  // Ürün bazlı bölme için: her sipariş kaleminin ADEDİ kadar tekil "birim"
  // oluşturulur (2 adet aynı üründen biri Kişi 1'e, diğeri Kişi 2'ye
  // atanabilsin diye) — kisiIndex null = henüz atanmadı.
  const kalemBirimleri = [];
  acikSiparisler.forEach((s) => (s.urunler || []).forEach((k) => {
    for (let i = 0; i < k.adet; i++) kalemBirimleri.push({ ad: k.ad, fiyat: Number(k.fiyat) || 0, kisiIndex: null });
  }));
  let aktifKisiIndex = 0;

  const katman = document.createElement("div");
  katman.className = "modal-katman";

  function kisiTutari(i) {
    return kalemBirimleri.filter((k) => k.kisiIndex === i).reduce((acc, k) => acc + k.fiyat, 0);
  }

  function icerik() {
    const modSecimHtml = `
      <div class="hesap-bol-mod-secim">
        <button type="button" class="btn-ikincil btn-kucuk ${mod === "esit" ? "secili" : ""}" data-mod="esit">Eşit Böl</button>
        <button type="button" class="btn-ikincil btn-kucuk ${mod === "urun" ? "secili" : ""}" data-mod="urun">Ürün Bazlı Böl</button>
      </div>`;

    if (mod === "esit") {
      const kisiBasi = Math.round((toplamTutar / kisiSayisi) * 100) / 100;
      return `
        <h3>➗ Hesabı Böl</h3>
        ${modSecimHtml}
        <div class="form-alan"><label>Kişi Sayısı</label><input id="hesap-bol-kisi-sayisi" type="number" min="2" max="20" value="${kisiSayisi}" /></div>
        <div class="gs-satir gs-vurgu"><span>Kişi Başı</span><span>${paraFormat(kisiBasi)}</span></div>
        <button type="button" id="hesap-bol-uygula-buton" class="btn-birincil btn-tam">Ödeme Satırlarını Oluştur (${kisiSayisi} Eşit Parça)</button>
      `;
    }

    const tumuAtandiMi = kalemBirimleri.every((k) => k.kisiIndex !== null);
    return `
      <h3>➗ Hesabı Böl — Ürün Bazlı</h3>
      ${modSecimHtml}
      <p style="font-size:12px;color:var(--renk-yazi-soluk);">Önce bir kişi seçin, sonra o kişiye ait ürünlere dokunun.</p>
      <div class="hesap-bol-kisi-cipler">
        ${Array.from({ length: kisiSayisi }, (_, i) => `
          <div class="hesap-bol-kisi-cip ${aktifKisiIndex === i ? "aktif" : ""}" data-kisi="${i}">Kişi ${i + 1}<span class="hesap-bol-kisi-tutar">${paraFormat(kisiTutari(i))}</span></div>
        `).join("")}
        <button type="button" class="hesap-bol-kisi-ekle" id="hesap-bol-kisi-ekle-buton">+ Kişi</button>
      </div>
      <div class="hesap-bol-urun-liste">
        ${kalemBirimleri.map((k, i) => `
          <div class="hesap-bol-urun-satir ${k.kisiIndex !== null ? "atanmis" : ""}" data-kalem="${i}">
            <span>${escapeHtml(k.ad)}</span>
            <span>${paraFormat(k.fiyat)}</span>
            <span class="hesap-bol-urun-etiket">${k.kisiIndex !== null ? `Kişi ${k.kisiIndex + 1}` : "—"}</span>
          </div>`).join("")}
      </div>
      ${!tumuAtandiMi ? `<p style="font-size:12px;color:var(--renk-kirmizi);">Henüz atanmamış ürünler var.</p>` : ""}
      <button type="button" id="hesap-bol-uygula-buton" class="btn-birincil btn-tam" ${!tumuAtandiMi ? "disabled" : ""}>Ödeme Satırlarını Oluştur</button>
    `;
  }

  katman.innerHTML = `<div class="modal-kutu" id="hesap-bol-icerik" style="position:relative;"><button class="modal-kapat">&times;</button>${icerik()}</div>`;
  document.body.appendChild(katman);
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  function bagla() {
    const icerikEl = katman.querySelector("#hesap-bol-icerik");
    icerikEl.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
    icerikEl.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", () => {
      mod = b.dataset.mod;
      icerikEl.innerHTML = `<button class="modal-kapat">&times;</button>${icerik()}`;
      bagla();
    }));

    if (mod === "esit") {
      const kisiSayisiInput = icerikEl.querySelector("#hesap-bol-kisi-sayisi");
      kisiSayisiInput.addEventListener("input", (e) => {
        kisiSayisi = Math.max(2, Number(e.target.value) || 2);
        icerikEl.innerHTML = `<button class="modal-kapat">&times;</button>${icerik()}`;
        bagla();
      });
      icerikEl.querySelector("#hesap-bol-uygula-buton").addEventListener("click", () => {
        const kisiBasi = Math.round((toplamTutar / kisiSayisi) * 100) / 100;
        const satirlar = Array.from({ length: kisiSayisi }, () => ({ yontem: "nakit", tutar: kisiBasi }));
        // Yuvarlama farkını son satıra ekle ki toplam TAM tutara eşit olsun.
        const fark = Math.round((toplamTutar - kisiBasi * kisiSayisi) * 100) / 100;
        satirlar[satirlar.length - 1].tutar = Math.round((satirlar[satirlar.length - 1].tutar + fark) * 100) / 100;
        odemeSatirlari = satirlar;
        katman.remove();
        renderDetay();
      });
    } else {
      icerikEl.querySelectorAll(".hesap-bol-kisi-cip").forEach((cip) => cip.addEventListener("click", () => {
        aktifKisiIndex = Number(cip.dataset.kisi);
        icerikEl.innerHTML = `<button class="modal-kapat">&times;</button>${icerik()}`;
        bagla();
      }));
      icerikEl.querySelector("#hesap-bol-kisi-ekle-buton").addEventListener("click", () => {
        kisiSayisi++;
        icerikEl.innerHTML = `<button class="modal-kapat">&times;</button>${icerik()}`;
        bagla();
      });
      icerikEl.querySelectorAll(".hesap-bol-urun-satir").forEach((satir) => satir.addEventListener("click", () => {
        kalemBirimleri[Number(satir.dataset.kalem)].kisiIndex = aktifKisiIndex;
        icerikEl.innerHTML = `<button class="modal-kapat">&times;</button>${icerik()}`;
        bagla();
      }));
      icerikEl.querySelector("#hesap-bol-uygula-buton")?.addEventListener("click", () => {
        const satirlar = Array.from({ length: kisiSayisi }, (_, i) => ({ yontem: "nakit", tutar: kisiTutari(i) })).filter((o) => o.tutar > 0);
        if (satirlar.length === 0) { bildirimGoster("Önce ürünleri kişilere atayın.", "uyari"); return; }
        odemeSatirlari = satirlar;
        katman.remove();
        renderDetay();
      });
    }
  }
  bagla();
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
      <div class="fiyat">${paraFormat(urunSubeFiyati(u, kullanici.subeId))}</div>
    </div>`).join("");

  el.querySelectorAll(".pos-urun-kart").forEach((kart) => kart.addEventListener("click", (e) => {
    const urun = urunlerCache.find((u) => u.id === kart.dataset.urun);
    if (e.target.closest(".pos-not-buton")) {
      urunEkleModali(urun);
      return;
    }
    const fiyat = urunSubeFiyati(urun, kullanici.subeId);
    const mevcut = sepet.find((s) => s.urunId === urun.id && !s.not);
    if (mevcut) mevcut.adet += 1; else sepet.push({ urunId: urun.id, ad: urun.ad, fiyat, adet: 1, not: "" });
    sepetYaz();
    bildirimGoster(`${urun.ad} eklendi.`, "basari");
  }));
}

function urunEkleModali(urun) {
  let adet = 1;
  const fiyat = urunSubeFiyati(urun, kullanici.subeId);
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
      <div class="detay-fiyat">${paraFormat(fiyat)}</div>
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
    if (mevcut) mevcut.adet += adet; else sepet.push({ urunId: urun.id, ad: urun.ad, fiyat, adet, not });
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
    const masaAd = masalarCache.find((m) => m.id === seciliMasaId)?.ad || "";
    mutfakFisiYazdir({ masaAd, gonderenAdi: kullanici.ad, urunler: sepet.map((s) => ({ ad: s.ad, adet: s.adet, not: s.not })) });
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
  musteriFisiYazdir({
    isletmeAdi: isletmeBilgisi.isletmeAdi,
    subeAdi: subeDokumani?.ad || "",
    subeAdres: subeDokumani?.adres || "",
    subeTelefon: subeDokumani?.telefon || "",
    vergiDairesi: isletmeBilgisi.vergiDairesi,
    vergiNo: isletmeBilgisi.vergiNo,
    masaAd: masa.ad,
    kalemler: siparisler.flatMap((s) => s.urunler || []),
    toplam,
    odemeSatirlari,
    kapananKullanici: kullanici.ad,
  });
}

async function hesabiKapat(masa, siparisler, toplam) {
  const girilen = odemeSatirlariToplami();
  if (Math.abs(toplam - girilen) > 0.01) {
    bildirimGoster(`Ödeme satırlarının toplamı (${paraFormat(girilen)}) hesap tutarına (${paraFormat(toplam)}) eşit değil.`, "uyari");
    return;
  }
  if (odemeSatirlari.some((o) => o.yontem === "yemek_ceki" && !o.marka)) {
    bildirimGoster("Yemek çeki satırları için marka seçin.", "uyari");
    return;
  }
  const odemeOzetiMetni = odemeSatirlari
    .map((o) => `${ODEME_YONTEMI_ETIKET[o.yontem]}${o.yontem === "yemek_ceki" ? ` (${o.marka})` : ""}: ${paraFormat(o.tutar)}`)
    .join("\n");
  if (!confirm(`${masa.ad} hesabı ${paraFormat(toplam)} tutarında kapatılacak:\n\n${odemeOzetiMetni}\n\nDevam edilsin mi?`)) return;

  const dagilikYontemSayisi = new Set(odemeSatirlari.map((o) => o.yontem)).size;
  const tekYontem = dagilikYontemSayisi === 1 ? odemeSatirlari[0].yontem : "karma";
  const tekYemekCekiMarkasi = dagilikYontemSayisi === 1 && odemeSatirlari[0].yontem === "yemek_ceki" && odemeSatirlari.length === 1
    ? odemeSatirlari[0].marka
    : null;

  try {
    await addDoc(collection(db, "adisyonlar"), {
      masaId: masa.id,
      masaAd: masa.ad,
      subeId: masa.subeId || null,
      siparisIdler: siparisler.map((s) => s.id),
      toplamTutar: toplam,
      // odemeler: bölüm bölüm ödenen her parça (yöntem+tutar+marka).
      // odemeYontemi/yemekCekiMarkasi: TEK yöntemle ödendiyse geriye dönük
      // uyumluluk ve basit raporlama için ayrıca tutulur; birden fazla
      // yöntem kullanıldıysa "karma" olarak işaretlenir (kırılım odemeler'de).
      odemeler: odemeSatirlari.map((o) => ({ yontem: o.yontem, tutar: Math.round(o.tutar * 100) / 100, marka: o.yontem === "yemek_ceki" ? o.marka : null })),
      odemeYontemi: tekYontem,
      yemekCekiMarkasi: tekYemekCekiMarkasi,
      kapananKullanici: kullanici.ad,
      kapanmaZamani: serverTimestamp(),
    });
    await Promise.all(siparisler.map((s) => updateDoc(doc(db, "siparisler", s.id), { durum: "kapandi" })));
    await updateDoc(doc(db, "masalar", masa.id), { durum: "bos", garsonCagirildi: false });
    bildirimGoster("Hesap kapatıldı.", "basari");
    // Ödeme sırasında müşteri fişi otomatik yazdırılır (gerekirse "Fiş
    // Yazdır" ile ayrıca yeniden basılabilir).
    fisYazdir(masa, siparisler, toplam);
    seciliMasaId = null;
    odemeSatirlari = [];
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
