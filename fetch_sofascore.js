// fetch_sofascore.js
const { chromium } = require('playwright');

(async () => {
  const SOFA_ENDPOINT_PART = '/unique-tournament/7/season/76953/standings/total';
  const TOURNAMENT_PAGE = 'https://www.sofascore.com/tournament/football/europe/uefa-champions-league/7';
  const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
  const COOKIE = process.env.SOFASCORE_COOKIE || '';

  if (!VPS_WEBHOOK) {
    console.error("Erreur: VPS_WEBHOOK non défini dans les secrets GitHub.");
    process.exit(2);
  }

  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: ua,
      locale: 'fr-FR',
      // si besoin ajouter viewport pour mobile-like:
      viewport: { width: 360, height: 800 }
    });

    const page = await context.newPage();

    // Si tu veux forcer un cookie (optionnel)
    if (COOKIE && COOKIE.length) {
      // Cookie string ex: "panoramaId=...; panoramaId_expiry=..."
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      for (const pair of cookiePairs) {
        const [name, ...rest] = pair.split('=');
        const value = rest.join('=');
        // définir le cookie sur le domaine sofascore
        await context.addCookies([{
          name: name,
          value: value,
          domain: 'www.sofascore.com',
          path: '/',
          httpOnly: false,
          secure: true,
        }]);
      }
    }

    // Navigue vers la page (cela déclenche les requêtes réseau internes)
    await page.goto(TOURNAMENT_PAGE, { waitUntil: 'networkidle' , timeout: 30000 });

    // Attendre/attraper la réponse réseau de l'API (200 ou 304)
    const response = await page.waitForResponse(
      r => r.url().includes(SOFA_ENDPOINT_PART) && (r.status() === 200 || r.status() === 304),
      { timeout: 20000 } // augmente si nécessaire
    ).catch(err => null);

    if (!response) {
      // tentative de debug: lister les dernières réponses (utile pour logs)
      const requests = await page.evaluate(() => {
        return performance.getEntriesByType('resource')
          .slice(-30)
          .map(r => ({ name: r.name, initiatorType: r.initiatorType }));
      }).catch(() => []);
      console.error('Aucune réponse interceptée pour standings/total. Dernières ressources:', requests);
      // Retourne erreur explicite
      const payload = { error: 'no_response_for_endpoint', details: requests };
      await sendToVPS(VPS_WEBHOOK, payload);
      process.exit(4);
    }

    // Obtenir le JSON ou le texte
    let data;
    try {
      // si 304 Not Modified, certains serveurs renverront un body vide -> essayer text si json fail
      data = await response.json();
    } catch (e) {
      const text = await response.text();
      // essayer parser si c'est du JSON text
      try { data = JSON.parse(text); }
      catch { data = { text }; }
    }

    // Poster au VPS
    const postBody = { source: 'sofascore', timestamp: Date.now(), payload: data };
    const posted = await sendToVPS(VPS_WEBHOOK, postBody);

    if (posted && posted.ok) {
      console.log('✅ Données envoyées au VPS avec succès.');
      process.exit(0);
    } else {
      console.error('⛔ Erreur lors du POST vers VPS.', posted);
      process.exit(3);
    }
  } finally {
    await browser.close();
  }

  // helper pour poster vers le webhook
  async function sendToVPS(url, body) {
    try {
      // node 18+ fournit global fetch
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // timeout géré par GH runner
      });
      const text = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

})();
