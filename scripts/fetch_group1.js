// scripts/fetch_group1.js
// 🚀 Analyse complète d’un groupe Sofascore (Group 1)
// Objectif : identifier les matchs de demain où un top 3 joue à domicile, et les envoyer au VPS

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// === CONFIGURATION ===
const TABLE_PATH = path.join(__dirname, '../tables/table1.json');
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;
const GROUP_NAME = '1';

// === Vérifications initiales ===
console.log(`🚀 Démarrage du script Group ${GROUP_NAME}...`);

if (!VPS_WEBHOOK) {
  console.error("❌ Erreur : aucune URL VPS_WEBHOOK trouvée dans les variables d’environnement !");
  process.exit(2);
}

if (!fs.existsSync(TABLE_PATH)) {
  console.error(`❌ Erreur : fichier ${TABLE_PATH} introuvable !`);
  process.exit(3);
}

console.log(`📖 Lecture du fichier : ${TABLE_PATH}`);
const table = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf-8'));
console.log(`✅ Table chargée (${Object.keys(table).length} pays trouvés).`);

// === Lancement Playwright ===
(async () => {
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext({ userAgent: ua });

    // Gestion des cookies
    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();
    const matchesToSend = [];

    // Calcul de la date de demain
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const formattedDate = `${yyyy}-${mm}-${dd}`;

    // === Analyse principale ===
    for (const [country, data] of Object.entries(table)) {
      console.log(`\n🌍 Traitement du pays : ${country}`);

      for (const league of data.leagues) {
        console.log(` ⚽ Ligue : ${league.name} (ID: ${league.id})`);

        // Étape 1 : récupérer les matchs de demain
        const scheduleUrl = `https://www.sofascore.com/api/v1/unique-tournament/${league.id}/scheduled-events/${formattedDate}`;
        let scheduleData;
        try {
          const resp = await page.goto(scheduleUrl, { waitUntil: 'networkidle', timeout: 20000 });
          scheduleData = await resp.json();
          console.log(` ↳ ${scheduleData.events?.length || 0} matchs trouvés pour ${formattedDate}`);
        } catch (err) {
          console.warn(` ⚠️ Impossible de récupérer les matchs : ${err.message}`);
          continue;
        }

        if (!scheduleData?.events?.length) continue;

        const seasonId = scheduleData.events[0]?.season?.id;
        if (!seasonId) {
          console.warn(" ⚠️ Aucun season_id détecté, on saute cette ligue.");
          continue;
        }

        // Étape 2 : récupérer le classement (top 3)
        const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${league.id}/season/${seasonId}/standings/total`;
        let standingsData;
        try {
          const resp = await page.goto(standingsUrl, { waitUntil: 'networkidle', timeout: 20000 });
          standingsData = await resp.json();
          console.log(` ↳ Classement récupéré avec succès.`);
        } catch {
          console.warn(" ⚠️ Erreur lors de la récupération du classement.");
          continue;
        }

        const top3 = standingsData?.standings?.[0]?.rows?.slice(0, 3)?.map(r => ({
          id: r.team.id,
          name: r.team.name
        })) || [];
        console.log(` 🏆 Top 3 équipes extraites (${top3.length} trouvées).`);

        if (!top3.length) continue;

        // Étape 3 : filtrer les matchs du jour avec un top 3 à domicile
        const filteredMatches = scheduleData.events.filter(ev =>
          top3.some(t => t.id === ev.homeTeam?.id)
        );

        if (!filteredMatches.length) {
          console.log(" ❌ Aucun match avec un top 3 à domicile demain.");
          continue;
        }

        for (const match of filteredMatches) {
          const homeTeam = match.homeTeam;
          const awayTeam = match.awayTeam;

          // Étape 4 : récupérer le dernier match du top 3 à domicile
          const lastUrl = `https://www.sofascore.com/api/v1/team/${homeTeam.id}/events/last/1`;
          let lastData;
          try {
            const resp = await page.goto(lastUrl, { waitUntil: 'networkidle', timeout: 15000 });
            lastData = await resp.json();
          } catch {
            console.warn(` ⚠️ Impossible de récupérer le dernier match pour ${homeTeam.name}`);
          }

          matchesToSend.push({
            country,
            league: league.name,
            season_id: seasonId,
            match_id: match.id,
            match_slug: match.slug,
            homeTeam: { id: homeTeam.id, name: homeTeam.name },
            awayTeam: { id: awayTeam.id, name: awayTeam.name },
            startTimestamp: match.startTimestamp,
            lastHomeMatch: lastData?.events?.[0] || null
          });
        }
      }
    }

    // === Envoi au VPS ===
    console.log("\n📤 Préparation à l’envoi au VPS...");
    if (matchesToSend.length) {
      const payload = {
        groupe: GROUP_NAME,
        timestamp: Date.now(),
        matches: matchesToSend
      };

      const posted = await sendToVPS(VPS_WEBHOOK, payload);
      if (posted.ok) console.log("✅ JSON envoyé avec succès au VPS !");
      else console.error("⛔ Erreur lors du POST vers VPS:", posted.text || posted.error);
    } else {
      console.log("ℹ️ Aucun match à envoyer pour demain.");
    }

  } catch (err) {
    console.error("💥 Erreur inattendue :", err);
  } finally {
    await browser.close();
    console.log("🏁 Fin du script Group 1.");
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
