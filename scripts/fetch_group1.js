const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '../tables/table1.json');
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;

if (!VPS_WEBHOOK) {
  console.error("❌ VPS_WEBHOOK non défini !");
  process.exit(1);
}

(async () => {
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext({ userAgent: ua });

    // Ajouter les cookies si besoin
    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // Lire la table JSON
    const table = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf-8'));

    let matchesToSend = [];

    for (const [country, data] of Object.entries(table)) {
      for (const league of data.leagues) {
        const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${league.id}/season/${league.seasonId || 'current'}/standings/total`;

        let standings;
        try {
          const resp = await page.goto(standingsUrl, { waitUntil: 'networkidle', timeout: 20000 });
          standings = await resp.json();
        } catch (err) {
          console.warn(`⚠️ Impossible de récupérer standings pour ${league.name}:`, err);
          continue;
        }

        // Prendre le top 3
        const top3 = standings.standings?.slice(0, 3) || [];
        for (const team of top3) {
          // Vérifier le dernier match perdu
          const eventsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${league.id}/season/${league.seasonId || 'current'}/team-events/total`;
          let eventsData;
          try {
            const resp = await page.goto(eventsUrl, { waitUntil: 'networkidle', timeout: 15000 });
            eventsData = await resp.json();
          } catch {
            continue;
          }

          const lastMatch = eventsData?.teams?.find(t => t.id === team.id)?.lastMatch;
          if (!lastMatch || lastMatch.result !== 'loss') continue;

          // Vérifier s'il joue demain à domicile
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const yyyy = tomorrow.getFullYear();
          const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
          const dd = String(tomorrow.getDate()).padStart(2, '0');
          const scheduleUrl = `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${yyyy}-${mm}-${dd}`;

          let schedule;
          try {
            const resp = await page.goto(scheduleUrl, { waitUntil: 'networkidle', timeout: 15000 });
            schedule = await resp.json();
          } catch {
            continue;
          }

          const matchTomorrow = schedule.events?.find(e => e.homeTeam?.id === team.id);
          if (!matchTomorrow) continue;

          // Ajouter le match filtré
          matchesToSend.push({
            country,
            league: league.name,
            team: team.name,
            matchId: matchTomorrow.id,
            time: matchTomorrow.startTimestamp,
            venue: 'home'
          });
        }
      }
    }

    if (matchesToSend.length) {
      const payload = {
        groupe: '1',
        timestamp: Date.now(),
        matches: matchesToSend
      };
      const posted = await fetch(VPS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (posted.ok) console.log("✅ JSON envoyé avec succès au VPS !");
      else console.error("⛔ Erreur lors du POST VPS :", await posted.text());
    } else {
      console.log("ℹ️ Aucun match à envoyer pour demain.");
    }

  } catch (err) {
    console.error("Erreur inattendue :", err);
  } finally {
    await browser.close();
    console.log("🏁 Fin du script Group 1.");
  }

})();

