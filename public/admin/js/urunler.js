import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml, paraFormat, alerjenRozetleriHtml, ALERJEN_LISTESI, debounce, kategorilerSirali, urunStokTakipli, urunStokAdedi } from "../../shared/utils.js";
import { kategorilerCache, kategorilerDegisti } from "./kategoriler.js";
import { hammaddelerCache, hammaddelerDegisti } from "./hammaddeler.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

export let urunlerCache = [];

const listeEl = document.getElementById("urunler-liste");
const ekleButon = document.getElementById("urun-ekle-buton");
const aramaEl = document.getElementById("urun-arama");
const kategoriFiltreEl = document.getElementById("urun-kategori-filtre");

let aramaMetni = "";
let kategoriFiltre = "";

export function baslat() {
  onSnapshot(
    query(collection(db, "urunler")),
    (snap) => {
      urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("urunler")
  );

  kategorilerDegisti(() => { renderKategoriFiltre(); render(); });
  hammaddelerDegisti(() => {}); // sadece cache güncel kalsın, form açıldığında okunuyor
  subelerDegisti(() => render()); // sadece cache güncel kalsın + rozet güncellensin

  ekleButon.addEventListener("click", () => formGoster());
  aramaEl.addEventListener("input", debounce((e) => { aramaMetni = e.target.value.toLowerCase(); render(); }, 200));
  kategoriFiltreEl.addEventListener("change", (e) => { kategoriFiltre = e.target.value; render(); });
}

function renderKategoriFiltre() {
  const secili = kategoriFiltreEl.value;
  kategoriFiltreEl.innerHTML = `<option value="">Tüm Kategoriler</option>` +
    kategorilerSirali(kategorilerCache)
      .map((k) => `<option value="${k.id}">${k.derinlik ? "— " : ""}${escapeHtml(k.ad)}</option>`)
      .join("");
  kategoriFiltreEl.value = secili;
}

function kategoriAdi(id) {
  const k = kategorilerCache.find((x) => x.id === id);
  if (!k) return "Kategorisiz";
  if (k.ustKategoriId) {
    const ust = kategorilerCache.find((x) => x.id === k.ustKategoriId);
    return ust ? `${ust.ad} › ${k.ad}` : k.ad;
  }
  return k.ad;
}

function render() {
  let liste = urunlerCache;
  if (kategoriFiltre) liste = liste.filter((u) => u.kategoriId === kategoriFiltre);
  if (aramaMetni) liste = liste.filter((u) => u.ad?.toLowerCase().includes(aramaMetni));
  liste = liste.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));

  if (liste.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Ürün bulunamadı.</div>`;
    return;
  }

  listeEl.innerHTML = liste
    .map(
      (u) => `
    <div class="urun-karti ${u.aktif === false ? "pasif" : ""} ${u.tukendi ? "tukendi" : ""}">
      <img src="${u.gorselUrl || "https://placehold.co/300x180?text=Görsel+Yok"}" alt="${escapeHtml(u.ad)}" loading="lazy" />
      <div class="icerik">
        <div class="ust-satir"><strong>${escapeHtml(u.ad)}</strong><span class="fiyat">${paraFormat(u.fiyat)}</span></div>
        <div class="etiket-satir">${escapeHtml(kategoriAdi(u.kategoriId))} · ${u.kalori ?? "-"} kcal ${u.aktif === false ? "· <b style='color:var(--renk-kirmizi)'>PASİF</b>" : ""} ${u.tukendi ? "· <b style='color:#e67e22'>TÜKENDİ</b>" : ""} ${subeFarkiEtiketi(u)}</div>
        <div class="maliyet-satir">${maliyetKarEtiketi(u)}</div>
        ${stokOzetiHtml(u)}
        <div class="aciklama">${escapeHtml((u.aciklama || "").slice(0, 70))}</div>
        <div>${alerjenRozetleriHtml(u.alerjenler, u.glutensiz)}</div>
      </div>
      <div class="eylemler">
        <button class="btn-ikincil btn-kucuk" data-tukendi="${u.id}">${u.tukendi ? "↩︎ Satışa Aç" : "⛔ Tükendi"}</button>
        <button class="btn-ikincil btn-kucuk" data-duzenle="${u.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${u.id}">Sil</button>
      </div>
    </div>`
    )
    .join("");

  listeEl.querySelectorAll("[data-duzenle]").forEach((b) =>
    b.addEventListener("click", () => formGoster(urunlerCache.find((u) => u.id === b.dataset.duzenle)))
  );
  listeEl.querySelectorAll("[data-tukendi]").forEach((b) =>
    b.addEventListener("click", () => tukendiToggle(b.dataset.tukendi))
  );
  listeEl.querySelectorAll("[data-sil]").forEach((b) =>
    b.addEventListener("click", () => silOnayla(b.dataset.sil))
  );
}

// "Tükendi" durumunu hızlıca değiştir (formu açmadan). Ürün listede/menüde
// görünmeye devam eder ama "TÜKENDİ" etiketiyle işaretlenir ve sipariş
// alınamaz — sadece admin bu durumu değiştirebilir.
async function tukendiToggle(id) {
  const u = urunlerCache.find((x) => x.id === id);
  if (!u) return;
  const yeni = !u.tukendi;
  try {
    await updateDoc(doc(db, "urunler", id), {
      tukendi: yeni,
      tukendiZamani: yeni ? serverTimestamp() : null,
      guncellemeZamani: serverTimestamp(),
    });
    bildirimGoster(yeni ? `"${u.ad}" tükendi olarak işaretlendi.` : `"${u.ad}" tekrar satışta.`, "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}

// Bir ürünün kaç şubede genel ayardan farklı (pasif veya farklı fiyat)
// olduğunu gösteren küçük etiket — admin listede tek bakışta görsün diye.
function subeFarkiEtiketi(u) {
  const farkSayisi = Object.keys(u.subeAyarlari || {}).length;
  if (farkSayisi === 0) return "";
  return `· <b style="color:#9b59b6;">${farkSayisi} şubede farklı</b>`;
}

// Maliyet + brüt kâr marjı etiketi (kart üzerinde).
function maliyetKarEtiketi(u) {
  const maliyet = Number(u.maliyet) || 0;
  const fiyat = Number(u.fiyat) || 0;
  if (maliyet <= 0) return `<span class="tablo-soluk">Maliyet girilmemiş</span>`;
  const kar = fiyat - maliyet;
  const marj = fiyat > 0 ? (kar / fiyat) * 100 : 0;
  const renk = kar >= 0 ? "var(--renk-yesil)" : "var(--renk-kirmizi)";
  return `Maliyet: <b>${paraFormat(maliyet)}</b> · Kâr: <b style="color:${renk}">${paraFormat(kar)}</b> <span class="tablo-soluk">(%${marj.toFixed(0)})</span>`;
}

// Stok takibi açık ürünlerde şube bazlı adet özeti.
function stokOzetiHtml(u) {
  if (!urunStokTakipli(u)) return "";
  const satirlar = subelerCache
    .map((s) => {
      const adet = urunStokAdedi(u, s.id);
      return `<span class="stok-cip ${adet <= 0 ? "bitti" : ""}">${escapeHtml(s.ad)}: <b>${adet}</b></span>`;
    })
    .join("");
  const toplam = subelerCache.reduce((acc, s) => acc + urunStokAdedi(u, s.id), 0);
  return `<div class="stok-ozeti">📦 Stok (toplam <b>${toplam}</b>): ${satirlar || "<span class='tablo-soluk'>şube yok</span>"}</div>`;
}

// Bir şube satırı: "Bu şubede satılıyor" onay kutusu + o şubeye özel
// fiyat / maliyet / stok. Fiyat & maliyet boş bırakılırsa genel değer
// kullanılır. Stok alanı yalnızca "Stok takibi" açıkken görünür/kaydedilir.
function subeAyarSatiriHtml(sube, ayar, stokAdedi, stokTakip) {
  const aktif = ayar?.aktif !== false;
  const fiyat = typeof ayar?.fiyat === "number" ? ayar.fiyat : "";
  const maliyet = typeof ayar?.maliyet === "number" ? ayar.maliyet : "";
  return `
    <div class="sube-ayar-satir" data-sube="${sube.id}">
      <label class="sube-ayar-checkbox"><input type="checkbox" class="sube-ayar-aktif" ${aktif ? "checked" : ""}/> ${escapeHtml(sube.ad)}</label>
      <div class="sube-ayar-alanlar">
        <label>Fiyat<input type="number" class="sube-ayar-fiyat" step="0.01" min="0" placeholder="Genel" value="${fiyat}" ${aktif ? "" : "disabled"} /></label>
        <label>Maliyet<input type="number" class="sube-ayar-maliyet" step="0.01" min="0" placeholder="Genel" value="${maliyet}" /></label>
        <label class="sube-ayar-stok-alan" ${stokTakip ? "" : "hidden"}>Stok<input type="number" class="sube-ayar-stok" step="1" min="0" placeholder="0" value="${stokAdedi ?? ""}" /></label>
      </div>
    </div>`;
}

function receteSatiriHtml(satir = { hammaddeId: "", miktar: "" }) {
  const secenekler = hammaddelerCache
    .map((h) => `<option value="${h.id}" ${h.id === satir.hammaddeId ? "selected" : ""}>${escapeHtml(h.ad)} (${escapeHtml(h.birim)})</option>`)
    .join("");
  return `
    <div class="recete-satir">
      <select class="recete-hammadde"><option value="">Hammadde seç...</option>${secenekler}</select>
      <input class="recete-miktar" type="number" step="0.01" min="0" placeholder="Miktar" value="${satir.miktar ?? ""}" />
      <button type="button" class="btn-kirmizi btn-kucuk recete-sil">✕</button>
    </div>`;
}

function formGoster(urun = null) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";

  const alerjenGrid = Object.entries(ALERJEN_LISTESI)
    .map(([key, a]) => `<label><input type="checkbox" name="alerjen" value="${key}" ${urun?.alerjenler?.includes(key) ? "checked" : ""}/> ${a.ikon} ${a.etiket}</label>`)
    .join("");

  const kategoriSecenekleri = kategorilerSirali(kategorilerCache)
    .map((k) => `<option value="${k.id}" ${urun?.kategoriId === k.id ? "selected" : ""}>${k.derinlik ? "— " : ""}${escapeHtml(k.ad)}</option>`)
    .join("");

  katman.innerHTML = `
    <div class="modal-kutu" style="max-width:600px;position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${urun ? "Ürünü Düzenle" : "Yeni Ürün"}</h2>
      <form id="urun-form">
        <div class="form-satir">
          <div class="form-alan"><label>Ürün Adı</label><input name="ad" required value="${urun ? escapeHtml(urun.ad) : ""}" /></div>
          <div class="form-alan"><label>Kategori</label><select name="kategoriId" required><option value="">Seçiniz...</option>${kategoriSecenekleri}</select></div>
        </div>
        <div class="form-alan"><label>Açıklama</label><textarea name="aciklama" rows="2">${urun ? escapeHtml(urun.aciklama || "") : ""}</textarea></div>
        <div class="form-satir">
          <div class="form-alan"><label>Fiyat (₺)</label><input name="fiyat" type="number" step="0.01" min="0" required value="${urun ? urun.fiyat : ""}" /></div>
          <div class="form-alan"><label>Genel Maliyet (₺)</label><input name="maliyet" type="number" step="0.01" min="0" placeholder="0" value="${urun && urun.maliyet != null ? urun.maliyet : ""}" /></div>
          <div class="form-alan"><label>Kalori (kcal) *zorunlu</label><input name="kalori" type="number" step="1" min="0" required value="${urun ? urun.kalori : ""}" /></div>
        </div>
        <div class="form-alan"><label>Görsel URL</label><input name="gorselUrl" type="url" placeholder="https://..." value="${urun ? escapeHtml(urun.gorselUrl || "") : ""}" /></div>

        ${subelerCache.length >= 1 ? `
        <div class="form-alan">
          <label>Şube Bazında Fiyat / Maliyet / Stok (fiyat & maliyet boşsa genel değer geçerli; onay kutusu kapalıysa ürün o şubede hiç görünmez)</label>
          <div id="sube-ayar-alani" class="sube-ayar-grid">${subelerCache.map((s) => subeAyarSatiriHtml(s, urun?.subeAyarlari?.[s.id], urun?.stok?.[s.id], urun?.stokTakip === true)).join("")}</div>
        </div>` : ""}

        <div class="form-alan">
          <label>Alerjenler (Türkiye Gıda Kodeksi / AB alerjen listesi)</label>
          <div class="alerjen-secim-grid">${alerjenGrid}</div>
        </div>

        <div class="form-satir">
          <div class="form-alan"><label><input type="checkbox" name="glutensiz" style="width:auto;" ${urun?.glutensiz ? "checked" : ""}/> Glutensiz</label></div>
          <div class="form-alan"><label><input type="checkbox" name="aktif" style="width:auto;" ${!urun || urun.aktif !== false ? "checked" : ""}/> Menüde Aktif</label></div>
          <div class="form-alan"><label><input type="checkbox" name="tukendi" style="width:auto;" ${urun?.tukendi ? "checked" : ""}/> Tükendi (stokta yok)</label></div>
          <div class="form-alan"><label><input type="checkbox" name="stokTakip" id="urun-stok-takip" style="width:auto;" ${urun?.stokTakip ? "checked" : ""}/> Stok takibi yap (adet)</label></div>
        </div>
        <p style="font-size:12px;color:var(--renk-yazi-soluk);margin:-6px 0 12px;">
          <b>Menüde Aktif</b> kapalıysa ürün hiçbir ekranda görünmez.
          <b>Tükendi</b> işaretliyse ürün menüde/adisyonda görünür ama “TÜKENDİ” etiketiyle ve sipariş alınamaz.
          <b>Stok takibi</b> açıksa yukarıdaki şube satırlarına adet girin — her satışta o şubenin stoğu otomatik düşer, iptalde geri eklenir, stok bitince ürün otomatik “TÜKENDİ” görünür.
        </p>

        <div class="form-alan">
          <label>Reçete (hammadde tüketimi)</label>
          <div id="recete-alani">${(urun?.recete || []).map(receteSatiriHtml).join("") || ""}</div>
          <button type="button" id="recete-ekle-satir" class="btn-ikincil btn-kucuk">+ Hammadde Ekle</button>
        </div>

        <button type="submit" class="btn-birincil btn-tam" style="margin-top:10px;">${urun ? "Kaydet" : "Ekle"}</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  const receteAlani = katman.querySelector("#recete-alani");
  function receteSilBagla() {
    receteAlani.querySelectorAll(".recete-sil").forEach((b) =>
      b.addEventListener("click", (e) => e.target.closest(".recete-satir").remove())
    );
  }
  receteSilBagla();
  katman.querySelector("#recete-ekle-satir").addEventListener("click", () => {
    receteAlani.insertAdjacentHTML("beforeend", receteSatiriHtml());
    receteSilBagla();
  });

  katman.querySelectorAll(".sube-ayar-satir").forEach((satir) => {
    const kutu = satir.querySelector(".sube-ayar-aktif");
    const fiyatInput = satir.querySelector(".sube-ayar-fiyat");
    const maliyetInput = satir.querySelector(".sube-ayar-maliyet");
    kutu.addEventListener("change", () => {
      fiyatInput.disabled = !kutu.checked;
      if (maliyetInput) maliyetInput.disabled = !kutu.checked;
    });
  });

  // "Stok takibi yap" açılınca/kapanınca şube satırlarındaki adet alanları
  // görünür/gizli olur.
  const stokTakipKutu = katman.querySelector("#urun-stok-takip");
  stokTakipKutu?.addEventListener("change", () => {
    katman.querySelectorAll(".sube-ayar-stok-alan").forEach((el) => { el.hidden = !stokTakipKutu.checked; });
  });

  katman.querySelector("#urun-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const gonderButon = e.target.querySelector('button[type="submit"]');
    gonderButon.disabled = true;
    try {
      const fd = new FormData(e.target);
      const gorselUrl = fd.get("gorselUrl")?.trim() || "";

      const alerjenler =Array.from(e.target.querySelectorAll('input[name="alerjen"]:checked')).map((c) => c.value);

      const recete = Array.from(receteAlani.querySelectorAll(".recete-satir"))
        .map((satir) => ({
          hammaddeId: satir.querySelector(".recete-hammadde").value,
          miktar: Number(satir.querySelector(".recete-miktar").value) || 0,
        }))
        .filter((r) => r.hammaddeId && r.miktar > 0);

      // Şubeye özel ayarlar: SADECE genel ayardan farklı olan şubeler
      // kaydedilir (pasiflik, fiyat farkı veya maliyet farkı) — belirtilmeyen
      // şubeler için ürün varsayılan (genel) ayarı kullanır.
      const genelFiyat = Number(fd.get("fiyat")) || 0;
      const genelMaliyet = Number(fd.get("maliyet")) || 0;
      const stokTakipSecili = fd.get("stokTakip") === "on";
      const subeAyarlari = {};
      const stok = {};
      katman.querySelectorAll(".sube-ayar-satir").forEach((satir) => {
        const subeId = satir.dataset.sube;
        const aktifMi = satir.querySelector(".sube-ayar-aktif").checked;
        const fiyatDegeri = satir.querySelector(".sube-ayar-fiyat").value;
        const maliyetDegeri = satir.querySelector(".sube-ayar-maliyet").value;
        const ozelFiyat = fiyatDegeri !== "" ? Number(fiyatDegeri) : null;
        const ozelMaliyet = maliyetDegeri !== "" ? Number(maliyetDegeri) : null;
        const ayar = {};
        if (!aktifMi) ayar.aktif = false;
        if (aktifMi && ozelFiyat !== null && ozelFiyat !== genelFiyat) ayar.fiyat = ozelFiyat;
        if (ozelMaliyet !== null && ozelMaliyet !== genelMaliyet) ayar.maliyet = ozelMaliyet;
        if (Object.keys(ayar).length) subeAyarlari[subeId] = ayar;

        // Stok: takip açıksa girilen adet (boşsa mevcut değeri koru), kapalıysa
        // eski stok verisini olduğu gibi sakla (yeniden açınca kaybolmasın).
        const stokDegeri = satir.querySelector(".sube-ayar-stok")?.value;
        if (stokTakipSecili) {
          stok[subeId] = stokDegeri === "" || stokDegeri == null
            ? (Number(urun?.stok?.[subeId]) || 0)
            : Math.max(0, Math.round(Number(stokDegeri) || 0));
        } else if (urun?.stok?.[subeId] != null) {
          stok[subeId] = Number(urun.stok[subeId]) || 0;
        }
      });

      const tukendiSecili = fd.get("tukendi") === "on";
      const veri = {
        ad: fd.get("ad").trim(),
        aciklama: fd.get("aciklama").trim(),
        kategoriId: fd.get("kategoriId"),
        fiyat: genelFiyat,
        maliyet: genelMaliyet,
        kalori: Number(fd.get("kalori")) || 0,
        gorselUrl,
        alerjenler,
        glutensiz: fd.get("glutensiz") === "on",
        aktif: fd.get("aktif") === "on",
        tukendi: tukendiSecili,
        // İşaretlenme anını koru: zaten tükendiyse eski zamanı bırak, yeni
        // işaretlendiyse şimdi damgala, kaldırıldıysa temizle.
        tukendiZamani: tukendiSecili ? (urun?.tukendi ? (urun.tukendiZamani ?? serverTimestamp()) : serverTimestamp()) : null,
        stokTakip: stokTakipSecili,
        stok,
        recete,
        subeAyarlari,
      };

      if (urun) {
        await updateDoc(doc(db, "urunler", urun.id), { ...veri, guncellemeZamani: serverTimestamp() });
        bildirimGoster("Ürün güncellendi.", "basari");
      } else {
        await addDoc(collection(db, "urunler"), { ...veri, olusturmaZamani: serverTimestamp() });
        bildirimGoster("Ürün eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      console.error(err);
      bildirimGoster("Hata: " + err.message, "hata");
      gonderButon.disabled = false;
    }
  });
}

async function silOnayla(id) {
  const u = urunlerCache.find((x) => x.id === id);
  if (!confirm(`"${u?.ad}" ürününü silmek istediğinize emin misiniz?`)) return;
  try {
    await deleteDoc(doc(db, "urunler", id));
    bildirimGoster("Ürün silindi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
