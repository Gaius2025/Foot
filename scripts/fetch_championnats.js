// scripts/fetch_championnats_raw.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
  const COOKIE = process.env.SOFASCORE_COOKIE || '';
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: ua });

    // Ajout des cookies si nécessaires
    if (COOKIE.trim()) {
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
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // On intercepte la réponse brute pour être sûr de capter le JSON complet
    page.on('response', async (response) => {
      if (response.url().includes('/api/v1/sport/football/categories/all')) {
        try {
          const txt = await response.text();
          const filePath = path.resolve(__dirname, 'championnats_raw.json');
          fs.writeFileSync(filePath, txt, 'utf-8');
          console.log(`✅ Données brutes écrites dans : ${filePath}`);
        } catch (err) {
          console.error('❌ Erreur lors de l’écriture du fichier :', err);
        }
      }
    });

    console.log('🌐 Navigation vers:', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // on attend un petit délai pour être sûr que la requête est bien captée
    await page.waitForTimeout(3000);

  } catch (err) {
    console.error('Erreur inattendue :', err);
  } finally {
    await browser.close();
  }
})();
