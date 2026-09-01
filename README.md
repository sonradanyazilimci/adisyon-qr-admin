# QR Menü + Adisyon + Stok Takip Sistemi

Vanilla HTML/CSS/JS (ES modülleri) + Firebase (Firestore, Auth, Hosting) ile geliştirilmiş,
çok şubeli çalışabilen restoran yönetim sistemi.

> **Bu proje Blaze (pay-as-you-go) plan gerektirmez — Cloud Functions ve Firebase Storage
> kullanmaz.** Ücretsiz **Spark** planla tamamen çalışır:
> - Sipariş oluşturma + reçeteye göre stok düşümü, client'tan çalışan bir Firestore
>   **transaction** ile yapılır (`public/shared/siparis.js`).
> - Roller (admin/garson/kasa) ve personel yönetimi doğrudan Firestore belgeleri ve
>   güvenlik kuralları üzerinden yürütülür — custom claim / Admin SDK kullanılmaz.
> - Ürün görselleri Storage yerine doğrudan **görsel URL'si** (harici link) ile eklenir.
>
> `functions/` klasörü, ileride Blaze planına geçerseniz sunucu taraflı (daha sıkı
> doğrulamalı) bir sürüme geçmek isteyenler için **opsiyonel** olarak saklanıyor; şu an
> deploy edilmiyor ve `firebase.json`'da tanımlı değil. Detay için o dosyanın başındaki not.

## Arayüzler

| Arayüz | Yol | Kim kullanır |
|---|---|---|
| Admin Paneli | `/admin` | admin |
| Personel Girişi / İlk Kurulum | `/login` | herkes |
| QR Dijital Menü | `/menu?sube=<subeId>&masa=<masaId>` | müşteri (QR kod ile) |
| Garson Terminali | `/garson` | garson |
| Adisyon / Kasa | `/adisyon` | kasa (admin da girebilir) |

