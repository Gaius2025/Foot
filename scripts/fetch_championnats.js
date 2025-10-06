// scripts/fetch_championnats_raw_debug.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = 'https://www.sofascore.com/api/v1/sport/football/categories/all';
  const COOKIE = process.env.SOFASCORE_COOKIE || '';
  const ua =
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

  console.log('🚀 Démarrage du script de récupération Sofascore...');
  console.log('🔗 URL cible :', url);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext({ userAgent: ua });
    const page = await context.newPage();

    // 1️⃣ Écouter toutes les réponses réseau
    page.on('response', async (response) => {
      if (response.url().includes('/api/v1/sport/football/categories/all')) {
        console.log('\n📡 Réponse interceptée depuis Sofascore !');
        console.log('➡️ Statut HTTP :', response.status());

        try {
          const txt = await response.text();

          if (!txt || txt.length < 50) {
            console.warn('⚠️ Contenu vide ou trop court reçu !');
          } else {
            console.log(`✅ Données reçues (${txt.length} caractères)`);
            console.log('🧩 Extrait :', txt.slice(0, 200), '...');
          }

          // 2️⃣ Sauvegarde dans un fichier local
          const filePath = path.resolve(__dirname, 'championnats_raw.json');
          fs.writeFileSync(filePath, txt, 'utf-8');

          // 3️⃣ Vérification après écriture
          if (fs.existsSync(filePath)) {
            console.log(`💾 Fichier créé avec succès : ${filePath}`);
            const stats = fs.statSync(filePath);
            console.log(`📏 Taille du fichier : ${stats.size} octets`);
          } else {
            console.error('❌ Fichier non trouvé après écriture !');
          }
        } catch (err) {
          console.error('❌ Erreur lors du traitement de la réponse :', err);
        }
      }
    });

    // 4️⃣ Lancer la navigation
    console.log('\n🌐 Navigation vers l’API...');
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });

    if (!response) {
      console.error('❌ Échec de la navigation : aucune réponse reçue.');
      return;
    }

    console.log('🛰️ Réponse principale reçue. Code HTTP :', response.status());
    await page.waitForTimeout(4000); // Attente pour capturer la réponse complète

    console.log('\n🏁 Fin du script — vérifie le dossier "scripts/" pour championnats_raw.json.');

  } catch (err) {
    console.error('\n💥 Erreur inattendue :', err);
  } finally {
    await browser.close();
  }
})();
