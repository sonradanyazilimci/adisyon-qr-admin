import { db } from "../../shared/firebase-config.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  escapeHtml, saatFormat, tarihAnahtariniOku, tarihAraligiBaslangici, snapshotHataYakala,
} from "../../shared/utils.js";
import { subelerCache, subelerDegisti } from "./subeler.js";

let puantajCache = [];
const ozetEl = document.getElementById("puantaj-ozet");
const listeEl = document.getElementById("puantaj-liste");
const aralikEl = document.getElementById("puantaj-aralik");
const subeEl = document.getElementById("puantaj-sube");

export function baslat() {
  onSnapshot(
    query(collection(db, "puantaj")),
    (snap) => {
      puantajCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    snapshotHataYakala("puantaj")
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

  let liste = puantajCache;
  if (subeFiltre) liste = liste.filter((p) => p.subeId === subeFiltre);
  if (sinir) {
    liste = liste.filter((p) => {
      const tarih = p.girisZamani?.toDate ? p.girisZamani.toDate() : null;
      return tarih && tarih >= sinir;
    });
  }
  liste = liste.slice().sort((a, b) => (b.girisZamani?.toMillis?.() || 0) - (a.girisZamani?.toMillis?.() || 0));

  const toplamKayit = liste.length;
  const gecGelenSayisi = liste.filter((p) => p.gecGeldi).length;
  const erkenCikanSayisi = liste.filter((p) => p.erkenCikti).length;
  const tamamlanmamis = liste.filter((p) => !p.cikisZamani).length;

  ozetEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">Toplam Vardiya</div><div class="deger">${toplamKayit}</div></div>
    <div class="panel-kart"><div class="etiket">Geç / Erken</div><div class="deger" style="color:#e67e22;">${gecGelenSayisi} / ${erkenCikanSayisi}</div></div>
    <div class="panel-kart"><div class="etiket">Hâlâ İşte</div><div class="deger">${tamamlanmamis}</div></div>
  `;

  if (liste.length === 0) {
    listeEl.innerHTML = `<div class="bos-durum">Seçilen aralıkta puantaj kaydı yok.</div>`;
    return;
  }

  // Sade, tek bakışta okunabilir bir tablo — kart yığını yerine (çok
  // personel/gün olduğunda kartlar hızla karışıyordu).
  listeEl.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="veri-tablo">
        <thead><tr><th>Personel</th><th>Şube</th><th>Tarih</th><th>Giriş</th><th>Çıkış</th></tr></thead>
        <tbody>
          ${liste.map((p) => `
            <tr>
              <td>${escapeHtml(p.personelAdi)} <span class="tablo-soluk">(${escapeHtml(p.rol)})</span></td>
              <td>${escapeHtml(p.subeAdi || "—")}</td>
              <td>${tarihAnahtariniOku(p.tarih)}</td>
              <td>${saatFormat(p.girisZamani)}${p.gecGeldi ? ` <span class="rozet" style="background:#e67e22;">Geç</span>` : ""}</td>
              <td>${p.cikisZamani ? saatFormat(p.cikisZamani) : "—"}${p.erkenCikti ? ` <span class="rozet" style="background:#e67e22;">Erken</span>` : ""}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}
