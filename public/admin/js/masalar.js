import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml, masaQrUrl, MASA_DURUMLARI } from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

export let masalarCache = [];

const listeEl = document.getElementById("masalar-liste");
const ekleButon = document.getElementById("masa-ekle-buton");
const subeFiltreEl = document.getElementById("masa-sube-filtre");

let subeFiltre = "";

export function baslat() {
  onSnapshot(
    query(collection(db, "masalar")),
    (snap) => {
      masalarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("masalar")
  );

  subelerDegisti(() => { renderSubeFiltre(); render(); });
  ekleButon.addEventListener("click", () => formGoster());
  subeFiltreEl.addEventListener("change", (e) => { subeFiltre = e.target.value; render(); });
}

function renderSubeFiltre() {
  const secili = subeFiltreEl.value;
  subeFiltreEl.innerHTML = `<option value="">Tüm Şubeler</option>` +
    subelerCache.map((s) => `<option value="${s.id}">${escapeHtml(s.ad)}</option>`).join("");
  subeFiltreEl.value = secili;
}

function subeAdi(id) {
  return subelerCache.find((s) => s.id === id)?.ad || "Şubesiz";
}

function render() {
  let liste = masalarCache;
  if (subeFiltre) liste = liste.filter((m) => m.subeId === subeFiltre);
  liste = liste.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr", { numeric: true }));

  if (liste.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Masa bulunamadı. Önce bir şube ekleyip ardından masa oluşturun.</div>`;
    return;
  }

  listeEl.innerHTML = liste
    .map((m) => {
      const durum = MASA_DURUMLARI[m.durum] || MASA_DURUMLARI.bos;
      return `
    <div class="masa-karti">
      <strong>${escapeHtml(m.ad)}</strong>
      <div style="font-size:11px;color:var(--renk-yazi-soluk);">${escapeHtml(subeAdi(m.subeId))}</div>
      <div class="durum-rozet"><span class="rozet" style="background:${durum.renk}">${durum.etiket}</span></div>
      ${m.garsonCagirildi ? `<div style="color:var(--renk-kirmizi);font-size:12px;font-weight:700;margin-bottom:8px;">🔔 Garson çağırdı</div>` : ""}
      <div class="eylemler">
        <button class="btn-birincil btn-kucuk" data-qr="${m.id}">QR Kod</button>
        <button class="btn-ikincil btn-kucuk" data-duzenle="${m.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${m.id}">Sil</button>
      </div>
    </div>`;
    })
    .join("");

  listeEl.querySelectorAll("[data-qr]").forEach((b) => b.addEventListener("click", () => qrGoster(masalarCache.find((m) => m.id === b.dataset.qr))));
  listeEl.querySelectorAll("[data-duzenle]").forEach((b) => b.addEventListener("click", () => formGoster(masalarCache.find((m) => m.id === b.dataset.duzenle))));
  listeEl.querySelectorAll("[data-sil]").forEach((b) => b.addEventListener("click", () => silOnayla(b.dataset.sil)));
}

function formGoster(masa = null) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  const subeSecenekleri = subelerCache.map((s) => `<option value="${s.id}" ${masa?.subeId === s.id ? "selected" : ""}>${escapeHtml(s.ad)}</option>`).join("");
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${masa ? "Masayı Düzenle" : "Yeni Masa"}</h2>
      <form id="masa-form">
        <div class="form-alan"><label>Şube</label><select name="subeId" required><option value="">Seçiniz...</option>${subeSecenekleri}</select></div>
        <div class="form-alan"><label>Masa Adı / Numarası</label><input name="ad" required value="${masa ? escapeHtml(masa.ad) : ""}" placeholder="Örn: Masa 5, Bahçe 2" /></div>
        ${masa ? `<div class="form-alan"><label>Durum</label>
          <select name="durum">
            <option value="bos" ${masa.durum === "bos" ? "selected" : ""}>Boş</option>
            <option value="dolu" ${masa.durum === "dolu" ? "selected" : ""}>Dolu</option>
            <option value="odeme_bekliyor" ${masa.durum === "odeme_bekliyor" ? "selected" : ""}>Ödeme Bekliyor</option>
          </select></div>` : ""}
        <button type="submit" class="btn-birincil btn-tam">${masa ? "Kaydet" : "Ekle"}</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#masa-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const veri = { ad: fd.get("ad").trim(), subeId: fd.get("subeId") };
    if (masa) veri.durum = fd.get("durum");
    try {
      if (masa) {
        await updateDoc(doc(db, "masalar", masa.id), veri);
        bildirimGoster("Masa güncellendi.", "basari");
      } else {
        await addDoc(collection(db, "masalar"), { ...veri, durum: "bos", garsonCagirildi: false, olusturmaZamani: serverTimestamp() });
        bildirimGoster("Masa eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
  });
}

function qrGoster(masa) {
  const { hedefUrl, qrGorselUrl } = masaQrUrl(masa.id, masa.subeId);
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;text-align:center;max-width:360px;">
      <button class="modal-kapat">&times;</button>
      <h3>${escapeHtml(masa.ad)} — QR Kod</h3>
      <div id="yazdirilacak-qr" class="yazdirilacak">
        <h2 style="margin:0 0 6px;">${escapeHtml(subeAdi(masa.subeId))}</h2>
        <h3 style="margin:0 0 14px;">${escapeHtml(masa.ad)}</h3>
        <img src="${qrGorselUrl}" alt="QR" style="width:220px;height:220px;" />
        <p style="font-size:12px;word-break:break-all;color:var(--renk-yazi-soluk);">${hedefUrl}</p>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn-ikincil btn-tam" id="qr-kopyala">Linki Kopyala</button>
        <button class="btn-birincil btn-tam" id="qr-yazdir">Yazdır</button>
      </div>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });
  katman.querySelector("#qr-kopyala").addEventListener("click", () => {
    navigator.clipboard.writeText(hedefUrl).then(() => bildirimGoster("Link kopyalandı.", "basari"));
  });
  katman.querySelector("#qr-yazdir").addEventListener("click", () => window.print());
}

async function silOnayla(id) {
  const m = masalarCache.find((x) => x.id === id);
  if (!confirm(`"${m?.ad}" masasını silmek istediğinize emin misiniz?`)) return;
  try {
    await deleteDoc(doc(db, "masalar", id));
    bildirimGoster("Masa silindi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
