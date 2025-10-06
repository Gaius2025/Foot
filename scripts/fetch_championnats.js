// scripts/fetch_championnats.js
// Playwright script -> récupère les championnats Sofascore et crée les tables par groupe
// Usage : node fetch_championnats.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOFA_CATEGORIES = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
const COOKIE = process.env.SOFASCORE_COOKIE || '';

const GROUPS = {
  1: [
    "Championnat d’Ouzbékistan — PFL",
    "Championnat d’Israël — League Leumit",
    "Israël — Première Ligue",
    "Championnat d’Irlande — Division 1",
    "Championnat d’Irlande du Nord — NIFL Premiership",
    "Championnat d’Arménie",
    "Championnat d’Arménie — Deuxième division"
  ],
  2: [
    "Championnat d’Afrique du Sud",
    "Bulgarie — B PFG",
    "Bulgarie — A PFG",
    "Bolivie — Primera Division",
    "Algérie — Ligue 1",
    "Corée du Sud — K Ligue 1",
    "Écosse — Championship"
  ],
  3: [
    "Écosse — Première Ligue",
    "Suède — Allsvenskan Femmes",
    "Suède — Division 1",
    "Suède — Allsvenskan",
    "Suisse — SuperLigue",
    "République tchèque — 3 Liga",
    "République tchèque — Druhá Liga"
  ],
  4: [
    "Tchéquie — Première Ligue",
    "Norvège — Toppserien Femmes",
    "Norvège — Division 2",
    "Championnat de Norvège — Adeccoligaen",
    "Championnat de Norvège — Eliteserien",
    "Championnat du Mexique — Ligue MX. Femmes",
    "Championnat du Mexique — Ligue MX"
  ],
  5: [
    "Championnat de Colombie — Categoria Primera A",
    "Championnat de Grèce — Superligue Elláda",
    "Championnat de Belgique — 2ème Division",
    "Championnat d’Autriche — Deuxième ligue",
    "Autriche — Bundesliga",
    "Turquie — TFF 1. Ligue 1",
    "Portugal — Segunda Liga"
  ],
  6: [
    "Pays-Bas — Eerste Divisie",
    "France — National",
    "France — Ligue 2",
    "Russie — 1ère ligue",
    "Italie — Série C. Groupe C",
    "Italie — Série B",
    "Espagne — Division 2"
  ],
  7: [
    "Allemagne — Oberliga NOFV Nord",
    "Allemagne — Ligue 3",
    "Allemagne — Regionalliga Ouest",
    "Allemagne — Oberliga Westfalen",
    "Allemagne — Oberliga Schleswig-Holstein",
    "Allemagne — Oberliga Hessen",
    "Allemagne — Oberliga Hamburg"
  ],
  8: [
    "Allemagne — Oberliga Baden-Württemberg",
    "Allemagne — 2. Bundesliga",
    "Angleterre — Ligue 2",
    "Angleterre — Ligue 1",
    "Angleterre — Championship",
    "Tunisie — Ligue 1",
    "Roumanie — Liga 2"
  ],
  9: [
    "Roumanie — Liga 1",
    "Pérou — Ligue 1",
    "Pays de Galles — Premier League",
    "Salvador — Primera Division",
    "Iran — Azadegan League",
    "Indonésie — Super Ligue",
    "Îles Féroé — Effodeildin",
    "Kenya — Première Ligue"
  ]
};

(async () => {
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext({ userAgent: ua, viewport: { width: 360, height: 800 } });

    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();
    const response = await page.goto(SOFA_CATEGORIES, { waitUntil: 'networkidle', timeout: 20000 });

    if (!response || ![200, 304].includes(response.status())) {
      console.error("Erreur: impossible de récupérer les catégories Sofascore.");
      process.exit(1);
    }

    let allData = await response.json();
    const tournaments = [];

    function extractTournaments(cat) {
      if (cat.uniqueTournaments) {
        cat.uniqueTournaments.forEach(t => tournaments.push({ id: t.id, name: t.name, slug: t.slug, country: cat.name }));
      }
      if (cat.categories) cat.categories.forEach(sub => extractTournaments(sub));
    }

    // ✅ Correction : parcourir allData.categories
    if (allData.categories && Array.isArray(allData.categories)) {
      allData.categories.forEach(c => extractTournaments(c));
    }

    // Filtrage plus permissif avec includes (ignore accents et différences mineures)
    for (let groupNum = 1; groupNum <= 9; groupNum++) {
      const groupNames = GROUPS[groupNum];
      const filtered = tournaments.filter(t =>
        groupNames.some(name => t.name.toLowerCase().includes(name.toLowerCase()))
      );
      const tablePath = path.join(__dirname, '../tables/table' + groupNum + '.js');
      const fileContent = 'module.exports = ' + JSON.stringify(filtered, null, 2) + ';';
      fs.writeFileSync(tablePath, fileContent);
      console.log(`✅ Groupe ${groupNum} écrit dans ${tablePath} (${filtered.length} championnats)`);
    }

    console.log("✅ Toutes les tables générées avec succès.");

  } catch (err) {
    console.error("Erreur inattendue:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
