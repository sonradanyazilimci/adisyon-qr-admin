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
  persistentMultipleTabManager,
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

// Firestore OFFLINE kalıcı önbellek: bağlantı koptuğunda okumalar
// önbellekten sürer, yapılan yazılar (addDoc/setDoc/updateDoc) IndexedDB'de
// kuyruğa alınır ve bağlantı gelince OTOMATİK gönderilir. Böylece adisyon
// terminali kısa internet kesintilerinde çalışmaya devam eder.
// NOT: runTransaction (stok düşen "yeni sipariş oluştur") çevrimdışı
// ÇALIŞMAZ — sunucu turu gerektirir; o işlem bağlantı gelince tekrar
// denenmelidir (kullanıcıya net hata gösterilir).
// persistentMultipleTabManager: aynı cihazda birden fazla sekme (ör. adisyon
// + mutfak) açıkken önbelleği paylaşırlar, "sadece tek sekme" hatası olmaz.
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  // IndexedDB kapalı/erişilemez (ör. gizli sekme, eski tarayıcı) — çevrimdışı
  // önbellek olmadan devam et.
  console.warn("[firebase-config] Çevrimdışı önbellek açılamadı, ağ moduyla devam:", err);
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
