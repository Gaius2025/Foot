// scripts/collecteur_global.js
// Rôle : Récupérer TOUS les matchs de demain pour plusieurs sports
// Usage : node scripts/collecteur_global.js

const { chromium } = require('playwright');
const path = require('path');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const SPORTS_A_SUIVRE = ['football', 'basketball', 'handball', 'tennis']; // Ajoute tes sports ici

if (!VPS_WEBHOOK) {
    console.error('❌ VPS_WEBHOOK manquant.');
    process.exit(1);
}

// Calcule la date de demain ISO (YYYY-MM-DD)
function getTomorrowISO() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.toISOString().split('T')[0];
}

(async () => {
    const dateCible = getTomorrowISO();
    console.log(`🚀 Collecte globale pour le : ${dateCible}`);

    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();

    let catalogueGlobal = {};

    for (const sport of SPORTS_A_SUIVRE) {
        console.log(`\n🔭 Analyse du sport : ${sport}`);
        const url = `https://www.sofascore.com/api/v1/sport/${sport}/scheduled-events/${dateCible}`;
        
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
            const content = await page.locator('pre').textContent();
            const data = JSON.parse(content);

            if (data.events) {
                // On ne garde que les matchs qui n'ont PAS commencé
                const futursMatchs = data.events.filter(e => e.status.type === 'notstarted');
                
                catalogueGlobal[sport] = futursMatchs.map(e => ({
                    matchId: e.id,
                    heure: e.startTimestamp,
                    championnat: e.tournament.name,
                    equipeHome: e.homeTeam.name,
                    equipeAway: e.awayTeam.name,
                    homeId: e.homeTeam.id,
                    awayId: e.awayTeam.id,
                    slug: e.slug
                }));
                console.log(`✅ ${futursMatchs.length} matchs trouvés en ${sport}`);
            }
        } catch (err) {
            console.error(`⚠️ Erreur sur le sport ${sport}:`, err.message);
        }
    }

    // Envoi au VPS
    if (Object.keys(catalogueGlobal).length > 0) {
        console.log('\n📤 Envoi de la moisson au VPS...');
        try {
            await page.request.post(VPS_WEBHOOK, {
                data: {
                    type: "COLLECTE_GLOBALE",
                    date: dateCible,
                    data: catalogueGlobal
                }
            });
            console.log('✅ VPS notifié avec succès.');
        } catch (e) {
            console.error('❌ Echec de l\'envoi au VPS');
        }
    }

    await browser.close();
    console.log('\n🏁 Fin de la collecte.');
})();
