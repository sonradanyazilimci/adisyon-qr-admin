import { db } from "../../shared/firebase-config.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { paraFormat, escapeHtml, snapshotHataYakala, tarihAraligiBaslangici } from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

let siparislerCache = [];
const ozetEl = document.getElementById("rapor-ozet");
const enCokSatanEl = document.getElementById("rapor-en-cok-satan");
const aralikEl = document.getElementById("rapor-aralik");
const subeEl = document.getElementById("rapor-sube");

export function baslat() {
  onSnapshot(
    query(collection(db, "siparisler")),
    (snap) => {
      siparislerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("raporlar")
  );
  subelerDegisti(() => { renderSubeSecim(); render(); });
  aralikEl.addEventListener("change", render);
  subeEl.addEventListener("change", render);
}

function renderSubeSecim() {
  const secili = subeEl.value;
  subeEl.innerHTML = `<option value="">Tüm Şubeler</option>` + subelerCache.map((s) => `<option value="${s.id}">${escapeHtml(s.ad)}</option>`).join("");
  subeEl.value = secili;
}

function render() {
  const sinir = tarihAraligiBaslangici(aralikEl.value);
  const subeFiltre = subeEl.value;

  let liste = siparislerCache.filter((s) => s.durum !== undefined); // tüm kayıtlı siparişler
  if (subeFiltre) liste = liste.filter((s) => s.subeId === subeFiltre);
  if (sinir) {
    liste = liste.filter((s) => {
      const tarih = s.olusturmaZamani?.toDate ? s.olusturmaZamani.toDate() : null;
      return tarih && tarih >= sinir;
    });
  }

  const toplamCiro = liste.reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
  const siparisSayisi = liste.length;
  const ortalamaFis = siparisSayisi ? toplamCiro / siparisSayisi : 0;

  ozetEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">Toplam Ciro</div><div class="deger">${paraFormat(toplamCiro)}</div></div>
    <div class="panel-kart"><div class="etiket">Sipariş Sayısı</div><div class="deger">${siparisSayisi}</div></div>
    <div class="panel-kart"><div class="etiket">Ortalama Sipariş Tutarı</div><div class="deger">${paraFormat(ortalamaFis)}</div></div>
  `;

  // En çok satan ürünler
  const urunAdet = new Map();
  liste.forEach((s) => {
    (s.urunler || []).forEach((k) => {
      urunAdet.set(k.ad, (urunAdet.get(k.ad) || 0) + Number(k.adet || 0));
    });
  });
  const siraliUrunler = Array.from(urunAdet.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const enYuksek = siraliUrunler[0]?.[1] || 1;

  if (siraliUrunler.length === 0) {
    enCokSatanEl.innerHTML = `<h3>En Çok Satan Ürünler</h3><div class="bos-durum">Seçilen aralıkta veri yok.</div>`;
  } else {
    enCokSatanEl.innerHTML = `<h3>En Çok Satan Ürünler</h3>` +
      siraliUrunler.map(([ad, adet]) => `
        <div class="bar-satir">
          <span class="ad" title="${escapeHtml(ad)}">${escapeHtml(ad)}</span>
          <div class="bar-dis"><div class="bar-ic" style="width:${(adet / enYuksek) * 100}%"></div></div>
          <span class="adet">${adet} adet</span>
        </div>`).join("");
  }
}
