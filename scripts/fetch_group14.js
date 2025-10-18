// scripts/fetch_group14.js  
// Analyse Group 1 : Top 3 à domicile + dernier match perdu → envoi au VPS  
// Usage : node scripts/fetch_group1.js  
// Variables d'env requises : VPS_WEBHOOK (obligatoire), SOFASCORE_COOKIE (optionnel)  

const { chromium } = require('playwright');  
const fs = require('fs');  
const path = require('path');  

const TABLE_PATH = path.join(__dirname, '../tables/table14.json');  
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;  
const COOKIE = process.env.SOFASCORE_COOKIE || '';  
const MAX_ATTEMPTS = 2;  
const NAV_TIMEOUT = 20000;  

if (!VPS_WEBHOOK) {  
  console.error('❌ VPS_WEBHOOK non défini. Mets la variable d\'env VPS_WEBHOOK et relance.');  
  process.exit(1);  
}  

// -----------------------------------------------------------------------------  
// Utils  
// -----------------------------------------------------------------------------  
function tomorrowISO() {  
  const t = new Date();  
  t.setDate(t.getDate() + 1);  
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;  
}  

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }  

// Fonction pour vérifier si une équipe est dans le top7
async function isTop7(teamId, leagueId, seasonId, fetchJsonFn, label = '') {
  const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/standings/total`;
  const standings = await fetchJsonFn(standingsUrl, `top7-${label}`);
  if (!standings) return false;
  let rows = [];
  if (Array.isArray(standings.rows)) rows = standings.rows;
  else if (standings.standings?.[0]?.rows) rows = standings.standings[0].rows;
  const top7Ids = rows.slice(0, 7).map(r => r.team?.id).filter(Boolean);
  return top7Ids.includes(teamId);
}

// -----------------------------------------------------------------------------  
// Main script  
// -----------------------------------------------------------------------------  
(async () => {  
  console.log('🚀 Démarrage du script Group 1...');  

  // Lire la table  
  let table;  
  try {  
    const raw = fs.readFileSync(TABLE_PATH, 'utf-8');  
    table = JSON.parse(raw);  
    console.log(`📖 Lecture du fichier : ${TABLE_PATH}`);  
  } catch (err) {  
    console.error('❌ Erreur lecture table1.json :', err.message);  
    process.exit(2);  
  }  

  const countries = Object.keys(table || {});  
  console.log(`✅ Table chargée (${countries.length} pays trouvés).`);  

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });  
  const context = await browser.newContext({  
    userAgent: "Mozilla/5.0 (Linux; Android 6.0; Nexus 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"  
  });  

  // Ajouter cookies si fournis  
  if (COOKIE.trim()) {  
    try {  
      const cookies = COOKIE.split(';').map(s => s.trim()).filter(Boolean).map(p => {  
        const [name, ...rest] = p.split('=');  
        return {  
          name: name.trim(),  
          value: rest.join('='),  
          domain: 'www.sofascore.com',  
          path: '/',  
          secure: true  
        };  
      });  
      await context.addCookies(cookies);  
      console.log('🔐 Cookies ajoutés au contexte navigateur.');  
    } catch (e) {  
      console.warn('⚠️ Erreur ajout cookies :', e.message);  
    }  
  }  

  const page = await context.newPage();  

  // ---------------------------------------------------------------------------  
  // Helper: fetch JSON (avec retry et logs)  
  // ---------------------------------------------------------------------------  
  async function fetchJson(url, label = '') {  
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {  
      try {  
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });  
        if (!resp) throw new Error('Réponse vide');  
        if (resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);  
        const text = await resp.text();  
        try {  
          return JSON.parse(text);  
        } catch {  
          throw new Error('Réponse non JSON');  
        }  
      } catch (err) {  
        console.warn(`⚠️ [${label}] Tentative ${attempt}/${MAX_ATTEMPTS} échouée (${err.message})`);  
        if (attempt < MAX_ATTEMPTS) await sleep(1000);  
      }  
    }  
    return null;  
  }  

  const dateTomorrow = tomorrowISO();  
  console.log(`📅 Date ciblée : ${dateTomorrow}`);  

  const matchesToSend = [];  

  // ---------------------------------------------------------------------------  
  // Boucle pays / ligues  
  // ---------------------------------------------------------------------------  
  for (const country of countries) {  
    console.log(`\n🌍 Pays : ${country}`);  
    const data = table[country];  
    if (!data?.leagues?.length) {  
      console.warn('⚠️ Aucun championnat pour ce pays, on saute.');  
      continue;  
    }  

    for (const league of data.leagues) {  
      const leagueName = league.name || 'Inconnu';  
      const leagueId = league.id;  
      if (!leagueId) continue;  
      console.log(`\n⚽ Ligue : ${leagueName} (ID: ${leagueId})`);  

      // ───────────────────────────────────────────────  
      // ÉTAPE 1 → Récupération des matchs de demain  
      // ───────────────────────────────────────────────  
      const scheduledUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/scheduled-events/${dateTomorrow}`;  
      console.log(`➡️ [Étape 1] API : ${scheduledUrl}`);  
      const scheduled = await fetchJson(scheduledUrl, `scheduled-${leagueId}`);  
      if (!scheduled?.events?.length) {  
        console.log('   Aucun match trouvé pour demain.');  
        continue;  
      }  
      console.log(`   ${scheduled.events.length} match(s) trouvé(s) pour demain.`);  

      const seasonId = scheduled.events.find(e => e.season?.id)?.season?.id || null;  
      if (!seasonId) {  
        console.warn('   ⚠️ season.id introuvable, on saute cette ligue.');  
        continue;  
      }  
      console.log(`   ✅ season.id = ${seasonId}`);  

      // ───────────────────────────────────────────────  
      // ÉTAPE 2 → Récupération du classement (Top 3)  
      // ───────────────────────────────────────────────  
      const standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/standings/total`;  
      console.log(`➡️ [Étape 2] API : ${standingsUrl}`);  
      const standings = await fetchJson(standingsUrl, `standings-${leagueId}`);  
      if (!standings) {  
        console.warn('   ⚠️ Pas de données standings.');  
        continue;  
      }  

      let rows = [];  
      if (Array.isArray(standings.rows)) rows = standings.rows;  
      else if (standings.standings?.[0]?.rows) rows = standings.standings[0].rows;  

      if (!rows.length) {  
        console.warn('   ⚠️ Aucune ligne de classement trouvée.');  
        continue;  
      }  

      const top3 = rows.slice(0, 3).map(r => ({  
        id: r.team?.id,  
        name: r.team?.name  
      })).filter(t => t.id);  
      console.log(`   🏆 Top 3 : ${top3.map(t => t.name).join(' | ')}`);  

      if (!top3.length) continue;  
      const top3Ids = new Set(top3.map(t => t.id));
// ───────────────────────────────────────────────
      // ÉTAPE 3 → Matchs où Top 3 joue à domicile ET pas encore commencé
      // ───────────────────────────────────────────────
      const matchesTomorrow = scheduled.events
        .filter(e => e.homeTeam && top3Ids.has(e.homeTeam.id))
        .filter(e => e.status?.type === "notstarted") // ← filtrer uniquement les matchs à venir
        .filter(e => {
          // Filtrage par date exacte GMT+1
          const matchDate = new Date(e.startTimestamp);
          const gmt1Date = new Date(matchDate.getTime() + 3600000); // +1h pour GMT+1
          const isoDate = `${gmt1Date.getFullYear()}-${String(gmt1Date.getMonth()+1).padStart(2,'0')}-${String(gmt1Date.getDate()).padStart(2,'0')}`;
          return isoDate === dateTomorrow;
        });

      if (!matchesTomorrow.length) {
        console.log('   Aucun match valide où un Top 3 joue à domicile et qui n\'a pas encore commencé demain GMT+1.');
        continue;
      }
      console.log(`   ✅ ${matchesTomorrow.length} match(s) Top3 à domicile à venir pour demain.`);

      // ───────────────────────────────────────────────
      // ÉTAPE 4 → Vérifier dernier match (dans même tournoi) + filtrage adversaire top7
      // ───────────────────────────────────────────────
      for (const m of matchesTomorrow) {
        const home = m.homeTeam;
        const away = m.awayTeam;
        console.log(`\n     ▶️ ${home.name} (home) vs ${away.name}`);

        // Dernier match home
        const lastEventUrl = `https://www.sofascore.com/api/v1/team/${home.id}/unique-tournament/${leagueId}/events/last/0`;
        console.log(`➡️ [Étape 4] API : ${lastEventUrl}`);
        const lastEv = await fetchJson(lastEventUrl, `last-${home.id}`);
        if (!lastEv?.events?.length) {
          console.warn('       ⚠️ Aucun dernier match trouvé.');
          continue;
        }
        const lastMatch = lastEv.events[lastEv.events.length - 1];
        console.log(`       🔁 Dernier match sélectionné : ${lastMatch.slug || lastMatch.id}`);

        // Analyse résultat dernier match
        let result = 'unknown';
        const hs = lastMatch.homeScore?.current;
        const as = lastMatch.awayScore?.current;
        if (typeof hs === 'number' && typeof as === 'number') {
          if (lastMatch.homeTeam?.id === home.id) result = hs > as ? 'win' : hs < as ? 'loss' : 'draw';
          else if (lastMatch.awayTeam?.id === home.id) result = as > hs ? 'win' : as < hs ? 'loss' : 'draw';
        } else if (lastMatch.winnerTeamId) {
          result = lastMatch.winnerTeamId === home.id ? 'win' : 'loss';
        }
        console.log(`       🔎 Résultat dernier match : ${result}`);

        if (result !== 'loss') {
          console.log('       ⛔ Pas une défaite → ignoré.');
          continue;
        }

        // Vérification adversaire top7
        const isAwayTop7 = await isTop7(away.id, leagueId, seasonId, fetchJson, `away-${away.id}`);
        if (isAwayTop7) {
          console.log(`       ⛔ Adversaire ${away.name} est dans le top7 → match ignoré.`);
          continue;
        }

        console.log('       ✅ Match valide après vérification top7 adversaire.');
        matchesToSend.push({
          country,
          league: leagueName,
          leagueId,
          seasonId,
          match: {
            matchId: m.id,
            slug: m.slug,
            startTimestamp: m.startTimestamp,
            status: m.status?.type || null,
            homeTeam: { id: home.id, name: home.name },
            awayTeam: { id: away.id, name: away.name }
          },
          lastMatchResult: result
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Envoi au VPS (inchangé)
  // ---------------------------------------------------------------------------
  if (matchesToSend.length) {
    console.log(`\n📤 Envoi au VPS... (${matchesToSend.length} match(es))`);
    const payload = {
      groupe: '14',
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
      if (resp.ok()) {
        console.log('✅ Données envoyées avec succès ! Réponse VPS :', text.slice(0, 200));
      } else {
        console.error('⛔ Erreur VPS :', resp.status(), text.slice(0, 400));
      }
    } catch (err) {
      console.error('⛔ Erreur POST VPS :', err.message);
    }
  } else {
    console.log('\nℹ️ Aucun match à envoyer pour demain.');
  }

  await browser.close();
  console.log('\n🏁 Fin du script Group 14.');
})();