Menü/hammadde/reçete verisi **tüm şubelerde ortaktır** (tek merkezi Firestore — "single
source of truth"); masalar, siparişler, adisyonlar ve personel ise **şube bazlı** ayrılır.
Her masanın QR kodu kendi şube kimliğini taşıyan bir linke (`?sube=...&masa=...`) gider, bu
sayede birden fazla şubeniz olduğunda linkler karışmaz ve her şubenin QR kodu/menü başlığı
kendi şube adını gösterir.

## 1) Firebase Projesi

Bu proje **`adisyon-admin-qr`** adlı Firebase projesine (hesap: erhankenar4@gmail.com)
bağlıdır ve `public/shared/firebase-config.js` içinde bu projenin gerçek `firebaseConfig`
değerleri zaten dolu. Projede tamamlanmış olanlar:

- ✅ Web app kaydedildi.
- ✅ Firestore veritabanı oluşturuldu (Europe/`eur3`).
- ✅ **Authentication → Email/Password** etkinleştirildi.

Farklı bir Firebase projesine taşımak isterseniz: `.firebaserc` içindeki proje ID'sini ve
`public/shared/firebase-config.js` içindeki `firebaseConfig` değerlerini kendi projenizinkiyle
değiştirin.

## 2) Deploy

Bu depoyu GitHub'a yükledikten/klonladıktan sonra, kendi makinenizden veya bir CI/CD
akışından Firebase CLI ile deploy edebilirsiniz:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore
```

Bu komut sadece Hosting (public/ klasörü) ve Firestore kurallarını/index'lerini yayınlar
— `functions` hedefi olmadığı için Blaze plan gerektirmez.

Yerelde denemek isterseniz: `firebase emulators:start`, ve tarayıcı konsolunda
`localStorage.setItem('kullanEmulator','1')` çalıştırıp sayfayı yenileyin
(`public/shared/firebase-config.js` bunu otomatik algılar).

### Alternatif: GitHub Pages ile yayınlama

Firebase Hosting yerine (veya onunla birlikte) statik dosyaları **GitHub Pages** üzerinden de
yayınlayabilirsiniz — backend (Firestore/Auth) aynı Firebase projesi olduğu için ikisi de
aynı veriyle çalışır, sadece HTML/CSS/JS dosyalarının servis edildiği adres değişir.

1. Bu depoda hazır bekleyen `.github/workflows/deploy-pages.yml` dosyası `public/` klasörünü
   otomatik yayınlar. Depoyu push ettikten sonra: GitHub reponuzda **Settings → Pages →
   Build and deployment → Source** kısmından **"GitHub Actions"**'ı seçin (varsayılan
   "Deploy from a branch" seçeneğini DEĞİL — o seçiliyse site sadece README'yi gösterir).
2. Her `main` dalına push'ta site otomatik güncellenir; adresiniz
   `https://<kullaniciadiniz>.github.io/<repo-adi>/` şeklinde olur.
3. **Önemli:** Bu adresi Firebase Console → **Authentication → Settings → Authorized
   domains** kısmına ekleyin (ör. `kullaniciadiniz.github.io`), yoksa personel girişi
   (`/login`) "unauthorized-domain" hatası verir. (QR menüyü anonim gezen müşteriler için bu
   adım gerekmez, sadece giriş yapan admin/garson/kasa/mutfak hesapları için gerekir.)
4. Kod, sitenin bir alan adı kökünde mi (Firebase Hosting) yoksa bir alt yolda mı (GitHub
   Pages'in `<kullaniciadiniz>.github.io/<repo-adi>/` yapısı) yayınlandığını otomatik anlayacak
   şekilde göreceli linkler (`../admin/` gibi) kullanır — bu yüzden her iki platformda da
   ek bir ayar yapmadan doğru çalışır.

## 3) İlk Admin Hesabını Oluşturma

Deploy sonrası `https://<projeniz>.web.app/login` (veya yerel test URL'niz) adresine gidin,
**"İlk kurulumu mu yapıyorsunuz?"** bağlantısına tıklayıp bir e-posta/şifre girin. Sistem,
henüz hiç admin yokken girilen ilk hesabı otomatik olarak admin yapar (bu kontrolü
`firestore.rules` içindeki tek kullanımlık `ayarlar/ilkAdmin` işaretçisi sağlar — ikinci bir
"ilk kurulum" denemesi güvenlik kuralları tarafından reddedilir).

Bundan sonraki tüm personel hesapları **Admin Paneli → Personel** ekranından oluşturulur
(bu da Cloud Function kullanmaz — geçici, ikincil bir Firebase App örneğiyle yeni hesap
açılır, böylece admin'in kendi oturumu etkilenmez; detay için `public/admin/js/personel.js`
başındaki not).

## 4) Adım Adım Kurulum Sırası (Admin Panelinde)

1. **Şubeler** — en az bir şube ekleyin (tek şubeli işletmeler için de gereklidir).
2. **Kategoriler** — menü kategorilerinizi girin (İskenderler, Çorbalar, İçecekler...).
3. **Hammaddeler / Stok** — hammaddelerinizi (birim, mevcut stok, kritik eşik) girin.
4. **Ürünler** — her ürün için ad/açıklama/fiyat/kalori/alerjen/glutensiz bilgisi, **görsel
   URL'si** ve reçete (hangi hammaddeden ne kadar) tanımlayın.
5. **Masalar / QR** — her masa için şube seçip masa ekleyin, **QR Kod** butonuyla
   `menu.html?sube=X&masa=Y` bağlantısını görüntüleyip yazdırın.
6. **Personel** — garson/kasa hesaplarını (şube ataması ile) oluşturun.
7. Hızlı test için **Ayarlar → Demo Veri Yükle** ile örnek şube/kategori/ürün/hammadde/masa
   verisi yükleyebilirsiniz.

## 5) Uçtan Uca Test Senaryosu

1. Admin panelinden demo veri yükleyin (veya kendi verinizi girin).
2. **Masalar / QR** ekranından bir masanın linkini kopyalayıp `/menu?sube=...&masa=...`
   adresini tarayıcıda açın → menüyü görün, bir ürün ekleyip **Siparişi Gönder**'e basın.
3. `/adisyon` ekranını açın (kasa/admin girişiyle) → siparişin ilgili masaya anında
   düştüğünü görün.
4. `/admin` → **Hammaddeler / Stok** sekmesinde, siparişteki ürünün reçetesine göre
   stokların otomatik düştüğünü doğrulayın.
5. `/adisyon`'da masaya tıklayıp sipariş durumunu güncelleyin, ödeme yöntemi seçip
   **Hesabı Kapat**'a basın → fiş yazdırma önizlemesini kontrol edin.
6. `/admin` → **Raporlar** sekmesinde ciro ve en çok satan ürünlerin göründüğünü kontrol edin.

## Mimari Notlar

- **Atomik stok düşümü**: Sipariş oluşturma işlemi, client'tan çalışan bir Firestore
  **transaction** (`runTransaction`, bkz. `public/shared/siparis.js`) içinde yapılır. Bu,
  aynı anda gelen siparişlerde stok tutarsızlığı oluşmasını (yarış durumu) engeller.
  **Bilinen sınır**: Cloud Functions olmadığı için bu artık sunucu tarafında doğrulanmıyor;
  Firestore güvenlik kuralları (`firestore.rules`) yapısal kontroller yapar (var olan bir
  masaya, pozitif tutarla, geçerli ürünlerle sipariş açılması gibi) ama örn. istemcinin
  gönderdiği fiyatı ürünün gerçek fiyatıyla birebir doğrulamaz. Küçük/orta ölçekli, güvenilir
  bir müşteri kitlesi için kabul edilebilir bir risktir; daha sıkı doğrulama isterseniz Blaze
  planına geçip `functions/index.js` içindeki hazır Cloud Function sürümünü devreye alın.
- **Rol bazlı erişim (Cloud Functions'sız)**: Roller (`admin`/`garson`/`kasa`), şube ataması
  ve aktiflik doğrudan `kullanicilar/{uid}` Firestore belgesinde tutulur. Güvenlik kuralları
  bu belgeyi `get()` ile okuyup yetkilendirme yapar. `kullanicilar` koleksiyonuna client
  sadece iki dar kapsamlı yoldan yazabilir: (1) sistemde hiç admin yokken kendi "ilk admin"
  profilini oluşturmak, (2) zaten admin olan biri başka personel oluşturuyor/düzenliyor/
  siliyor olmak. Personel "silindiğinde" sadece bu profil belgesi silinir — sistemdeki tüm
  erişim kontrolü bu belgeye dayandığı için kişi anında erişimini kaybeder, ama Blaze/Admin
  SDK olmadığı için Firebase Authentication hesabının kendisi silinmez (isterseniz Firebase
  Console → Authentication'dan manuel silebilirsiniz).
- **Şube ölçeklendirmesi hakkında bilinen sınır**: `subeId` kullanıcı belgesinde tutulsa da,
  Firestore kuralları garson/kasa yazmalarını **şube bazında satır seviyesinde** zorunlu
  kılmıyor (yalnızca uygulama arayüzü sorguları kendi şubesine filtreler). Çok hassas/çok
  şubeli büyük kurulumlarda bunu `firestore.rules` içinde ek `subeId` eşleşme kontrolleriyle
  sıkılaştırmanız önerilir.
- **Gerçek zamanlı senkronizasyon**: Tüm arayüzler `onSnapshot` ile menü/stok/sipariş
  değişikliklerini anlık dinler; sayfa yenilemeye gerek yoktur.
- **Ürün görselleri**: Firebase Storage kullanılmıyor. Admin panelinde ürün formunda
  sadece "Görsel URL" alanı vardır — kendi sunucunuzdaki, bir CDN'deki veya herhangi bir
  görsel barındırma servisindeki (ör. Imgur, Cloudinary) doğrudan görsel linkini yapıştırın.

## Klasör Yapısı

```
public/
  shared/          → firebase-config.js, auth.js, utils.js, siparis.js, common.css (tüm arayüzler paylaşır)
  admin/           → admin paneli (ürün/kategori/hammadde/masa/personel/rapor CRUD)
  menu/            → müşteri QR menüsü
  garson/          → garson sipariş terminali
  adisyon/         → kasa / adisyon ekranı
  login/           → ortak personel girişi + ilk kurulum
functions/         → OPSİYONEL, şu an kullanılmıyor (bkz. dosya başındaki not) — ileride Blaze
                     planına geçilirse devreye alınabilecek sunucu taraflı sürüm
firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
```
