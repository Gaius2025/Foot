const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// === CONFIGURATION ===
const TABLE_PATH = path.join(__dirname, '../tables/table1.json');
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;

// === COULEURS CONSOLE ===
const color = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

// === VALIDATION DE L'ENVIRONNEMENT ===
if (!VPS_WEBHOOK) {
  console.error(`${color.red}❌ VPS_WEBHOOK non défini dans l'environnement !${color.reset}`);
  process.exit(1);
}

(async () => {
  console.log(`${color.cyan}🚀 Démarrage du script Group 1...${color.reset}`);
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ userAgent: ua });

  try {
    // === COOKIES ===
    if (COOKIE.trim()) {
      console.log(`${color.magenta}🍪 Ajout des cookies Sofascore...${color.reset}`);
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // === LECTURE DU FICHIER TABLE ===
    console.log(`${color.blue}📖 Lecture du fichier : ${TABLE_PATH}${color.reset}`);
    if (!fs.existsSync(TABLE_PATH)) {
      console.error(`${color.red}⛔ Fichier table introuvable : ${TABLE_PATH}${color.reset}`);
      process.exit(1);
    }

    const table = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf-8'));
    console.log(`${color.green}✅ Table chargée (${Object.keys(table).length} pays trouvés).${color.reset}`);

    let matchesToSend = [];

    // === BOUCLE SUR LES PAYS ET LIGUES ===
    for (const [country, data] of Object.entries(table)) {
      console.log(`${color.yellow}\n🌍 Traitement du pays : ${country}${color.reset}`);

      for (const league of data.leagues) {
        console.log(`${color.cyan}  ⚽ Ligue : ${league.name} (ID: ${league.id})${color.reset}`);

        const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${league.id}/season/${league.seasonId || 'current'}/standings/total`;
        let standings = null;

        try {
          const resp = await page.goto(standingsUrl, { waitUntil: 'networkidle', timeout: 20000 });
          standings = await resp.json();
          console.log(`${color.gray}  ↳ Classement récupéré avec succès.${color.reset}`);
        } catch (err) {
          console.warn(`${color.red}  ⚠️ Erreur standings pour ${league.name}:${color.reset}`, err.message);
          continue;
        }

        const top3 = standings?.standings?.slice(0, 3) || [];
        console.log(`${color.green}  🏆 Top 3 équipes extraites (${top3.length} trouvées).${color.reset}`);

        for (const team of top3) {
          const eventsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${league.id}/season/${league.seasonId || 'current'}/team-events/total`;
          let eventsData = null;

          try {
            const resp = await page.goto(eventsUrl, { waitUntil: 'networkidle', timeout: 15000 });
            eventsData = await resp.json();
          } catch {
            console.warn(`${color.yellow}    ⚠️ Échec récupération des matchs pour ${team.name}.${color.reset}`);
            continue;
          }

          const lastMatch = eventsData?.teams?.find(t => t.id === team.id)?.lastMatch;
          if (!lastMatch || lastMatch.result !== 'loss') {
            console.log(`${color.gray}    ↳ ${team.name} : pas de dernière défaite récente.${color.reset}`);
            continue;
          }

          // Vérifier s’il joue demain à domicile
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
            console.warn(`${color.yellow}    ⚠️ Impossible de charger le calendrier pour ${yyyy}-${mm}-${dd}.${color.reset}`);
            continue;
          }

          const matchTomorrow = schedule.events?.find(e => e.homeTeam?.id === team.id);
          if (!matchTomorrow) {
            console.log(`${color.gray}    ↳ ${team.name} ne joue pas demain à domicile.${color.reset}`);
            continue;
          }

          matchesToSend.push({
            country,
            league: league.name,
            team: team.name,
            matchId: matchTomorrow.id,
            time: matchTomorrow.startTimestamp,
            venue: 'home'
          });

          console.log(`${color.green}    ✅ ${team.name} joue demain à domicile !${color.reset}`);
        }
      }
    }

    // === ENVOI AU VPS ===
    console.log(`${color.blue}\n📤 Préparation à l'envoi au VPS...${color.reset}`);

    if (matchesToSend.length > 0) {
      const payload = {
        groupe: '1',
        timestamp: Date.now(),
        matches: matchesToSend
      };

      try {
        const posted = await fetch(VPS_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (posted.ok) {
          console.log(`${color.green}✅ Données envoyées avec succès au VPS (${matchesToSend.length} matchs).${color.reset}`);
        } else {
          console.error(`${color.red}⛔ Erreur lors du POST VPS :${color.reset}`, await posted.text());
        }
      } catch (err) {
        console.error(`${color.red}💥 Erreur réseau lors de l'envoi au VPS :${color.reset}`, err.message);
      }

    } else {
      console.log(`${color.yellow}ℹ️ Aucun match à envoyer pour demain.${color.reset}`);
    }

  } catch (err) {
    console.error(`${color.red}💀 Erreur inattendue :${color.reset}`, err);
  } finally {
    await browser.close();
    console.log(`${color.magenta}\n🏁 Fin du script Group 1.${color.reset}`);
  }

})();
