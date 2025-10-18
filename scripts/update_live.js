// scripts/update_live.js
// Workflow de mise à jour des scores live depuis Sofascore vers VPS

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// URL VPS
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const SOFA_ENDPOINT_BASE = "https://api.sofascore.com/api/v1/event/";
const OUTPUT_DIR = path.join(__dirname, "../public_html/sofascore-ingest/groupes_json");

(async () => {
  console.log("🚀 Démarrage du script de mise à jour des scores live...");

  if (!VPS_WEBHOOK) {
    console.error("❌ Erreur : variable VPS_WEBHOOK manquante !");
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  // Ici, tu récupères la liste des fichiers JSON dans groupes_json/
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith(".json"));
  console.log(`📂 ${files.length} fichiers trouvés pour mise à jour.`);

  for (const file of files) {
    try {
      const fullPath = path.join(OUTPUT_DIR, file);
      const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));

      // Parcours des matchs dans chaque JSON
      for (const [country, data] of Object.entries(json)) {
        if (!data.leagues) continue;
        for (const league of data.leagues) {
          if (!league.matches) continue;

          for (const match of league.matches) {
            const matchId = match.id;
            if (!matchId) continue;

            const url = `${SOFA_ENDPOINT_BASE}${matchId}`;
            console.log(`📡 Vérification du match ${matchId}...`);

            const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
            if (!response) continue;

            const text = await response.text();
            const liveData = JSON.parse(text);

            // Mise à jour du statut et score dans le JSON local
            match.status = liveData.event.status?.type || "unknown";
            match.homeScore = liveData.event.homeScore?.display || 0;
            match.awayScore = liveData.event.awayScore?.display || 0;
          }
        }
      }

      // Sauvegarde du fichier mis à jour
      fs.writeFileSync(fullPath, JSON.stringify(json, null, 2), "utf8");
      console.log(`✅ Fichier mis à jour : ${file}`);

    } catch (err) {
      console.error(`⚠️ Erreur sur ${file} :`, err.message);
    }
  }

  await browser.close();
  console.log("🏁 Fin du script de mise à jour live !");
})();
