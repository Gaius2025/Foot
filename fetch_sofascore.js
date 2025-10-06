// scripts/fetch_championnats.js
// Playwright script -> récupère (via interception réseau) les catégories Sofascore et sauvegarde tous les noms
// Usage : node scripts/fetch_championnats.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOFA_CATEGORIES = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
const SOFA_PAGE = 'https://www.sofascore.com/sport/football';
const COOKIE = process.env.SOFASCORE_COOKIE || ''; // optionnel mais recommandé

(async () => {
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext({ userAgent: ua, viewport: { width: 1200, height: 900 } });

    // ajouter cookies si fournis (utile pour contourner des blocages)
    if (COOKIE && COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return {
          name: name.trim(),
          value: rest.join('='),
          domain: 'www.sofascore.com',
          path: '/',
          httpOnly: false,
          secure: true
        };
      });
      if (cookies.length) {
        await context.addCookies(cookies);
        console.log('Cookies ajoutés au contexte :', cookies.map(c => c.name).join(', '));
      }
    }

    const page = await context.newPage();

    // variable qui contiendra l'objet JSON intercepté
    let captured = null;
    let capturedUrl = null;

    // Intercepteur de réponses réseau
    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (!url) return;
        // on cible la route contenant "categories/all"
        if (url.includes('/categories/all')) {
          try {
            const json = await response.json();
            captured = json;
            capturedUrl = url;
            console.log('✅ Intercepté response categories/all depuis:', url);
          } catch (e) {
            // parfois non JSON ou erreur -> ignore
            console.warn('Interception categories/all, impossible de parser JSON:', e.message || e);
          }
        }
      } catch (e) {
        // safe guard
      }
    });

    // 1) On tente une navigation directe vers l'endpoint (parfois marche)
    try {
      console.log('Tentative navigation directe vers endpoint categories...');
      const resp = await page.goto(SOFA_CATEGORIES, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => null);
      if (resp && (resp.status() === 200 || resp.status() === 304)) {
        try {
          const json = await resp.json();
          if (json) {
            captured = json;
            capturedUrl = SOFA_CATEGORIES;
            console.log('✅ Récupéré JSON via navigation directe.');
          }
        } catch (e) {
          console.log('Navigation directe: réponse non JSON ou impossible à parser.');
        }
      } else {
        console.log('Navigation directe non concluante (status != 200).');
      }
    } catch (err) {
      console.warn('Erreur navigation directe:', err.message || err);
    }

    // 2) Si pas encore capturé, on ouvre la page sport/football pour déclencher les XHR et attend l'interception
    if (!captured) {
      console.log('Visite de la page principale pour déclencher les appels XHR...');
      await page.goto(SOFA_PAGE, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => null);
      // attendre quelques secondes pour laisser les requêtes réseau se produire
      await page.waitForTimeout(4000);
    }

    // 3) si toujours rien, faire une requête fetch depuis le contexte page (simulate browser fetch)
    if (!captured) {
      console.log('Tentative fetch depuis le contexte navigateur (page.evaluate)...');
      try {
        const result = await page.evaluate(async (urlToFetch, cookieString) => {
          try {
            const headers = {
              'accept': '*/*',
              'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
              'referer': 'https://www.sofascore.com/',
              'user-agent': navigator.userAgent
            };
            if (cookieString && cookieString.length) headers['cookie'] = cookieString;
            const r = await fetch(urlToFetch, { method: 'GET', headers, credentials: 'include' });
            const ct = r.headers.get('content-type') || '';
            if (ct.includes('application/json') || ct.includes('text/json')) {
              return { status: r.status, body: await r.json() };
            } else {
              const txt = await r.text();
              try { return { status: r.status, body: JSON.parse(txt) }; } catch { return { status: r.status, body: { text: txt } }; }
            }
          } catch (e) {
            return { error: String(e) };
          }
        }, SOFA_CATEGORIES, COOKIE);

        if (result && result.body) {
          captured = result.body;
          capturedUrl = SOFA_CATEGORIES + ' (fetch via page)';
          console.log('✅ Récupéré JSON via fetch sur la page.');
        } else {
          console.warn('fetch via page n\'a pas renvoyé de body:', result && result.error);
        }
      } catch (e) {
        console.warn('Erreur lors du fetch via page:', e.message || e);
      }
    }

    // Debug si rien récupéré
    if (!captured) {
      console.error('❌ Impossible de récupérer les catégories Sofascore. Vérifie SOFASCORE_COOKIE ou les restrictions réseau.');
      // Pour debug, on peut sauvegarder le HTML de la page visitée
      try {
        const html = await page.content();
        fs.writeFileSync(path.join(__dirname, '../tables/page_debug.html'), html, 'utf8');
        console.log('HTML de debug sauvé dans tables/page_debug.html');
      } catch (e) {}
      process.exit(1);
    }

    // Maintenant on a captured (objet JSON). Extraire tous les noms de championnats.
    // Les championnats peuvent être présents dans captured.categories (liste de pays) puis
    // dans uniqueTournaments pour chaque pays, ou d'autres structures.
    const names = [];
    function walkAndCollect(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(item => walkAndCollect(item));
        return;
      }
      // Si objet a "name" et "id" et ressemble à un tournoi unique -> prendre name
      if (obj.name && obj.id && obj.slug && (obj.uniqueTournament || obj.fieldTranslations || obj.sport || obj.userCount || obj.category)) {
        // cela peut être un "category" ou "uniqueTournament"; on veut surtout uniqueTournament => mais on collectera name si présent
        names.push(String(obj.name));
      }
      // Cas spécifique: uniqueTournaments array inside a category object
      if (obj.uniqueTournaments && Array.isArray(obj.uniqueTournaments)) {
        obj.uniqueTournaments.forEach(ut => {
          if (ut && ut.name) names.push(String(ut.name));
        });
      }
      // Recurse on object properties
      Object.values(obj).forEach(v => {
        if (v && typeof v === 'object') walkAndCollect(v);
      });
    }

    walkAndCollect(captured);

    // Dédupliquer et nettoyer
    const uniq = Array.from(new Set(names.map(n => n.trim()).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'en', {sensitivity:'base'}));

    // Ecrire le fichier memo_noms.js dans tables/
    const tablesDir = path.join(__dirname, '../tables');
    if (!fs.existsSync(tablesDir)) fs.mkdirSync(tablesDir, { recursive: true });

    const outPath = path.join(tablesDir, 'memo_noms.js');
    const fileContent = 'module.exports = ' + JSON.stringify(uniq, null, 2) + ';\n';
    fs.writeFileSync(outPath, fileContent, 'utf8');

    console.log(`✅ Tous les noms de championnats sauvegardés dans ${outPath} (${uniq.length} items)`);
    if (capturedUrl) console.log('Source interceptée:', capturedUrl);

    // Si tu veux visualiser l'objet complet pour debug, tu peux écrire:
    // fs.writeFileSync(path.join(tablesDir, 'categories_raw.json'), JSON.stringify(captured, null, 2), 'utf8');

    process.exit(0);

  } catch (err) {
    console.error('Erreur inattendue:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
