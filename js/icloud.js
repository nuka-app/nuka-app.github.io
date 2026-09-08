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

/**
 * Charge CloudKit JS à la demande — d'abord chez Apple, sinon depuis ce site.
 *
 * La copie locale n'est pas une commodité : le script d'Apple est BLOQUÉ par
 * la plupart des bloqueurs de publicité et extensions de confidentialité, qui
 * traitent un domaine tiers chargeant du script comme un traqueur. Le
 * navigateur répond alors ERR_BLOCKED_BY_CLIENT, la connexion iCloud devient
 * impossible, et l'utilisateur n'a aucun moyen de comprendre pourquoi.
 *
 * On tente donc l'original — c'est la voie recommandée par Apple, et elle
 * apporte les correctifs — puis on se replie sur la copie servie depuis notre
 * propre origine, que rien ne peut bloquer. Le fichier est nommé `ck.js` et
 * non `cloudkit.js` : certaines règles de filtrage visent le nom lui-même.
 *
 * Licence : Apple concède ce fichier aux développeurs pour fournir des
 * services CloudKit Web, ce qui est précisément l'usage ici.
 */
function chargeSDK() {
  if (window.CloudKit) return Promise.resolve();

  const essaie = (src) => new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => (window.CloudKit ? ok() : ko(new Error("chargé mais vide")));
    s.onerror = () => ko(new Error("bloqué ou injoignable"));
    document.head.appendChild(s);
  });

  return essaie("https://cdn.apple-cloudkit.com/ck/2/cloudkit.js")
    .catch(() => essaie("vendor/ck.js"))
    .catch(() => {
      throw new Error(
        "Le module de connexion Apple n'a pas pu être chargé. " +
        "Un bloqueur de contenu l'empêche probablement de s'exécuter."
      );
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
  try {
    return await c.setUpAuth();
  } catch (e) {
    // NETWORK_ERROR ici ne veut pas dire « pas de réseau » : le SDK est chargé,
    // mais ses appels vers api.apple-cloudkit.com sont refusés. C'est la
    // signature d'un bloqueur de contenu, et il faut le nommer — sinon
    // l'utilisateur cherche une panne chez nous.
    const code = String(e && (e.ckErrorCode || e.message || e));
    throw new Error(code.includes("NETWORK")
      ? "BLOQUEUR"
      : code);
  }
}

/**
 * Vérifie ce qui empêche la connexion, pour le dire plutôt que de le subir.
 *
 * Deux domaines doivent être joignables : celui qui sert le SDK et celui qui
 * répond aux requêtes. Un bloqueur coupe souvent les deux, et l'échec qui en
 * résulte ne ressemble à rien de compréhensible.
 */
export async function diagnostic() {
  const test = async (url) => {
    try { await fetch(url, { mode: "no-cors", cache: "no-store" }); return true; }
    catch { return false; }
  };
  return {
    sdk: !!window.CloudKit,
    api: await test("https://api.apple-cloudkit.com/"),
  };
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

  // Un seul parcours de zone, réparti ensuite par type : la relire deux fois
  // doublerait le temps d'attente pour rien.
  const parType = await parcourtZone(bdd);
  const cours = parType["CD_Course"] || [];
  const cartes = parType["CD_Flashcard"] || [];

  // Rattachement des cartes à leur cours.
  //
  // Le nom du champ de relation n'est pas garanti : le miroir Core Data le
  // dérive du modèle, et un renommage côté Swift le changerait ici. Plutôt que
  // de parier sur « CD_course », on cherche parmi les champs de la carte
  // celui qui EST une référence — il n'y en a qu'une.
  const parCours = {};
  for (const f of cartes) {
    const ref = premiereReference(f);
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
      recto: texte(champ(f, "CD_recto")),
      verso: texte(champ(f, "CD_verso")),
      explanation: texte(champ(f, "CD_explanation")),
      distractors: distracteurs(champ(f, "CD_cachedDistractors")),
    })).filter(x => x.recto && x.verso),
  }));
  // ⚠️ AUCUN filtre sur les cours vides ici.
  //
  // La version précédente écartait tout cours sans carte rattachée. Si le
  // rattachement échoue — un nom de champ qui a changé, par exemple — ce
  // filtre fait disparaître LA TOTALITÉ des cours, et l'écran affiche une
  // bibliothèque vide sans le moindre indice. Mieux vaut un cours visible mais
  // vide, qui dit où chercher.
}

