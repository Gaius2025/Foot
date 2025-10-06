// scripts/fetch_championnats_names.js
// Récupère tous les noms de championnats Sofascore et les sauvegarde dans tables/memo_noms.js
// Utilisation : node scripts/fetch_championnats_names.js

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // npm i node-fetch

(async () => {
  const SOFA_CATEGORIES = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
  const COOKIE = process.env.SOFASCORE_COOKIE || '';

  try {
    const headers = {
      'accept': '*/*',
      'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'max-age=0',
      'referer': 'https://www.sofascore.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      'x-requested-with': '335131'
    };
    if (COOKIE.trim()) headers['cookie'] = COOKIE;

    const resp = await fetch(SOFA_CATEGORIES, { method: 'GET', headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const result = await resp.json();

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
  }
})();
