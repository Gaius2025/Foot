// scripts/fetch_group1.js
// Analyse automatique Group 1 : Top 3 / domicile / dernier match perdu
// Usage: node scripts/fetch_group1.js
// Nécessite playwright installé et un fichier tables/table1.json
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

// Retourne la date de demain en format YYYY-MM-DD
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

  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // Création du contexte navigateur
  const page = await (async () => {
    const ctx = await browser.newContext({ userAgent: ua });
    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return {
          name: name.trim(),
          value: rest.join('='),
          domain: 'www.sofascore.com',
          path: '/',
          httpOnly: false,
          secure: true
        };
      });
      if (cookies.length) {
        try {
          await ctx.addCookies(cookies);
          console.log('🔐 Cookies ajoutés au contexte Playwright.');
        } catch (e) {
          console.warn('⚠️ Erreur ajout cookies :', e.message);
        }
      }
    }
    return await ctx.newPage();
  })();

  // Fonction utilitaire pour récupérer du JSON
  async function fetchJson(url, label = '') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
        if (!resp) throw new Error('No response object');
        const status = resp.status();
        if (status >= 400) throw new Error(`HTTP ${status}`);
        const text = await resp.text();
        return JSON.parse(text);
      } catch (err) {
        console.warn(`⚠️ [${label}] tentative ${attempt} échouée → ${err.message}`);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    return null;
  }

  const dateTomorrow = tomorrowISO();
  console.log(`📅 Date analysée : ${dateTomorrow}`);

  let matchesToSend = [];

  // Parcourir chaque pays
  for (const country of countries) {
    console.log(`\n🌍 Pays : ${country}`);
    const data = table[country];
    if (!data || !Array.isArray(data.leagues)) continue;

    for (const league of data.leagues) {
      const leagueName = league.name || 'unknown';
      const leagueId = league.id;
      if (!leagueId) continue;

      console.log(`⚽ Ligue : ${leagueName} (ID: ${leagueId})`);

      // --- Étape 1 : récupérer les matchs de demain
      const scheduledUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${dateTomorrow}`;
      const scheduled = await fetchJson(scheduledUrl, `scheduled-${leagueId}`);
      if (!scheduled || !Array.isArray(scheduled.events) || scheduled.events.length === 0) {
        console.log(`   ⚠️ Aucun match programmé demain.`);
        continue;
      }

      // Extraire infos nécessaires : seasonId, tournamentId, matchId, teams, roundId
      const events = scheduled.events;
      const seasonId = events[0]?.season?.id || null;
      const roundId = events[0]?.roundInfo?.round || null;
      const tournamentId = events[0]?.tournament?.uniqueTournament?.id || leagueId;

      console.log(`   🔹 Season ID: ${seasonId} | Round ID: ${roundId} | Tournament ID: ${tournamentId}`);

      if (!seasonId || !roundId) {
        console.warn('   ⚠️ seasonId ou roundId manquant, on passe cette ligue.');
        continue;
      }

      // --- Étape 2 : Récupérer le top 3 du classement
      const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/standings/total`;
      const standings = await fetchJson(standingsUrl, `standings-${leagueId}`);
      let rows = [];
      if (standings?.standings?.[0]?.rows) rows = standings.standings[0].rows;
      else if (standings?.rows) rows = standings.rows;

      if (!rows || rows.length === 0) {
        console.warn('   ⚠️ Classement introuvable.');
        continue;
      }

      const top3 = rows.slice(0, 3).map(r => ({
        id: r.team?.id,
        name: r.team?.name
      })).filter(Boolean);

      console.log(`   🥇 Top 3: ${top3.map(t => t.name).join(' | ')}`);

      // --- Étape 3 : filtrer les matchs où un top 3 joue à domicile
      const top3Ids = new Set(top3.map(t => t.id));
      const matchesTomorrow = events.filter(e => top3Ids.has(e.homeTeam?.id));

      if (matchesTomorrow.length === 0) {
        console.log('   ⛔ Aucun match à domicile pour le top 3.');
        continue;
      }

      // --- Étape 4 : pour chaque match sélectionné, récupérer le dernier match du top 3 à domicile
      for (const match of matchesTomorrow) {
        const home = match.homeTeam;
        const away = match.awayTeam;
        const matchId = match.id;
        const slug = match.slug;
        const startTimestamp = match.startTimestamp;

        console.log(`   ⚔️ ${home.name} vs ${away.name}`);

        const lastUrl = `https://www.sofascore.com/api/v1/team/${home.id}/unique-tournament/${tournamentId}/events/last/${roundId}`;
        const lastEvent = await fetchJson(lastUrl, `last-${home.id}`);
        if (!lastEvent || !Array.isArray(lastEvent.events) || lastEvent.events.length === 0) {
          console.warn('     ⚠️ Aucun match précédent trouvé.');
          continue;
        }

        const lastMatch = lastEvent.events[0];
        const hs = Number(lastMatch.homeScore?.current ?? lastMatch.homeScore?.display ?? 0);
        const as = Number(lastMatch.awayScore?.current ?? lastMatch.awayScore?.display ?? 0);
        const isHome = lastMatch.homeTeam?.id === home.id;
        const result = isHome
          ? hs > as ? 'win' : hs < as ? 'loss' : 'draw'
          : as > hs ? 'win' : as < hs ? 'loss' : 'draw';

        console.log(`     📊 Dernier match: ${result}`);

        if (result === 'loss') {
          console.log('     ✅ Équipe du top 3 a perdu son dernier match → ajoutée');
          matchesToSend.push({
            country,
            league: leagueName,
            leagueId,
            tournamentId,
            seasonId,
            roundId,
            match: {
              id: matchId,
              slug,
              startTimestamp,
              homeTeam: { id: home.id, name: home.name },
              awayTeam: { id: away.id, name: away.name }
            },
            lastResult: result
          });
        } else {
          console.log('     ⛔ Pas une défaite, ignoré.');
        }
      }
    }
  }

  // Envoi au VPS
  if (matchesToSend.length > 0) {
    console.log(`\n📤 Envoi au VPS... (${matchesToSend.length} match(es))`);
    const payload = {
      groupe: '1',
      generatedAt: new Date().toISOString(),
      analysisDate: new Date().toISOString(),
      dateTarget: dateTomorrow,
      matches: matchesToSend
    };
    try {
      const resp = await page.request.post(VPS_WEBHOOK, {
        headers: { 'Content-Type': 'application/json' },
        data: payload,
        timeout: NAV_TIMEOUT
      });
      const text = await resp.text();
      if (resp.ok) console.log('✅ JSON envoyé avec succès au VPS !');
      else console.error('⛔ Erreur VPS :', resp.status(), text.slice(0, 200));
    } catch (e) {
      console.error('⛔ Exception POST VPS :', e.message);
    }
  } else {
    console.log('\nℹ️ Aucun match à envoyer.');
  }

  await browser.close();
  console.log('\n🏁 Fin du script Group 1.');
  process.exit(0);
})();
