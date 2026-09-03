// ─────────────────────────────────────────────────────────────────────────
// Firebase yapılandırması — TEK KAYNAK (single source of truth)
// Tüm arayüzler (admin, menu, garson, adisyon) bu dosyayı import eder.
//
// AŞAĞIDAKİ DEĞERLERİ KENDİ FIREBASE PROJENİZİN DEĞERLERİYLE DEĞİŞTİRİN:
// Firebase Console → Proje Ayarları → Genel → "Web uygulamanız" → SDK config
//
// NOT: Bu proje Blaze planı OLMADAN (Cloud Functions / Storage kullanmadan)
// çalışacak şekilde kuruludur. Roller ve sipariş/stok işlemleri tamamen
// client + Firestore güvenlik kuralları ile yürütülür (bkz. auth.js, siparis.js,
// firestore.rules). Ürün görselleri de Storage yerine doğrudan URL ile eklenir.
// ─────────────────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7emskQ_4lwAvODyzLzjrwHVuz8_9fEEc",
  authDomain: "adisyon-admin-qr.firebaseapp.com",
  projectId: "adisyon-admin-qr",
  storageBucket: "adisyon-admin-qr.firebasestorage.app",
  messagingSenderId: "630920442936",
  appId: "1:630920442936:web:99e697292229c7a4e0a2cd",
};

export const app = initializeApp(firebaseConfig);

// Firestore OFFLINE kalıcı önbellek: bağlantı koptuğunda okumalar önbellekten
// sürer, yapılan yazılar (addDoc/updateDoc) IndexedDB'de kuyruğa alınır ve
// bağlantı gelince OTOMATİK gönderilir.
//
// ÖNEMLİ: Kalıcı önbellek yalnızca OPT-IN. Bazı ortamlarda (IndexedDB kısıtlı,
// bozuk/askıda kalmış eski sekme kilidi vb.) persistent cache ilk Firestore
// okumasını askıya alıp "giriş yapılamıyor" gibi görünen bir kilitlenmeye yol
// açabiliyor. Bu yüzden VARSAYILAN ağ modudur; önbelleği açmak için tarayıcı
// konsoluna: localStorage.setItem('cevrimdisiOnbellek','1') yazıp yenileyin.
// runTransaction (stok düşen "yeni sipariş") her koşulda çevrimdışı çalışmaz.
let _db;
const onbellekIstendi = typeof window !== "undefined" && window.localStorage
  && window.localStorage.getItem("cevrimdisiOnbellek") === "1";
if (onbellekIstendi) {
  try {
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) }),
    });
  } catch (err) {
    console.warn("[firebase-config] Çevrimdışı önbellek açılamadı, ağ moduyla devam:", err);
    _db = getFirestore(app);
  }
} else {
  _db = getFirestore(app);
}
export const db = _db;
export const auth = getAuth(app);

// Yerel geliştirme sırasında Firebase Emulator Suite kullanmak isterseniz
// tarayıcı konsoluna: localStorage.setItem('kullanEmulator','1') yazıp
// sayfayı yenileyin. Prodüksiyonda bu satırlar hiçbir şey yapmaz.
if (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("kullanEmulator") === "1") {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectAuthEmulator(auth, "http://localhost:9099");
  console.info("[firebase-config] Emulator moduna bağlanıldı.");
}
