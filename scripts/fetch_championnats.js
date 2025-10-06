// scripts/fetch_championnats.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

(async () => {
  console.log("🚀 Démarrage du script Sofascore...");

  const url = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const vpsWebhook = process.env.VPS_WEBHOOK;
  const filePath = path.join(__dirname, 'championnats_raw.json');

  if (!vpsWebhook) {
    console.error("❌ Erreur : aucune URL VPS_WEBHOOK trouvée dans les variables d’environnement !");
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const page = await (await browser.newContext({ userAgent: ua })).newPage();
    console.log("🌐 Accès à l’API Sofascore...");
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

    const data = await response.json();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ Données brutes écrites : ${filePath}`);

    // --- Envoi vers le VPS ---
    console.log("📡 Envoi du contenu JSON vers le VPS...");
    const payload = JSON.stringify({ data });

    const req = https.request(vpsWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      console.log(`🛰️ Réponse VPS : ${res.statusCode}`);
      res.on('data', d => process.stdout.write(d));
    });

    req.on('error', (err) => console.error("❌ Erreur d’envoi :", err));
    req.write(payload);
    req.end();

  } catch (err) {
    console.error("❌ Erreur inattendue :", err);
  } finally {
    await browser.close();
  }
})();
