import { db, auth } from "../../shared/firebase-config.js";
import {
  collection, doc, updateDoc, onSnapshot, query, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  paraFormat, escapeHtml, tarihFormat, tarihAnahtariniOku, tarihAraligiBaslangici, tarihAnahtari, snapshotHataYakala, bildirimGoster,
} from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

let adisyonlarCache = [];
let kasaHareketleriCache = [];
let gunSonuKapanislariCache = [];

const ozetEl = document.getElementById("muhasebe-ozet");
const subeOzetKartEl = document.getElementById("muhasebe-sube-ozet-kart");
const subeOzetEl = document.getElementById("muhasebe-sube-ozet");
const gunSonuListeEl = document.getElementById("muhasebe-gunsonu-liste");
const hareketListeEl = document.getElementById("muhasebe-hareket-liste");
const aralikEl = document.getElementById("muhasebe-aralik");
const subeEl = document.getElementById("muhasebe-sube");

export function baslat() {
  onSnapshot(query(collection(db, "adisyonlar")), (snap) => {
    adisyonlarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, snapshotHataYakala("muhasebe-adisyonlar"));

  onSnapshot(query(collection(db, "kasaHareketleri")), (snap) => {
    kasaHareketleriCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, snapshotHataYakala("muhasebe-hareketler"));

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

function render() {
  const sinir = tarihAraligiBaslangici(aralikEl.value);
  const subeFiltre = subeEl.value;

  let adisyonlar = adisyonlarCache.filter((a) => tarihAraligiUyuyorMu(a.kapanmaZamani, sinir));
  let hareketler = kasaHareketleriCache.filter((k) => tarihAraligiUyuyorMu(k.zaman, sinir));
  let gunSonulari = gunSonuKapanislariCache.filter((g) => tarihAraligiUyuyorMu(g.kapanmaZamani, sinir));
  if (subeFiltre) {
    adisyonlar = adisyonlar.filter((a) => a.subeId === subeFiltre);
    hareketler = hareketler.filter((k) => k.subeId === subeFiltre);
    gunSonulari = gunSonulari.filter((g) => g.subeId === subeFiltre);
  }

  const nakitSatis = adisyonlar.filter((a) => a.odemeYontemi === "nakit").reduce((acc, a) => acc + Number(a.toplamTutar || 0), 0);
  const kartSatis = adisyonlar.filter((a) => a.odemeYontemi === "kart").reduce((acc, a) => acc + Number(a.toplamTutar || 0), 0);
  const manuelGiris = hareketler.filter((k) => k.tur === "nakit_giris").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const manuelCikis = hareketler.filter((k) => k.tur === "nakit_cikis").reduce((acc, k) => acc + Number(k.tutar || 0), 0);
  const netNakit = nakitSatis + manuelGiris - manuelCikis;

  ozetEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">Nakit Satış</div><div class="deger">${paraFormat(nakitSatis)}</div></div>
    <div class="panel-kart"><div class="etiket">Kart Satış</div><div class="deger">${paraFormat(kartSatis)}</div></div>
    <div class="panel-kart"><div class="etiket">Toplam Ciro</div><div class="deger">${paraFormat(nakitSatis + kartSatis)}</div></div>
    <div class="panel-kart"><div class="etiket">Manuel Nakit Giriş</div><div class="deger" style="color:var(--renk-yesil);">${paraFormat(manuelGiris)}</div></div>
    <div class="panel-kart"><div class="etiket">Manuel Nakit Çıkış</div><div class="deger" style="color:var(--renk-kirmizi);">${paraFormat(manuelCikis)}</div></div>
    <div class="panel-kart"><div class="etiket">Net Nakit Hareketi</div><div class="deger">${paraFormat(netNakit)}</div></div>
  `;

  // Merkezi muhasebe: "Tüm Şubeler" seçiliyken her şubenin cirosu VE bugünkü
  // gün sonu durumu (kapandı mı, açık mı) tek tabloda toplanır — admin hangi
  // şubenin henüz kasasını kapatmadığını buradan tek bakışta görür.
  if (!subeFiltre && subelerCache.length > 1) {
    subeOzetKartEl.hidden = false;
    const bugun = tarihAnahtari();
    subeOzetEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="veri-tablo">
          <thead><tr><th>Şube</th><th>Nakit Satış</th><th>Kart Satış</th><th>Toplam Ciro</th><th>Bugün Gün Sonu</th></tr></thead>
          <tbody>
            ${subelerCache.map((s) => {
              const sAdisyonlar = adisyonlar.filter((a) => a.subeId === s.id);
              const sNakit = sAdisyonlar.filter((a) => a.odemeYontemi === "nakit").reduce((acc, a) => acc + Number(a.toplamTutar || 0), 0);
              const sKart = sAdisyonlar.filter((a) => a.odemeYontemi === "kart").reduce((acc, a) => acc + Number(a.toplamTutar || 0), 0);
              const bugunkuKapanis = gunSonuKapanislariCache.find((g) => g.subeId === s.id && g.tarih === bugun && !g.iptalEdildi);
              const durum = bugunkuKapanis
                ? `<span class="rozet" style="background:#27ae60;">✅ Kapandı</span>`
                : `<span class="rozet" style="background:#e67e22;">⏳ Açık</span>`;
              return `<tr>
                <td><strong>${escapeHtml(s.ad)}</strong></td>
                <td>${paraFormat(sNakit)}</td>
                <td>${paraFormat(sKart)}</td>
                <td><b>${paraFormat(sNakit + sKart)}</b></td>
                <td>${durum}</td>
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
    ? `<div class="bos-durum">Seçilen aralıkta gün sonu kapanışı yok.</div>`
    : `<div style="overflow-x:auto;">
        <table class="veri-tablo">
          <thead><tr><th>Şube</th><th>Tarih</th><th>Devir</th><th>Beklenen</th><th>Sayılan</th><th>Fark</th><th>Kapatan</th><th></th></tr></thead>
          <tbody>
            ${gsSirali.map((g) => `
              <tr class="${g.iptalEdildi ? "tablo-satir-iptal" : ""}">
                <td>${escapeHtml(g.subeAdi || "")}</td>
                <td>${tarihAnahtariniOku(g.tarih)}</td>
                <td>${paraFormat(g.devirTutari)}</td>
                <td>${paraFormat(g.beklenenNakit)}</td>
                <td>${paraFormat(g.sayilanNakit)}</td>
                <td><span class="rozet" style="background:${g.fark === 0 ? "#27ae60" : (g.fark || 0) > 0 ? "#2980b9" : "#c0392b"}">${paraFormat(g.fark)}</span></td>
                <td class="tablo-soluk">${escapeHtml(g.kapatanKullanici || "")}</td>
                <td>${g.iptalEdildi
                  ? `<span class="tablo-soluk">🔓 Yeniden açıldı</span>`
                  : g.tarih === tarihAnahtari()
                    ? `<button class="btn-ikincil btn-kucuk" data-ac="${g.id}">🔓 Yeniden Aç</button>`
                    : `<span class="tablo-soluk">—</span>`}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

  gunSonuListeEl.querySelectorAll("[data-ac]").forEach((b) => b.addEventListener("click", () => gunSonuAc(b.dataset.ac)));

  const hareketSirali = hareketler.slice().sort((a, b) => (b.zaman?.toMillis?.() || 0) - (a.zaman?.toMillis?.() || 0));
  hareketListeEl.innerHTML = hareketSirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta manuel kasa hareketi yok.</div>`
    : `<div style="overflow-x:auto;">
        <table class="veri-tablo">
          <thead><tr><th>Tür</th><th>Tutar</th><th>Şube</th><th>Açıklama</th><th>Yapan</th><th>Zaman</th></tr></thead>
          <tbody>
            ${hareketSirali.map((k) => `
              <tr>
                <td style="color:${k.tur === "nakit_giris" ? "var(--renk-yesil)" : "var(--renk-kirmizi)"};font-weight:700;">${k.tur === "nakit_giris" ? "⬆️ Giriş" : "⬇️ Çıkış"}</td>
                <td>${paraFormat(k.tutar)}</td>
                <td>${escapeHtml(k.subeAdi || "")}</td>
                <td>${escapeHtml(k.aciklama || "—")}</td>
                <td class="tablo-soluk">${escapeHtml(k.yapanKullanici || "")}</td>
                <td class="tablo-soluk">${tarihFormat(k.zaman)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

// Yanlışlıkla veya hatalı sayımla kapatılmış bir gün sonunu admin geri açar
// — kapanış kaydı SİLİNMEZ (denetim izi/kontrol için korunur), sadece
// "iptalEdildi" ile işaretlenir ve şubenin kasa devri bu kapanıştan önceki
// haline döndürülür. Böylece o gün için kasa yeniden (doğru şekilde)
// kapatılabilir hale gelir.
async function gunSonuAc(id) {
  const g = gunSonuKapanislariCache.find((x) => x.id === id);
  if (!g) return;
  // Şubenin kasa devri (sonKasaDevri) tarih bazlı bir defter değil, tek bir
  // "son bakiye" alanıdır — sadece EN GÜNCEL (bugünkü) kapanış güvenle geri
  // alınabilir. Daha eski bir kapanışı geri almak, aradaki günlerin devrini
  // bozacağından desteklenmez (arayüzde de sadece bugünküne buton çıkar).
  if (g.tarih !== tarihAnahtari()) {
    bildirimGoster("Sadece bugünün gün sonu kapanışı yeniden açılabilir.", "uyari");
    return;
  }
  if (!confirm(`"${g.subeAdi}" şubesinin ${tarihAnahtariniOku(g.tarih)} tarihli gün sonu kapanışı yeniden açılacak.\n\nKasa devri ${paraFormat(g.devirTutari)} değerine geri alınacak ve o gün için kasa yeniden kapatılabilir olacak. Emin misiniz?`)) return;
  try {
    await updateDoc(doc(db, "gunSonuKapanislari", id), {
      iptalEdildi: true,
      iptalZamani: serverTimestamp(),
      iptalEdenKullanici: auth.currentUser?.displayName || auth.currentUser?.email || "",
    });
    await updateDoc(doc(db, "subeler", g.subeId), { sonKasaDevri: g.devirTutari, sonGunSonuTarihi: null });
    bildirimGoster("Gün sonu yeniden açıldı.", "basari");
  } catch (err) {
    bildirimGoster("Hata: " + err.message, "hata");
  }
}
