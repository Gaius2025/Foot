// scripts/fetch_championnats_raw.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
  const COOKIE = process.env.SOFASCORE_COOKIE || ''; // si tu veux utiliser un cookie
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: ua });
    
    // Ajouter les cookies si nécessaire
    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();
    
    // On fait la requête en simulant le navigateur
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    let data = null;

    if (response && (response.status() === 200 || response.status() === 304)) {
      try {
        data = await response.json();
      } catch {
        const txt = await response.text();
        try { data = JSON.parse(txt); } catch { data = { text: txt }; }
      }
    }

    // Écriture dans un fichier
    const filePath = path.join(__dirname, 'championnats_raw.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ Données brutes écrites dans : ${filePath}`);

  } catch (err) {
    console.error('Erreur inattendue :', err);
  } finally {
    await browser.close();
  }
})();
