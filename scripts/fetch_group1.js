// scripts/fetch_all_tomorrow.js
// Rôle : Collecte globale de tous les matchs de demain (sans filtres ligues)
// Variables d'env : VPS_WEBHOOK (obligatoire), SOFASCORE_COOKIE (optionnel)

const { chromium } = require('playwright');
const path = require('path');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 3; // Augmenté pour la robustesse
const NAV_TIMEOUT = 30000;
const SPORTS = ['football', 'basketball', 'tennis', 'handball'];

if (!VPS_WEBHOOK) {
  console.error('❌ VPS_WEBHOOK non défini.');
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

// -----------------------------------------------------------------------------
// Main Script
// -----------------------------------------------------------------------------
(async () => {
  console.log('🚀 Démarrage de la Collecte Globale...');

  const browser = await chromium.launch({ 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1"
  });

  // Gestion des Cookies (Inspiré de ton script)
  if (COOKIE.trim()) {
    try {
      const cookies = COOKIE.split(';').map(s => s.trim()).filter(Boolean).map(p => {
        const [name, ...rest] = p.split('=');
        return { name: name.trim(), value: rest.join('='), domain: '.sofascore.com', path: '/', secure: true };
      });
      await context.addCookies(cookies);
      console.log('🔐 Cookies SofaScore injectés.');
    } catch (e) { console.warn('⚠️ Erreur cookies :', e.message); }
  }

  const page = await context.newPage();
  const dateTomorrow = tomorrowISO();
  console.log(`📅 Date ciblée : ${dateTomorrow}`);

  let allEvents = {};

  // Boucle sur les sports
  for (const sport of SPORTS) {
    console.log(`\n🔭 Analyse Sport : ${sport.toUpperCase()}`);
    const url = `https://www.sofascore.com/api/v1/sport/${sport}/scheduled-events/${dateTomorrow}`;
    
    let data = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`➡️ [Essai ${attempt}] Requête : ${url}`);
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
        
        if (resp && resp.status() === 200) {
          const text = await resp.text();
          data = JSON.parse(text);
          break; 
        } else {
          throw new Error(`Status ${resp ? resp.status() : 'null'}`);
        }
      } catch (err) {
        console.warn(`⚠️ Échec tentative ${attempt}: ${err.message}`);
        if (attempt < MAX_ATTEMPTS) await sleep(2000);
      }
    }

    if (data?.events) {
        // Filtre : uniquement ce qui n'a pas commencé
        const upcoming = data.events.filter(e => e.status?.type === "notstarted");
        console.log(`✅ ${upcoming.length} matchs trouvés pour ${sport}.`);
        
        // Logs détaillés pour tes logs GitHub
        upcoming.slice(0, 10).forEach(e => {
            console.log(`   📍 [${e.tournament.uniqueTournament?.name || 'Ligue'}] ${e.homeTeam.name} vs ${e.awayTeam.name}`);
        });
        if (upcoming.length > 10) console.log(`   ... et ${upcoming.length - 10} autres matchs.`);

        allEvents[sport] = upcoming.map(e => ({
            id: e.id,
            slug: e.slug,
            time: e.startTimestamp,
            league: e.tournament.name,
            home: { id: e.homeTeam.id, name: e.homeTeam.name },
            away: { id: e.awayTeam.id, name: e.awayTeam.name }
        }));
    }
  }

  // -----------------------------------------------------------------------------
  // Envoi au VPS
  // -----------------------------------------------------------------------------
  const totalFound = Object.values(allEvents).flat().length;
  if (totalFound > 0) {
    console.log(`\n📤 Envoi de ${totalFound} matchs au VPS...`);
    try {
      const resp = await page.request.post(VPS_WEBHOOK, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          source: "COLLECTEUR_GLOBAL",
          dateTarget: dateTomorrow,
          timestamp: Math.floor(Date.now() / 1000),
          data: allEvents
        },
        timeout: 30000
      });
      console.log(`✅ Réponse VPS : ${resp.status()} ${await resp.text()}`);
    } catch (err) {
      console.error('⛔ Erreur envoi VPS :', err.message);
    }
  } else {
    console.log('\nℹ️ Aucun match trouvé à envoyer.');
  }

  await browser.close();
  console.log('\n🏁 Fin de la collecte.');
})();
