import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml } from "../../shared/utils.js";

export let subelerCache = [];
const dinleyiciler = [];
export function subelerDegisti(cb) { dinleyiciler.push(cb); }
function bildir() { dinleyiciler.forEach((cb) => cb(subelerCache)); }

const listeEl = document.getElementById("subeler-liste");
const ekleButon = document.getElementById("sube-ekle-buton");

export function baslat() {
  const q = query(collection(db, "subeler"), orderBy("sira", "asc"));
  onSnapshot(
    q,
    (snap) => {
      subelerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      bildir();
    },
    snapshotHataYakala("subeler")
  );

  ekleButon.addEventListener("click", () => formGoster());
}

function render() {
  if (subelerCache.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Henüz şube eklenmedi. Tek şubeli çalışıyorsanız bile en az bir şube eklemeniz, masa/personel/sipariş verilerinin şubeye bağlanması için gereklidir.</div>`;
    return;
  }
  listeEl.innerHTML = subelerCache
    .map(
      (s) => `
    <div class="liste-satir">
      <div class="ana-bilgi">
        <strong>${escapeHtml(s.ad)}</strong>
        <span>${escapeHtml(s.adres || "adres girilmemiş")} ${s.telefon ? "· " + escapeHtml(s.telefon) : ""}</span>
      </div>
      <span class="rozet" style="background:${s.aktif === false ? "#7f8c8d" : "#27ae60"}">${s.aktif === false ? "Pasif" : "Aktif"}</span>
      <div class="eylemler">
        <button class="btn-ikincil btn-kucuk" data-duzenle="${s.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${s.id}">Sil</button>
      </div>
    </div>`
    )
    .join("");

  listeEl.querySelectorAll("[data-duzenle]").forEach((b) =>
    b.addEventListener("click", () => formGoster(subelerCache.find((s) => s.id === b.dataset.duzenle)))
  );
  listeEl.querySelectorAll("[data-sil]").forEach((b) =>
    b.addEventListener("click", () => silOnayla(b.dataset.sil))
  );
}

function formGoster(sube = null) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${sube ? "Şubeyi Düzenle" : "Yeni Şube"}</h2>
      <form id="sube-form">
        <div class="form-alan"><label>Şube Adı</label><input name="ad" required value="${sube ? escapeHtml(sube.ad) : ""}" placeholder="Örn: Bornova Şubesi" /></div>
        <div class="form-alan"><label>Adres</label><input name="adres" value="${sube ? escapeHtml(sube.adres || "") : ""}" /></div>
        <div class="form-alan"><label>Telefon</label><input name="telefon" value="${sube ? escapeHtml(sube.telefon || "") : ""}" /></div>
        <div class="form-alan"><label>Sıra</label><input name="sira" type="number" value="${sube ? sube.sira ?? 0 : subelerCache.length}" /></div>
        <div class="form-alan"><label><input type="checkbox" name="aktif" style="width:auto;" ${!sube || sube.aktif !== false ? "checked" : ""}/> Aktif</label></div>
        <hr style="border:none;border-top:1px solid var(--renk-kenar);margin:14px 0;">
        <p style="font-weight:700;font-size:13px;margin:0 0 8px;">💳 QR Menü Ödeme Bilgileri (opsiyonel)</p>
        <div class="form-alan"><label>Ödeme Linki (iyzico/PayTR/Param linki)</label><input name="odemeLinki" value="${sube ? escapeHtml(sube.odemeLinki || "") : ""}" placeholder="https://..." /></div>
        <div class="form-satir">
          <div class="form-alan"><label>IBAN</label><input name="iban" value="${sube ? escapeHtml(sube.iban || "") : ""}" placeholder="TR.. .. .. .." /></div>
          <div class="form-alan"><label>IBAN Hesap Adı</label><input name="ibanAdi" value="${sube ? escapeHtml(sube.ibanAdi || "") : ""}" placeholder="Firma / kişi adı" /></div>
        </div>
        <small style="color:var(--renk-yazi-soluk);">QR menüde "💳 Öde" butonuyla müşteriye gösterilir. Link varsa açılır; yoksa IBAN + tutar kopyalanabilir. Müşteri "Ödedim" derse kasaya bildirim düşer.</small>
        <button type="submit" class="btn-birincil btn-tam" style="margin-top:14px;">${sube ? "Kaydet" : "Ekle"}</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#sube-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const veri = {
      ad: fd.get("ad").trim(),
      adres: fd.get("adres").trim(),
      telefon: fd.get("telefon").trim(),
      sira: Number(fd.get("sira")) || 0,
      aktif: fd.get("aktif") === "on",
      // Vardiya kilidi özelliği devre dışı — her kayıtta false'a çekilir.
      vardiyaKilidiAktif: false,
      odemeLinki: fd.get("odemeLinki").trim(),
      iban: fd.get("iban").trim(),
      ibanAdi: fd.get("ibanAdi").trim(),
    };
    try {
      if (sube) {
        await updateDoc(doc(db, "subeler", sube.id), veri);
        bildirimGoster("Şube güncellendi.", "basari");
      } else {
        await addDoc(collection(db, "subeler"), { ...veri, olusturmaZamani: serverTimestamp() });
        bildirimGoster("Şube eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
  });
}

async function silOnayla(id) {
  const sube = subelerCache.find((s) => s.id === id);
  if (!confirm(`"${sube?.ad}" şubesini silmek istediğinize emin misiniz? Bu şubeye bağlı masalar/personel etkilenebilir.`)) return;
  try {
    await deleteDoc(doc(db, "subeler", id));
    bildirimGoster("Şube silindi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
