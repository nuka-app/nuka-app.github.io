import { manifeste, cours, langues, parMatiere, NOMS_LANGUES, DRAPEAUX } from "./catalogue.js";
import { store } from "./store.js";
import { carteNeuve, reviser, noteDepuisTemps, estDue } from "./sm2.js";
// Mêmes noms d'événements que l'app iOS : c'est ce qui permet de comparer les
// deux plateformes dans un seul entonnoir, la propriété `source` les séparant.
import { suit, suitUneFois, consentement } from "./analytics.js";
import * as icloud from "./icloud.js";

const vue = document.getElementById("vue");
const nav = document.getElementById("nav");

// ── Routage ───────────────────────────────────────────────────────────────
// Le fragment d'URL sert de route : chaque écran est partageable et le bouton
// « retour » du navigateur fonctionne sans code supplémentaire.

const CLE_ACCUEIL_VU = "nuka.accueil.vu";

const routes = {
  "":            () => ecranAccueil(),
  "accueil":     () => ecranAccueil(true),
  "bibliotheque": () => ecranBibliotheque(),
  "catalogue":   (p) => ecranCatalogue(p[0]),
  "cours":       (p) => ecranCours(p.join("/")),
  "reviser":     (p) => ecranRevision(p.join("/")),
};

function route() {
  const brut = location.hash.replace(/^#\/?/, "");
  const [nom, ...reste] = brut.split("/");
  (routes[nom] || routes[""])(reste);
  nav.querySelectorAll("a").forEach(a =>
    a.classList.toggle("actif", a.getAttribute("href") === `#/${nom}`));
}
addEventListener("hashchange", route);
addEventListener("DOMContentLoaded", () => {
  suit("app_started");
  route();
});

// ── Accueil : connexion iCloud ────────────────────────────────────────────
//
// La connexion est PROPOSÉE, jamais imposée. Un mur d'authentification devant
// un site de révision coûterait exactement ce que la mesure a montré de plus
// cher : les gens s'arrêtent avant d'avoir rien vu. On montre donc les deux
// portes côte à côte, et le choix de continuer sans compte est aussi visible
// que l'autre.

async function ecranAccueil(force = false) {
  let vu = false;
  try { vu = localStorage.getItem(CLE_ACCUEIL_VU) === "1"; } catch {}
  if (vu && !force) return ecranBibliotheque();

  const dispo = icloud.configure();
  const identite = dispo ? await icloud.session() : null;

  vue.innerHTML = `
    <div class="accueil">
      <div class="emoji gros">🧠</div>
      <h1>Nuka</h1>
      <p class="intro">Révise par répétition espacée. Plus de 300 cours gratuits,
         en sept langues, les mêmes que dans l'application iPhone.</p>

      ${identite ? `
        <div class="carte connecte">
          <p><strong>Connecté à iCloud.</strong> Tes cours de l'iPhone sont dans
             ta bibliothèque.</p>
          <button class="bouton" id="entrer">Continuer</button>
          <button class="bouton second" id="deco">Se déconnecter</button>
        </div>` : `
        <button class="bouton apple" id="connexion" ${dispo ? "" : "disabled"}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11.2 8.5c0-1.5 1.2-2.2 1.3-2.3-.7-1-1.8-1.2-2.2-1.2-1-.1-1.9.6-2.4.6-.5 0-1.2-.6-2-.6-1 0-2 .6-2.5 1.5-1.1 1.9-.3 4.6.8 6.1.5.7 1.1 1.5 1.9 1.5.8 0 1-.5 2-.5s1.2.5 2 .5c.8 0 1.4-.7 1.9-1.4.6-.8.8-1.6.8-1.7 0 0-1.6-.6-1.6-2.5zM9.8 3.6c.4-.5.7-1.2.6-1.9-.6 0-1.4.4-1.8.9-.4.4-.7 1.1-.6 1.8.7.1 1.4-.3 1.8-.8z"/></svg>
          Se connecter avec Apple
        </button>
        <p class="note">${dispo
          ? "Pour retrouver les cours de ton iPhone. Le navigateur parle directement à ton iCloud, rien ne passe par nos serveurs."
          : "La connexion iCloud n'est pas encore activée."}
        </p>
        <p class="note"><button class="lien" id="sansCompte">Continuer sans compte</button></p>`}
    </div>`;

  const entre = () => {
    try { localStorage.setItem(CLE_ACCUEIL_VU, "1"); } catch {}
    location.hash = "#/bibliotheque";
  };
  const brancher = (id, action) => {
    const b = document.getElementById(id);
    if (b) b.onclick = action;
  };

  brancher("entrer", entre);
  brancher("sansCompte", () => { suit("accueil_sans_compte"); entre(); });
  brancher("deco", async () => { await icloud.deconnecte(); ecranAccueil(true); });
  brancher("connexion", async () => {
    const b = document.getElementById("connexion");
    b.disabled = true;
    b.textContent = "Connexion…";
    try {
      await icloud.connecte();
      suit("icloud_signed_in");
      await importeDepuisICloud();
      entre();
    } catch (e) {
      suit("icloud_sign_in_failed", { raison: String(e.message || e).slice(0, 60) });
      b.disabled = false;
      b.textContent = "Réessayer";
      vue.insertAdjacentHTML("beforeend",
        `<p class="note erreurTexte">${echappe(e.message || e)}</p>`);
    }
  });
}

/** Verse les cours de l'iPhone dans la bibliothèque locale. */
async function importeDepuisICloud() {
  const cours = await icloud.coursDeliCloud();
  for (const c of cours) await store.ajouteCours(c);
  suit("icloud_courses_imported", { cours: String(cours.length) });
  return cours.length;
}

// ── Utilitaires de rendu ──────────────────────────────────────────────────

const echappe = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function attente(message = "Chargement…") {
  vue.innerHTML = `<div class="attente"><div class="rond"></div><p>${echappe(message)}</p></div>`;
}

function erreur(e) {
  vue.innerHTML = `<div class="carte erreur">
    <h2>Ça n'a pas marché</h2>
    <p>${echappe(e.message || e)}</p>
    <button onclick="location.reload()">Réessayer</button>
  </div>`;
}

// ── Bibliothèque ──────────────────────────────────────────────────────────

async function ecranBibliotheque() {
  attente();
  try {
    const mes = await store.bibliotheque();
    if (!mes.length) {
      vue.innerHTML = `<div class="carte vide">
        <div class="emoji">📚</div>
        <h2>Ta bibliothèque est vide</h2>
        <p>Choisis un cours dans le catalogue et commence à réviser.
           Tout reste dans ce navigateur : aucun compte, aucune donnée envoyée.</p>
        <a class="bouton" href="#/catalogue">Ouvrir le catalogue</a>
      </div>`;
      return;
    }
    const cartes = await Promise.all(mes.map(async ({ fichier }) => {
      const prog = await store.progressionDuCours(fichier.id);
      const dues = fichier.cards.filter((_, i) => estDue(prog[i])).length;
      const vues = Object.keys(prog).length;
      return `<a class="carte cours" href="#/cours/${encodeURIComponent(fichier.id)}">
        <div class="emoji">${echappe(fichier.emoji || "📚")}</div>
        <div class="corps">
          <h3>${echappe(fichier.title)}</h3>
          <p class="meta">${fichier.cards.length} cartes · ${vues} vues</p>
        </div>
        ${dues ? `<span class="pastille">${dues}</span>` : `<span class="apour">à jour</span>`}
      </a>`;
    }));
    vue.innerHTML = `<h1>Ma bibliothèque</h1><div class="liste">${cartes.join("")}</div>`;
  } catch (e) { erreur(e); }
}

// ── Catalogue ─────────────────────────────────────────────────────────────

async function ecranCatalogue(langue) {
  attente("Chargement du catalogue…");
  try {
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
    suit("catalog_opened", { langue });
    const groupes = parMatiere(m, langue);
    const sections = Object.entries(groupes).map(([matiere, liste]) => `
      <h2>${echappe(matiere.replace(/-/g, " "))}</h2>
      <div class="liste">${liste.map(c => `
        <a class="carte cours" href="#/cours/${encodeURIComponent(c.id)}">
          <div class="emoji">${echappe(c.emoji || "📚")}</div>
          <div class="corps">
            <h3>${echappe(c.title)}</h3>
            <p class="meta">${c.cardCount} cartes${c.level ? " · " + echappe(c.level) : ""}</p>
          </div>
        </a>`).join("")}</div>`).join("");
    vue.innerHTML = `<a class="retour" href="#/catalogue">← Toutes les langues</a>
      <h1>${DRAPEAUX[langue] || "🌍"} ${echappe(NOMS_LANGUES[langue] || langue)}</h1>${sections}`;
  } catch (e) { erreur(e); }
}

// ── Fiche d'un cours ──────────────────────────────────────────────────────

async function ecranCours(id) {
  attente();
  try {
    const fichier = await chargeCours(id);
    const possede = await store.possede(id);
    const prog = await store.progressionDuCours(id);
    const dues = fichier.cards.filter((_, i) => estDue(prog[i])).length;

    vue.innerHTML = `
      <a class="retour" href="#/catalogue">← Catalogue</a>
      <div class="entete">
        <div class="emoji gros">${echappe(fichier.emoji || "📚")}</div>
        <div>
          <h1>${echappe(fichier.title)}</h1>
          <p class="meta">${fichier.cards.length} cartes${fichier.level ? " · " + echappe(fichier.level) : ""}</p>
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
      ${fichier.lesson ? `<div class="lecon">${fichier.lesson}</div>` : ""}`;

    suit("course_opened", { cours: id, cartes: String(fichier.cards.length) });

    document.getElementById("basculeBiblio").onclick = async () => {
      if (possede) {
        await store.retireCours(id);
        suit("course_deleted", { cours: id });
      } else {
        await store.ajouteCours(fichier);
        suit("catalog_course_downloaded", { cours: id });
      }
      ecranCours(id);
    };
  } catch (e) { erreur(e); }
}

/** Le cours, depuis la bibliothèque locale si possible, sinon le catalogue. */
async function chargeCours(id) {
  const mes = await store.bibliotheque();
  const local = mes.find(c => c.id === id);
  if (local) return local.fichier;
  const m = await manifeste();
  const resume = m.courses.find(c => c.id === id);
  if (!resume) throw new Error("Ce cours n'existe pas dans le catalogue.");
  return cours(resume);
}

// ── Session de révision ───────────────────────────────────────────────────

async function ecranRevision(id) {
  attente();
  try {
    const fichier = await chargeCours(id);
    const prog = await store.progressionDuCours(id);
    const aReviser = fichier.cards
      .map((c, i) => ({ carte: c, index: i, etat: prog[i] || carteNeuve() }))
      .filter(x => estDue(x.etat));
    const file = (aReviser.length ? aReviser : fichier.cards.map((c, i) =>
      ({ carte: c, index: i, etat: prog[i] || carteNeuve() })));
    melange(file);
    const session = file.slice(0, 20);
    suit("revision_mode_selected", { mode: "qcm", cartes: String(session.length) });
    lanceSession(id, fichier, session);
  } catch (e) { erreur(e); }
}

function melange(t) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
}

