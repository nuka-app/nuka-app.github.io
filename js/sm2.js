// Répétition espacée SM-2 — miroir exact de SpacedRepetitionEngine.swift.
//
// Les deux plateformes DOIVENT produire les mêmes intervalles. Une divergence
// ne se verrait pas tout de suite : elle apparaîtrait des semaines plus tard,
// sous la forme de cartes qui reviennent au mauvais moment, et serait alors
// très difficile à rattacher à sa cause. Toute modification ici doit être
// reportée dans le Swift, et réciproquement.

export const EF_MIN = 1.3;
export const EF_MAX = 2.5;
export const EF_INITIAL = 2.5;
export const NOTE_PASSAGE = 3;

const SEUIL_RAPIDE = 3.0;   // secondes
const SEUIL_MOYEN  = 8.0;

/** L'état d'une carte jamais révisée. */
export function carteNeuve() {
  return {
    easinessFactor: EF_INITIAL,
    repetitions: 0,
    interval: 0,
    consecutiveCorrect: 0,
    leechCount: 0,
    timesReviewed: 0,
    timesCorrect: 0,
    successRate: 0,
    lastReviewed: null,
    nextReviewDate: null,   // null = due immédiatement
  };
}

/** Note SM-2 déduite du résultat et du temps de réponse (QCM). */
export function noteDepuisTemps(correct, secondes) {
  if (!correct) return 2;
  // Un temps nul ou négatif — horloge ajustée, minuteur en défaut — ne doit
  // pas passer pour une réponse instantanée et gonfler l'ease factor.
  if (!(secondes > 0.01)) return 4;
  return secondes < SEUIL_RAPIDE ? 5 : 4;
}

function facteurAisance(actuel, note, secondes) {
  const q = note;
  const base = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  let bonus = 0;
  if (secondes != null && note >= NOTE_PASSAGE) {
    if (secondes < SEUIL_RAPIDE)      bonus =  0.05;
    else if (secondes < SEUIL_MOYEN)  bonus =  0;
    else                              bonus = -0.05;
  }
  return Math.max(EF_MIN, Math.min(EF_MAX, actuel + base + bonus));
}

// 1re répétition → 1 jour, 2e → 6 jours, ensuite intervalle × facteur.
function intervalle(repetitions, ef, precedent) {
  if (repetitions === 1) return 1;
  if (repetitions === 2) return 6;
  return Math.max(1, Math.round(precedent * ef));
}

/**
 * Applique une révision et renvoie le NOUVEL état — la fonction ne modifie
 * rien sur place, pour que l'appelant reste maître de ce qu'il enregistre.
 */
export function reviser(etat, note, secondes = null) {
  if (!Number.isInteger(note) || note < 0 || note > 5) {
    throw new Error(`note SM-2 invalide : ${note}`);
  }
  const e = { ...etat };
  const correct = note >= NOTE_PASSAGE;

  e.lastReviewed = new Date().toISOString();
  e.timesReviewed += 1;
  if (correct) e.timesCorrect += 1;
  e.successRate = e.timesReviewed > 0
    ? (e.timesCorrect / e.timesReviewed) * 100
    : 0;

  e.easinessFactor = facteurAisance(e.easinessFactor, note, secondes);

  if (correct) {
    e.repetitions += 1;
    e.consecutiveCorrect += 1;
    e.leechCount = 0;
    e.interval = intervalle(e.repetitions, e.easinessFactor, e.interval);
    e.nextReviewDate = dansNJours(e.interval);
  } else {
    // Convention SM-2 : intervalle 1 sur échec, jamais 0 — un intervalle nul
    // casse les calculs de force mémoire en aval.
    e.repetitions = 0;
    e.consecutiveCorrect = 0;
    e.interval = 1;
    e.leechCount += 1;
    e.nextReviewDate = new Date().toISOString();   // de nouveau disponible
  }
  return e;
}

function dansNJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

/** Une carte est due si elle n'a jamais été vue ou si son échéance est passée. */
export function estDue(etat, maintenant = new Date()) {
  if (!etat || !etat.nextReviewDate) return true;
  return new Date(etat.nextReviewDate) <= maintenant;
}
