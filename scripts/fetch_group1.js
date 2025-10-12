// scripts/fetch_group1.js
// Playwright script: analyse Group 1 (top3/home/last match lost -> envoi au VPS)
// Usage: node scripts/fetch_group1.js
// Doit être exécuté dans un projet avec playwright installé.
// Variables d'env : VPS_WEBHOOK (obligatoire), SOFASCORE_COOKIE (optionnel)

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

  // Charger table1.json
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

  // helper: goto and parse json robustly
  async function fetchJson(url, label = '') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
        if (!resp) throw new Error('No response object');
        const status = resp.status();
        if (status >= 400) throw new Error(`HTTP ${status}`);
        try {
          const j = await resp.json();
          return j;
        } catch (errJson) {
          const txt = await resp.text();
          try {
            return JSON.parse(txt);
          } catch (errParse) {
            throw new Error('Response not JSON');
          }
        }
      } catch (err) {
        console.warn(`⚠️ [${label}] tentative ${attempt} échouée pour ${url} → ${err.message}`);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000 * attempt));
        else return null;
      }
    }
    return null;
  }

  const dateTomorrow = tomorrowISO();
  console.log(`📅 Date (demain) utilisée pour l'analyse : ${dateTomorrow}`);

  let matchesToSend = [];

  for (const country of countries) {
    console.log(`\n🌍 Traitement du pays : ${country}`);
    const data = table[country];
    if (!data || !Array.isArray(data.leagues)) {
      console.warn(`⚠️ Aucun champ leagues pour ${country}, on passe.`);
      continue;
    }

    for (const league of data.leagues) {
      const leagueName = league.name || 'unknown';
      const leagueId = league.id;
      console.log(`\n ⚽ Ligue : ${leagueName} (ID: ${leagueId})`);

      if (!leagueId) {
        console.warn('   ⚠️ Pas d\'ID pour cette ligue, on passe.');
        continue;
      }

      // Etape 1: scheduled events pour demain
      const scheduledUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${dateTomorrow}`;
      console.log(`   ↳ Récupération des matchs demain via: ${scheduledUrl}`);
      const scheduled = await fetchJson(scheduledUrl, `scheduled-${leagueId}`);
      if (!scheduled || !Array.isArray(scheduled.events)) {
        console.warn('   ⚠️ Pas de données événements pour demain (ou erreur).');
        continue;
      }
      console.log(`   ↳ ${scheduled.events.length} événement(s) reçu(s) pour ${leagueName}.`);

      // récupérer seasonId et roundId
      const firstEvent = scheduled.events[0] || {};
      const seasonId = firstEvent.season?.id || null;
      const roundId = firstEvent.roundInfo?.round || null;

      if (!seasonId) {
        console.warn('   ⚠️ season.id introuvable.');
      } else {
        console.log(`   ↳ season.id : ${seasonId}`);
      }

      if (!roundId) {
        console.warn('   ⚠️ round.id introuvable.');
      } else {
        console.log(`   ↳ round.id : ${roundId}`);
      }

      // Etape 2: récupérer top 3
      const standingsSeasonId = seasonId || 'current';
      const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${standingsSeasonId}/standings/total`;
      console.log(`   ↳ Récupération du classement via: ${standingsUrl}`);
      const standings = await fetchJson(standingsUrl, `standings-${leagueId}`);
      let rows = [];
      if (standings) {
        if (Array.isArray(standings.rows)) rows = standings.rows;
        else if (Array.isArray(standings.standings) && standings.standings.length && Array.isArray(standings.standings[0].rows)) {
          rows = standings.standings[0].rows;
        }
      }

      if (!rows || rows.length === 0) {
        console.warn('   ⚠️ Impossible d\'extraire le top 3, on passe.');
        continue;
      }

      const top3 = rows.slice(0, 3).map(r => {
        const teamObj = r.team || r;
        return { id: teamObj?.id, name: teamObj?.name || null };
      }).filter(t => t.id);

      console.log(`   ↳ Top 3 : ${top3.map(t => t.name || t.id).join(' | ')}`);

      // Etape 3: sélectionner matchs où top3 joue à domicile
      const top3Ids = new Set(top3.map(t => t.id));
      const matchesTomorrow = scheduled.events.filter(e => e.homeTeam && top3Ids.has(e.homeTeam.id));
      if (!matchesTomorrow || matchesTomorrow.length === 0) {
        console.log('   🏆 Aucun match demain impliquant un Top 3 à domicile pour cette ligue.');
        continue;
      }

      // Etape 4: récupérer dernier match de l’équipe à domicile et vérifier défaite
      for (const m of matchesTomorrow) {
        const home = m.homeTeam;
        const away = m.awayTeam;
        const matchId = m.id;
        const startTs = m.startTimestamp;
        const slug = m.slug || null;

        console.log(`     → Match ${slug || matchId} : ${home.name} vs ${away?.name || 'unknown'} at ${startTs}`);

        if (!roundId) {
          console.warn('       ⚠️ roundId manquant, impossible de récupérer le dernier match correctement.');
          continue;
        }

        const lastEventUrl = `https://www.sofascore.com/api/v1/team/${home.id}/unique-tournament/${leagueId}/events/last/${roundId}`;
        console.log(`       ↳ Récupération du dernier match de l'équipe via: ${lastEventUrl}`);
        const lastEv = await fetchJson(lastEventUrl, `team-last-${home.id}`);
        if (!lastEv) {
          console.warn('       ⚠️ Impossible de récupérer last event, on passe ce match.');
          continue;
        }

        let lastMatch = Array.isArray(lastEv.events) ? lastEv.events[0] : lastEv.lastMatch || lastEv.event || null;
        if (!lastMatch) {
          console.warn('       ⚠️ Format last match non reconnu.');
          continue;
        }

        let lastResult = null;
        try {
          if (lastMatch.result) lastResult = lastMatch.result;
          else if (lastMatch.homeScore && lastMatch.awayScore) {
            const hs = Number(lastMatch.homeScore.current ?? lastMatch.homeScore.display);
            const as = Number(lastMatch.awayScore.current ?? lastMatch.awayScore.display);
            if (!Number.isNaN(hs) && !Number.isNaN(as)) {
              lastResult = (lastMatch.homeTeam?.id === home.id ? (hs < as ? 'loss' : (hs > as ? 'win' : 'draw')) : (as < hs ? 'loss' : (as > hs ? 'win' : 'draw')));
            }
          }
          if (!lastResult && lastMatch.winnerTeamId) lastResult = lastMatch.winnerTeamId === home.id ? 'win' : 'loss';
        } catch (e) {
          console.warn('       ⚠️ Erreur parse last match result:', e.message);
        }

        if (!lastResult) continue;

        console.log(`       ↳ Résultat du dernier match : ${lastResult}`);

        if (String(lastResult).toLowerCase().includes('loss')) {
          console.log('       ✅ Équipe a perdu -> ajout.');
          matchesToSend.push({
            country,
            league: leagueName,
            leagueId,
            seasonId: seasonId || null,
            match: {
              matchId,
              slug,
              startTimestamp: startTs,
              homeTeam: { id: home.id, name: home.name },
              awayTeam: { id: away?.id, name: away?.name }
            },
            lastMatchResult: lastResult
          });
        } else {
          console.log('       ⛔ Équipe n\'a pas perdu -> ignore.');
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
      else console.error('⛔ Erreur lors du POST vers VPS :', resp.status(), text.slice(0, 400));
    } catch (e) {
      console.error('⛔ Exception lors du POST vers VPS :', e.message);
    }
  } else {
    console.log('\nℹ️ Aucun match à envoyer.');
  }

  await browser.close();
  console.log('\n🏁 Fin du script Group 1.');
  process.exit(0);
})();
