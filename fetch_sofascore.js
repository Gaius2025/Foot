// fetch_sofascore.js
// Exécute Playwright (Chromium), ouvre un contexte "mobile-like", fait un fetch vers l'API Sofascore
// et POSTe le JSON récupéré vers ton VPS (VPS_WEBHOOK).

const { chromium } = require('playwright'); // installé par playwright
const fetch = require('node-fetch');        // npm install node-fetch si besoin (ou utilise global fetch sur node18+)

(async () => {
  const SOFA_ENDPOINT = 'https://www.sofascore.com/api/v1/unique-tournament/7/season/76953/standings/total';
  const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
  const COOKIE = process.env.SOFASCORE_COOKIE || ''; // optionnel

  if (!VPS_WEBHOOK) {
    console.error("Erreur: VPS_WEBHOOK non défini dans les secrets GitHub.");
    process.exit(2);
  }

  const headers = {
    "accept": "*/*",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "max-age=0",
    "referer": "https://www.sofascore.com/tournament/football/europe/uefa-champions-league/7",
    "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    "x-requested-with": "335131"
  };
  if (COOKIE) headers['cookie'] = COOKIE;

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: headers['user-agent'],
      locale: 'fr-FR',
    });

    const page = await context.newPage();

    // IMPORTANT : on passe un objet à page.evaluate pour éviter l'erreur "Too many arguments"
    const result = await page.evaluate(async ({ url, hdrs }) => {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: hdrs,
          credentials: 'include'
        });
        const text = await resp.text();
        try { return { status: resp.status, body: JSON.parse(text) }; }
        catch(e) { return { status: resp.status, bodyText: text }; }
      } catch (err) {
        return { error: String(err) };
      }
    }, { url: SOFA_ENDPOINT, hdrs: headers });

    console.log('Fetch result status:', result && result.status);
    if (result && result.body) {
      const postResp = await fetch(VPS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'sofascore', timestamp: Date.now(), payload: result.body })
      });
      console.log('POST to VPS status:', postResp.status);
      console.log('POST response:', await postResp.text());
      process.exit(postResp.ok ? 0 : 3);
    } else {
      console.error('Fetch did not return JSON. Result:', result);
      process.exit(4);
    }
  } finally {
    await browser.close();
  }
})();
