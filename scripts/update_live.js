// scripts/update_live.js
// Playwright script -> récupère les scores live par match Sofascore et poste les données au VPS2
// Compatible Node 20, CommonJS

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VPS_WEBHOOK = process.env.VPS_WEBHOOK2; // secret GitHub Actions
const COOKIE = process.env.SOFASCORE_COOKIE || '';
const MAX_ATTEMPTS = 2;
const NAV_TIMEOUT = 15000;

// Chemin des fichiers historiques
const BASE_DIR = path.join(__dirname, '..', 'public_html', 'sofascore-ingest', 'historique');

if (!VPS_WEBHOOK) {
  console.error("❌ VPS_WEBHOOK2 introuvable ! Définis le secret VPS_WEBHOOK2 dans GitHub Actions.");
  process.exit(2);
}

(async () => {
  console.log("🚀 Démarrage du script de mise à jour des scores live...");

  // Assure l'existence du dossier historique
  try {
    if (!fs.existsSync(BASE_DIR)) {
      console.log("📂 Dossier historique introuvable, création de :", BASE_DIR);
      fs.mkdirSync(BASE_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("❌ Impossible de créer/accéder au dossier historique :", err.message);
    process.exit(4);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
    });

    // Ajouter les cookies si fournis
    if (COOKIE.trim()) {
      try {
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
          await context.addCookies(cookies);
          console.log("🔐 Cookies ajoutés au contexte Playwright.");
        }
      } catch (e) {
        console.warn("⚠️ Erreur lors de l'ajout des cookies :", e.message);
      }
    }

    const page = await context.newPage();

    // Récupère la liste des dossiers "groupe*"
    let groupes = [];
    try {
      const items = fs.readdirSync(BASE_DIR, { withFileTypes: true });
      groupes = items.filter(it => it.isDirectory() && /^groupe/i.test(it.name)).map(it => it.name);
      if (!groupes.length) console.log("ℹ️ Aucun dossier 'groupe*' trouvé dans historique. Rien à traiter.");
      else console.log(`📂 Groupes trouvés: ${groupes.join(', ')}`);
    } catch (err) {
      console.error("❌ Erreur lecture dossier historique:", err.message);
      process.exit(5);
    }

    for (const groupe of groupes) {
      const groupeDir = path.join(BASE_DIR, groupe);
      console.log(`\n--- Traitement du ${groupe} (${groupeDir}) ---`);

      // lister fichiers .json
      let fichiers;
      try {
        fichiers = fs.readdirSync(groupeDir).filter(f => f.toLowerCase().endsWith('.json'));
        fichiers.sort((a, b) => fs.statSync(path.join(groupeDir, a)).mtimeMs - fs.statSync(path.join(groupeDir, b)).mtimeMs);
        console.log(`🔎 ${fichiers.length} fichier(s) JSON trouvés dans ${groupeDir}`);
      } catch (err) {
        console.warn(`⚠️ Impossible de lire le dossier ${groupeDir} :`, err.message);
        continue;
      }

      for (const fichier of fichiers) {
        const filePath = path.join(groupeDir, fichier);
        console.log(`\n📄 Lecture fichier : ${filePath}`);
        let payload;
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          payload = JSON.parse(raw);
        } catch (err) {
          console.warn(`  ⚠️ Échec lecture/parse JSON pour ${fichier} :`, err.message);
          continue;
        }

        const matches = payload.matches || [];
        if (!Array.isArray(matches) || matches.length === 0) {
          console.log("  ℹ️ Aucun match dans ce fichier — on passe.");
          continue;
        }

        console.log(`  🔁 ${matches.length} match(es) à vérifier dans ${fichier}`);

        for (const matchEntry of matches) {
          const matchId = matchEntry.match?.matchId || matchEntry.matchId || null;
          const status = matchEntry.liveStatus || matchEntry.status || null;

          // Ne traiter que si pas de statut ou match en live / à venir
          if (status && !['NOT_STARTED', 'IN_PROGRESS', null].includes(status)) {
            continue;
          }

          if (!matchId) {
            console.warn("    ⚠️ Aucun matchId trouvé, on saute.");
            continue;
          }

          const apiUrl = `https://api.sofascore.com/api/v1/event/${matchId}`;
          console.log(`    ↳ Récupération event ${matchId}`);

          let finalData = null;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const resp = await page.goto(apiUrl, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
              if (!resp) throw new Error('no response');
              if (resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
              const txt = await resp.text();
              try { finalData = JSON.parse(txt); } catch { try { finalData = await resp.json(); } catch {} }
              break;
            } catch (err) {
              console.warn(`      ⚠️ tentative ${attempt}/${MAX_ATTEMPTS} échouée pour ${matchId} → ${err.message}`);
              if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 600));
            }
          }

          if (!finalData) {
            console.warn(`    ⛔ Impossible d'obtenir l'event ${matchId}`);
            continue;
          }

          // Extraction des scores et statut
          const eventObj = finalData.event || finalData;
          const homeScore = (eventObj.homeScore && (eventObj.homeScore.current ?? eventObj.homeScore)) ?? null;
          const awayScore = (eventObj.awayScore && (eventObj.awayScore.current ?? eventObj.awayScore)) ?? null;
          const liveStatus = eventObj.status ?? eventObj.status?.type ?? null;

          // Mise à jour du fichier
          matchEntry.liveScore = (Number.isFinite(homeScore) && Number.isFinite(awayScore)) ? `${homeScore} - ${awayScore}` : null;
          matchEntry.liveStatus = liveStatus ?? (eventObj.status?.description || null);
          matchEntry._eventFetchedAt = new Date().toISOString();

          // Envoi au VPS
          const sendBody = { source: 'live_match', matchId, groupe, fichier, timestamp: Date.now(), event: eventObj };
          try {
            const postResp = await page.request.post(VPS_WEBHOOK, {
              headers: { 'Content-Type': 'application/json' },
              data: sendBody,
              timeout: NAV_TIMEOUT
            });
            const postText = await postResp.text().catch(() => '');
            if (postResp.ok()) {
              console.log(`    ✅ Match ${matchId} envoyé au VPS (HTTP ${postResp.status()})`);
            } else {
              console.error(`    ⛔ Erreur VPS pour match ${matchId} (HTTP ${postResp.status()}): ${postText.slice(0,200)}`);
            }
          } catch (err) {
            console.error(`    ⛔ Exception lors du POST VPS pour ${matchId}:`, err.message);
          }
        } // end matches loop

        // Sauvegarde du fichier mis à jour
        try {
          const backupPath = filePath + '.bak';
          fs.copyFileSync(filePath, backupPath);
          fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
          console.log(`  💾 Fichier mis à jour (backup créé: ${path.basename(backupPath)})`);
        } catch (err) {
          console.error("  ⚠️ Échec écriture fichier :", err.message);
        }
      } // end fichiers loop
    } // end groupes loop

  } catch (err) {
    console.error('Erreur inattendue :', err);
    process.exit(5);
  } finally {
    try { await browser.close(); } catch {}
    console.log("🏁 Fin du script update_live.js");
  }
})();
