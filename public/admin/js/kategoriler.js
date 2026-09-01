import { db } from "../../shared/firebase-config.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml, kategorilerSirali } from "../../shared/utils.js";

export let kategorilerCache = [];
const dinleyiciler = [];
export function kategorilerDegisti(cb) { dinleyiciler.push(cb); }
function bildir() { dinleyiciler.forEach((cb) => cb(kategorilerCache)); }

const listeEl = document.getElementById("kategoriler-liste");
const ekleButon = document.getElementById("kategori-ekle-buton");

export function baslat() {
  // sira'ya göre client-side sıralıyoruz (kategorilerSirali), bu yüzden
  // burada sadece koleksiyonu dinlemek yeterli.
  onSnapshot(
    query(collection(db, "kategoriler")),
    (snap) => {
      kategorilerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      bildir();
    },
    snapshotHataYakala("kategoriler")
  );

  ekleButon.addEventListener("click", () => formGoster());
}

function render() {
  if (kategorilerCache.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Henüz kategori eklenmedi.</div>`;
    return;
  }
  const sirali = kategorilerSirali(kategorilerCache);
  listeEl.innerHTML = sirali
    .map(
      (k) => `
    <div class="liste-satir" style="${k.derinlik ? "margin-left:28px;background:#fafbfc;" : ""}">
      <div class="ana-bilgi">
        <strong>${k.derinlik ? "↳ " : ""}${escapeHtml(k.ad)}</strong>
        <span>Sıra: ${k.sira ?? 0}${k.derinlik ? " · Alt kategori" : ""}</span>
      </div>
      <div class="eylemler">
        ${!k.derinlik ? `<button class="btn-ikincil btn-kucuk" data-alt-ekle="${k.id}">+ Alt Kategori</button>` : ""}
        <button class="btn-ikincil btn-kucuk" data-duzenle="${k.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${k.id}">Sil</button>
      </div>
    </div>`
    )
    .join("");

  listeEl.querySelectorAll("[data-duzenle]").forEach((b) =>
    b.addEventListener("click", () => formGoster(kategorilerCache.find((k) => k.id === b.dataset.duzenle)))
  );
  listeEl.querySelectorAll("[data-sil]").forEach((b) =>
    b.addEventListener("click", () => silOnayla(b.dataset.sil))
  );
  listeEl.querySelectorAll("[data-alt-ekle]").forEach((b) =>
    b.addEventListener("click", () => formGoster(null, b.dataset.altEkle))
  );
}

function formGoster(kategori = null, varsayilanUstId = "") {
  const katman = document.createElement("div");
  katman.className = "modal-katman";

  // Üst kategori seçilebilir sadece ANA kategoriler (kendisi ve alt kategoriler hariç —
  // 2 seviyeli hiyerarşi: bir alt kategori başka bir kategorinin üstü olamaz).
  const anaKategoriSecenekleri = kategorilerCache
    .filter((k) => !k.ustKategoriId && k.id !== kategori?.id)
    .sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0))
    .map((k) => `<option value="${k.id}" ${(kategori?.ustKategoriId || varsayilanUstId) === k.id ? "selected" : ""}>${escapeHtml(k.ad)}</option>`)
    .join("");

  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${kategori ? "Kategoriyi Düzenle" : varsayilanUstId ? "Yeni Alt Kategori" : "Yeni Kategori"}</h2>
      <form id="kategori-form">
        <div class="form-alan"><label>Kategori Adı</label><input name="ad" required value="${kategori ? escapeHtml(kategori.ad) : ""}" placeholder="Örn: İskenderler" /></div>
        <div class="form-alan">
          <label>Üst Kategori (opsiyonel)</label>
          <select name="ustKategoriId">
            <option value="">— Yok (ana kategori) —</option>
            ${anaKategoriSecenekleri}
          </select>
        </div>
        <div class="form-alan"><label>Sıra (menüde gösterim sırası)</label><input name="sira" type="number" value="${kategori ? kategori.sira ?? 0 : kategorilerCache.length}" /></div>
        <button type="submit" class="btn-birincil btn-tam">${kategori ? "Kaydet" : "Ekle"}</button>
      </form>
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  katman.querySelector("#kategori-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const veri = {
      ad: fd.get("ad").trim(),
      sira: Number(fd.get("sira")) || 0,
      ustKategoriId: fd.get("ustKategoriId") || null,
    };
    try {
      if (kategori) {
        await updateDoc(doc(db, "kategoriler", kategori.id), veri);
        bildirimGoster("Kategori güncellendi.", "basari");
      } else {
        await addDoc(collection(db, "kategoriler"), { ...veri, olusturmaZamani: serverTimestamp() });
        bildirimGoster(varsayilanUstId ? "Alt kategori eklendi." : "Kategori eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
    }
  });
}

async function silOnayla(id) {
  const k = kategorilerCache.find((x) => x.id === id);
  const altKategoriSayisi = kategorilerCache.filter((x) => x.ustKategoriId === id).length;
  const uyari = altKategoriSayisi > 0
    ? `\n\nDİKKAT: Bu kategorinin ${altKategoriSayisi} alt kategorisi var, onlar silinmeyecek ama üst kategorisiz kalacak.`
    : "";
  if (!confirm(`"${k?.ad}" kategorisini silmek istediğinize emin misiniz? Bu kategorideki ürünler etkilenmez ama kategorisiz kalır.${uyari}`)) return;
  try {
    await deleteDoc(doc(db, "kategoriler", id));
    bildirimGoster("Kategori silindi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
