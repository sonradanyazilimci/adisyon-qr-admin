// ─────────────────────────────────────────────────────────────────────────
// Fiş yazdırma — ortak, sayfadan bağımsız şablonlar.
//
// İki fiş türü:
//   • mutfakFisiYazdir()  — garson/kasa siparişi mutfağa GÖNDERDİĞİNDE
//     basılan kısa "hazırlık fişi" (KOT). Fiyat YOKTUR, sadece ürün/adet/not
//     — mutfağın hızlıca okuyup hazırlamasına yarar, büyük/kalın yazı.
//   • musteriFisiYazdir() — hesap KAPATILDIĞINDA müşteriye verilen fiş.
//     İşletme bilgileri (ad/adres/telefon/vergi no) ve ödeme dökümünü içerir.
//
// Her iki fonksiyon da `#fis-yazdirma` (class="yazdirilacak") elemanına
// yazar ve window.print() çağırır — bu eleman ekranda gizlidir, yazdırma
// anında görünür kılınıp geri kalan her şey gizlenir (bkz. shared/common.css
// @media print kuralları). Kullanan sayfa bu elemanı HTML'sinde bulundurmalı:
//   <div id="fis-yazdirma" class="yazdirilacak" style="display:none;"></div>
// ─────────────────────────────────────────────────────────────────────────
import { paraFormat, escapeHtml } from "./utils.js";

// GEÇİCİ: fiş yazdırma özelliği kullanıcı isteğiyle şimdilik devre dışı —
// çağrı noktaları (adisyon.js/garson.js) hiç değiştirilmedi, sadece burada
// tek bir bayrakla kapatıldı. Yeniden açmak için `true` yapmak yeterli.
const FIS_YAZDIRMA_AKTIF = false;

const ODEME_YONTEMI_ETIKET = { nakit: "NAKİT", kart: "KART", yemek_ceki: "YEMEK ÇEKİ" };

function fisAlaniniAl() {
  const el = document.getElementById("fis-yazdirma");
  if (!el) {
    console.warn("#fis-yazdirma elemanı bu sayfada yok — fiş yazdırılamadı.");
    return null;
  }
  return el;
}

/**
 * Mutfağa/hazırlığa giden bir siparişin KISA HAZIRLIK FİŞİ (KOT).
 * Garson veya kasa yeni bir sipariş gönderdiğinde çağrılır.
 * @param {{masaAd:string, gonderenAdi?:string, urunler:Array<{ad:string, adet:number, not?:string}>}} girdi
 */
export function mutfakFisiYazdir({ masaAd, gonderenAdi, urunler }) {
  if (!FIS_YAZDIRMA_AKTIF) return;
  const el = fisAlaniniAl();
  if (!el || !urunler || urunler.length === 0) return;
  el.innerHTML = `
    <div class="fis-govde fis-mutfak">
      <h2>MUTFAK FİŞİ</h2>
      <div class="fis-cizgi"></div>
      <h3>${escapeHtml(masaAd || "")}</h3>
      <p class="fis-meta">${new Date().toLocaleString("tr-TR")}${gonderenAdi ? ` · ${escapeHtml(gonderenAdi)}` : ""}</p>
      <div class="fis-cizgi"></div>
      <table class="fis-tablo">
        ${urunler.map((k) => `
          <tr>
            <td class="fis-adet">${k.adet}x</td>
            <td>${escapeHtml(k.ad)}${k.not ? `<br><span class="fis-not">Not: ${escapeHtml(k.not)}</span>` : ""}</td>
          </tr>`).join("")}
      </table>
      <div class="fis-cizgi"></div>
    </div>`;
  window.print();
}

/**
 * Hesap kapatılırken müşteriye verilen fiş — işletme bilgileri, ürün
 * dökümü, toplam ve ödeme (bölüm bölüm ödendiyse her parça) dahil.
 * @param {{
 *   isletmeAdi?:string, subeAdi?:string, subeAdres?:string, subeTelefon?:string,
 *   vergiDairesi?:string, vergiNo?:string, masaAd:string,
 *   kalemler:Array<{ad:string, adet:number, fiyat:number, tutar?:number}>,
 *   toplam:number, odemeSatirlari:Array<{yontem:string, tutar:number, marka?:string}>,
 *   kapananKullanici?:string,
 * }} girdi
 */
export function musteriFisiYazdir({
  isletmeAdi, subeAdi, subeAdres, subeTelefon, vergiDairesi, vergiNo,
  masaAd, kalemler, toplam, odemeSatirlari, kapananKullanici,
}) {
  if (!FIS_YAZDIRMA_AKTIF) return;
  const el = fisAlaniniAl();
  if (!el) return;
  const baslikAdi = isletmeAdi || subeAdi || "";
  const altBaslikGoster = subeAdi && isletmeAdi && subeAdi !== isletmeAdi;

  el.innerHTML = `
    <div class="fis-govde">
      <h2>${escapeHtml(baslikAdi)}</h2>
      ${altBaslikGoster ? `<p class="fis-meta">${escapeHtml(subeAdi)}</p>` : ""}
      ${subeAdres ? `<p class="fis-meta">${escapeHtml(subeAdres)}</p>` : ""}
      ${subeTelefon ? `<p class="fis-meta">Tel: ${escapeHtml(subeTelefon)}</p>` : ""}
      ${vergiDairesi || vergiNo ? `<p class="fis-meta">${vergiDairesi ? `V.D.: ${escapeHtml(vergiDairesi)}` : ""}${vergiDairesi && vergiNo ? " · " : ""}${vergiNo ? `V.No: ${escapeHtml(vergiNo)}` : ""}</p>` : ""}
      <div class="fis-cizgi"></div>
      <h3>${escapeHtml(masaAd || "")}</h3>
      <p class="fis-meta">${new Date().toLocaleString("tr-TR")}</p>
      <div class="fis-cizgi"></div>
      <table class="fis-tablo">
        ${(kalemler || []).map((k) => `
          <tr>
            <td>${k.adet}x ${escapeHtml(k.ad)}</td>
            <td class="fis-sag">${paraFormat(k.tutar ?? k.adet * k.fiyat)}</td>
          </tr>`).join("")}
      </table>
      <div class="fis-cizgi"></div>
      <table class="fis-tablo"><tr><td><b>TOPLAM</b></td><td class="fis-sag"><b>${paraFormat(toplam)}</b></td></tr></table>
      <div class="fis-cizgi"></div>
      ${(odemeSatirlari || []).map((o) => `
        <p class="fis-odeme"><span>${ODEME_YONTEMI_ETIKET[o.yontem] || o.yontem}${o.yontem === "yemek_ceki" && o.marka ? ` (${escapeHtml(o.marka)})` : ""}</span><span>${paraFormat(o.tutar)}</span></p>`).join("")}
      <div class="fis-cizgi"></div>
      ${kapananKullanici ? `<p class="fis-meta">Kapatan: ${escapeHtml(kapananKullanici)}</p>` : ""}
      <p class="fis-tesekkur">Afiyet olsun, bizi tercih ettiğiniz için teşekkürler!</p>
    </div>`;
  window.print();
}
