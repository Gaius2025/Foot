// scripts/fetch_championnats_names.js
// Récupère tous les noms de championnats Sofascore et les sauvegarde dans tables/memo_noms.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const SOFA_CATEGORIES = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
  const COOKIE = process.env.SOFASCORE_COOKIE || '';
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: ua, viewport: { width: 360, height: 800 } });
    if (COOKIE.trim()) {
      const cookies = COOKIE.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();
    const result = await page.evaluate(async ({ url, ua, cookieString }) => {
      const headers = {
        'accept': '*/*',
        'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'max-age=0',
        'referer': 'https://www.sofascore.com/',
        'user-agent': ua,
        'x-requested-with': '335131'
      };
      if (cookieString) headers['cookie'] = cookieString;

      const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      return await resp.json();
    }, { url: SOFA_CATEGORIES, ua, cookieString: COOKIE });

    // Extraire tous les noms récursivement
    const names = [];
    function extractNames(cat) {
      if (cat.uniqueTournaments) cat.uniqueTournaments.forEach(t => names.push(t.name));
      if (cat.categories) cat.categories.forEach(sub => extractNames(sub));
    }
    if (result.categories && Array.isArray(result.categories)) result.categories.forEach(c => extractNames(c));

    // Sauvegarde
    const filePath = path.join(__dirname, '../tables/memo_noms.js');
    fs.writeFileSync(filePath, 'module.exports = ' + JSON.stringify(names, null, 2) + ';');
    console.log(`✅ Tous les noms de championnats sauvegardés dans ${filePath} (${names.length} items)`);

  } catch (err) {
    console.error('Erreur inattendue :', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
