import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml, paraFormat, alerjenRozetleriHtml, ALERJEN_LISTESI, debounce, kategorilerSirali } from "../../shared/utils.js";
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
    <div class="urun-karti ${u.aktif === false ? "pasif" : ""}">
      <img src="${u.gorselUrl || "https://placehold.co/300x180?text=Görsel+Yok"}" alt="${escapeHtml(u.ad)}" loading="lazy" />
      <div class="icerik">
        <div class="ust-satir"><strong>${escapeHtml(u.ad)}</strong><span class="fiyat">${paraFormat(u.fiyat)}</span></div>
        <div class="etiket-satir">${escapeHtml(kategoriAdi(u.kategoriId))} · ${u.kalori ?? "-"} kcal ${u.aktif === false ? "· <b style='color:var(--renk-kirmizi)'>PASİF</b>" : ""} ${subeFarkiEtiketi(u)}</div>
        <div class="aciklama">${escapeHtml((u.aciklama || "").slice(0, 70))}</div>
        <div>${alerjenRozetleriHtml(u.alerjenler, u.glutensiz)}</div>
      </div>
      <div class="eylemler">
        <button class="btn-ikincil btn-kucuk" data-duzenle="${u.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${u.id}">Sil</button>
      </div>
    </div>`
    )
    .join("");

  listeEl.querySelectorAll("[data-duzenle]").forEach((b) =>
    b.addEventListener("click", () => formGoster(urunlerCache.find((u) => u.id === b.dataset.duzenle)))
  );
  listeEl.querySelectorAll("[data-sil]").forEach((b) =>
    b.addEventListener("click", () => silOnayla(b.dataset.sil))
  );
}

// Bir ürünün kaç şubede genel ayardan farklı (pasif veya farklı fiyat)
// olduğunu gösteren küçük etiket — admin listede tek bakışta görsün diye.
function subeFarkiEtiketi(u) {
  const farkSayisi = Object.keys(u.subeAyarlari || {}).length;
  if (farkSayisi === 0) return "";
  return `· <b style="color:#9b59b6;">${farkSayisi} şubede farklı</b>`;
}

// Bir şube satırı: "Bu şubede satılıyor" onay kutusu + varsa fiyat farkı.
// Onay kutusu kapatılırsa ürün o şubede hiç görünmez (fiyat girilse de
// dikkate alınmaz). Fiyat boş bırakılırsa genel fiyat kullanılır.
function subeAyarSatiriHtml(sube, ayar) {
  const aktif = ayar?.aktif !== false;
  const fiyat = typeof ayar?.fiyat === "number" ? ayar.fiyat : "";
  return `
    <div class="sube-ayar-satir" data-sube="${sube.id}">
      <label class="sube-ayar-checkbox"><input type="checkbox" class="sube-ayar-aktif" ${aktif ? "checked" : ""}/> ${escapeHtml(sube.ad)}</label>
      <input type="number" class="sube-ayar-fiyat" step="0.01" min="0" placeholder="Genel fiyat" value="${fiyat}" ${aktif ? "" : "disabled"} />
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
          <div class="form-alan"><label>Kalori (kcal) *zorunlu</label><input name="kalori" type="number" step="1" min="0" required value="${urun ? urun.kalori : ""}" /></div>
        </div>
        <div class="form-alan"><label>Görsel URL</label><input name="gorselUrl" type="url" placeholder="https://..." value="${urun ? escapeHtml(urun.gorselUrl || "") : ""}" /></div>

        ${subelerCache.length > 1 ? `
        <div class="form-alan">
          <label>Şubeye Özel Ayarlar (boş bırakılırsa yukarıdaki genel fiyat/durum tüm şubelerde geçerli olur — bu ürün bir şubede satılmıyorsa veya farklı fiyatlanıyorsa burada belirtin)</label>
          <div id="sube-ayar-alani" class="sube-ayar-grid">${subelerCache.map((s) => subeAyarSatiriHtml(s, urun?.subeAyarlari?.[s.id])).join("")}</div>
        </div>` : ""}

        <div class="form-alan">
          <label>Alerjenler (Türkiye Gıda Kodeksi / AB alerjen listesi)</label>
          <div class="alerjen-secim-grid">${alerjenGrid}</div>
        </div>

        <div class="form-satir">
          <div class="form-alan"><label><input type="checkbox" name="glutensiz" style="width:auto;" ${urun?.glutensiz ? "checked" : ""}/> Glutensiz</label></div>
          <div class="form-alan"><label><input type="checkbox" name="aktif" style="width:auto;" ${!urun || urun.aktif !== false ? "checked" : ""}/> Menüde Aktif</label></div>
        </div>

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
    kutu.addEventListener("change", () => { fiyatInput.disabled = !kutu.checked; });
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
      // kaydedilir (aktif=false veya fiyat override) — belirtilmeyen şubeler
      // için ürün varsayılan (genel) ayarı kullanır.
      const genelFiyat = Number(fd.get("fiyat")) || 0;
      const subeAyarlari = {};
      katman.querySelectorAll(".sube-ayar-satir").forEach((satir) => {
        const subeId = satir.dataset.sube;
        const aktifMi = satir.querySelector(".sube-ayar-aktif").checked;
        const fiyatDegeri = satir.querySelector(".sube-ayar-fiyat").value;
        const ozelFiyat = fiyatDegeri !== "" ? Number(fiyatDegeri) : null;
        if (!aktifMi) {
          subeAyarlari[subeId] = { aktif: false };
        } else if (ozelFiyat !== null && ozelFiyat !== genelFiyat) {
          subeAyarlari[subeId] = { aktif: true, fiyat: ozelFiyat };
        }
      });

      const veri = {
        ad: fd.get("ad").trim(),
        aciklama: fd.get("aciklama").trim(),
        kategoriId: fd.get("kategoriId"),
        fiyat: genelFiyat,
        kalori: Number(fd.get("kalori")) || 0,
        gorselUrl,
        alerjenler,
        glutensiz: fd.get("glutensiz") === "on",
        aktif: fd.get("aktif") === "on",
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
