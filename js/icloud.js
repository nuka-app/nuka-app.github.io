// Synchronisation avec l'iCloud de l'utilisateur, via CloudKit JS.
//
// ── Ce que ce module fait, et ce qu'il ne fait pas ────────────────────────
//
// Il LIT le conteneur privé de l'utilisateur : les cours et les cartes que son
// iPhone y a déposés. Il n'y ÉCRIT rien, et ce n'est pas un oubli.
//
// `NSPersistentCloudKitContainer` — le mécanisme qui fait remonter Core Data
// vers iCloud — y écrit un schéma interne : des types `CD_Course`,
// `CD_Flashcard`, des champs préfixés `CD_`, une zone dédiée, et des
// enregistrements de métadonnées. Apple ne documente pas ce format et ne
// garantit pas sa stabilité. Le lire est sans danger. Y écrire depuis
// JavaScript, en revanche, exposerait à produire un enregistrement mal formé
// que l'iPhone importerait de travers — c'est-à-dire à ABÎMER LES DONNÉES
// RÉELLES d'un utilisateur, ses cours et sa progression. Le jeu n'en vaut pas
// la chandelle tant qu'une écriture n'est pas indispensable.
//
// La conséquence, à dire clairement à l'utilisateur : ce qu'il révise sur le
// web ne remonte pas encore dans son téléphone.

const CONTENEUR = "iCloud.simonneau.D-and-R-Learn";
const ZONE = "com.apple.coredata.cloudkit.zone";

// Jetons d'API web CloudKit — UN PAR ENVIRONNEMENT.
//
// C'est le point qui m'a fait conclure de travers : un jeton créé pour
// development est refusé en production, et réciproquement, avec le même
// AUTHENTICATION_FAILED que si le conteneur n'existait pas. Le symptôme
// ressemble à un schéma jamais déployé alors qu'il ne s'agit que d'une portée.
//
// Ils sont PUBLICS par conception, comme la clé de projet PostHog : CloudKit JS
// s'exécute dans le navigateur, donc tout jeton qu'il emploie est lisible par
// qui ouvre les sources. Ils n'ouvrent d'ailleurs rien par eux-mêmes — ils
// identifient l'application, et c'est la connexion Apple de l'utilisateur qui
// donne accès à SES données, à lui seul.
const JETONS = {
  production:  "e965337bc0ecca6b0aa217d65415d1ea830036585ff5cdaf6fac5a48d6bd2ce8",
  development: "ecad388b1371f1bcebdf4205af1626e1cd33910b60dfd7d07e1da40f225b1fe3",
};

// Production par défaut : c'est là que vivent les données des utilisateurs de
// l'App Store et de TestFlight.
//
// Development s'obtient par `?env=development` dans l'adresse. Ce n'est pas un
// gadget : une app installée depuis Xcode écrit dans development, si bien qu'un
// iPhone de développement reste INVISIBLE depuis la production, sans erreur ni
// message. Sans cette bascule, on cherche longtemps une panne qui n'existe pas.
export const ENVIRONNEMENT =
  new URLSearchParams(location.search).get("env") === "development"
    ? "development" : "production";

export const JETON = JETONS[ENVIRONNEMENT];

let conteneur = null;

export function configure() { return !!JETON; }

/** Charge CloudKit JS à la demande : inutile de le peser si on ne s'en sert pas. */
function chargeSDK() {
  if (window.CloudKit) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://cdn.apple-cloudkit.com/ck/2/cloudkit.js";
    s.onload = ok;
    s.onerror = () => ko(new Error("CloudKit JS n'a pas pu être chargé."));
    document.head.appendChild(s);
  });
}

async function prepare() {
  if (conteneur) return conteneur;
  await chargeSDK();
  window.CloudKit.configure({
    containers: [{
      containerIdentifier: CONTENEUR,
      apiTokenAuth: { apiToken: JETON, persist: true },
      environment: ENVIRONNEMENT,
    }],
  });
  conteneur = window.CloudKit.getDefaultContainer();
  return conteneur;
}

/**
 * Prépare la connexion et renvoie l'identité si elle existe déjà.
 *
 * ⚠️ CloudKit JS n'expose AUCUNE fonction pour ouvrir la fenêtre de connexion.
 * `setUpAuth()` injecte son propre bouton dans l'élément `#apple-sign-in-button`
 * et c'est le clic sur CE bouton qui ouvre la fenêtre Apple. Un bouton maison
 * ne peut pas déclencher la connexion : il attendrait indéfiniment un signal
 * qui ne viendra jamais — ce que faisait la version précédente, d'où un
 * « Connexion… » qui ne finissait pas.
 *
 * L'élément d'accueil doit donc exister dans la page AVANT cet appel.
 */
export async function prepareConnexion() {
  if (!JETON) return null;
  const c = await prepare();
  try { return await c.setUpAuth(); } catch { return null; }
}

/** Se résout quand l'utilisateur a terminé sa connexion dans la fenêtre Apple. */
export async function quandConnecte() {
  const c = await prepare();
  return c.whenUserSignsIn();
}

export async function deconnecte() {
  if (!conteneur) return;
  try { await conteneur.signOut(); } catch { /* déjà déconnecté */ }
}

/** Les cours et cartes déposés par l'iPhone, remis au format du catalogue. */
export async function coursDeliCloud() {
  const c = await prepare();
  const bdd = c.privateCloudDatabase;

  const cours = await tout(bdd, "CD_Course");
  const cartes = await tout(bdd, "CD_Flashcard");

  // Les cartes pointent vers leur cours par une référence CloudKit.
  const parCours = {};
  for (const f of cartes) {
    const ref = champ(f, "CD_course");
    const cle = ref && ref.recordName;
    if (cle) (parCours[cle] = parCours[cle] || []).push(f);
  }

  return cours.map(co => ({
    id: "icloud:" + co.recordName,
    title: champ(co, "CD_title") || "Sans titre",
    emoji: champ(co, "CD_emoji") || "📱",
    courseDescription: champ(co, "CD_courseDescription") || "",
    origine: "icloud",
    cards: (parCours[co.recordName] || []).map(f => ({
      recto: champ(f, "CD_recto") || "",
      verso: champ(f, "CD_verso") || "",
      explanation: champ(f, "CD_explanation") || "",
      distractors: distracteurs(champ(f, "CD_cachedDistractors")),
    })).filter(x => x.recto && x.verso),
  })).filter(c => c.cards.length);
}

const champ = (r, nom) => (r.fields && r.fields[nom] ? r.fields[nom].value : null);

/** Le cache QCM de l'app est un JSON à trois paliers ; seul le difficile sert. */
function distracteurs(brut) {
  if (!brut) return { easy: [], medium: [], hard: [] };
  try {
    const d = typeof brut === "string" ? JSON.parse(brut) : brut;
    return { easy: d.easy || [], medium: d.medium || [], hard: d.hard || [] };
  } catch { return { easy: [], medium: [], hard: [] }; }
}

/** Pagination : CloudKit renvoie par lots, il faut suivre le curseur. */
async function tout(bdd, type) {
  const acc = [];
  let reponse = await bdd.performQuery({ recordType: type }, { zoneName: ZONE });
  while (reponse) {
    if (reponse.hasErrors) throw new Error(reponse.errors[0].ckErrorCode || "requête refusée");
    acc.push(...(reponse.records || []));
    if (!reponse.moreComing) break;
    reponse = await bdd.performQuery(reponse);
  }
  return acc;
}
