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
  // `CD_course` contient une CHAÎNE — le nom d'enregistrement du cours — et
  // non une référence CloudKit. Vérifié sur les données réelles : c'est ainsi
  // que le miroir Core Data encode une relation à un. Chercher un objet muni
  // d'un `recordName`, comme je le faisais, ne pouvait rien trouver.
  // Un cours se désigne par DEUX identifiants, et rien ne dit lequel la carte
  // emploie : le nom d'enregistrement CloudKit, et le `CD_id` que Core Data a
  // posé. On indexe les deux vers le même cours, ce qui rend le rattachement
  // indifférent au choix du miroir.
  const versCours = new Map();
  for (const c of cours) {
    versCours.set(c.recordName, c.recordName);
    const id = texte(champ(c, "CD_id"));
    if (id) versCours.set(id, c.recordName);
  }

  const parCours = {};
  for (const f of cartes) {
    const cle = lienVersCours(f, versCours);
    if (cle) (parCours[cle] = parCours[cle] || []).push(f);
  }

  return cours.map(co => {
    const brutes = parCours[co.recordName] || [];
    const versos = brutes.map(f => texte(champ(f, "CD_verso"))).filter(Boolean);
    return {
      id: "icloud:" + co.recordName,
      title: texte(champ(co, "CD_title")) || "Sans titre",
      emoji: texte(champ(co, "CD_emoji")) || texte(champ(co, "CD_icon")) || "📱",
      courseDescription: texte(champ(co, "CD_courseDescription")),
      origine: "icloud",
      cards: brutes.map(f => {
        const verso = texte(champ(f, "CD_verso"));
        return {
          recto: texte(champ(f, "CD_recto")),
          verso,
          explanation: texte(champ(f, "CD_explanation")),
          distractors: distracteursOuVoisins(champ(f, "CD_cachedDistractors"), verso, versos),
          // La progression du téléphone voyage avec la carte : sans elle, le
          // site rendrait toutes les cartes dues et l'on réviserait ce qui
          // vient d'être révisé.
          sm2: progressionDepuis(f),
        };
      }).filter(x => x.recto && x.verso),
    };
  });
}

/**
 * Le cours auquel appartient une carte.
 *
 * `versCours` associe TOUT identifiant connu d'un cours — nom d'enregistrement
 * CloudKit comme `CD_id` — à son nom d'enregistrement. On n'a donc pas besoin
 * de savoir lequel des deux le miroir a inscrit dans la carte.
 *
 * Le repli sur les autres champs vaut son coût : il reconnaît le lien à sa
 * VALEUR, et survivrait donc à un renommage du champ côté Swift.
 */
function lienVersCours(carte, versCours) {
  const direct = champ(carte, "CD_course");
  const cle = typeof direct === "string" ? direct
            : (direct && direct.recordName) || null;
  if (cle && versCours.has(cle)) return versCours.get(cle);

  for (const nom of Object.keys(carte.fields || {})) {
    const v = carte.fields[nom].value;
    const candidat = typeof v === "string" ? v : (v && v.recordName);
    if (candidat && versCours.has(candidat)) return versCours.get(candidat);
  }
  return null;
}

/**
 * Les distracteurs de la carte, ou à défaut ceux de ses voisines.
 *
 * Les cartes créées dans l'app n'ont pas toujours de distracteurs en cache :
 * l'app les demande au serveur au moment de la révision. Le site, lui, doit
 * proposer quatre options tout de suite. Prendre les réponses d'autres cartes
 * du même cours donne des options plausibles — c'est le procédé classique du
 * QCM, et il vaut mieux qu'une carte injouable.
 */
function distracteursOuVoisins(cache, verso, tousLesVersos) {
  const d = distracteurs(cache);
  if (d.hard.length >= 3) return d;

  const voisins = tousLesVersos.filter(v => v && v !== verso);
  melange(voisins);
  const trois = voisins.slice(0, 3);
  return trois.length === 3
    ? { easy: trois, medium: trois, hard: trois }
    : d;
}

function melange(t) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
}

/**
 * Les statistiques du compte, telles que l'app les tient.
 *
 * Elles ne se recalculent pas côté web : série, XP et niveau résultent de
 * règles qui vivent dans l'app — gels de série, barème d'expérience, paliers.
 * Les recalculer produirait deux vérités divergentes ; on lit celle qui fait foi.
 */
export async function statistiques() {
  const c = await prepare();
  const parType = await parcourtZone(c.privateCloudDatabase);
  const enr = (parType["CD_UserStats"] || [])[0];
  if (!enr) return null;
  const n = (nom) => {
    const v = champ(enr, nom);
    return typeof v === "number" ? v : 0;
  };
  return {
    serie: n("CD_currentStreak"),
    meilleureSerie: n("CD_longestStreak"),
    xp: n("CD_totalXP"),
    niveau: n("CD_currentLevel"),
    cartesRevisees: n("CD_totalCardsReviewed"),
    bonnesReponses: n("CD_totalCorrectAnswers"),
    cartesCreees: n("CD_totalCardsCreated"),
    coursCrees: n("CD_coursesCreated"),
    tempsEtudeSecondes: n("CD_totalStudyTimeSeconds"),
    objectifQuotidien: n("CD_dailyGoalCards"),
  };
}

/** L'état SM-2 tel que le téléphone l'a laissé. */
function progressionDepuis(f) {
  const n = (nom) => {
    const v = champ(f, nom);
    return typeof v === "number" ? v : null;
  };
  const date = (nom) => {
    const v = n(nom);
    if (v == null) return null;
    // CloudKit horodate en millisecondes ; on tolère les secondes au cas où.
    return new Date(v > 1e11 ? v : v * 1000).toISOString();
  };
  return {
    easinessFactor: n("CD_easinessFactor") ?? 2.5,
    repetitions: n("CD_repetitions") ?? 0,
    interval: n("CD_interval") ?? 0,
    consecutiveCorrect: n("CD_consecutiveCorrect") ?? 0,
    leechCount: n("CD_leechCount") ?? 0,
    timesReviewed: n("CD_timesReviewed") ?? 0,
    timesCorrect: n("CD_timesCorrect") ?? 0,
    successRate: n("CD_successRate") ?? 0,
    lastReviewed: date("CD_lastReviewed"),
    nextReviewDate: date("CD_nextReviewDate"),
  };
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
  // Les valeurs des identifiants, seules capables de dire ce qui relie une
  // carte à son cours. Aucun contenu de carte n'est exposé : uniquement des
  // identifiants.
  const echantillon = {
    cours: (parType["CD_Course"] || []).slice(0, 4).map(c => ({
      recordName: c.recordName, CD_id: (c.fields.CD_id || {}).value,
      titre: (c.fields.CD_title || {}).value,
    })),
    carte: (parType["CD_Flashcard"] || []).slice(0, 2).map(f => ({
      recordName: f.recordName,
      CD_course: (f.fields.CD_course || {}).value,
      CD_id: (f.fields.CD_id || {}).value,
    })),
  };
  return { environnement: ENVIRONNEMENT, zone: ZONE, types: resume, echantillon };
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
