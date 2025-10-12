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
          // fallback: text -> parse
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

      // try to get season id from the first event that has season
      const seasonId = (scheduled.events.find(e => e.season && e.season.id && e.season.id > 0)?.season?.id) || null;
      if (!seasonId) {
        console.warn('   ⚠️ season.id introuvable dans scheduled-events. Tentative de récupération via unique-tournaments...');
        // fallback: call category unique-tournaments (category.id is in event.tournament.category.id)
        const catId = scheduled.events[0]?.tournament?.category?.id || null;
        if (catId) {
          const catUrl = `https://www.sofascore.com/api/v1/category/${catId}/unique-tournaments`;
          console.log(`   ↳ Récupération unique-tournaments via: ${catUrl}`);
          const catData = await fetchJson(catUrl, `category-${catId}`);
          // best-effort: find the uniqueTournament with id === leagueId and maybe recent seasons (we cannot list seasons here)
          // many uniqueTournaments have "id" field (uniqueTournament.id); but standings require season id; we'll just try to skip if unknown
          if (!catData) {
            console.warn('   ⚠️ Impossible d\'obtenir unique-tournaments. On pourra essayer standings "current" mais risque d\'échec.');
          } else {
            console.log('   ↳ unique-tournaments récupéré (non utilisé automatiquement pour season.id).');
          }
        } else {
          console.warn('   ⚠️ Pas de category.id disponible non plus.');
        }
      } else {
        console.log(`   ↳ season.id trouvé : ${seasonId}`);
      }

      // Step: retrieve standings (requires seasonId). If seasonId missing, try to attempt standings with "current" (best-effort).
      if (!seasonId) {
        console.warn('   ⚠️ Pas de seasonId fiable -> on tente standings avec "current" (peut échouer).');
      }

      const standingsSeasonId = seasonId || 'current';
      const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${standingsSeasonId}/standings/total`;
      console.log(`   ↳ Récupération du classement via: ${standingsUrl}`);
      const standings = await fetchJson(standingsUrl, `standings-${leagueId}`);
      if (!standings || !Array.isArray(standings.standings) && !Array.isArray(standings.rows) && !Array.isArray(standings.rows || standings.standings)) {
        // Some responses use structure { standings: [ { rows: [...] } ] } or { rows: [...] }
        // We'll try to extract rows.
      }

      // extract rows array robustly
      let rows = [];
      if (standings) {
        if (Array.isArray(standings.rows)) rows = standings.rows;
        else if (Array.isArray(standings.standings) && standings.standings.length && Array.isArray(standings.standings[0].rows)) {
          rows = standings.standings[0].rows;
        } else if (Array.isArray(standings.rows || [])) rows = standings.rows;
        else if (Array.isArray(standings.standings)) {
          // some endpoints might include rows under standings[].rows
          for (const s of standings.standings) {
            if (Array.isArray(s.rows)) {
              rows = s.rows;
              break;
            }
          }
        }
      }
      if (!rows || rows.length === 0) {
        console.warn('   ⚠️ Impossible d\'extraire les lignes de classement (rows). On passe cette ligue.');
        continue;
      }

      // Take top 3 teams (rows sorted by position already)
      const top3 = rows.slice(0, 3).map(r => {
        // various structures: r.team.id or r.team
        const teamObj = r.team || r;
        return {
          id: teamObj?.id,
          name: teamObj?.name || (teamObj && teamObj.team && teamObj.team.name) || null
        };
      }).filter(t => t.id);
      console.log(`   ↳ Top 3 récupéré : ${top3.map(t => `${t.name || t.id}`).join(' | ') || '(aucun)'}`);

      // If no top3, skip
      if (!top3 || top3.length === 0) {
        console.warn('   ⚠️ Top3 vide, on passe cette ligue.');
        continue;
      }

      // From scheduled.events, find matches where homeTeam.id in top3
      const top3Ids = new Set(top3.map(t => t.id));
      const matchesTomorrow = scheduled.events.filter(e => e.homeTeam && top3Ids.has(e.homeTeam.id));
      if (!matchesTomorrow || matchesTomorrow.length === 0) {
        console.log('   🏆 Aucun match demain impliquant un Top 3 à domicile pour cette ligue.');
        continue;
      }

      console.log(`   🏆 ${matchesTomorrow.length} match(s) demain où un Top 3 joue à domicile.`);

      // For each such match, check last match of the home team via team/{id}/events/last/1
      for (const m of matchesTomorrow) {
        const home = m.homeTeam;
        const away = m.awayTeam;
        const matchId = m.id;
        const startTs = m.startTimestamp;
        const slug = m.slug || null;
        console.log(`     → Match ${slug || matchId} : ${home.name} (id:${home.id}) vs ${away?.name || 'unknown'} (id:${away?.id || 'unknown'}) at ${startTs}`);

        const lastEventUrl = `https://www.sofascore.com/api/v1/team/${home.id}/events/last/1`;
        console.log(`       ↳ Récupération du dernier match de l'équipe (home) via: ${lastEventUrl}`);
        const lastEv = await fetchJson(lastEventUrl, `team-last-${home.id}`);
        if (!lastEv) {
          console.warn('       ⚠️ Impossible de récupérer last event, on passe ce match.');
          continue;
        }

        // Attempt to extract result: structure varies. Look for lastEv.events[0].status/result or lastEv.lastMatch etc.
        let lastMatch = null;
        if (Array.isArray(lastEv.events) && lastEv.events.length > 0) lastMatch = lastEv.events[0];
        else if (Array.isArray(lastEv) && lastEv.length > 0) lastMatch = lastEv[0];
        else if (lastEv.lastMatch) lastMatch = lastEv.lastMatch;
        else if (lastEv.event) lastMatch = lastEv.event;

        if (!lastMatch) {
          console.warn('       ⚠️ Format last match non reconnu, on passe.');
          continue;
        }

        // Determine if the team lost its last match.
        // Many responses have "result" string or "homeScore/awayScore" to compare.
        // We'll try common patterns:
        let lastResult = null; // 'win'|'loss'|'draw' or null
        try {
          if (lastMatch.result) { // sometimes string
            lastResult = lastMatch.result;
          } else if (lastMatch.status && lastMatch.status.type) {
            lastResult = lastMatch.status.type; // not always the result
          } else if (typeof lastMatch.homeScore === 'object' && typeof lastMatch.awayScore === 'object') {
            // compare numeric fields if present
            const hs = lastMatch.homeScore?.current ?? lastMatch.homeScore?.display ?? null;
            const as = lastMatch.awayScore?.current ?? lastMatch.awayScore?.display ?? null;
            // if numeric values available, compare
            const hsn = Number(hs);
            const asn = Number(as);
            if (!Number.isNaN(hsn) && !Number.isNaN(asn)) {
              // determine if home team was our team or away team (we don't always know). We'll check lastMatch.homeTeam.id
              const lastHomeId = lastMatch.homeTeam?.id;
              if (lastHomeId === home.id) {
                lastResult = hsn > asn ? 'win' : (hsn < asn ? 'loss' : 'draw');
              } else if (lastMatch.awayTeam?.id === home.id) {
                lastResult = asn > hsn ? 'win' : (asn < hsn ? 'loss' : 'draw');
              }
            }
          } else if (lastMatch.homeTeam && lastMatch.awayTeam && (lastMatch.homeTeam.id || lastMatch.awayTeam.id) && lastMatch.scores) {
            // other variations
          }
        } catch (e) {
          console.warn('       ⚠️ Erreur parse last match result:', e.message);
        }

        // fallback check: some responses include "homeScore" and "awayScore" top-level with "winnerTeamId"
        if (!lastResult && lastMatch.winnerTeamId) {
          lastResult = (lastMatch.winnerTeamId === home.id) ? 'win' : 'loss';
        }

        // Another fallback: some lastMatch have .score?.label etc. We won't over-engineer — we'll accept null if unknown.
        if (!lastResult) {
          console.log('       ℹ️ Impossible de déterminer le résultat exact du dernier match (format inconnu). On l\'ignore.');
          continue;
        }

        console.log(`       ↳ Résultat du dernier match de ${home.name} : ${lastResult}`);

        // We want teams that **lost** their last match
        if (String(lastResult).toLowerCase().includes('loss') || String(lastResult).toLowerCase().includes('lost')) {
          console.log('       ✅ Équipe a perdu dernier match -> ajout à la liste d\'envoi.');
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
          console.log('       ⛔ Équipe n\'a pas perdu le dernier match -> ignore.');
        }
      } // end matchesTomorrow loop
    } // end leagues loop
  } // end countries loop

  // Envoi au VPS si on a des matches
  if (matchesToSend.length > 0) {
    console.log(`\n📤 Préparation à l'envoi au VPS... (${matchesToSend.length} match(es))`);
    const payload = {
      groupe: '1',
      generatedAt: new Date().toISOString(),
      analysisDate: (new Date()).toISOString(),
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
      if (resp.ok) {
        console.log('✅ JSON envoyé avec succès au VPS ! Réponse VPS:', text.slice(0, 200));
      } else {
        console.error('⛔ Erreur lors du POST vers VPS :', resp.status(), text.slice(0, 400));
      }
    } catch (e) {
      console.error('⛔ Erreur lors du POST vers VPS (exception) :', e.message);
    }
  } else {
    console.log('\nℹ️ Aucun match à envoyer pour demain.');
  }

  await browser.close();
  console.log('\n🏁 Fin du script Group 1.');
  process.exit(0);
})();
