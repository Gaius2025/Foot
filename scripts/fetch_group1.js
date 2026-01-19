// scripts/collecteur_global.js
const { chromium } = require('playwright');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const SPORTS_A_SUIVRE = ['football', 'basketball', 'handball', 'tennis']; 

function getTomorrowISO() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.toISOString().split('T')[0];
}

(async () => {
    const dateCible = getTomorrowISO();
    console.log(`🚀 COLLECTE DU : ${dateCible}`);

    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();

    let catalogueGlobal = {};

    for (const sport of SPORTS_A_SUIVRE) {
        console.log(`\n--- 🔭 ANALYSE : ${sport.toUpperCase()} ---`);
        const url = `https://www.sofascore.com/api/v1/sport/${sport}/scheduled-events/${dateCible}`;
        
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
            const content = await page.locator('pre').textContent();
            const data = JSON.parse(content);

            if (data.events && data.events.length > 0) {
                // Filtrage des matchs non commencés
                const futursMatchs = data.events.filter(e => e.status.type === 'notstarted');
                
                console.log(`✅ [${sport}] ${futursMatchs.length} matchs à venir trouvés.`);

                catalogueGlobal[sport] = futursMatchs.map(e => {
                    // AFFICHAGE DANS LES LOGS POUR TOI :
                    console.log(`   📍 [${e.tournament.name}] ${e.homeTeam.name} vs ${e.awayTeam.name} (${new Date(e.startTimestamp * 1000).toLocaleTimeString()})`);

                    return {
                        matchId: e.id,
                        heure: e.startTimestamp,
                        championnat: e.tournament.name,
                        equipeHome: e.homeTeam.name,
                        equipeAway: e.awayTeam.name,
                        homeId: e.homeTeam.id,
                        awayId: e.awayTeam.id
                    };
                });
            } else {
                console.log(`⚠️ [${sport}] Aucun match trouvé dans l'API.`);
            }
        } catch (err) {
            console.error(`❌ Erreur ${sport}:`, err.message);
        }
    }

    // Envoi au VPS
    const totalMatchs = Object.values(catalogueGlobal).flat().length;
    if (totalMatchs > 0) {
        console.log(`\n📤 ENVOI DE ${totalMatchs} MATCHS AU VPS...`);
        try {
            // ... ton code d'envoi reste le même ...
            console.log('✅ Transfert terminé.');
        } catch (e) { console.error('❌ Echec envoi VPS'); }
    } else {
        console.log('\n❌ RIEN À ENVOYER (Liste vide).');
    }

    await browser.close();
})();
