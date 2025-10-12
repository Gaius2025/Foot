// scripts/fetch_group1.js
// Analyse Group 1 (top3/home/last match lost → envoi VPS)
// Usage: node scripts/fetch_group1.js
// Variables d'env requises : VPS_WEBHOOK (obligatoire), SOFASCORE_COOKIE (optionnel)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '../tables/table1.json');
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;
const NAV_TIMEOUT = 20000;

if (!VPS_WEBHOOK) {
  console.error('❌ VPS_WEBHOOK non défini. Mets la variable d\'env VPS_WEBHOOK et relance.');
  process.exit(1);
}

function tomorrowISO() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

(async () => {
  console.log('🚀 Démarrage du script Group 1...');

  // Lecture du fichier table1.json
  let table;
  try {
    const raw = fs.readFileSync(TABLE_PATH, 'utf-8');
    table = JSON.parse(raw);
    console.log(`📖 Lecture du fichier : ${TABLE_PATH}`);
  } catch (err) {
    console.error('❌ Impossible de lire/parse table1.json :', err.message);
    process.exit(2);
  }

  const countries = Object.keys(table || {});
  console.log(`✅ Table chargée (${countries.length} pays trouvés).`);

  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  const ctx = await browser.newContext({ userAgent: ua });
  if (COOKIE.trim()) {
    try {
      await ctx.addCookies(
        COOKIE.split(';').map(c => {
          const [n, ...v] = c.trim().split('=');
          return { name: n, value: v.join('='), domain: 'www.sofascore.com', path: '/', secure: true };
        })
      );
      console.log('🔐 Cookies ajoutés.');
    } catch (e) {
      console.warn('⚠️ Erreur ajout cookies :', e.message);
    }
  }
  const page = await ctx.newPage();

  async function fetchJson(url, label = '') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
        if (!resp) throw new Error('Pas de réponse');
        if (resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
        try { return await resp.json(); } catch { return JSON.parse(await resp.text()); }
      } catch (err) {
        console.warn(`⚠️ [${label}] tentative ${attempt} échouée (${err.message})`);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    return null;
  }

  const dateTomorrow = tomorrowISO();
  console.log(`📅 Date cible : ${dateTomorrow}`);

  let matchesToSend = [];

  // --- Boucle sur les pays ---
  for (const country of countries) {
    console.log(`\n🌍 Pays : ${country}`);
    const data = table[country];
    if (!data || !Array.isArray(data.leagues)) continue;

    for (const league of data.leagues) {
      const leagueName = league.name;
      const leagueId = league.id;
      console.log(`\n ⚽ Ligue : ${leagueName} (ID: ${leagueId})`);

      // 1️⃣ Récupération des matchs de demain
      const scheduledUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${dateTomorrow}`;
      const scheduled = await fetchJson(scheduledUrl, `scheduled-${leagueId}`);
      if (!scheduled?.events?.length) {
        console.log('   ⚠️ Aucun match trouvé pour demain.');
        continue;
      }
      const seasonId = scheduled.events.find(e => e.season?.id)?.season?.id;
      if (!seasonId) {
        console.log('   ⚠️ season.id introuvable, on passe.');
        continue;
      }
      console.log(`   ↳ season.id = ${seasonId}`);

      // 2️⃣ Classement (Top 3)
      const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/standings/total`;
      const standings = await fetchJson(standingsUrl, `standings-${leagueId}`);
      let rows = [];
      if (Array.isArray(standings?.rows)) rows = standings.rows;
      else if (Array.isArray(standings?.standings) && standings.standings[0]?.rows)
        rows = standings.standings[0].rows;
      if (!rows.length) {
        console.log('   ⚠️ Pas de rows (classement vide).');
        continue;
      }

      const top3 = rows.slice(0, 3).map(r => ({
        id: r.team?.id,
        name: r.team?.name
      })).filter(t => t.id);
      console.log(`   🏆 Top 3: ${top3.map(t => t.name).join(' | ')}`);

      const top3Ids = new Set(top3.map(t => t.id));
      const homeMatches = scheduled.events.filter(e => top3Ids.has(e.homeTeam?.id));
      if (!homeMatches.length) {
        console.log('   🏟️ Aucun match à domicile d\'une équipe du top 3.');
        continue;
      }

      // 3️⃣ Vérif du dernier match dans le même championnat
      for (const m of homeMatches) {
        const home = m.homeTeam;
        const away = m.awayTeam;
        const slug = m.slug;
        console.log(`     → Match : ${home.name} vs ${away.name}`);

        const lastUrl = `https://www.sofascore.com/api/v1/team/${home.id}/unique-tournament/${leagueId}/events/last/0`;
        const lastData = await fetchJson(lastUrl, `last-${home.id}`);
        if (!lastData?.events?.length) {
          console.log('       ⚠️ Aucun last event trouvé.');
          continue;
        }
        const lastMatch = lastData.events[0];
        let res = null;
        const hs = lastMatch.homeScore?.current;
        const as = lastMatch.awayScore?.current;
        if (hs != null && as != null) {
          if (lastMatch.homeTeam?.id === home.id) res = hs > as ? 'win' : hs < as ? 'loss' : 'draw';
          else if (lastMatch.awayTeam?.id === home.id) res = as > hs ? 'win' : as < hs ? 'loss' : 'draw';
        }

        if (res === 'loss') {
          console.log(`       ✅ ${home.name} a perdu son dernier match.`);
          matchesToSend.push({
            country,
            league: leagueName,
            leagueId,
            seasonId,
            match: {
              id: m.id,
              slug,
              startTimestamp: m.startTimestamp,
              homeTeam: { id: home.id, name: home.name },
              awayTeam: { id: away.id, name: away.name }
            }
          });
        } else {
          console.log(`       ⛔ ${home.name} n'a pas perdu (résultat: ${res || 'inconnu'}).`);
        }
      }
    }
  }

  // 4️⃣ Envoi au VPS
  if (matchesToSend.length) {
    console.log(`\n📤 Envoi de ${matchesToSend.length} match(es) au VPS...`);
    const payload = {
      groupe: '1',
      generatedAt: new Date().toISOString(),
      dateTarget: dateTomorrow,
      matches: matchesToSend
    };
    try {
      const resp = await page.request.post(VPS_WEBHOOK, {
        headers: { 'Content-Type': 'application/json' },
        data: payload,
        timeout: NAV_TIMEOUT
      });
      console.log(resp.ok ? '✅ Données envoyées au VPS.' : `⛔ Erreur HTTP VPS: ${resp.status()}`);
    } catch (e) {
      console.error('⛔ Erreur lors de l\'envoi au VPS :', e.message);
    }
  } else {
    console.log('\nℹ️ Aucun match à envoyer.');
  }

  await browser.close();
  console.log('\n🏁 Fin du script Group 1.');
  process.exit(0);
})();
