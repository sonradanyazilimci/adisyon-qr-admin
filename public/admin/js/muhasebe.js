import { db } from "../../shared/firebase-config.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  paraFormat, escapeHtml, tarihFormat, tarihAnahtariniOku, tarihAraligiBaslangici, snapshotHataYakala,
} from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

let adisyonlarCache = [];
let kasaHareketleriCache = [];
let gunSonuKapanislariCache = [];

const ozetEl = document.getElementById("muhasebe-ozet");
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

  const gsSirali = gunSonulari.slice().sort((a, b) => (b.kapanmaZamani?.toMillis?.() || 0) - (a.kapanmaZamani?.toMillis?.() || 0));
  gunSonuListeEl.innerHTML = gsSirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta gün sonu kapanışı yok.</div>`
    : gsSirali.map((g) => `
      <div class="liste-satir">
        <div class="ana-bilgi">
          <strong>${escapeHtml(g.subeAdi || "")} — ${tarihAnahtariniOku(g.tarih)}</strong>
          <span>Devir: ${paraFormat(g.devirTutari)} · Beklenen: ${paraFormat(g.beklenenNakit)} · Sayılan: ${paraFormat(g.sayilanNakit)} · Kapatan: ${escapeHtml(g.kapatanKullanici || "")}</span>
        </div>
        <span class="rozet" style="background:${g.fark === 0 ? "#27ae60" : (g.fark || 0) > 0 ? "#2980b9" : "#c0392b"}">Fark: ${paraFormat(g.fark)}</span>
      </div>`).join("");

  const hareketSirali = hareketler.slice().sort((a, b) => (b.zaman?.toMillis?.() || 0) - (a.zaman?.toMillis?.() || 0));
  hareketListeEl.innerHTML = hareketSirali.length === 0
    ? `<div class="bos-durum">Seçilen aralıkta manuel kasa hareketi yok.</div>`
    : hareketSirali.map((k) => `
      <div class="liste-satir">
        <div class="ana-bilgi">
          <strong style="color:${k.tur === "nakit_giris" ? "var(--renk-yesil)" : "var(--renk-kirmizi)"}">${k.tur === "nakit_giris" ? "⬆️ Giriş" : "⬇️ Çıkış"} — ${paraFormat(k.tutar)}</strong>
          <span>${escapeHtml(k.subeAdi || "")} · ${escapeHtml(k.aciklama || "")} · ${escapeHtml(k.yapanKullanici || "")} · ${tarihFormat(k.zaman)}</span>
        </div>
      </div>`).join("");
}
