// update_live.js
// Playwright script -> récupère les scores live Sofascore et poste les données au VPS
// Compatible Node 20, CommonJS
// Usage via GitHub Actions

const { chromium } = require('playwright');
const fetch = require('node-fetch'); // nécessaire pour Node.js CommonJS

(async () => {
  const LIVE_ENDPOINT = 'https://www.sofascore.com/api/v1/sport/all/matches/live';
  const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
  const COOKIE = process.env.SOFASCORE_COOKIE || '';
  const MAX_ATTEMPTS = 2;

  console.log("🚀 Démarrage du script de mise à jour des scores live...");

  if (!VPS_WEBHOOK) {
    console.error("❌ Erreur : aucune URL VPS_WEBHOOK trouvée !");
    process.exit(2);
  }

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
    let finalData = null;
    let finalStatus = null;
    let attemptDetails = [];

    console.log("🌐 Tentative de récupération des matchs en direct...");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await page.goto(LIVE_ENDPOINT, { waitUntil: 'networkidle', timeout: 20000 });
        if (response) {
          const status = response.status();
          finalStatus = status;
          attemptDetails.push({ attempt, method: 'goto', status });

          if (status === 200 || status === 304) {
            try { finalData = await response.json(); } 
            catch { 
              const txt = await response.text();
              try { finalData = JSON.parse(txt); } catch { finalData = { text: txt }; }
            }
            break;
          }
        }
      } catch (err) {
        attemptDetails.push({ attempt, method: 'goto', error: String(err) });
      }
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000));
    }

    if (!finalData) {
      console.error("❌ Impossible de récupérer les données après plusieurs tentatives !");
      process.exit(3);
    }

    console.log(`📦 Données live reçues (${JSON.stringify(finalData).length} caractères)`);

    // Préparer le payload pour le VPS
    const payloadToSend = {
      source: 'sofascore_live_matches',
      timestamp: Date.now(),
      endpoint: LIVE_ENDPOINT,
      attempts: attemptDetails,
      status: finalStatus,
      payload: finalData,
      filename: `live_matches_${Date.now()}.json`
    };

    console.log("💾 Envoi au VPS...");
    const posted = await sendToVPS(VPS_WEBHOOK, payloadToSend);
    if (posted.ok) console.log("✅ JSON live envoyé avec succès au VPS !");
    else console.error("⛔ Erreur lors du POST vers VPS:", posted);

  } catch (err) {
    console.error('Erreur inattendue :', err);
    process.exit(5);
  } finally {
    await browser.close();
    console.log("🏁 Fin du script update_live.js");
  }

  async function sendToVPS(url, body) {
    try {
      const resp = await fetch(url, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body) 
      });
      const text = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

})();
