// ─────────────────────────────────────────────────────────────────────────
// Ortak kimlik doğrulama / rol koruma yardımcıları
//
// NOT: Cloud Functions (Blaze planı) kullanılmadığı için roller custom
// claim yerine doğrudan `kullanicilar/{uid}` Firestore belgesinden okunur.
// ─────────────────────────────────────────────────────────────────────────
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const ROL_ANASAYFA = {
  admin: "/admin/",
  garson: "/garson/",
  kasa: "/adisyon/",
  mutfak: "/mutfak/",
};

export async function girisYap(email, sifre) {
  const sonuc = await signInWithEmailAndPassword(auth, email, sifre);
  return sonuc.user;
}

export async function cikisYap() {
  await signOut(auth);
  window.location.href = "/login/";
}

// Auth durumu netleşene kadar bekler, ardından kullanicilar/{uid}
// belgesinden { user, rol, subeId, ad } döner. Giriş yapılmamışsa veya
// profil pasif/atanmamışsa rol = null.
export function oturumBilgisiAl() {
  return new Promise((resolve, reject) => {
    const kaldir = onAuthStateChanged(
      auth,
      async (user) => {
        kaldir();
        if (!user) {
          resolve({ user: null, rol: null, subeId: null, ad: null });
          return;
        }
        try {
          const snap = await getDoc(doc(db, "kullanicilar", user.uid));
          if (!snap.exists() || snap.data().aktif === false) {
            resolve({ user, rol: null, subeId: null, ad: null });
            return;
          }
          const veri = snap.data();
          resolve({ user, rol: veri.rol || null, subeId: veri.subeId ?? null, ad: veri.ad || user.email });
        } catch (err) {
          reject(err);
        }
      },
      reject
    );
  });
}

// Sayfayı belirli rollerle korur. İzinli değilse uygun sayfaya yönlendirir.
// Kullanım: const {user, rol, subeId, ad} = await sayfaKorumaBaslat(['admin']);
export async function sayfaKorumaBaslat(izinliRoller) {
  const { user, rol, subeId, ad } = await oturumBilgisiAl();
  if (!user || !rol) {
    window.location.href = "/login/?donus=" + encodeURIComponent(window.location.pathname);
    return new Promise(() => {}); // yönlendirme sırasında sayfa akışını durdur
  }
  if (!izinliRoller.includes(rol)) {
    window.location.href = ROL_ANASAYFA[rol] || "/login/";
    return new Promise(() => {});
  }
  return { user, rol, subeId, ad };
}
