import { db, auth } from "../../shared/firebase-config.js";
import {
  collection, doc, updateDoc, onSnapshot, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  paraFormat, escapeHtml, tarihFormat, tarihAnahtariniOku, tarihAraligiBaslangici, snapshotHataYakala, bildirimGoster,
} from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

// ÖNEMLİ: Admin muhasebesi artık ADİSYON TERMİNALİNDEKİ CANLI hareketleri
// (ham `adisyonlar`/`kasaHareketleri` koleksiyonları) HİÇ dinlemez — kasada
// yapılan her değişiklik anlık olarak admine yansımaz. Tek veri kaynağı
// `gunSonuKapanislari`dır: kasa "Gün Sonunu Kapat ve Merkeze Gönder"e
// basmadan hiçbir rakam burada görünmez. O belge oluştuktan sonra da kasa
// tarafından bir daha değiştirilemez/silinemez (bkz. firestore.rules) — yani
// "gönderilince düzenleme şansı olmaz" kuralı veritabanı seviyesinde de
// garanti edilir. Admin sadece hatalı bir kapanışı "yeniden aç" ile
// (denetim izini koruyarak) geçersiz kılıp kasının yeniden göndermesini
// sağlayabilir.
let gunSonuKapanislariCache = [];

const ozetEl = document.getElementById("muhasebe-ozet");
const subeOzetKartEl = document.getElementById("muhasebe-sube-ozet-kart");
const subeOzetEl = document.getElementById("muhasebe-sube-ozet");
const gunSonuListeEl = document.getElementById("muhasebe-gunsonu-liste");
const hareketListeEl = document.getElementById("muhasebe-hareket-liste");
const aralikEl = document.getElementById("muhasebe-aralik");
const subeEl = document.getElementById("muhasebe-sube");

