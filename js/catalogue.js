// Lecture du catalogue public.
//
// Les fichiers sont servis par GitHub Pages avec `access-control-allow-origin: *`,
// donc lisibles directement depuis un navigateur : aucun serveur intermédiaire,
// aucune clé, et le web voit exactement le même contenu que l'app iOS.

const BASE = "https://sogbap.github.io/catalog/";

let manifesteEnCache = null;

export async function manifeste() {
  if (manifesteEnCache) return manifesteEnCache;
  const r = await fetch(BASE + "manifest.json");
  if (!r.ok) throw new Error(`catalogue indisponible (${r.status})`);
  manifesteEnCache = await r.json();
  return manifesteEnCache;
}

export async function cours(resume) {
  const chemin = resume.path.startsWith("http") ? resume.path : BASE + resume.path;
  const r = await fetch(chemin);
  if (!r.ok) throw new Error(`cours indisponible (${r.status})`);
  return r.json();
}

/** Les langues présentes, avec leur nombre de cours. */
export function langues(m) {
  const compte = {};
  for (const c of m.courses) {
    const lg = c.language || "??";
    compte[lg] = (compte[lg] || 0) + 1;
  }
  return Object.entries(compte).sort((a, b) => b[1] - a[1]);
}

/** Les cours d'une langue, groupés par matière. */
export function parMatiere(m, langue) {
  const groupes = {};
  for (const c of m.courses) {
    if ((c.language || "") !== langue) continue;
    const s = c.subject || "general";
    (groupes[s] = groupes[s] || []).push(c);
  }
  for (const s of Object.keys(groupes)) {
    groupes[s].sort((a, b) => a.title.localeCompare(b.title));
  }
  return groupes;
}

export const NOMS_LANGUES = {
  fr: "Français", en: "English", es: "Español", de: "Deutsch",
  pt: "Português", ja: "日本語", ko: "한국어",
};

export const DRAPEAUX = {
  fr: "🇫🇷", en: "🇬🇧", es: "🇪🇸", de: "🇩🇪", pt: "🇧🇷", ja: "🇯🇵", ko: "🇰🇷",
};