/** La première valeur de champ qui est une référence CloudKit. */
function premiereReference(enr) {
  for (const nom of Object.keys(enr.fields || {})) {
    const v = enr.fields[nom].value;
    if (v && typeof v === "object" && v.recordName) return v;
  }
  return null;
}

/** Le texte d'un champ, qu'il soit chaîne brute ou valeur enveloppée. */
function texte(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.value === "string") return v.value;
  return String(v);
}

/**
 * Ce que la zone contient réellement, pour le dire quand rien ne s'affiche.
 *
 * Une bibliothèque vide a plusieurs causes possibles — mauvais environnement,
 * zone différente, champs renommés — et elles se ressemblent toutes à l'écran.
 * Ce relevé les sépare.
 */
export async function inventaire() {
  const c = await prepare();
  const parType = await parcourtZone(c.privateCloudDatabase);
  const resume = {};
  for (const [type, liste] of Object.entries(parType)) {
    const premier = liste[0];
    resume[type] = {
      nombre: liste.length,
      champs: premier ? Object.keys(premier.fields || {}).slice(0, 30) : [],
      // La FORME des valeurs compte autant que leur nom : c'est elle qui dit
      // si un champ est une référence vers un autre enregistrement.
      formes: premier ? Object.fromEntries(
        Object.entries(premier.fields || {}).slice(0, 30).map(([k, v]) => {
          const val = v && v.value;
          if (val && typeof val === "object") {
            return [k, val.recordName ? "référence" : "objet(" + Object.keys(val).slice(0, 3) + ")"];
          }
          return [k, typeof val];
        })) : {},
    };
  }
  return { environnement: ENVIRONNEMENT, zone: ZONE, types: resume };
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

/**
 * Parcourt la zone Core Data et répartit les enregistrements par type.
 *
 * ⚠️ PAS de `performQuery`. Interroger un type demande un index « queryable »
 * sur `recordName`, et `NSPersistentCloudKitContainer` n'en crée aucun : sa
 * synchronisation ne procède pas par requêtes mais par parcours de zone. Une
 * requête échoue donc sur « Field 'recordName' is not marked queryable », et
 * la corriger supposerait de modifier le schéma d'un conteneur en production
 * — disproportionné pour une lecture seule, et risqué sur des données réelles.
 *
 * La méthode s'appelle `fetchRecordZoneChanges` et non `fetchRecordChanges` :
 * vérifié dans le SDK, après m'être trompé de nom une première fois.
 *
 * Elle accepte une ou plusieurs zones, d'où une réponse qui peut arriver sous
 * deux formes — enveloppée dans `zones[]`, ou à plat. On accepte les deux
 * plutôt que d'en parier une.
 */
async function parcourtZone(bdd) {
  const parType = {};
  let jeton = null;
  do {
    const demande = { zoneID: { zoneName: ZONE } };
    if (jeton) demande.syncToken = jeton;

    const r = await bdd.fetchRecordZoneChanges(demande);
    if (r && r.hasErrors) {
      const e = r.errors[0];
      throw new Error(e.reason || e.ckErrorCode || "lecture refusée");
    }
    const bloc = (r && r.zones && r.zones[0]) || r || {};
    if (bloc.hasErrors) {
      const e = bloc.errors[0];
      throw new Error(e.reason || e.ckErrorCode || "zone illisible");
    }

    const enregistrements = bloc.records || [];
    for (const enr of enregistrements) {
      const type = enr.recordType;
      if (type) (parType[type] = parType[type] || []).push(enr);
    }
    jeton = bloc.moreComing ? bloc.syncToken : null;
  } while (jeton);
  return parType;
}
