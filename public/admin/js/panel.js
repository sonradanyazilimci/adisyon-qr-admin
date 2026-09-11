import { db } from "../../shared/firebase-config.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { paraFormat, escapeHtml, snapshotHataYakala } from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

const kartlarEl = document.getElementById("panel-kartlar");
const haftalikEl = document.getElementById("panel-haftalik");
const cokSatanEl = document.getElementById("panel-cok-satan");
const subeOzetKartEl = document.getElementById("panel-sube-ozet-kart");
const subeOzetEl = document.getElementById("panel-sube-ozet");

// Ciroya SADECE gerçekten satışa dönüşen siparişler girer — raporlar.js'teki
// tanımla birebir aynı (bkz. orada satisMi): "onay_bekliyor" henüz onaylanmamış
// bir taslak, "iptal" ise iptal edilmiş — ikisi de ciro dışı sayılmazsa
// panel raporlarla tutarsız (şişirilmiş) bir "bugünkü ciro" gösterir.
const SATIS_DISI_DURUMLAR = ["onay_bekliyor", "iptal"];
function satisMi(s) {
  return s.durum !== undefined && !SATIS_DISI_DURUMLAR.includes(s.durum);
}

let urunlerCache = [];
let masalarCache = [];
let siparislerCache = [];
let kritikStokSayisi = 0;

