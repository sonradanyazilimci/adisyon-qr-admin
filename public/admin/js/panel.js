import { db } from "../../shared/firebase-config.js";
import { collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { paraFormat, snapshotHataYakala } from "../../shared/utils.js";

const kartlarEl = document.getElementById("panel-kartlar");

let urunSayisi = 0, aktifUrunSayisi = 0;
let masaSayisi = 0, doluMasaSayisi = 0;
let kritikStokSayisi = 0;
let acikSiparisSayisi = 0;
let bugunkuCiro = 0;

export function baslat() {
  onSnapshot(query(collection(db, "urunler")), (snap) => {
    urunSayisi = snap.size;
    aktifUrunSayisi = snap.docs.filter((d) => d.data().aktif !== false).length;
    render();
  }, snapshotHataYakala("panel-urunler"));

  onSnapshot(query(collection(db, "masalar")), (snap) => {
    masaSayisi = snap.size;
    doluMasaSayisi = snap.docs.filter((d) => d.data().durum === "dolu" || d.data().durum === "odeme_bekliyor").length;
    render();
  }, snapshotHataYakala("panel-masalar"));

  onSnapshot(query(collection(db, "hammaddeler")), (snap) => {
    kritikStokSayisi = snap.docs.filter((d) => Number(d.data().mevcutStok) <= Number(d.data().kritikEsik ?? 0)).length;
    render();
  }, snapshotHataYakala("panel-hammaddeler"));

  onSnapshot(query(collection(db, "siparisler")), (snap) => {
    const bugunBaslangic = new Date();
    bugunBaslangic.setHours(0, 0, 0, 0);
    acikSiparisSayisi = 0;
    bugunkuCiro = 0;
    snap.docs.forEach((d) => {
      const s = d.data();
      if (["yeni", "hazirlaniyor", "hazir"].includes(s.durum)) acikSiparisSayisi++;
      const tarih = s.olusturmaZamani?.toDate ? s.olusturmaZamani.toDate() : null;
      if (tarih && tarih >= bugunBaslangic) bugunkuCiro += Number(s.toplamTutar) || 0;
    });
    render();
  }, snapshotHataYakala("panel-siparisler"));
}

function render() {
  kartlarEl.innerHTML = `
    <div class="panel-kart"><div class="etiket">Bugünkü Ciro</div><div class="deger">${paraFormat(bugunkuCiro)}</div></div>
    <div class="panel-kart"><div class="etiket">Açık Sipariş</div><div class="deger">${acikSiparisSayisi}</div></div>
    <div class="panel-kart"><div class="etiket">Dolu Masa</div><div class="deger">${doluMasaSayisi} / ${masaSayisi}</div></div>
    <div class="panel-kart"><div class="etiket">Aktif Ürün</div><div class="deger">${aktifUrunSayisi} / ${urunSayisi}</div></div>
    <div class="panel-kart" style="${kritikStokSayisi > 0 ? "border:1.5px solid var(--renk-kirmizi);" : ""}"><div class="etiket">Kritik Stok</div><div class="deger" style="${kritikStokSayisi > 0 ? "color:var(--renk-kirmizi);" : ""}">${kritikStokSayisi}</div></div>
  `;
}