function lanceSession(id, fichier, file) {
  let position = 0, justes = 0, debut = 0;
  surveilleAbandon(id, file, () => position);

  const suivant = () => {
    if (position >= file.length) {
      suit("session_completed", {
        cours: id, cartes: String(file.length), justes: String(justes),
      });
      return resultats(id, fichier, file.length, justes);
    }
    const { carte, index, etat } = file[position];
    // Seul le palier difficile est servi, comme dans l'app depuis le 05/09/2026.
    const durs = (carte.distractors && carte.distractors.hard) || [];
    const options = melangeRetour([carte.verso, ...durs.slice(0, 3)]);
    debut = performance.now();

    vue.innerHTML = `
      <div class="jauge"><span style="width:${(position / file.length) * 100}%"></span></div>
      <p class="compteur">${position + 1} / ${file.length}</p>
      <div class="question">${echappe(carte.recto)}</div>
      <div class="options">${options.map((o, i) =>
        `<button class="option" data-i="${i}">${echappe(o)}</button>`).join("")}</div>`;

    vue.querySelectorAll(".option").forEach(b => {
      b.onclick = async () => {
        const secondes = (performance.now() - debut) / 1000;
        const choix = options[Number(b.dataset.i)];
        const correct = choix === carte.verso;
        if (correct) justes += 1;

        vue.querySelectorAll(".option").forEach(x => {
          x.disabled = true;
          const t = x.textContent;
          if (t === carte.verso) x.classList.add("juste");
          else if (x === b) x.classList.add("faux");
        });
        if (carte.explanation) {
          vue.insertAdjacentHTML("beforeend",
            `<p class="explication">${echappe(carte.explanation)}</p>`);
        }
        vue.insertAdjacentHTML("beforeend",
          `<button class="bouton" id="suite">Continuer</button>`);
        document.getElementById("suite").onclick = () => { position += 1; suivant(); };

        const note = noteDepuisTemps(correct, secondes);
        await store.enregistre(id, index, reviser(etat, note, secondes));
        // La toute première carte révisée, une seule fois par navigateur :
        // c'est la marche d'activation que l'app iOS mesure aussi.
        suitUneFois("first_review_done");
      };
    });
  };
  suivant();
}

