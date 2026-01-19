// scripts/fetch_metadata_logs.js
// Récupère les catégories/ligues pour 5 sports et log les IDs clés
const { chromium } = require('playwright');

const SPORTS_CIBLES = ['football', 'basketball', 'tennis', 'handball', 'rugby'];
const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
const COOKIE = process.env.SOFASCORE_COOKIE || '';

(async () => {
    console.log("🚀 Démarrage de l'extraction des métadonnées...");

    if (!VPS_WEBHOOK) {
        console.error("❌ VPS_WEBHOOK manquant !");
        process.exit(1);
    }

    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();
    let globalMetadata = {};

    for (const sport of SPORTS_CIBLES) {
        console.log(`\n\n--- 🏆 EXTRACTION : ${sport.toUpperCase()} ---`);
        const endpoint = `https://www.sofascore.com/api/v1/sport/${sport}/categories/all`;
        
        try {
            const response = await page.goto(endpoint, { waitUntil: 'networkidle', timeout: 30000 });
            if (response.status() === 200) {
                const data = await response.json();
                globalMetadata[sport] = data.categories;

                // --- LOGS POUR COPIER/COLLER ---
                data.categories.forEach(category => {
                    // On filtre souvent par pays ou catégories majeures
                    console.log(`\n🌍 Catégorie: ${category.name} (ID: ${category.id})`);
                    
                    if (category.uniqueTournaments) {
                        category.uniqueTournaments.forEach(league => {
                            console.log(`   ⚽ Ligue: ${league.name}`);
                            console.log(`      ID Ligue: ${league.id}`);
                            // On récupère la saison en cours si elle existe
                            const currentSeason = league.upperSeasonId || "N/A";
                            console.log(`      ID Saison Actuelle: ${currentSeason}`);
                        });
                    }
                });
            } else {
                console.log(`⚠️ Erreur Status ${response.status()} pour ${sport}`);
            }
        } catch (err) {
            console.error(`❌ Erreur sur ${sport}: ${err.message}`);
        }
    }

    // --- ENVOI AU VPS POUR ARCHIVE ---
    console.log("\n\n💾 Envoi des métadonnées complètes au VPS...");
    try {
        const resp = await fetch(VPS_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'metadata_extractor',
                date: new Date().toISOString(),
                data: globalMetadata
            })
        });
        if (resp.ok) console.log("✅ Backup VPS réussi !");
    } catch (e) {
        console.log("⚠️ Echec backup VPS, mais les logs sont dispos ci-dessus.");
    }

    await browser.close();
    console.log("\n🏁 Fin du script d'extraction.");
})();
