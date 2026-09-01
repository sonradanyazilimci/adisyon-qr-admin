import { sayfaKorumaBaslat, cikisYap } from "../../shared/auth.js";

import * as panel from "./panel.js";
import * as subeler from "./subeler.js";
import * as kategoriler from "./kategoriler.js";
import * as urunler from "./urunler.js";
import * as hammaddeler from "./hammaddeler.js";
import * as masalar from "./masalar.js";
import * as personel from "./personel.js";
import * as raporlar from "./raporlar.js";
import * as ayarlar from "./ayarlar.js";

const SEKME_BASLIKLARI = {
  panel: "Panel",
  subeler: "Şubeler",
  kategoriler: "Kategoriler",
  urunler: "Ürünler",
  hammaddeler: "Hammaddeler / Stok",
  masalar: "Masalar / QR Kodları",
  personel: "Personel",
  raporlar: "Raporlar",
  ayarlar: "Ayarlar",
};

async function baslat() {
  const { user } = await sayfaKorumaBaslat(["admin"]);

  document.getElementById("yukleniyor-ekrani").remove();
  document.getElementById("uygulama").classList.remove("uygulama-gizli");
  document.getElementById("kullanici-bilgisi").textContent = `👤 ${user.displayName || user.email}`;

  document.getElementById("cikis-buton").addEventListener("click", cikisYap);

  // Sekme geçişleri
  document.querySelectorAll(".nav-buton").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-buton").forEach((b) => b.classList.remove("aktif"));
      btn.classList.add("aktif");
      const hedef = btn.dataset.sekme;
      document.querySelectorAll(".sekme-icerik").forEach((s) => (s.hidden = true));
      document.getElementById(`sekme-${hedef}`).hidden = false;
      document.getElementById("sekme-baslik").textContent = SEKME_BASLIKLARI[hedef] || hedef;
    });
  });

  // Tüm modülleri başlat (gerçek zamanlı dinleyiciler kurulur)
  subeler.baslat();
  kategoriler.baslat();
  hammaddeler.baslat();
  urunler.baslat(); // kategoriler + hammaddeler cache'lerine bağımlı, sonra başlar
  masalar.baslat();
  personel.baslat();
  raporlar.baslat();
  ayarlar.baslat();
  panel.baslat();
}

baslat().catch((err) => {
  console.error(err);
  document.getElementById("yukleniyor-ekrani").textContent = "Bir hata oluştu: " + err.message;
});
