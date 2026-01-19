// scripts/fetch_metadata_extended.js
const { chromium } = require('playwright');

// Ajout du Volleyball et conservation des autres sports demandés
const SPORTS_CIBLES = ['tennis', 'handball', 'volleyball']; 
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;

(async () => {
    console.log("🚀 Extraction des métadonnées : Tennis, Handball, Volleyball...");

    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();
    let globalMetadata = {};

    for (const sport of SPORTS_CIBLES) {
        console.log(`\n\n--- 🏆 SPORT : ${sport.toUpperCase()} ---`);
        const endpoint = `https://www.sofascore.com/api/v1/sport/${sport}/categories/all`;
        
        try {
            const response = await page.goto(endpoint, { waitUntil: 'networkidle', timeout: 30000 });
            if (response.status() === 200) {
                const data = await response.json();
                globalMetadata[sport] = data.categories;

                data.categories.forEach(category => {
                    if (category.uniqueTournaments) {
                        category.uniqueTournaments.forEach(league => {
                            const cleanLeague = league.name.replace(/'/g, "''");
                            const cleanCat = category.name.replace(/'/g, "''");
                            const seasonId = league.upperSeasonId || 0;

                            // LOG FORMAT SQL (Prêt pour PHPMyAdmin)
                            console.log(`INSERT IGNORE INTO countries_leagues (sport, category_name, category_id, league_name, league_id, current_season_id) VALUES ('${sport}', '${cleanCat}', ${category.id}, '${cleanLeague}', ${league.id}, ${seasonId});`);
                        });
                    }
                });
            }
        } catch (err) {
            console.error(`❌ Erreur sur ${sport}: ${err.message}`);
        }
    }

    // Backup vers le VPS
    if (VPS_WEBHOOK) {
        try {
            await fetch(VPS_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'metadata_extended', data: globalMetadata })
            });
            console.log("\n✅ Données envoyées au VPS.");
        } catch (e) { console.log("\n⚠️ Échec envoi VPS."); }
    }

    await browser.close();
    console.log("\n🏁 Fin de l'extraction.");
})();
