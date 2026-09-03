import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml, masaQrUrl, MASA_DURUMLARI } from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";
import { personelCache, personelDegisti } from "./personel.js";

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
  personelDegisti(() => render());
  ekleButon.addEventListener("click", () => formGoster());
  subeFiltreEl.addEventListener("change", (e) => { subeFiltre = e.target.value; render(); if (planAcik) planCiz(); });

  document.getElementById("masa-plan-buton").addEventListener("click", planAcKapa);
  document.getElementById("masa-plan-sifirla").addEventListener("click", planSifirla);
}

// ── Masa planı (salon yerleşimi) düzenleyici ──────────────────────────────
let planAcik = false;

function planAcKapa() {
  planAcik = !planAcik;
  document.getElementById("masa-plan-editor").hidden = !planAcik;
  document.getElementById("masa-plan-buton").textContent = planAcik ? "✕ Planı Kapat" : "📐 Masa Planı";
  if (planAcik) planCiz();
}

function planMasalari() {
  return masalarCache
    .filter((m) => !subeFiltre || m.subeId === subeFiltre)
    .slice()
    .sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr", { numeric: true }));
}

function planCiz() {
  const alan = document.getElementById("masa-plan-alani");
  const liste = planMasalari();
  if (liste.length === 0) {
    alan.innerHTML = `<div class="bos-durum" style="padding:20px;">Bu şubede masa yok.</div>`;
    return;
  }
  // Konumu olmayan masalar sol üstte ızgara halinde dizilir (oradan sürüklenir).
  let yerlesmemisSayaci = 0;
  alan.innerHTML = liste.map((m) => {
    const konumlu = typeof m.planX === "number" && typeof m.planY === "number";
    let x = m.planX;
    let y = m.planY;
    if (!konumlu) {
      x = 3 + (yerlesmemisSayaci % 6) * 9;
      y = 3 + Math.floor(yerlesmemisSayaci / 6) * 14;
      yerlesmemisSayaci++;
    }
    return `<div class="masa-plan-cip ${konumlu ? "" : "yerlesmemis"}" data-masa="${m.id}" style="left:${x}%;top:${y}%;">${escapeHtml(m.ad)}</div>`;
  }).join("");

  alan.querySelectorAll(".masa-plan-cip").forEach((cip) => surukleBagla(cip, alan));
}

function surukleBagla(cip, alan) {
  let surukluyor = false;
  let bkX = 0;
  let bkY = 0;

  cip.addEventListener("pointerdown", (e) => {
    surukluyor = true;
    cip.setPointerCapture(e.pointerId);
    cip.classList.add("suruklenen");
    const r = cip.getBoundingClientRect();
    bkX = e.clientX - r.left;
    bkY = e.clientY - r.top;
  });

  cip.addEventListener("pointermove", (e) => {
    if (!surukluyor) return;
    const ar = alan.getBoundingClientRect();
    let x = ((e.clientX - bkX - ar.left) / ar.width) * 100;
    let y = ((e.clientY - bkY - ar.top) / ar.height) * 100;
    x = Math.max(0, Math.min(92, x));
    y = Math.max(0, Math.min(90, y));
    cip.style.left = `${x}%`;
    cip.style.top = `${y}%`;
    cip._sonX = x;
    cip._sonY = y;
  });

  cip.addEventListener("pointerup", async (e) => {
    if (!surukluyor) return;
    surukluyor = false;
    cip.releasePointerCapture(e.pointerId);
    cip.classList.remove("suruklenen");
    cip.classList.remove("yerlesmemis");
    const x = Math.round((cip._sonX ?? parseFloat(cip.style.left)) * 10) / 10;
    const y = Math.round((cip._sonY ?? parseFloat(cip.style.top)) * 10) / 10;
    try {
      await updateDoc(doc(db, "masalar", cip.dataset.masa), { planX: x, planY: y });
    } catch (err) {
      bildirimGoster("Konum kaydedilemedi: " + err.message, "hata");
    }
  });
}

async function planSifirla() {
  const liste = planMasalari().filter((m) => typeof m.planX === "number");
  if (liste.length === 0) { bildirimGoster("Sıfırlanacak yerleşim yok.", "uyari"); return; }
  if (!confirm(`${liste.length} masanın plan konumu silinecek. Emin misiniz?`)) return;
  try {
    await Promise.all(liste.map((m) => updateDoc(doc(db, "masalar", m.id), { planX: null, planY: null })));
    bildirimGoster("Yerleşim sıfırlandı.", "basari");
    planCiz();
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
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

function garsonAdi(id) {
  if (!id) return null;
  return personelCache.find((p) => p.id === id)?.ad || null;
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
      <div style="font-size:11px;color:var(--renk-yazi-soluk);">👤 ${garsonAdi(m.sorumluGarsonId) ? escapeHtml(garsonAdi(m.sorumluGarsonId)) : "Sorumlu atanmadı"}</div>
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

  // Plan düzenleyici açıksa ve şu an bir çip sürüklenmiyorsa tazele.
  if (planAcik && !document.querySelector(".masa-plan-cip.suruklenen")) planCiz();
}

function formGoster(masa = null) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  const subeSecenekleri = subelerCache.map((s) => `<option value="${s.id}" ${masa?.subeId === s.id ? "selected" : ""}>${escapeHtml(s.ad)}</option>`).join("");
  const garsonlar = personelCache.filter((p) => p.rol === "garson" && (!masa?.subeId || p.subeId === masa.subeId));
  const garsonSecenekleri = garsonlar.map((p) => `<option value="${p.id}" ${masa?.sorumluGarsonId === p.id ? "selected" : ""}>${escapeHtml(p.ad)}</option>`).join("");
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${masa ? "Masayı Düzenle" : "Yeni Masa"}</h2>
      <form id="masa-form">
        <div class="form-alan"><label>Şube</label><select name="subeId" required><option value="">Seçiniz...</option>${subeSecenekleri}</select></div>
        <div class="form-alan"><label>Masa Adı / Numarası</label><input name="ad" required value="${masa ? escapeHtml(masa.ad) : ""}" placeholder="Örn: Masa 5, Bahçe 2" /></div>
        <div class="form-alan">
          <label>Sorumlu Garson (opsiyonel)</label>
          <select name="sorumluGarsonId">
            <option value="">Atanmadı</option>
            ${garsonSecenekleri}
          </select>
        </div>
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
    const sorumluId = fd.get("sorumluGarsonId") || null;
    const veri = {
      ad: fd.get("ad").trim(),
      subeId: fd.get("subeId"),
      sorumluGarsonId: sorumluId,
      sorumluGarsonAdi: sorumluId ? (personelCache.find((p) => p.id === sorumluId)?.ad || null) : null,
    };
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