function melangeRetour(t) { const c = [...t]; melange(c); return c; }

/** Quitter en cours de session est un signal, pas un non-événement. */
function surveilleAbandon(id, file, position) {
  const partir = () => {
    if (position() < file.length) {
      suit("session_abandoned", {
        cours: id, vues: String(position()), total: String(file.length),
      });
    }
  };
  addEventListener("pagehide", partir, { once: true });
}

function resultats(id, fichier, total, justes) {
  const pourcent = total ? Math.round((justes / total) * 100) : 0;
  vue.innerHTML = `
    <div class="carte resultats">
      <div class="emoji gros">${pourcent >= 80 ? "🎉" : pourcent >= 50 ? "👍" : "💪"}</div>
      <h1>${justes} / ${total}</h1>
      <p class="meta">${pourcent} % de bonnes réponses</p>
      <p class="intro">Les cartes ratées reviendront dès aujourd'hui,
         les autres à leur échéance.</p>
      <div class="actions">
        <a class="bouton" href="#/cours/${encodeURIComponent(id)}">Terminé</a>
        <a class="bouton second" href="#/reviser/${encodeURIComponent(id)}">Recommencer</a>
      </div>
    </div>`;
}

// ── Refus de mesure ───────────────────────────────────────────────────────
// L'application iOS offre le même retrait ; le site ne peut pas en offrir
// moins. Le libellé dit l'état COURANT et l'action, pour qu'on sache d'un coup
// d'œil si l'on est mesuré ou non.

function rafraichitConsentement() {
  const b = document.getElementById("refusSuivi");
  if (!b) return;
  const refuse = consentement.refuse();
  b.textContent = refuse ? "Mesure désactivée — réactiver" : "Désactiver la mesure";
  b.onclick = () => {
    if (refuse) consentement.redonne(); else consentement.retire();
    rafraichitConsentement();
  };
}
addEventListener("DOMContentLoaded", rafraichitConsentement);
