// scripts/update_live.js
// Playwright/Node.js script pour mettre à jour le statut et le score des matchs depuis Sofascore
// Compatible environnement GitHub Actions / Node 18+
// Aucune dépendance ESM — fonctionne tel quel

const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  console.log("🚀 Démarrage du script de mise à jour des matchs live...");

  // === CONFIGURATION ===
  const VPS_WEBHOOK = process.env.VPS_WEBHOOK; // URL côté VPS (ex: https://tonsite.com/sofascore-ingest/update_live.php)
  const GROUP_FILE = process.env.GROUP_FILE || "groupes_json/championnats_groupe_1.json"; // chemin du fichier JSON local
  const MAX_ATTEMPTS = 2;
  const UA =
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  if (!VPS_WEBHOOK) {
    console.error("❌ Erreur : variable VPS_WEBHOOK non définie !");
    process.exit(2);
  }

  if (!fs.existsSync(GROUP_FILE)) {
    console.error("❌ Fichier introuvable :", GROUP_FILE);
    process.exit(3);
  }

  const data = JSON.parse(fs.readFileSync(GROUP_FILE, "utf8"));
  const matches = data.matches || [];

  if (!matches.length) {
    console.log("⚠️ Aucun match trouvé dans", GROUP_FILE);
    process.exit(0);
  }

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  console.log(`📋 Nombre de matchs à mettre à jour : ${matches.length}`);

  const updatedMatches = [];

  for (const match of matches) {
    const matchId = match.match?.matchId;
    if (!matchId) continue;

    let liveData = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await page.goto(`https://api.sofascore.com/api/v1/event/${matchId}`, {
          timeout: 20000,
          waitUntil: "networkidle",
        });

        if (resp && resp.status() === 200) {
          const json = await resp.json();
          liveData = json.event;
          break;
        }
      } catch (err) {
        console.log(`⚠️ Tentative ${attempt} échouée pour match ${matchId}:`, err.message);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!liveData) {
      console.log(`⛔ Données introuvables pour le match ${matchId}`);
      continue;
    }

    // Analyse des infos live
    const status = liveData.status?.type || "unknown";
    const homeScore = liveData.homeScore?.current || 0;
    const awayScore = liveData.awayScore?.current || 0;

    let winner = "pending";
    if (status === "finished") {
      winner = homeScore > awayScore ? "homeWin" : homeScore < awayScore ? "awayWin" : "draw";
    }

    updatedMatches.push({
      matchId,
      status,
      homeScore,
      awayScore,
      winner,
      startTimestamp: liveData.startTimestamp,
      homeTeam: liveData.homeTeam?.name,
      awayTeam: liveData.awayTeam?.name,
    });

    console.log(`✅ Match ${matchId}: ${status} (${homeScore}-${awayScore})`);
  }

  await browser.close();

  if (!updatedMatches.length) {
    console.log("⚠️ Aucun match mis à jour.");
    process.exit(0);
  }

  console.log("📡 Envoi des résultats au VPS...");
  const payload = {
    source: "sofascore_live_update",
    timestamp: Date.now(),
    groupFile: GROUP_FILE,
    matches: updatedMatches,
  };

  const resp = await sendToVPS(VPS_WEBHOOK, payload);
  if (resp.ok) console.log("✅ Données live envoyées avec succès au VPS !");
  else console.error("❌ Échec de l’envoi au VPS :", resp);

  console.log("🏁 Fin du script.");

  async function sendToVPS(url, body) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
})();
