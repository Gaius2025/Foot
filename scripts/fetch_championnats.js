// fetch_championnats.js
// Playwright script -> récupère les championnats Sofascore et les enregistre par groupe
// Usage via GitHub Actions (Node 18+, Playwright installé)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const SOFA_ENDPOINT = 'https://www.sofascore.com/api/v1/sport/football/categories/all';

  // Dossier où seront stockées les tables
  const TABLE_DIR = path.join(__dirname, '../tables');
  if (!fs.existsSync(TABLE_DIR)) fs.mkdirSync(TABLE_DIR);

  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: ua, locale: 'fr-FR', viewport: { width: 360, height: 800 } });
    const page = await context.newPage();

    // Headers personnalisés
    const headers = {
      accept: '*/*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'max-age=0',
      cookie: process.env.SOFASCORE_COOKIE || '',
      'if-none-match': 'W/"4d940b8cef"',
      'priority': 'u=1, i',
      referer: 'https://www.sofascore.com/',
      'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': ua,
      'x-requested-with': '9abf56'
    };

    const response = await page.goto(SOFA_ENDPOINT, { waitUntil: 'networkidle' });
    let allData = null;

    try {
      allData = await response.json();
    } catch (err) {
      const txt = await response.text();
      try { allData = JSON.parse(txt); } catch { allData = { text: txt }; }
    }

    // ✅ Extraire les championnats
    const extractTournaments = (category) => {
      if (!category?.tournaments) return [];
      return category.tournaments.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        country: t.category?.name || null
      }));
    };

    // Liste complète de tous les championnats récupérés
    let tournaments = [];
    if (Array.isArray(allData)) {
      allData.forEach(c => { tournaments.push(...extractTournaments(c)); });
    } else if (allData.categories) {
      allData.categories.forEach(c => { tournaments.push(...extractTournaments(c)); });
    } else {
      console.error("Format inattendu:", allData);
      process.exit(1);
    }

    // ✅ Championnats cibles par groupe
    const groups = {
      1: ["Championnat d’Ouzbékistan — PFL","Championnat d’Israël — League Leumit","Israël — Première Ligue","Championnat d’Irlande — Division 1","Championnat d’Irlande du Nord — NIFL Premiership","Championnat d’Arménie","Championnat d’Arménie — Deuxième division"],
      2: ["Championnat d’Afrique du Sud","Bulgarie — B PFG","Bulgarie — A PFG","Bolivie — Primera Division","Algérie — Ligue 1","Corée du Sud — K Ligue 1","Écosse — Championship"],
      3: ["Écosse — Première Ligue","Suède — Allsvenskan Femmes","Suède — Division 1","Suède — Allsvenskan","Suisse — SuperLigue","République tchèque — 3 Liga","République tchèque — Druhá Liga"],
      4: ["Tchéquie — Première Ligue","Norvège — Toppserien Femmes","Norvège — Division 2","Championnat de Norvège — Adeccoligaen","Championnat de Norvège — Eliteserien","Championnat du Mexique — Ligue MX. Femmes","Championnat du Mexique — Ligue MX"],
      5: ["Championnat de Colombie — Categoria Primera A","Championnat de Grèce — Superligue Elláda","Championnat de Belgique — 2ème Division","Championnat d’Autriche — Deuxième ligue","Autriche — Bundesliga","Turquie — TFF 1. Ligue 1","Portugal — Segunda Liga"],
      6: ["Pays-Bas — Eerste Divisie","France — National","France — Ligue 2","Russie — 1ère ligue","Italie — Série C. Groupe C","Italie — Série B","Espagne — Division 2"],
      7: ["Allemagne — Oberliga NOFV Nord","Allemagne — Ligue 3","Allemagne — Regionalliga Ouest","Allemagne — Oberliga Westfalen","Allemagne — Oberliga Schleswig-Holstein","Allemagne — Oberliga Hessen","Allemagne — Oberliga Hamburg"],
      8: ["Allemagne — Oberliga Baden-Württemberg","Allemagne — 2. Bundesliga","Angleterre — Ligue 2","Angleterre — Ligue 1","Angleterre — Championship","Tunisie — Ligue 1","Roumanie — Liga 2"],
      9: ["Roumanie — Liga 1","Pérou — Ligue 1","Pays de Galles — Premier League","Salvador — Primera Division","Iran — Azadegan League","Indonésie — Super Ligue","Îles Féroé — Effodeildin","Kenya — Première Ligue"]
    };

    // ✅ Filtrer et écrire chaque table par groupe
    for (const [groupId, names] of Object.entries(groups)) {
      const filtered = tournaments.filter(t => names.includes(t.name));
      const filePath = path.join(TABLE_DIR, `table${groupId}.js`);
      const content = `module.exports = ${JSON.stringify(filtered, null, 2)};`;
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`✅ Groupe ${groupId} écrit avec ${filtered.length} championnats.`);
    }

    console.log("🎉 Tous les fichiers de tables ont été créés !");
  } catch (err) {
    console.error("Erreur inattendue:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
