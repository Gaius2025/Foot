// scripts/update_live.js
// Compatible Node18+/CommonJS (aucun import ES)
// Exécute via GitHub Actions et envoie les mises à jour live au VPS

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const BASE_API = "https://api.sofascore.com/api/v1/event";
const GROUPES_DIR = "sofascore-ingest/groupes_json";

(async () => {
  console.log("🚀 Démarrage de la mise à jour live Sofascore...");

  if (!VPS_WEBHOOK) {
    console.error("❌ Erreur : VPS_WEBHOOK non défini dans les variables d’environnement !");
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const groupes = fs.readdirSync(GROUPES_DIR)
    .filter(f => f.match(/^championnats_groupe_\d+\.json$/));

  for (const file of groupes) {
    const groupe = file.match(/(\d+)/)[1];
    const fullPath = path.join(GROUPES_DIR, file);
    console.log(`📂 Lecture du groupe ${groupe} -> ${fullPath}`);

    const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const matches = json.matches || [];
    const updatedMatches = [];

    for (const m of matches) {
      const matchId = m.match?.matchId;
      if (!matchId) continue;

      const url = `${BASE_API}/${matchId}`;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!resp) continue;

        const status = resp.status();
        if (status !== 200) {
          console.warn(`⚠️ ${matchId}: HTTP ${status}`);
          continue;
        }

        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { continue; }

        const ev = data.event;
        if (!ev) continue;

        const live = {
          status: ev.status?.type || "unknown",
          homeScore: ev.homeScore?.current ?? null,
          awayScore: ev.awayScore?.current ?? null
        };

        let result = "pending";
        if (live.status === "finished") {
          result = (live.homeScore > live.awayScore) ? "homeWin" : "lost";
        }

        updatedMatches.push({
          ...m,
          live,
          result
        });

        console.log(`✅ Match ${matchId} -> ${live.status} (${live.homeScore}-${live.awayScore})`);
      } catch (err) {
        console.error(`❌ Erreur match ${matchId}:`, err.message);
      }

      // Attendre un peu entre chaque requête pour éviter le blocage
      await new Promise(r => setTimeout(r, 800));
    }

    const payload = {
      groupe,
      updatedAt: new Date().toISOString(),
      matches: updatedMatches
    };

    try {
      const res = await axios.post(VPS_WEBHOOK, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log(`📤 Groupe ${groupe} envoyé (${res.status})`);
    } catch (err) {
      console.error(`⛔ Erreur envoi groupe ${groupe}:`, err.message);
    }
  }

  await browser.close();
  console.log("🏁 Fin du script update_live.js");
})();
// scripts/update_live.js
// Compatible Node18+/CommonJS (aucun import ES)
// Exécute via GitHub Actions et envoie les mises à jour live au VPS

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const BASE_API = "https://api.sofascore.com/api/v1/event";
const GROUPES_DIR = "sofascore-ingest/groupes_json";

(async () => {
  console.log("🚀 Démarrage de la mise à jour live Sofascore...");

  if (!VPS_WEBHOOK) {
    console.error("❌ Erreur : VPS_WEBHOOK non défini dans les variables d’environnement !");
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const groupes = fs.readdirSync(GROUPES_DIR)
    .filter(f => f.match(/^championnats_groupe_\d+\.json$/));

  for (const file of groupes) {
    const groupe = file.match(/(\d+)/)[1];
    const fullPath = path.join(GROUPES_DIR, file);
    console.log(`📂 Lecture du groupe ${groupe} -> ${fullPath}`);

    const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const matches = json.matches || [];
    const updatedMatches = [];

    for (const m of matches) {
      const matchId = m.match?.matchId;
      if (!matchId) continue;

      const url = `${BASE_API}/${matchId}`;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!resp) continue;

        const status = resp.status();
        if (status !== 200) {
          console.warn(`⚠️ ${matchId}: HTTP ${status}`);
          continue;
        }

        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { continue; }

        const ev = data.event;
        if (!ev) continue;

        const live = {
          status: ev.status?.type || "unknown",
          homeScore: ev.homeScore?.current ?? null,
          awayScore: ev.awayScore?.current ?? null
        };

        let result = "pending";
        if (live.status === "finished") {
          result = (live.homeScore > live.awayScore) ? "homeWin" : "lost";
        }

        updatedMatches.push({
          ...m,
          live,
          result
        });

        console.log(`✅ Match ${matchId} -> ${live.status} (${live.homeScore}-${live.awayScore})`);
      } catch (err) {
        console.error(`❌ Erreur match ${matchId}:`, err.message);
      }

      // Attendre un peu entre chaque requête pour éviter le blocage
      await new Promise(r => setTimeout(r, 800));
    }

    const payload = {
      groupe,
      updatedAt: new Date().toISOString(),
      matches: updatedMatches
    };

    try {
      const res = await axios.post(VPS_WEBHOOK, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log(`📤 Groupe ${groupe} envoyé (${res.status})`);
    } catch (err) {
      console.error(`⛔ Erreur envoi groupe ${groupe}:`, err.message);
    }
  }

  await browser.close();
  console.log("🏁 Fin du script update_live.js");
})();
