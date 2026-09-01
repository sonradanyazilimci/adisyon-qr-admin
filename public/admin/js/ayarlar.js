import { db } from "../../shared/firebase-config.js";
import {
  collection, doc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { bildirimGoster } from "../../shared/utils.js";

const demoButon = document.getElementById("demo-veri-buton");

export function baslat() {
  demoButon.addEventListener("click", async () => {
    if (!confirm("Demo veri (1 şube, 4 kategori, birkaç hammadde/ürün ve 6 masa) eklenecek. Devam edilsin mi?")) return;
    demoButon.disabled = true;
    try {
      await demoVeriYukle();
      bildirimGoster("Demo veri başarıyla yüklendi!", "basari");
    } catch (err) {
      console.error(err);
      bildirimGoster("Hata: " + err.message, "hata");
    } finally {
      demoButon.disabled = false;
    }
  });
}

async function demoVeriYukle() {
  const batch = writeBatch(db);

  const subeRef = doc(collection(db, "subeler"));
  batch.set(subeRef, { ad: "Merkez Şube", adres: "Örnek Mah. Lezzet Cad. No:1", telefon: "0212 000 00 00", sira: 0, aktif: true, olusturmaZamani: serverTimestamp() });

  const kategoriler = ["Ana Yemekler", "Çorbalar", "İçecekler", "Tatlılar"].map((ad, i) => {
    const ref = doc(collection(db, "kategoriler"));
    batch.set(ref, { ad, sira: i, olusturmaZamani: serverTimestamp() });
    return { id: ref.id, ad };
  });
  const kategoriId = (ad) => kategoriler.find((k) => k.ad === ad).id;

  const hammaddeTanimlari = [
    { ad: "Dana Eti", birim: "gram", mevcutStok: 20000, kritikEsik: 3000 },
    { ad: "Tavuk Göğsü", birim: "gram", mevcutStok: 15000, kritikEsik: 2000 },
    { ad: "Ekmek", birim: "adet", mevcutStok: 200, kritikEsik: 30 },
    { ad: "Yoğurt", birim: "gram", mevcutStok: 10000, kritikEsik: 1500 },
    { ad: "Domates Sosu", birim: "ml", mevcutStok: 8000, kritikEsik: 1000 },
    { ad: "Tereyağı", birim: "gram", mevcutStok: 5000, kritikEsik: 500 },
    { ad: "Su", birim: "ml", mevcutStok: 30000, kritikEsik: 3000 },
    { ad: "Su Şişesi (500ml)", birim: "adet", mevcutStok: 200, kritikEsik: 30 },
    { ad: "Un", birim: "gram", mevcutStok: 10000, kritikEsik: 2000 },
    { ad: "Şeker", birim: "gram", mevcutStok: 6000, kritikEsik: 1000 },
  ].map((h) => {
    const ref = doc(collection(db, "hammaddeler"));
    batch.set(ref, { ...h, olusturmaZamani: serverTimestamp() });
    return { id: ref.id, ad: h.ad };
  });
  const hammaddeId = (ad) => hammaddeTanimlari.find((h) => h.ad === ad).id;

  const urunler = [
    {
      ad: "İskender Kebap", kategoriId: kategoriId("Ana Yemekler"),
      aciklama: "Özel domates sosu ve tereyağı ile servis edilen ızgara dana döner.",
      fiyat: 220, kalori: 750, alerjenler: ["gluten", "sut"], glutensiz: false, aktif: true,
      recete: [
        { hammaddeId: hammaddeId("Dana Eti"), miktar: 180 },
        { hammaddeId: hammaddeId("Ekmek"), miktar: 1 },
        { hammaddeId: hammaddeId("Yoğurt"), miktar: 100 },
        { hammaddeId: hammaddeId("Domates Sosu"), miktar: 50 },
        { hammaddeId: hammaddeId("Tereyağı"), miktar: 30 },
      ],
      gorselUrl: "https://images.unsplash.com/photo-1633436375392-4316f5c1f6d0?w=500",
    },
    {
      ad: "Tavuk Şiş", kategoriId: kategoriId("Ana Yemekler"),
      aciklama: "Marine edilmiş, ızgarada pişirilmiş tavuk göğüs şiş.",
      fiyat: 180, kalori: 520, alerjenler: ["gluten"], glutensiz: false, aktif: true,
      recete: [
        { hammaddeId: hammaddeId("Tavuk Göğsü"), miktar: 200 },
        { hammaddeId: hammaddeId("Ekmek"), miktar: 1 },
      ],
      gorselUrl: "https://images.unsplash.com/photo-1598515213692-5f252f2c1a67?w=500",
    },
    {
      ad: "Mercimek Çorbası", kategoriId: kategoriId("Çorbalar"),
      aciklama: "Geleneksel tarif ile hazırlanmış kırmızı mercimek çorbası.",
      fiyat: 65, kalori: 210, alerjenler: [], glutensiz: true, aktif: true,
      recete: [],
      gorselUrl: "https://images.unsplash.com/photo-1547592180-85f173990554?w=500",
    },
    {
      ad: "Ayran", kategoriId: kategoriId("İçecekler"),
      aciklama: "Ev yapımı taze ayran.",
      fiyat: 25, kalori: 80, alerjenler: ["sut"], glutensiz: true, aktif: true,
      recete: [
        { hammaddeId: hammaddeId("Yoğurt"), miktar: 150 },
        { hammaddeId: hammaddeId("Su"), miktar: 100 },
      ],
      gorselUrl: "https://images.unsplash.com/photo-1626200926749-e388a5f1f3e9?w=500",
    },
    {
      ad: "Su (0.5L)", kategoriId: kategoriId("İçecekler"),
      aciklama: "Doğal kaynak suyu.",
      fiyat: 15, kalori: 0, alerjenler: [], glutensiz: true, aktif: true,
      recete: [{ hammaddeId: hammaddeId("Su Şişesi (500ml)"), miktar: 1 }],
      gorselUrl: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=500",
    },
    {
      ad: "Baklava (4 dilim)", kategoriId: kategoriId("Tatlılar"),
      aciklama: "Antep fıstıklı, şerbetli geleneksel baklava.",
      fiyat: 110, kalori: 450, alerjenler: ["gluten", "sut", "findik"], glutensiz: false, aktif: true,
      recete: [
        { hammaddeId: hammaddeId("Un"), miktar: 80 },
        { hammaddeId: hammaddeId("Şeker"), miktar: 60 },
      ],
      gorselUrl: "https://images.unsplash.com/photo-1519676867240-f03562e64548?w=500",
    },
  ];
  urunler.forEach((u) => {
    const ref = doc(collection(db, "urunler"));
    batch.set(ref, { ...u, olusturmaZamani: serverTimestamp() });
  });

  for (let i = 1; i <= 6; i++) {
    const ref = doc(collection(db, "masalar"));
    batch.set(ref, { ad: `Masa ${i}`, subeId: subeRef.id, durum: "bos", garsonCagirildi: false, olusturmaZamani: serverTimestamp() });
  }

  await batch.commit();
}
