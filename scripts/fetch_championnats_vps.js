// scripts/fetch_metadata_debug.js
const { chromium } = require('playwright');

const SPORTS_CIBLES = ['tennis', 'handball', 'volleyball']; 

(async () => {
    console.log("🚀 Lancement de l'extraction avec logs détaillés...");

    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();

    for (const sport of SPORTS_CIBLES) {
        console.log(`\n\n=== 🔎 EXPLORATION : ${sport.toUpperCase()} ===`);
        const endpoint = `https://www.sofascore.com/api/v1/sport/${sport}/categories/all`;
        
        try {
            const response = await page.goto(endpoint, { waitUntil: 'networkidle', timeout: 30000 });
            const data = await response.json();

            if (!data.categories) {
                console.log(`❌ Pas de champ 'categories' trouvé pour ${sport}`);
                continue;
            }

            for (const cat of data.categories) {
                // LOG DE CHAQUE CATEGORIE POUR VOIR SI ELLES EXISTENT
                console.log(`📍 Analyse Catégorie : ${cat.name} (ID: ${cat.id})`);

                // Vérification des tournois uniques (La structure standard)
                if (cat.uniqueTournaments && cat.uniqueTournaments.length > 0) {
                    cat.uniqueTournaments.forEach(league => {
                        const cleanLeague = league.name.replace(/'/g, "''");
                        const cleanCat = cat.name.replace(/'/g, "''");
                        const seasonId = league.upperSeasonId || 0;

                        console.log(`INSERT IGNORE INTO countries_leagues (sport, category_name, category_id, league_name, league_id, current_season_id) VALUES ('${sport}', '${cleanCat}', ${cat.id}, '${cleanLeague}', ${league.id}, ${seasonId});`);
                    });
                } else {
                    // Si pas de uniqueTournaments, on cherche dans 'tournaments' (structure secondaire)
                    if (cat.tournaments && cat.tournaments.length > 0) {
                         cat.tournaments.forEach(t => {
                            const cleanT = t.name.replace(/'/g, "''");
                            const cleanCat = cat.name.replace(/'/g, "''");
                            console.log(`INSERT IGNORE INTO countries_leagues (sport, category_name, category_id, league_name, league_id, current_season_id) VALUES ('${sport}', '${cleanCat}', ${cat.id}, '${cleanT}', ${t.id}, 0);`);
                         });
                    }
                }
            }
        } catch (err) {
            console.error(`❌ Erreur sur ${sport}: ${err.message}`);
        }
    }

    await browser.close();
    console.log("\n🏁 Fin de l'exploration.");
})();