export function baslat() {
  onSnapshot(query(collection(db, "urunler")), (snap) => {
    urunlerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, snapshotHataYakala("panel-urunler"));

  onSnapshot(query(collection(db, "masalar")), (snap) => {
    masalarCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, snapshotHataYakala("panel-masalar"));

  onSnapshot(query(collection(db, "hammaddeler")), (snap) => {
    kritikStokSayisi = snap.docs.filter((d) => Number(d.data().mevcutStok) <= Number(d.data().kritikEsik ?? 0)).length;
    render();
  }, snapshotHataYakala("panel-hammaddeler"));

  onSnapshot(query(collection(db, "siparisler")), (snap) => {
    siparislerCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, snapshotHataYakala("panel-siparisler"));

  // Şube listesi değiştikçe (yeni şube eklendi/silindi) çok şubeli
  // karşılaştırma tablosu da güncellenmeli.
  subelerDegisti(() => render());
}

function gunBaslangici(gunOncesi = 0) {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - gunOncesi);
  return t;
}

function tarihi(s) {
  return s.olusturmaZamani?.toDate ? s.olusturmaZamani.toDate() : null;
}

function render() {
  const urunSayisi = urunlerCache.length;
  const aktifUrunSayisi = urunlerCache.filter((u) => u.aktif !== false).length;
  const masaSayisi = masalarCache.length;
  const doluMasaSayisi = masalarCache.filter((m) => m.durum === "dolu" || m.durum === "odeme_bekliyor").length;

  const bugunBaslangic = gunBaslangici(0);
  const dunBaslangic = gunBaslangici(1);

  const satislar = siparislerCache.filter(satisMi);
  const bugunSatislar = satislar.filter((s) => { const t = tarihi(s); return t && t >= bugunBaslangic; });
  const dunSatislar = satislar.filter((s) => { const t = tarihi(s); return t && t >= dunBaslangic && t < bugunBaslangic; });

  const bugunkuCiro = bugunSatislar.reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
  const dunkuCiro = dunSatislar.reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
  const ortalamaFis = bugunSatislar.length > 0 ? bugunkuCiro / bugunSatislar.length : 0;
  const acikSiparisSayisi = siparislerCache.filter((s) => ["yeni", "hazirlaniyor", "hazir"].includes(s.durum)).length;

  renderKartlar({ bugunkuCiro, dunkuCiro, ortalamaFis, bugunSiparisSayisi: bugunSatislar.length, acikSiparisSayisi, doluMasaSayisi, masaSayisi, aktifUrunSayisi, urunSayisi, kritikStokSayisi });
  renderHaftalik(satislar, bugunBaslangic);
  renderCokSatan(bugunSatislar);
  renderSubeOzet(bugunSatislar, masalarCache);
}

function trendRozeti(bugun, dun) {
  if (dun <= 0) return `<span class="trend flat">—</span>`;
  const fark = ((bugun - dun) / dun) * 100;
  if (Math.abs(fark) < 1) return `<span class="trend flat">≈ dün ile aynı</span>`;
  const yon = fark > 0 ? "up" : "down";
  const ok = fark > 0 ? "▲" : "▼";
  return `<span class="trend ${yon}">${ok} %${Math.abs(fark).toFixed(0)} dün'e göre</span>`;
}

function renderKartlar(v) {
  kartlarEl.innerHTML = `
    <div class="panel-kart">
      <div class="ikon">💰</div>
      <div class="etiket">Bugünkü Ciro</div>
      <div class="deger">${paraFormat(v.bugunkuCiro)}</div>
      ${trendRozeti(v.bugunkuCiro, v.dunkuCiro)}
    </div>
    <div class="panel-kart">
      <div class="ikon">🧾</div>
      <div class="etiket">Ortalama Fiş</div>
      <div class="deger">${paraFormat(v.ortalamaFis)}</div>
      <span class="trend flat">bugün ${v.bugunSiparisSayisi} sipariş</span>
    </div>
    <div class="panel-kart">
      <div class="ikon">🍳</div>
      <div class="etiket">Açık Sipariş</div>
      <div class="deger">${v.acikSiparisSayisi}</div>
    </div>
    <div class="panel-kart">
      <div class="ikon">🪑</div>
      <div class="etiket">Dolu Masa</div>
      <div class="deger">${v.doluMasaSayisi} / ${v.masaSayisi}</div>
    </div>
    <div class="panel-kart">
      <div class="ikon">🍔</div>
      <div class="etiket">Aktif Ürün</div>
      <div class="deger">${v.aktifUrunSayisi} / ${v.urunSayisi}</div>
    </div>
    <div class="panel-kart${v.kritikStokSayisi > 0 ? " panel-kart-kritik" : ""}">
      <div class="ikon">${v.kritikStokSayisi > 0 ? "⚠️" : "📦"}</div>
      <div class="etiket">Kritik Stok</div>
      <div class="deger">${v.kritikStokSayisi}</div>
    </div>
  `;
}

// Son 7 gün (bugün dahil) — satışa dönüşmüş siparişlerin günlük ciro toplamı.
function renderHaftalik(satislar, bugunBaslangic) {
  if (!haftalikEl) return;
  const GUN_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const gunler = [];
  for (let i = 6; i >= 0; i--) {
    const baslangic = gunBaslangici(i);
    const bitis = i === 0 ? new Date(bugunBaslangic.getTime() + 24 * 60 * 60 * 1000) : gunBaslangici(i - 1);
    const ciro = satislar
      .filter((s) => { const t = tarihi(s); return t && t >= baslangic && t < bitis; })
      .reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
    gunler.push({ etiket: GUN_KISA[baslangic.getDay()], ciro, bugunMu: i === 0 });
  }
  const enYuksek = Math.max(...gunler.map((g) => g.ciro), 1);

  haftalikEl.innerHTML = `
    <h3>📈 Son 7 Gün Ciro</h3>
    <div class="hafta-grafik">
      ${gunler.map((g) => `
        <div class="hafta-cubuk-dis">
          <span class="hafta-deger">${g.ciro > 0 ? Math.round(g.ciro / 1000) + "b" : "—"}</span>
          <div class="hafta-cubuk${g.bugunMu ? " bugun" : ""}" style="height:${Math.max((g.ciro / enYuksek) * 100, 2)}%" title="${paraFormat(g.ciro)}"></div>
          <span class="hafta-etiket">${g.etiket}</span>
        </div>`).join("")}
    </div>
  `;
}

function renderCokSatan(bugunSatislar) {
  if (!cokSatanEl) return;
  const urunAdet = new Map();
  bugunSatislar.forEach((s) => (s.urunler || []).forEach((k) => {
    urunAdet.set(k.ad, (urunAdet.get(k.ad) || 0) + (Number(k.adet) || 0));
  }));
  const sirali = Array.from(urunAdet.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const enYuksek = sirali[0]?.[1] || 1;

  cokSatanEl.innerHTML = `<h3>🏆 Bugün Çok Satanlar</h3>` + (sirali.length === 0
    ? `<div class="bos-durum">Bugün henüz satış yok.</div>`
    : sirali.map(([ad, adet]) => `
        <div class="bar-satir">
          <span class="ad" title="${escapeHtml(ad)}">${escapeHtml(ad)}</span>
          <div class="bar-dis"><div class="bar-ic" style="width:${(adet / enYuksek) * 100}%"></div></div>
          <span class="adet">${adet} adet</span>
        </div>`).join(""));
}

// Çok şubeli işletmeler için tek bakışta karşılaştırma — client tarafında
// zaten dinlenmekte olan siparisler/masalar önbelleğinden şubeId'ye göre
// gruplanır; ayrı bir sorgu/backend gerekmez.
function renderSubeOzet(bugunSatislar, masalar) {
  if (!subeOzetKartEl || !subeOzetEl) return;
  if (subelerCache.length <= 1) {
    subeOzetKartEl.hidden = true;
    return;
  }
  subeOzetKartEl.hidden = false;

  const satirlar = subelerCache.map((sube) => {
    const sSatis = bugunSatislar.filter((s) => s.subeId === sube.id);
    const sCiro = sSatis.reduce((acc, s) => acc + (Number(s.toplamTutar) || 0), 0);
    const sMasalar = masalar.filter((m) => m.subeId === sube.id);
    const sDolu = sMasalar.filter((m) => m.durum === "dolu" || m.durum === "odeme_bekliyor").length;
    const sOrtFis = sSatis.length > 0 ? sCiro / sSatis.length : 0;
    return { ad: sube.ad, ciro: sCiro, dolu: sDolu, toplamMasa: sMasalar.length, ortFis: sOrtFis };
  }).sort((a, b) => b.ciro - a.ciro);

  const enYuksekCiro = Math.max(...satirlar.map((s) => s.ciro), 1);

  subeOzetEl.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="veri-tablo">
        <thead><tr><th>Şube</th><th>Bugünkü Ciro</th><th>Dolu Masa</th><th>Ortalama Fiş</th></tr></thead>
        <tbody>
          ${satirlar.map((s, i) => `
            <tr>
              <td><strong>${i === 0 && s.ciro > 0 ? "👑 " : ""}${escapeHtml(s.ad)}</strong></td>
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div class="bar-dis" style="width:90px;flex-shrink:0;"><div class="bar-ic" style="width:${(s.ciro / enYuksekCiro) * 100}%"></div></div>
                  <b>${paraFormat(s.ciro)}</b>
                </div>
              </td>
              <td>${s.dolu} / ${s.toplamMasa}</td>
              <td>${paraFormat(s.ortFis)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}
