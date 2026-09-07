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

// Jeton d'API web, à créer dans le tableau de bord CloudKit et à autoriser
// pour l'origine du site. Tant qu'il est vide, la connexion iCloud est
// simplement absente de l'interface — le site fonctionne sans.
export const JETON = "";

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
      environment: "production",
    }],
  });
  conteneur = window.CloudKit.getDefaultContainer();
  return conteneur;
}

/** L'utilisateur déjà connecté, ou null. N'ouvre aucune fenêtre. */
export async function session() {
  if (!JETON) return null;
  const c = await prepare();
  try { return await c.setUpAuth(); } catch { return null; }
}

/** Ouvre la fenêtre de connexion Apple et renvoie l'identité obtenue. */
export async function connecte() {
  const c = await prepare();
  const identite = await c.setUpAuth();
  return identite || c.whenUserSignsIn();
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
