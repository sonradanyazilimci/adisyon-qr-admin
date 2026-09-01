import { auth, db } from "../shared/firebase-config.js";
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { girisYap, oturumBilgisiAl, ROL_ANASAYFA } from "../shared/auth.js";

const hataKutusu = document.getElementById("hata-mesaji");
const basariKutusu = document.getElementById("basari-mesaji");
const girisFormu = document.getElementById("giris-formu");
const kurulumFormu = document.getElementById("kurulum-formu");
const kurulumLinki = document.getElementById("kurulum-linki");
const girisLinki = document.getElementById("giris-linki");

function mesajGizle() {
  hataKutusu.style.display = "none";
  basariKutusu.style.display = "none";
}
function hataGoster(msg) {
  basariKutusu.style.display = "none";
  hataKutusu.textContent = msg;
  hataKutusu.style.display = "block";
}
function basariGoster(msg) {
  hataKutusu.style.display = "none";
  basariKutusu.textContent = msg;
  basariKutusu.style.display = "block";
}

kurulumLinki.addEventListener("click", () => {
  girisFormu.style.display = "none";
  kurulumFormu.style.display = "block";
  kurulumLinki.style.display = "none";
  girisLinki.style.display = "inline";
  mesajGizle();
});
girisLinki.addEventListener("click", () => {
  girisFormu.style.display = "block";
  kurulumFormu.style.display = "none";
  kurulumLinki.style.display = "inline";
  girisLinki.style.display = "none";
  mesajGizle();
});

function donusAdresi() {
  const params = new URLSearchParams(window.location.search);
  return params.get("donus");
}

girisFormu.addEventListener("submit", async (e) => {
  e.preventDefault();
  mesajGizle();
  const buton = document.getElementById("giris-buton");
  buton.disabled = true;
  try {
    const email = document.getElementById("giris-email").value.trim();
    const sifre = document.getElementById("giris-sifre").value;
    await girisYap(email, sifre);
    const { rol } = await oturumBilgisiAl();
    if (!rol) {
      hataGoster("Bu hesaba henüz bir rol atanmamış veya hesap pasif. Yöneticinizle iletişime geçin.");
      buton.disabled = false;
      return;
    }
    window.location.href = donusAdresi() || ROL_ANASAYFA[rol] || "/login/";
  } catch (err) {
    console.error(err);
    hataGoster("Giriş başarısız: e-posta veya şifre hatalı.");
    buton.disabled = false;
  }
});

// İlk kurulum: Blaze planı / Cloud Functions gerektirmeden, tamamen
// client + Firestore güvenlik kuralları ile çalışır. Sistemde henüz hiç
// admin yokken bu form çağrılan İLK ve TEK seferdir (bkz. firestore.rules
// içindeki "ayarlar/ilkAdmin" tek kullanımlık işaretçisi).
kurulumFormu.addEventListener("submit", async (e) => {
  e.preventDefault();
  mesajGizle();
  const buton = document.getElementById("kurulum-buton");
  buton.disabled = true;
  try {
    const ad = document.getElementById("kurulum-ad").value.trim();
    const email = document.getElementById("kurulum-email").value.trim();
    const sifre = document.getElementById("kurulum-sifre").value;

    const kimlik = await createUserWithEmailAndPassword(auth, email, sifre);
    await updateProfile(kimlik.user, { displayName: ad }).catch(() => {});

    const batch = writeBatch(db);
    batch.set(doc(db, "kullanicilar", kimlik.user.uid), {
      ad,
      email,
      rol: "admin",
      subeId: null,
      aktif: true,
      olusturmaZamani: serverTimestamp(),
    });
    batch.set(doc(db, "ayarlar", "ilkAdmin"), {
      olusturulduUid: kimlik.user.uid,
      tarih: serverTimestamp(),
    });
    await batch.commit();

    basariGoster("Admin hesabı oluşturuldu! Admin paneline yönlendiriliyorsunuz...");
    setTimeout(() => (window.location.href = "/admin/"), 1200);
  } catch (err) {
    console.error(err);
    if (err.code === "auth/email-already-in-use") {
      hataGoster("Bu e-posta zaten kayıtlı. Giriş ekranını kullanın.");
    } else if (err.code === "permission-denied") {
      hataGoster("Sistemde zaten bir admin var. Lütfen giriş yapın.");
    } else {
      hataGoster("Kurulum başarısız: " + err.message);
    }
    buton.disabled = false;
  }
});
