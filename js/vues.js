// Les écrans de Nuka web, hors accueil et session.
//
// Cinq onglets, comme dans l'application iOS : Accueil, Catalogue, Réviser,
// Statistiques, Profil. Reprendre la même architecture n'est pas une coquetterie
// — quelqu'un qui passe du téléphone au navigateur ne doit pas réapprendre où
// se trouvent les choses.

import { manifeste, cours as chargeFichier, langues, parMatiere, NOMS_LANGUES, DRAPEAUX } from "./catalogue.js";
import { store } from "./store.js";
import { carteNeuve, estDue } from "./sm2.js";

export const echappe = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Les cours de la bibliothèque, enrichis de ce qui est dû. */
export async function bibliothequeEnrichie() {
  const mes = await store.bibliotheque();
  return Promise.all(mes.map(async ({ fichier }) => {
    const prog = await store.progressionDuCours(fichier.id);
    const dues = fichier.cards.filter((_, i) => estDue(prog[i])).length;
    const vues = Object.values(prog).filter(e => e && e.timesReviewed > 0).length;
    return { fichier, dues, vues, total: fichier.cards.length };
  }));
}

// ── Accueil : les cours de l'utilisateur ─────────────────────────────────

export async function ecranAccueilCours(vue, etat) {
  const liste = await bibliothequeEnrichie();
  const stats = store.stats();

  if (!liste.length) {
    vue.innerHTML = `<div class="carte vide">
      <div class="emoji">📚</div>
      <h2>Ta bibliothèque est vide</h2>
      <p>Choisis un cours dans le catalogue, ou connecte-toi à iCloud pour
         retrouver ceux de ton iPhone.</p>
      <a class="bouton" href="#/catalogue">Ouvrir le catalogue</a>
    </div>`;
    return;
  }

  const dusTotal = liste.reduce((n, c) => n + c.dues, 0);
  const filtre = etat.filtre || "";
  const visibles = liste.filter(c =>
    !filtre || c.fichier.title.toLowerCase().includes(filtre.toLowerCase()));

  vue.innerHTML = `
    ${stats ? enteteProgression(stats) : ""}
    ${dusTotal ? `<a class="carte aReviser" href="#/reviser-tout">
        <div>
          <h3>${dusTotal} carte${dusTotal > 1 ? "s" : ""} à réviser</h3>
          <p class="meta">Tous cours confondus</p>
        </div>
        <span class="fleche">→</span>
      </a>` : `<div class="carte ajour"><p>Tout est à jour. Rien à réviser aujourd'hui.</p></div>`}

    <div class="barreRecherche">
      <input id="recherche" type="search" placeholder="Rechercher un cours…"
             value="${echappe(filtre)}" autocomplete="off">
    </div>

    <div class="liste">${visibles.map(carteCours).join("")
      || "<p class='intro'>Aucun cours ne correspond.</p>"}</div>`;

  const champ = document.getElementById("recherche");
  champ.oninput = () => {
    etat.filtre = champ.value;
    const pos = champ.selectionStart;
    ecranAccueilCours(vue, etat).then(() => {
      const n = document.getElementById("recherche");
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    });
  };
}

function enteteProgression(s) {
  return `<div class="carte progression">
    <div class="bloc"><span class="valeur">${s.niveau}</span><span class="etiquette">Niveau</span></div>
    <div class="bloc"><span class="valeur">${s.serie}</span><span class="etiquette">Jours d'affilée</span></div>
    <div class="bloc"><span class="valeur">${s.cartesRevisees}</span><span class="etiquette">Cartes revues</span></div>
  </div>`;
}

function carteCours({ fichier, dues, total }) {
  return `<a class="carte cours" href="#/cours/${encodeURIComponent(fichier.id)}">
    <div class="emoji">${echappe(fichier.emoji || "📚")}</div>
    <div class="corps">
      <h3>${echappe(fichier.title)}</h3>
      <p class="meta">${total} carte${total > 1 ? "s" : ""}${
        fichier.origine === "icloud" ? " · iPhone" : ""}</p>
    </div>
    ${dues ? `<span class="pastille">${dues}</span>` : `<span class="apour">à jour</span>`}
  </a>`;
}

// ── Réviser : tout ce qui est dû ─────────────────────────────────────────

export async function ecranReviser(vue) {
  const liste = (await bibliothequeEnrichie()).filter(c => c.dues > 0);
  const total = liste.reduce((n, c) => n + c.dues, 0);

  vue.innerHTML = `
    <h1>Réviser</h1>
    ${total ? `
      <p class="intro">${total} carte${total > 1 ? "s" : ""} à revoir aujourd'hui.</p>
      <a class="bouton" href="#/reviser-tout">Tout réviser</a>
      <h2>Par cours</h2>
      <div class="liste">${liste.map(carteCours).join("")}</div>`
    : `<div class="carte vide">
        <div class="emoji">✅</div>
        <h2>Rien à réviser</h2>
        <p>Tes cartes reviendront à leur échéance. La répétition espacée fait
           son travail même quand tu ne fais rien.</p>
      </div>`}`;
}

// ── Statistiques ─────────────────────────────────────────────────────────

export async function ecranStats(vue) {
  const s = store.stats();
  const liste = await bibliothequeEnrichie();
  const cartes = liste.reduce((n, c) => n + c.total, 0);
  const vues = liste.reduce((n, c) => n + c.vues, 0);

  vue.innerHTML = `
    <h1>Statistiques</h1>
    ${s ? `
      <p class="intro">Chiffres tenus par l'application iPhone, lus depuis iCloud.</p>
      <div class="grilleStats">
        ${bloc("Niveau", s.niveau)}
        ${bloc("Expérience", s.xp)}
        ${bloc("Série en cours", s.serie + " j")}
        ${bloc("Meilleure série", s.meilleureSerie + " j")}
        ${bloc("Cartes revues", s.cartesRevisees)}
        ${bloc("Bonnes réponses", s.bonnesReponses)}
        ${bloc("Taux de réussite", s.cartesRevisees
            ? Math.round((s.bonnesReponses / s.cartesRevisees) * 100) + " %" : "—")}
        ${bloc("Temps d'étude", dureeLisible(s.tempsEtudeSecondes))}
      </div>` : `<p class="intro">Connecte-toi à iCloud pour retrouver les
        statistiques tenues par ton iPhone.</p>`}

    <h2>Sur ce navigateur</h2>
    <div class="grilleStats">
      ${bloc("Cours", liste.length)}
      ${bloc("Cartes", cartes)}
      ${bloc("Cartes déjà vues ici", vues)}
    </div>`;
}

const bloc = (etiquette, valeur) => `<div class="carte statBloc">
  <span class="valeur">${echappe(valeur)}</span>
  <span class="etiquette">${echappe(etiquette)}</span></div>`;

function dureeLisible(secondes) {
  if (!secondes) return "—";
  const h = Math.floor(secondes / 3600), m = Math.round((secondes % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

// ── Catalogue ────────────────────────────────────────────────────────────

export async function ecranCatalogue(vue, langue) {
  const m = await manifeste();
  if (!langue) {
    const lignes = langues(m).map(([lg, n]) =>
      `<a class="carte langue" href="#/catalogue/${lg}">
         <span class="drapeau">${DRAPEAUX[lg] || "🌍"}</span>
         <span class="nom">${echappe(NOMS_LANGUES[lg] || lg)}</span>
         <span class="apour">${n} cours</span>
       </a>`).join("");
    vue.innerHTML = `<h1>Catalogue</h1>
      <p class="intro">${m.courses.length} cours gratuits, les mêmes que dans l'application.</p>
      <div class="liste">${lignes}</div>`;
    return;
  }
  const groupes = parMatiere(m, langue);
  const possedes = new Set((await store.bibliotheque()).map(c => c.id));
  const sections = Object.entries(groupes).map(([matiere, l]) => `
    <h2>${echappe(matiere.replace(/-/g, " "))}</h2>
    <div class="liste">${l.map(c => `
      <a class="carte cours" href="#/cours/${encodeURIComponent(c.id)}">
        <div class="emoji">${echappe(c.emoji || "📚")}</div>
        <div class="corps">
          <h3>${echappe(c.title)}</h3>
          <p class="meta">${c.cardCount} cartes${c.level ? " · " + echappe(c.level) : ""}</p>
        </div>
        ${possedes.has(c.id) ? `<span class="apour">déjà pris</span>` : ""}
      </a>`).join("")}</div>`).join("");
  vue.innerHTML = `<a class="retour" href="#/catalogue">← Toutes les langues</a>
    <h1>${DRAPEAUX[langue] || "🌍"} ${echappe(NOMS_LANGUES[langue] || langue)}</h1>${sections}`;
}

export { chargeFichier };

// ── Fiche d'un cours ─────────────────────────────────────────────────────

/**
 * La liste des cartes manquait entièrement.
 *
 * On voyait « 24 cartes » sans pouvoir en regarder une seule : impossible de
 * vérifier ce qui avait été importé, ni de relire une carte sans lancer une
 * session. Chaque carte montre désormais son recto, son verso au clic, et son
 * échéance — c'est cette dernière qui prouve que la progression du téléphone
 * est bien arrivée.
 */
export async function ecranCours(vue, id, fichier, prog, possede) {
  const dues = fichier.cards.filter((_, i) => estDue(prog[i])).length;
  const venuDiCloud = fichier.origine === "icloud";

  vue.innerHTML = `
    <a class="retour" href="#/${venuDiCloud ? "accueil" : "catalogue"}">← Retour</a>
    <div class="entete">
      <div class="emoji gros">${echappe(fichier.emoji || "📚")}</div>
      <div>
        <h1>${echappe(fichier.title)}</h1>
        <p class="meta">${fichier.cards.length} cartes${
          venuDiCloud ? " · depuis ton iPhone" : ""}${
          fichier.level ? " · " + echappe(fichier.level) : ""}</p>
      </div>
    </div>
    ${fichier.courseDescription ? `<p class="intro">${echappe(fichier.courseDescription)}</p>` : ""}
    <div class="actions">
      <a class="bouton" href="#/reviser/${encodeURIComponent(id)}">
        ${dues ? `Réviser ${dues} carte${dues > 1 ? "s" : ""}` : "Revoir le cours"}
      </a>
      <button id="basculeBiblio" class="bouton second">
        ${possede ? "Retirer de ma bibliothèque" : "Ajouter à ma bibliothèque"}
      </button>
    </div>

    <h2>Les ${fichier.cards.length} cartes</h2>
    <div class="cartes">${fichier.cards.map((c, i) => ligneCarte(c, i, prog[i])).join("")}</div>

    ${fichier.lesson ? `<h2>La leçon</h2><div class="lecon">${fichier.lesson}</div>` : ""}`;

  vue.querySelectorAll(".carteApercu").forEach(el => {
    el.onclick = () => el.classList.toggle("ouverte");
  });
}

function ligneCarte(carte, i, etat) {
  const e = etat || carteNeuve();
  const due = estDue(e);
  return `<div class="carte carteApercu">
    <div class="haut">
      <span class="num">${i + 1}</span>
      <span class="recto">${echappe(carte.recto)}</span>
      <span class="echeance ${due ? "due" : ""}">${echeanceLisible(e)}</span>
    </div>
    <div class="bas">
      <p class="verso"><strong>${echappe(carte.verso)}</strong></p>
      ${carte.explanation ? `<p class="meta">${echappe(carte.explanation)}</p>` : ""}
    </div>
  </div>`;
}

/** L'échéance, dite en clair : c'est elle qui prouve que la synchro a marché. */
function echeanceLisible(e) {
  if (!e.nextReviewDate) return "jamais vue";
  const jours = Math.round((new Date(e.nextReviewDate) - Date.now()) / 86400000);
  if (jours <= 0) return "à réviser";
  if (jours === 1) return "demain";
  if (jours < 31) return `dans ${jours} j`;
  return `dans ${Math.round(jours / 30)} mois`;
}

// ── Profil ───────────────────────────────────────────────────────────────

export function ecranProfil(vue, { identite, environnement, surDeconnexion, surRefusMesure, mesureRefusee }) {
  vue.innerHTML = `
    <h1>Profil</h1>

    <h2>Compte iCloud</h2>
    <div class="carte">
      ${identite
        ? `<p><strong>Connecté.</strong> Les cours de ton iPhone sont dans ta
             bibliothèque, avec leurs échéances.</p>
           <p class="meta">Environnement : ${echappe(environnement)}</p>
           <button class="bouton second" id="deco">Se déconnecter</button>`
        : `<p>Non connecté. Le catalogue reste accessible, et ta progression
             est conservée dans ce navigateur.</p>
           <a class="bouton" href="#/accueil">Se connecter</a>`}
    </div>

    <h2>Ce qui remonte, et ce qui ne remonte pas</h2>
    <div class="carte">
      <p>Le site <strong>lit</strong> ton iCloud : cours, cartes et échéances
         arrivent de ton iPhone.</p>
      <p>Il n'y <strong>écrit rien</strong>. Ce que tu révises ici ne repart pas
         vers le téléphone — la structure interne d'iCloud n'est pas documentée
         par Apple, et y écrire risquerait d'abîmer tes données réelles.</p>
    </div>

    <h2>Mesure d'usage</h2>
    <div class="carte">
      <p>Anonyme, jamais ton contenu ni ton identité.</p>
      <button class="bouton second" id="mesure">
        ${mesureRefusee ? "Réactiver la mesure" : "Désactiver la mesure"}
      </button>
    </div>

    <h2>L'application iPhone</h2>
    <div class="carte">
      <p>Elle synchronise dans les deux sens, propose les modes écrit et
         balayage, et fonctionne hors ligne.</p>
      <a class="bouton second" href="https://apps.apple.com/app/id6749459846">Voir sur l'App Store</a>
    </div>`;

  const d = document.getElementById("deco");
  if (d) d.onclick = surDeconnexion;
  document.getElementById("mesure").onclick = surRefusMesure;
}
