// update_live.js
// Playwright script -> récupère les scores live par match Sofascore et poste les données au VPS2
// Compatible Node 20, CommonJS

const { chromium } = require('playwright');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK2; // Utilise le secret correct
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;

// Chemin des fichiers historiques
const BASE_DIR = path.join(__dirname, '..', 'public_html', 'sofascore-ingest', 'historique');

if (!VPS_WEBHOOK) {
  console.error("❌ VPS_WEBHOOK2 introuvable !");
  process.exit(2);
}

(async () => {
  console.log("🚀 Démarrage du script de mise à jour des scores live...");

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" });

    // Ajouter cookies si nécessaire
    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // Parcours tous les groupes et fichiers JSON
    const groupes = fs.readdirSync(BASE_DIR).filter(f => f.startsWith('groupe'));
    for (const groupe of groupes) {
      const groupeDir = path.join(BASE_DIR, groupe);
      const fichiers = fs.readdirSync(groupeDir).filter(f => f.endsWith('.json'));

      for (const fichier of fichiers) {
        const filePath = path.join(groupeDir, fichier);
        let payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const matches = payload.matches || [];

        for (const matchEntry of matches) {
          const matchId = matchEntry.match?.matchId || matchEntry.matchId;
          if (!matchId) continue;

          const url = `https://api.sofascore.com/api/v1/event/${matchId}`;
          let finalData = null;

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
              if (response && (response.status() === 200 || response.status() === 304)) {
                try { finalData = await response.json(); } 
                catch { 
                  const txt = await response.text();
                  finalData = JSON.parse(txt);
                }
                break;
              }
            } catch {}
            if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 500));
          }

          if (!finalData) {
            console.warn(`⚠️ Impossible de récupérer le match ${matchId}`);
            continue;
          }

          // On peut injecter les statuts / scores directement dans le payload
          matchEntry.liveScore = finalData.event?.homeScore + ' - ' + finalData.event?.awayScore;
          matchEntry.status = finalData.event?.status;

          // Envoie au VPS
          const posted = await sendToVPS(VPS_WEBHOOK, {
            source: 'live_match',
            matchId,
            payload: finalData,
            groupe,
            fichier,
            timestamp: Date.now()
          });
          if (posted.ok) console.log(`✅ Match ${matchId} envoyé au VPS !`);
          else console.error(`⛔ Erreur VPS pour match ${matchId}:`, posted);
        }

        // Écriture des scores mis à jour dans le JSON local
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
      }
    }

  } catch (err) {
    console.error('Erreur inattendue :', err);
    process.exit(5);
  } finally {
    await browser.close();
    console.log("🏁 Fin du script update_live.js");
  }

  async function sendToVPS(url, body) {
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

})();
