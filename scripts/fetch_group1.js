// scripts/fetch_group1.js
// Analyse automatique des matchs du groupe 1 selon la nouvelle logique.
// Étapes :
//  1️⃣ Récupère les matchs de demain (par ligue)
//  2️⃣ Récupère la saison courante et les rounds
//  3️⃣ Récupère le top 3 de la ligue
//  4️⃣ Sélectionne les matchs où un top 3 joue à domicile
//  5️⃣ Récupère le dernier match à domicile de cette équipe et vérifie si elle a perdu
//  6️⃣ Envoie les matchs qualifiés au VPS

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '../tables/table1.json');
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;
const NAV_TIMEOUT = 25000;

if (!VPS_WEBHOOK) {
  console.error('❌ VPS_WEBHOOK non défini. Mets la variable d\'env VPS_WEBHOOK et relance.');
  process.exit(1);
}

// ---- Fonction utilitaire : date de demain au format YYYY-MM-DD ----
function tomorrowISO() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// ---- Démarrage principal ----
(async () => {
  console.log('🚀 Démarrage du script Groupe 1 (nouvelle logique)...');

  // Lire table1.json
  let table;
  try {
    const raw = fs.readFileSync(TABLE_PATH, 'utf-8');
    table = JSON.parse(raw);
    console.log(`📖 Table chargée (${Object.keys(table).length} pays trouvés)`);
  } catch (err) {
    console.error('❌ Erreur lecture table1.json :', err.message);
    process.exit(2);
  }

  // Lancement Playwright
  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.newContext({ userAgent: ua });
  const page = await ctx.newPage();

  if (COOKIE.trim()) {
    const cookies = COOKIE.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
      const [name, ...rest] = pair.split('=');
      return { name, value: rest.join('='), domain: 'www.sofascore.com', path: '/', secure: true };
    });
    if (cookies.length) {
      await ctx.addCookies(cookies);
      console.log('🔐 Cookies ajoutés.');
    }
  }

  // ---- Helper: Fetch JSON ----
  async function fetchJson(url, label = '') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`🌐 [${label}] Tentative ${attempt} → ${url}`);
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
        if (!resp) throw new Error('Pas de réponse');
        const txt = await resp.text();
        const json = JSON.parse(txt);
        console.log(`✅ Réponse reçue (${txt.length} caractères)`);
        return json;
      } catch (err) {
        console.warn(`⚠️ Erreur fetch [${label}] (${attempt}/${MAX_ATTEMPTS}) → ${err.message}`);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    return null;
  }

  const dateTomorrow = tomorrowISO();
  console.log(`📅 Date d'analyse (matchs de demain) : ${dateTomorrow}`);

  const matchesToSend = [];

  // ---- Boucle sur les pays ----
  for (const [country, data] of Object.entries(table)) {
    console.log(`\n🌍 Pays : ${country}`);
    if (!data || !Array.isArray(data.leagues)) continue;

    for (const league of data.leagues) {
      const leagueId = league.id;
      const leagueName = league.name;
      console.log(`\n⚽ Ligue : ${leagueName} (ID: ${leagueId})`);

      if (!leagueId) continue;

      // --- Étape 1: Matchs programmés ---
      const scheduledUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${dateTomorrow}`;
      const scheduled = await fetchJson(scheduledUrl, `scheduled-${leagueId}`);
      if (!scheduled?.events?.length) {
        console.log(`   ⚠️ Aucun match prévu demain pour ${leagueName}`);
        continue;
      }

      console.log(`   ✅ ${scheduled.events.length} matchs trouvés.`);
      const firstEvent = scheduled.events[0];
      const seasonId = firstEvent?.season?.id;
      const roundId = firstEvent?.roundInfo?.round;
      const tournamentId = firstEvent?.tournament?.id || leagueId;

      console.log(`   🏁 seasonId: ${seasonId} | roundId: ${roundId} | tournamentId: ${tournamentId}`);

      if (!seasonId) continue;

      // --- Étape 2: Classement (Top 3) ---
      const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/standings/total`;
      const standings = await fetchJson(standingsUrl, `standings-${leagueId}`);
      let rows = [];

      if (Array.isArray(standings?.standings)) {
        rows = standings.standings[0]?.rows || [];
      } else if (Array.isArray(standings?.rows)) {
        rows = standings.rows;
      }

      if (!rows.length) {
        console.log(`   ⚠️ Impossible d'obtenir le classement.`);
        continue;
      }

      const top3 = rows.slice(0, 3).map(r => ({
        id: r.team?.id,
        name: r.team?.name
      }));

      console.log(`   🥇 Top 3: ${top3.map(t => t.name).join(' | ')}`);

      const top3Ids = new Set(top3.map(t => t.id));
      const matchesTomorrow = scheduled.events.filter(e => e.homeTeam && top3Ids.has(e.homeTeam.id));

      if (!matchesTomorrow.length) {
        console.log('   🏡 Aucun match de Top 3 à domicile demain.');
        continue;
      }

      // --- Étape 3 et 4: Analyse des matchs ---
      for (const m of matchesTomorrow) {
        const home = m.homeTeam;
        const away = m.awayTeam;
        const matchId = m.id;
        const startTs = m.startTimestamp;
        const slug = m.slug;

        console.log(`     🔎 Match: ${home.name} (dom) vs ${away.name} — ID: ${matchId}`);

        if (!roundId) {
          console.log('     ⚠️ roundId manquant, on passe ce match.');
          continue;
        }

        // --- Étape 5: Dernier match de l'équipe à domicile ---
        const lastUrl = `https://www.sofascore.com/api/v1/team/${home.id}/unique-tournament/${tournamentId}/events/last/${roundId}`;
        const last = await fetchJson(lastUrl, `last-${home.id}`);

        if (!last?.events?.length) {
          console.log('     ⚠️ Aucun dernier match trouvé.');
          continue;
        }

        const lastMatch = last.events[0];
        let result = 'unknown';
        const hs = Number(lastMatch.homeScore?.current ?? lastMatch.homeScore?.display ?? 0);
        const as = Number(lastMatch.awayScore?.current ?? lastMatch.awayScore?.display ?? 0);

        if (hs !== null && as !== null) {
          if (lastMatch.homeTeam?.id === home.id) {
            result = hs > as ? 'win' : hs < as ? 'loss' : 'draw';
          } else {
            result = as > hs ? 'win' : as < hs ? 'loss' : 'draw';
          }
        }

        console.log(`     ⚔️ Dernier match de ${home.name}: ${result} (score ${hs}-${as})`);

        if (result === 'loss') {
          console.log('     ✅ Équipe a perdu son dernier match -> ajout dans la liste');
          matchesToSend.push({
            country,
            league: leagueName,
            leagueId,
            seasonId,
            match: {
              matchId,
              slug,
              startTimestamp: startTs,
              homeTeam: { id: home.id, name: home.name },
              awayTeam: { id: away.id, name: away.name }
            },
            lastMatchResult: result
          });
        } else {
          console.log('     ⛔ Équipe n’a pas perdu → ignorée.');
        }
      }
    }
  }

  // ---- Envoi au VPS ----
  console.log('\n📦 Préparation de l\'envoi...');
  if (!matchesToSend.length) {
    console.log('ℹ️ Aucun match à envoyer.');
    await browser.close();
    return;
  }

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
    const txt = await resp.text();
    if (resp.ok()) {
      console.log('✅ Envoi réussi au VPS !');
    } else {
      console.error(`⛔ Erreur lors de l’envoi (${resp.status()}) : ${txt.slice(0, 400)}`);
    }
  } catch (e) {
    console.error('⛔ Exception POST VPS:', e.message);
  }

  await browser.close();
  console.log('\n🏁 Fin du script Groupe 1.');
  process.exit(0);
})();
