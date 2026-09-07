// Suivi d'activité — même projet PostHog que l'application iOS.
//
// Pas de SDK : un envoi direct sur /batch/, exactement comme le fait
// PostHogService.swift. La bibliothèque officielle pèserait une cinquantaine
// de kilo-octets pour une capture automatique dont on n'a pas l'usage, et
// ajouterait la seule dépendance externe du projet.
//
// La clé de projet est PUBLIQUE par conception : embarquée dans tous les
// binaires iOS comme ici, elle n'autorise QUE l'écriture d'événements. Le pire
// qu'un tiers puisse en faire est d'injecter de faux événements ; elle ne lit
// rien.

const CLE = "phc_t393M8Nx27DcWntXxnX3VCjnDW58sRxNunqCW5TkHBY4";
const HOTE = "https://eu.i.posthog.com";
const CLE_ID = "nuka.distinct_id";
const CLE_REFUS = "nuka.analytics.refus";
const CLE_UNE_FOIS = "nuka.analytics.once.";

/** Refus explicite, ou signal « ne pas me pister » du navigateur. */
function refuse() {
  try {
    if (localStorage.getItem(CLE_REFUS) === "1") return true;
  } catch { /* stockage indisponible : on n'insiste pas */ }
  return navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
}

/** Identifiant pseudonyme, propre à ce navigateur. Jamais l'identité réelle. */
function identifiant() {
  try {
    let id = localStorage.getItem(CLE_ID);
    if (!id) {
      id = "web-" + crypto.randomUUID();
      localStorage.setItem(CLE_ID, id);
    }
    return id;
  } catch {
    return "web-anonyme";
  }
}

function proprietesCommunes() {
  return {
    // Distingue le web de l'iOS dans le même projet : sans cela les deux
    // plateformes se mélangeraient et aucun entonnoir ne voudrait plus rien dire.
    source: "web",
    $app_version: "1.0",
    $locale: navigator.language || "",
    $os: navigator.platform || "",
    is_debug: location.hostname === "localhost" || location.hostname === "127.0.0.1",
  };
}

export function suit(nom, props = {}) {
  if (refuse()) return;
  const corps = {
    api_key: CLE,
    batch: [{
      event: nom,
      properties: {
        distinct_id: identifiant(),
        ...proprietesCommunes(),
        ...props,
      },
      timestamp: new Date().toISOString(),
    }],
  };
  // `keepalive` pour que l'envoi survive à une navigation immédiate — sans
  // quoi tout événement suivi d'un changement de page serait perdu.
  fetch(`${HOTE}/batch/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
    keepalive: true,
  }).catch(() => { /* le suivi ne doit jamais gêner l'utilisateur */ });
}

/** Une seule fois par navigateur, pour toujours — équivalent de trackOnce. */
export function suitUneFois(nom, props = {}) {
  try {
    const cle = CLE_UNE_FOIS + nom;
    if (localStorage.getItem(cle)) return;
    localStorage.setItem(cle, "1");
  } catch { /* sans stockage, on renonce plutôt que d'envoyer en double */ return; }
  suit(nom, props);
}

export const consentement = {
  refuse: () => refuse(),
  retire() { try { localStorage.setItem(CLE_REFUS, "1"); } catch {} },
  redonne() { try { localStorage.removeItem(CLE_REFUS); } catch {} },
};
