// Persistance locale : IndexedDB.
//
// Pourquoi pas le serveur : la progression des utilisateurs iOS vit dans
// CloudKit, l'iCloud privé de chacun, et n'est pas joignable depuis un
// navigateur. La remonter au serveur supposerait un système de comptes, une
// couche de synchronisation dans l'app iOS, et l'exposition de données
// personnelles aujourd'hui confinées à l'appareil. Cette version garde donc la
// progression DANS LE NAVIGATEUR : rien ne sort, aucun compte à créer, et
// l'ajout d'une synchronisation reste possible plus tard sans rien jeter.

const BASE = "nuka";
const VERSION = 1;

function ouvre() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      // Une entrée par carte : clé « idCours#indexCarte ».
      if (!db.objectStoreNames.contains("progression")) {
        db.createObjectStore("progression", { keyPath: "cle" });
      }
      // Les cours ajoutés à la bibliothèque, avec leur contenu en cache pour
      // que la révision fonctionne hors ligne une fois le cours ouvert.
      if (!db.objectStoreNames.contains("cours")) {
        db.createObjectStore("cours", { keyPath: "id" });
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

function transaction(magasin, mode, action) {
  return ouvre().then(db => new Promise((ok, ko) => {
    const t = db.transaction(magasin, mode);
    const res = action(t.objectStore(magasin));
    t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res);
    t.onerror = () => ko(t.error);
  }));
}

export const store = {
  cle: (idCours, index) => `${idCours}#${index}`,

  async progression(idCours, index) {
    const r = await transaction("progression", "readonly",
      m => m.get(store.cle(idCours, index)));
    return r ? r.etat : null;
  },

  async progressionDuCours(idCours) {
    const tout = await transaction("progression", "readonly", m => m.getAll());
    const parIndex = {};
    for (const e of tout || []) {
      if (e.cle.startsWith(idCours + "#")) {
        parIndex[Number(e.cle.split("#")[1])] = e.etat;
      }
    }
    return parIndex;
  },

  enregistre(idCours, index, etat) {
    return transaction("progression", "readwrite",
      m => m.put({ cle: store.cle(idCours, index), etat }));
  },

  ajouteCours(fichier) {
    return transaction("cours", "readwrite",
      m => m.put({ id: fichier.id, fichier, ajoute: new Date().toISOString() }));
  },

  /**
   * Réenregistre un cours modifié.
   *
   * Une carte ajoutée ou corrigée ne vit que dans ce navigateur : le site ne
   * réécrit pas dans iCloud. C'est dit à l'utilisateur au moment où il édite,
   * pas caché dans une page d'aide.
   */
  metAJourCours(fichier) {
    return transaction("cours", "readwrite", m => m.put({
      id: fichier.id, fichier, ajoute: new Date().toISOString(),
    }));
  },

  /** Efface la progression d'un cours — après une suppression de carte. */
  async effaceProgression(idCours) {
    const tout = await transaction("progression", "readonly", m => m.getAll());
    const aOter = (tout || []).filter(e => e.cle.startsWith(idCours + "#"));
    for (const e of aOter) {
      await transaction("progression", "readwrite", m => m.delete(e.cle));
    }
  },

  retireCours(id) {
    return transaction("cours", "readwrite", m => m.delete(id));
  },

  async bibliotheque() {
    const tout = await transaction("cours", "readonly", m => m.getAll());
    return (tout || []).sort((a, b) => b.ajoute.localeCompare(a.ajoute));
  },

  /** Les statistiques venues d'iCloud, conservées entre deux visites. */
  memoriseStats(stats) {
    try { localStorage.setItem("nuka.stats", JSON.stringify(stats)); } catch {}
  },

  stats() {
    try { return JSON.parse(localStorage.getItem("nuka.stats") || "null"); }
    catch { return null; }
  },

  async possede(id) {
    const r = await transaction("cours", "readonly", m => m.get(id));
    return !!r;
  },
};
