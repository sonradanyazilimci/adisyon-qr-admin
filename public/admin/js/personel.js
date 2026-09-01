import { db, app, auth } from "../../shared/firebase-config.js";
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { bildirimGoster, snapshotHataYakala, escapeHtml } from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

export let personelCache = [];
const dinleyiciler = [];
export function personelDegisti(cb) { dinleyiciler.push(cb); }
function bildir() { dinleyiciler.forEach((cb) => cb(personelCache)); }

const listeEl = document.getElementById("personel-liste");
const ekleButon = document.getElementById("personel-ekle-buton");

const ROL_ETIKET = { admin: "Admin", garson: "Garson", kasa: "Kasa", mutfak: "Mutfak" };

export function baslat() {
  onSnapshot(
    query(collection(db, "kullanicilar")),
    (snap) => {
      personelCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
      bildir();
    },
    snapshotHataYakala("personel")
  );
  subelerDegisti(() => render());
  ekleButon.addEventListener("click", () => formGoster());
}

function subeAdi(id) {
  if (!id) return "Tüm Şubeler";
  return subelerCache.find((s) => s.id === id)?.ad || "—";
}

function render() {
  if (personelCache.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Henüz personel eklenmedi.</div>`;
    return;
  }
  const liste = personelCache.slice().sort((a, b) => (a.ad || "").localeCompare(b.ad || "", "tr"));
  listeEl.innerHTML = liste
    .map(
      (p) => `
    <div class="liste-satir">
      <div class="ana-bilgi">
        <strong>${escapeHtml(p.ad)} ${p.id === auth.currentUser?.uid ? "(Siz)" : ""}</strong>
        <span>${escapeHtml(p.email || "")} · ${escapeHtml(subeAdi(p.subeId))}</span>
      </div>
      <span class="rozet" style="background:${p.rol === "admin" ? "#8e44ad" : p.rol === "kasa" ? "#2980b9" : p.rol === "mutfak" ? "#16a085" : "#d35400"}">${ROL_ETIKET[p.rol] || p.rol}</span>
      <span class="rozet" style="background:${p.aktif === false ? "#7f8c8d" : "#27ae60"}">${p.aktif === false ? "Pasif" : "Aktif"}</span>
      <div class="eylemler">
        <button class="btn-ikincil btn-kucuk" data-duzenle="${p.id}">Düzenle</button>
        <button class="btn-kirmizi btn-kucuk" data-sil="${p.id}" ${p.id === auth.currentUser?.uid ? "disabled" : ""}>Sil</button>
      </div>
    </div>`
    )
    .join("");

  listeEl.querySelectorAll("[data-duzenle]").forEach((b) => b.addEventListener("click", () => formGoster(personelCache.find((p) => p.id === b.dataset.duzenle))));
  listeEl.querySelectorAll("[data-sil]").forEach((b) => b.addEventListener("click", () => silOnayla(b.dataset.sil)));
}

function formGoster(personelDoc = null) {
  const katman = document.createElement("div");
  katman.className = "modal-katman";
  const subeSecenekleri = subelerCache.map((s) => `<option value="${s.id}" ${personelDoc?.subeId === s.id ? "selected" : ""}>${escapeHtml(s.ad)}</option>`).join("");

  katman.innerHTML = `
    <div class="modal-kutu" style="position:relative;">
      <button class="modal-kapat">&times;</button>
      <h2>${personelDoc ? "Personeli Düzenle" : "Yeni Personel"}</h2>
      <form id="personel-form">
        <div class="form-alan"><label>Ad Soyad</label><input name="ad" required value="${personelDoc ? escapeHtml(personelDoc.ad) : ""}" /></div>
        <div class="form-alan"><label>E-posta</label><input name="email" type="email" required ${personelDoc ? "disabled" : ""} value="${personelDoc ? escapeHtml(personelDoc.email) : ""}" /></div>
        ${!personelDoc ? `<div class="form-alan"><label>Şifre</label><input name="password" type="password" minlength="6" required /></div>` : ""}
        <div class="form-satir">
          <div class="form-alan"><label>Rol</label>
            <select name="rol" id="personel-rol-select">
              <option value="garson" ${personelDoc?.rol === "garson" ? "selected" : ""}>Garson</option>
              <option value="kasa" ${personelDoc?.rol === "kasa" ? "selected" : ""}>Kasa</option>
              <option value="mutfak" ${personelDoc?.rol === "mutfak" ? "selected" : ""}>Mutfak</option>
              <option value="admin" ${personelDoc?.rol === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </div>
          <div class="form-alan" id="personel-sube-alani"><label>Şube</label><select name="subeId"><option value="">Seçiniz...</option>${subeSecenekleri}</select></div>
        </div>
        ${personelDoc ? `<div class="form-alan"><label><input type="checkbox" name="aktif" style="width:auto;" ${personelDoc.aktif !== false ? "checked" : ""}/> Aktif (girişe izinli)</label></div>` : ""}
        <button type="submit" class="btn-birincil btn-tam">${personelDoc ? "Kaydet" : "Ekle"}</button>
      </form>
      ${!personelDoc ? `<p style="font-size:12px;color:var(--renk-yazi-soluk);margin-top:10px;">Not: Bu işlem yeni bir Firebase Authentication hesabı oluşturur; kendi oturumunuz etkilenmez.</p>` : ""}
    </div>`;
  document.body.appendChild(katman);
  katman.querySelector(".modal-kapat").addEventListener("click", () => katman.remove());
  katman.addEventListener("click", (e) => { if (e.target === katman) katman.remove(); });

  const rolSelect = katman.querySelector("#personel-rol-select");
  const subeAlani = katman.querySelector("#personel-sube-alani");
  function subeAlaniniGuncelle() {
    subeAlani.style.display = rolSelect.value === "admin" ? "none" : "block";
  }
  rolSelect.addEventListener("change", subeAlaniniGuncelle);
  subeAlaniniGuncelle();

  katman.querySelector("#personel-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const gonderButon = e.target.querySelector('button[type="submit"]');
    gonderButon.disabled = true;
    const fd = new FormData(e.target);
    const rol = fd.get("rol");
    const subeId = rol === "admin" ? null : fd.get("subeId") || null;
    try {
      if (personelDoc) {
        await updateDoc(doc(db, "kullanicilar", personelDoc.id), {
          ad: fd.get("ad").trim(),
          rol,
          subeId,
          aktif: fd.get("aktif") === "on",
        });
        bildirimGoster("Personel güncellendi.", "basari");
      } else {
        await personelOlustur({
          ad: fd.get("ad").trim(),
          email: fd.get("email").trim(),
          password: fd.get("password"),
          rol,
          subeId,
        });
        bildirimGoster("Personel eklendi.", "basari");
      }
      katman.remove();
    } catch (err) {
      bildirimGoster("Hata: " + err.message, "hata");
      gonderButon.disabled = false;
    }
  });
}

// Blaze planı / Cloud Functions olmadan yeni bir Firebase Authentication
// hesabı oluşturmanın yolu: GEÇİCİ, İKİNCİL bir Firebase App örneği açıp
// kullanıcıyı orada oluşturmak — böylece admin'in mevcut oturumu (birincil
// app) etkilenmez/değişmez. Ardından profil bilgisi normal (birincil)
// bağlantı üzerinden Firestore'a yazılır.
async function personelOlustur({ ad, email, password, rol, subeId }) {
  const ikincilApp = initializeApp(app.options, "personel-olustur-" + Date.now());
  try {
    const ikincilAuth = getAuth(ikincilApp);
    const sonuc = await createUserWithEmailAndPassword(ikincilAuth, email, password);
    const uid = sonuc.user.uid;
    await signOut(ikincilAuth).catch(() => {});

    await setDoc(doc(db, "kullanicilar", uid), {
      ad,
      email,
      rol,
      subeId,
      aktif: true,
      olusturmaZamani: serverTimestamp(),
    });
  } finally {
    await deleteApp(ikincilApp).catch(() => {});
  }
}

async function silOnayla(uid) {
  const p = personelCache.find((x) => x.id === uid);
  if (!confirm(`"${p?.ad}" personelinin profilini silmek istediğinize emin misiniz?\n\nNot: Bu işlem kişinin sisteme erişimini keser, ancak Blaze planı olmadan Firebase Authentication hesabının kendisi silinemez (isterseniz Firebase Console'dan manuel silebilirsiniz).`)) return;
  try {
    await deleteDoc(doc(db, "kullanicilar", uid));
    bildirimGoster("Personel profili silindi, sisteme erişimi kesildi.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
