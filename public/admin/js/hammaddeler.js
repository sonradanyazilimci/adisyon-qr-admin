import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml } from "../../shared/utils.js";

export let hammaddelerCache = [];
const dinleyiciler = [];
export function hammaddelerDegisti(cb) { dinleyiciler.push(cb); }
function bildir() { dinleyiciler.forEach((cb) => cb(hammaddelerCache)); }

const listeEl = document.getElementById("hammaddeler-liste");
const ekleButon = document.getElementById("hammadde-ekle-buton");
const kritikStokEl = document.getElementById("panel-kritik-stok");

export function baslat() {
  const q = query(collection(db, "hammaddeler"), orderBy("ad", "asc"));
  onSnapshot(
    q,
    (snap) => {
      hammaddelerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      renderKritikStok();
      bildir();
    },
    snapshotHataYakala("hammaddeler")
  );

  ekleButon.addEventListener("click", () => formGoster());
}

function kritikMi(h) {
  return Number(h.mevcutStok) <= Number(h.kritikEsik ?? 0);
}

function render() {
  if (hammaddelerCache.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Henüz hammadde eklenmedi.</div>`;
    return;
  }
  listeEl.innerHTML = hammaddelerCache
    .map((h) => {
      const kritik = kritikMi(h);
      return `
    <div class="liste-satir" style="${kritik ? "border:1.5px solid var(--renk-kirmizi);" : ""}">
      <div class="ana-bilgi">
        <strong>${escapeHtml(h.ad)} ${kritik ? "⚠️" : ""}</strong>
        <span>Mevcut: <b>${h.mevcutStok} ${escapeHtml(h.birim)}</b> · Kritik eşik: ${h.kritikEsik ?? 0} ${escapeHtml(h.birim)}</span>
      </div>
      <div class="eylemler">
        <button class="btn-yesil btn-kucuk" data-stok-ekle="${h.id}">+ Stok Gir</button>
        <button class="btn-ikincil btn-kucuk" data-duzenle="${h.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${h.id}">Sil</button>
      </div>
    </div>`;
    })
    .join("");

  listeEl.querySelectorAll("[data-duzenle]").forEach((b) =>
    b.addEventListener("click", () => formGoster(hammaddelerCache.find((h) => h.id === b.dataset.duzenle)))
  );
  listeEl.querySelectorAll("[data-sil]").forEach((b) =>
    b.addEventListener("click", () => silOnayla(b.dataset.sil))
  );
  listeEl.querySelectorAll("[data-stok-ekle]").forEach((b) =>
    b.addEventListener("click", () => stokDuzeltFormGoster(hammaddelerCache.find((h) => h.id === b.dataset.stokEkle)))
  );
}

function renderKritikStok() {
  const kritikler = hammaddelerCache.filter(kritikMi);
  if (kritikler.length === 0) {
    kritikStokEl.innerHTML = `<h3>⚠️ Kritik Stok Uyarıları</h3><div class="bos-durum" style="padding:16px;">Kritik seviyenin altında hammadde yok. 👍</div>`;
    return;
  }
  kritikStokEl.innerHTML = `<h3>⚠️ Kritik Stok Uyarıları (${kritikler.length})</h3>` +
    kritikler.map((h) => `<div class="kritik-satir"><span>${escapeHtml(h.ad)}</span><b style="color:var(--renk-kirmizi)">${h.mevcutStok} ${escapeHtml(h.birim)} (eşik: ${h.kritikEsik ?? 0})</b></div>`).join("");
}

function formGoster(hammadde = null) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${hammadde ? "Hammaddeyi Düzenle" : "Yeni Hammadde"}</h2>
      <form id="hammadde-form">
        <div class="form-alan"><label>Hammadde Adı</label><input name="ad" required value="${hammadde ? escapeHtml(hammadde.ad) : ""}" placeholder="Örn: Dana Eti" /></div>
        <div class="form-satir">
          <div class="form-alan"><label>Birim</label>
            <select name="birim">
              <option value="gram" ${hammadde?.birim === "gram" ? "selected" : ""}>gram</option>
              <option value="ml" ${hammadde?.birim === "ml" ? "selected" : ""}>ml</option>
              <option value="adet" ${hammadde?.birim === "adet" ? "selected" : ""}>adet</option>
            </select>
          </div>
          <div class="form-alan"><label>Mevcut Stok</label><input name="mevcutStok" type="number" step="0.01" min="0" value="${hammadde ? hammadde.mevcutStok : 0}" required /></div>
        </div>
        <div class="form-alan"><label>Kritik Stok Eşiği</label><input name="kritikEsik" type="number" step="0.01" min="0" value="${hammadde ? hammadde.kritikEsik ?? 0 : 0}" /></div>
        <button type="submit" class="btn-birincil btn-tam">${hammadde ? "Kaydet" : "Ekle"}</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#hammadde-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const veri = {
      ad: fd.get("ad").trim(),
      birim: fd.get("birim"),
      mevcutStok: Number(fd.get("mevcutStok")) || 0,
      kritikEsik: Number(fd.get("kritikEsik")) || 0,
    };
    try {
      if (hammadde) {
        await updateDoc(doc(db, "hammaddeler", hammadde.id), { ...veri, guncellemeZamani: serverTimestamp() });
        bildirimGoster("Hammadde güncellendi.", "basari");
      } else {
        await addDoc(collection(db, "hammaddeler"), { ...veri, olusturmaZamani: serverTimestamp() });
        bildirimGoster("Hammadde eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
  });
}

function stokDuzeltFormGoster(hammadde) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;max-width:360px;">
      <button class="modal-kapat">&times;</button>
      <h3>${escapeHtml(hammadde.ad)} — Stok Girişi/Düzeltme</h3>
      <p style="font-size:13px;color:var(--renk-yazi-soluk);">Mevcut: <b>${hammadde.mevcutStok} ${escapeHtml(hammadde.birim)}</b>. Mal geldiğinde pozitif, fire/kayıp için negatif miktar girin.</p>
      <form id="stok-form">
        <div class="form-alan"><label>Miktar (${escapeHtml(hammadde.birim)})</label><input name="miktar" type="number" step="0.01" required placeholder="Örn: 5000 veya -200" /></div>
        <div class="form-alan"><label>Sebep (opsiyonel not)</label><input name="sebep" placeholder="Örn: Yeni mal girişi" /></div>
        <button type="submit" class="btn-birincil btn-tam">Kaydet</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#stok-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const degisim = Number(fd.get("miktar"));
    if (!degisim) return;
    const yeniStok = Math.round(((Number(hammadde.mevcutStok) || 0) + degisim) * 100) / 100;
    if (yeniStok < 0) {
      bildirimGoster("Stok negatif olamaz.", "hata");
      return;
    }
    try {
      await updateDoc(doc(db, "hammaddeler", hammadde.id), { mevcutStok: yeniStok, guncellemeZamani: serverTimestamp() });
      await addDoc(collection(db, "stokHareketleri"), {
        hammaddeId: hammadde.id,
        hammaddeAd: hammadde.ad,
        birim: hammadde.birim,
        degisim,
        eskiStok: hammadde.mevcutStok,
        yeniStok,
        sebep: fd.get("sebep") ? "manuel: " + fd.get("sebep") : "manuel_giris",
        tarih: serverTimestamp(),
      });
      bildirimGoster("Stok güncellendi.", "basari");
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
  });
}

async function silOnayla(id) {
  const h = hammaddelerCache.find((x) => x.id === id);
  if (!confirm(`"${h?.ad}" hammaddesini silmek istediğinize emin misiniz? Bu hammaddeyi kullanan ürünlerin reçetesi etkilenir.`)) return;
  try {
    await deleteDoc(doc(db, "hammaddeler", id));
    bildirimGoster("Hammadde silindi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
