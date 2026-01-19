// scripts/fetch_metadata_final.js
const { chromium } = require('playwright');

const SPORTS_CIBLES = ['tennis', 'handball', 'volleyball']; 
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;

(async () => {
    console.log("🚀 Lancement de l'extraction profonde...");

    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    for (const sport of SPORTS_CIBLES) {
        console.log(`\n\n--- 🏆 ANALYSE SPORTIVE : ${sport.toUpperCase()} ---`);
        const endpoint = `https://www.sofascore.com/api/v1/sport/${sport}/categories/all`;
        
        try {
            const response = await page.goto(endpoint, { waitUntil: 'networkidle', timeout: 30000 });
            
            if (response && response.ok()) {
                const data = await response.json();
                
                if (!data.categories || data.categories.length === 0) {
                    console.log(`⚠️ Aucun résultat trouvé dans le JSON pour ${sport}.`);
                    continue;
                }

                console.log(`✅ ${data.categories.length} catégories détectées.`);

                data.categories.forEach(category => {
                    if (category.uniqueTournaments && category.uniqueTournaments.length > 0) {
                        category.uniqueTournaments.forEach(league => {
                            const cleanLeague = league.name.replace(/'/g, "''");
                            const cleanCat = category.name.replace(/'/g, "''");
                            const seasonId = league.upperSeasonId || 0;

                            // GENERATION SQL DIRECTE DANS LES LOGS
                            console.log(`INSERT IGNORE INTO countries_leagues (sport, category_name, category_id, league_name, league_id, current_season_id) VALUES ('${sport}', '${cleanCat}', ${category.id}, '${cleanLeague}', ${league.id}, ${seasonId});`);
                        });
                    }
                });
            } else {
                console.log(`❌ Erreur de chargement (Status: ${response ? response.status() : 'N/A'})`);
            }
        } catch (err) {
            console.error(`❌ Erreur critique sur ${sport}: ${err.message}`);
        }
        
        // Petite pause pour ne pas se faire bannir par l'API
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
    console.log("\n🏁 Fin de l'extraction. Copiez les lignes INSERT ci-dessus vers PHPMyAdmin.");
})();