export function baslat() {
  onSnapshot(query(collection(db, "gunSonuKapanislari")), (snap) => {
    gunSonuKapanislariCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, snapshotHataYakala("muhasebe-gunsonu"));

  subelerDegisti(() => { renderSubeSecim(); render(); });
  aralikEl.addEventListener("change", render);
  subeEl.addEventListener("change", render);
}

function renderSubeSecim() {
  const secili = subeEl.value;
  subeEl.innerHTML = `<option value="">Tüm Şubeler</option>` + subelerCache.map((s) => `<option value="${s.id}">${escapeHtml(s.ad)}</option>`).join("");
  subeEl.value = secili;
}

function tarihAraligiUyuyorMu(tarihAlani, sinir) {
  if (!sinir) return true;
  const tarih = tarihAlani?.toDate ? tarihAlani.toDate() : null;
  return tarih && tarih >= sinir;
}

// Bir şubenin en son GEÇERLİ (iptal edilmemiş) kapanışı — kasa devri
// zinciri tek bir "son bakiye" alanı olduğundan sadece bu kapanış güvenle
// geri alınabilir (daha eskisi aradaki vardiyaların devrini bozar).
function subeninEnSonKapanisi(subeId) {
  return gunSonuKapanislariCache
    .filter((g) => g.subeId === subeId && !g.iptalEdildi)
    .sort((a, b) => (b.kapanmaZamani?.toMillis?.() || 0) - (a.kapanmaZamani?.toMillis?.() || 0))[0] || null;
}

function render() {
  const sinir = tarihAraligiBaslangici(aralikEl.value);
  const subeFiltre = subeEl.value;

  let gunSonulari = gunSonuKapanislariCache.filter((g) => tarihAraligiUyuyorMu(g.kapanmaZamani, sinir));
  if (subeFiltre) gunSonulari = gunSonulari.filter((g) => g.subeId === subeFiltre);

  // İptal edilmiş (yeniden açılmış) kapanışlar geçersiz sayılır — yerine
  // zaten yeni bir kapanış gelecek, toplamlara iki kez girmemesi için.
  const gecerli = gunSonulari.filter((g) => !g.iptalEdildi);

  const nakitSatis = gecerli.reduce((acc, g) => acc + Number(g.nakitSatisToplam || 0), 0);
  const kartSatis = gecerli.reduce((acc, g) => acc + Number(g.kartSatisToplam || 0), 0);
  const manuelGiris = gecerli.reduce((acc, g) => acc + Number(g.manuelNakitGiris || 0), 0);
  const manuelCikis = gecerli.reduce((acc, g) => acc + Number(g.manuelNakitCikis || 0), 0);
  const netNakit = nakitSatis + manuelGiris - manuelCikis;

  ozetEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">Nakit Satış (Raporlanan)</div><div class="deger">${paraFormat(nakitSatis)}</div></div>
    <div class="panel-kart"><div class="etiket">Kart Satış (Raporlanan)</div><div class="deger">${paraFormat(kartSatis)}</div></div>
    <div class="panel-kart"><div class="etiket">Toplam Ciro</div><div class="deger">${paraFormat(nakitSatis + kartSatis)}</div></div>
    <div class="panel-kart"><div class="etiket">Manuel Nakit Giriş</div><div class="deger" style="color:var(--renk-yesil);">${paraFormat(manuelGiris)}</div></div>
    <div class="panel-kart"><div class="etiket">Manuel Nakit Çıkış</div><div class="deger" style="color:var(--renk-kirmizi);">${paraFormat(manuelCikis)}</div></div>
    <div class="panel-kart"><div class="etiket">Net Nakit Hareketi</div><div class="deger">${paraFormat(netNakit)}</div></div>
  `;

  // Merkezi muhasebe: "Tüm Şubeler" seçiliyken her şubenin RAPORLANMIŞ cirosu
  // ve en son ne zaman kasa gönderdiği tek tabloda toplanır.
  if (!subeFiltre && subelerCache.length > 1) {
    subeOzetKartEl.hidden = false;
    subeOzetEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="veri-tablo">
          <thead><tr><th>Şube</th><th>Nakit Satış</th><th>Kart Satış</th><th>Toplam Ciro</th><th>Son Kapanış</th></tr></thead>
          <tbody>
            ${subelerCache.map((s) => {
              const sGecerli = gecerli.filter((g) => g.subeId === s.id);
              const sNakit = sGecerli.reduce((acc, g) => acc + Number(g.nakitSatisToplam || 0), 0);
              const sKart = sGecerli.reduce((acc, g) => acc + Number(g.kartSatisToplam || 0), 0);
              const enSon = subeninEnSonKapanisi(s.id);
              const sonKapanisHtml = enSon
                ? `${tarihFormat(enSon.kapanmaZamani)} <span class="tablo-soluk">(${escapeHtml(enSon.kapatanKullanici || "")})</span>`
                : `<span class="tablo-soluk">Hiç gönderilmedi</span>`;
              return `<tr>
                <td><strong>${escapeHtml(s.ad)}</strong></td>
                <td>${paraFormat(sNakit)}</td>
                <td>${paraFormat(sKart)}</td>
                <td><b>${paraFormat(sNakit + sKart)}</b></td>
                <td>${sonKapanisHtml}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  } else {
    subeOzetKartEl.hidden = true;
  }

  const gsSirali = gunSonulari.slice().sort((a, b) => (b.kapanmaZamani?.toMillis?.() || 0) - (a.kapanmaZamani?.toMillis?.() || 0));
  gunSonuListeEl.innerHTML = gsSirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta gönderilmiş vardiya kapanışı yok.</div>`
    : `<div style="overflow-x:auto;">
        <table class="veri-tablo">
          <thead><tr><th>Şube</th><th>Tarih</th><th>Devir</th><th>Beklenen</th><th>Sayılan</th><th>Fark</th><th>Kapatan</th><th></th></tr></thead>
          <tbody>
            ${gsSirali.map((g) => {
              const enSonMu = !g.iptalEdildi && subeninEnSonKapanisi(g.subeId)?.id === g.id;
              return `
              <tr class="${g.iptalEdildi ? "tablo-satir-iptal" : ""}">
                <td>${escapeHtml(g.subeAdi || "")}</td>
                <td>${tarihAnahtariniOku(g.tarih)} <span class="tablo-soluk">${tarihFormat(g.kapanmaZamani)}</span></td>
                <td>${paraFormat(g.devirTutari)}</td>
                <td>${paraFormat(g.beklenenNakit)}</td>
                <td>${paraFormat(g.sayilanNakit)}</td>
                <td><span class="rozet" style="background:${g.fark === 0 ? "#27ae60" : (g.fark || 0) > 0 ? "#2980b9" : "#c0392b"}">${paraFormat(g.fark)}</span></td>
                <td class="tablo-soluk">${escapeHtml(g.kapatanKullanici || "")}</td>
                <td>${g.iptalEdildi
                  ? `<span class="tablo-soluk">🔓 Yeniden açıldı</span>`
                  : enSonMu
                    ? `<button class="btn-ikincil btn-kucuk" data-ac="${g.id}">🔓 Yeniden Aç</button>`
                    : `<span class="tablo-soluk">—</span>`}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;

  gunSonuListeEl.querySelectorAll("[data-ac]").forEach((b) => b.addEventListener("click", () => gunSonuAc(b.dataset.ac)));

  // Ham manuel kasa hareketleri artık burada gösterilmez — her hareket
  // ilgili vardiyanın gün sonu raporuna toplu olarak yansır (yukarıdaki
  // tablo). Tek tek/anlık hareket akışı istenen davranış değil.
  hareketListeEl.innerHTML = `<p style="color:var(--renk-yazi-soluk);font-size:13px;">Manuel kasa hareketlerinin ayrıntısı, ilgili vardiya "Gün Sonunu Kapat ve Merkeze Gönder" ile raporlandığında yukarıdaki Gün Sonu Kapanışları tablosundaki toplamlara yansır. Tek tek hareketler kapanış öncesi burada anlık görünmez.</p>`;
}

// Yanlışlıkla veya hatalı sayımla kapatılmış bir vardiyayı admin geri açar
// — kapanış kaydı SİLİNMEZ (denetim izi/kontrol için korunur), sadece
// "iptalEdildi" ile işaretlenir ve şubenin kasa devri (ve vardiya sınırı)
// bu kapanıştan önceki haline döndürülür. Böylece kasa aynı vardiyayı
// yeniden (doğru şekilde) sayıp gönderebilir.
async function gunSonuAc(id) {
  const g = gunSonuKapanislariCache.find((x) => x.id === id);
  if (!g) return;
  // Şubenin kasa devri (sonKasaDevri) tarih bazlı bir defter değil, tek bir
  // "son bakiye" alanıdır — sadece EN GÜNCEL kapanış güvenle geri alınabilir.
  // Daha eski bir kapanışı geri almak aradaki vardiyaların devrini
  // bozacağından desteklenmez (arayüzde de sadece en sonuncuya buton çıkar).
  if (g.iptalEdildi || subeninEnSonKapanisi(g.subeId)?.id !== g.id) {
    bildirimGoster("Sadece bir şubenin EN SON (henüz iptal edilmemiş) kapanışı yeniden açılabilir.", "uyari");
    return;
  }
  if (!confirm(`"${g.subeAdi}" şubesinin ${tarihAnahtariniOku(g.tarih)} tarihli (${tarihFormat(g.kapanmaZamani)}) vardiya kapanışı yeniden açılacak.\n\nKasa devri ${paraFormat(g.devirTutari)} değerine geri alınacak ve bu vardiya için kasa yeniden sayılıp gönderilebilir olacak. Emin misiniz?`)) return;
  try {
    await updateDoc(doc(db, "gunSonuKapanislari", id), {
      iptalEdildi: true,
      iptalZamani: serverTimestamp(),
      iptalEdenKullanici: auth.currentUser?.displayName || auth.currentUser?.email || "",
    });
    // Bir önceki (varsa) geçerli kapanışın zamanına geri dön; hiç yoksa
    // vardiya sınırını tamamen temizle (ilk vardiyaya dönülmüş olur).
    const onceki = gunSonuKapanislariCache
      .filter((x) => x.subeId === g.subeId && x.id !== g.id && !x.iptalEdildi)
      .sort((a, b) => (b.kapanmaZamani?.toMillis?.() || 0) - (a.kapanmaZamani?.toMillis?.() || 0))[0] || null;
    await updateDoc(doc(db, "subeler", g.subeId), {
      sonKasaDevri: g.devirTutari,
      sonGunSonuZamani: onceki ? onceki.kapanmaZamani : null,
      sonGunSonuTarihi: onceki ? onceki.tarih : null,
    });
    bildirimGoster("Vardiya kapanışı yeniden açıldı.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
