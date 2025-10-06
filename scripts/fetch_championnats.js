// scripts/fetch_championnats_memo.js
// Playwright script -> récupère tous les championnats Sofascore et enregistre les noms dans tables/memo_noms.js
// Usage : node fetch_championnats_memo.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOFA_CATEGORIES = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
const COOKIE = process.env.SOFASCORE_COOKIE || '';

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

    // Extraire tous les noms de championnats
    const tournamentNames = [];
    function extractTournamentNames(cat) {
      if (cat.uniqueTournaments) {
        cat.uniqueTournaments.forEach(t => tournamentNames.push(t.name));
      }
      if (cat.categories) cat.categories.forEach(sub => extractTournamentNames(sub));
    }

    if (allData.categories && Array.isArray(allData.categories)) {
      allData.categories.forEach(c => extractTournamentNames(c));
    }

    // Sauvegarder les noms dans tables/memo_noms.js
    const memoPath = path.join(__dirname, '../tables/memo_noms.js');
    const fileContent = 'module.exports = ' + JSON.stringify(tournamentNames, null, 2) + ';';
    fs.writeFileSync(memoPath, fileContent);
    console.log(`✅ Tous les noms de championnats sauvegardés dans ${memoPath} (${tournamentNames.length} items)`);

  } catch (err) {
    console.error("Erreur inattendue:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
