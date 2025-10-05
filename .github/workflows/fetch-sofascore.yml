// fetch_sofascore.js
// Playwright script -> ouvre directement l'API interne Sofascore et poste le JSON au webhook VPS
// Usage via GitHub Actions (node 18+, playwright installé)

const { chromium } = require('playwright');

(async () => {
  const SOFA_ENDPOINT = 'https://www.sofascore.com/api/v1/unique-tournament/7/season/76953/standings/total';
  const VPS_WEBHOOK = process.env.VPS_WEBHOOK;               // obligatoire (mettre en secrets GitHub)
  const COOKIE = process.env.SOFASCORE_COOKIE || '';        // optionnel : "panoramaId=...; panoramaId_expiry=..."
  const MAX_ATTEMPTS = 2;

  if (!VPS_WEBHOOK) {
    console.error("Erreur: VPS_WEBHOOK non défini dans les secrets GitHub.");
    process.exit(2);
  }

  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: ua,
      locale: 'fr-FR',
      // viewport mobile-like si besoin:
      viewport: { width: 360, height: 800 }
    });

    // Si cookie fourni, ajoute au contexte (permet d'avoir panoramaId si nécessaire)
    if (COOKIE && COOKIE.trim()) {
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
        console.log('Cookies ajoutés au contexte:', cookies.map(c => c.name));
      }
    }

    const page = await context.newPage();

    // Essayer directement loader l'URL de l'API (comme si on collait l'URL dans l'onglet navigateur)
    // On fera jusqu'à MAX_ATTEMPTS tentatives en variant la méthode si nécessaire
    let finalData = null;
    let finalStatus = null;
    let attemptDetails = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`Tentative ${attempt} : navigation directe vers l'endpoint API...`);
        const response = await page.goto(SOFA_ENDPOINT, { waitUntil: 'networkidle', timeout: 20000 });

        if (!response) {
          attemptDetails.push({ attempt, method: 'goto', status: null, note: 'no response' });
          console.warn('Aucune réponse (response null) pour goto.');
        } else {
          const status = response.status();
          finalStatus = status;
          attemptDetails.push({ attempt, method: 'goto', status });
          console.log(`Réponse goto HTTP status: ${status}`);

          // Si 200 ou 304 on récupère le body
          if (status === 200 || status === 304) {
            try {
              finalData = await response.json();
              console.log('Récupéré JSON via goto.');
            } catch (e) {
              // si body vide ou non-json -> fallback to text
              const txt = await response.text();
              try { finalData = JSON.parse(txt); console.log('Parsed JSON from text'); }
              catch { finalData = { text: txt }; console.log('Got text body'); }
            }
            break; // successful
          }

          // si 403, on va essayer méthode "fetch depuis la page" pour mieux simuler un vrai navigateur
          if (status === 403) {
            console.warn('403 reçu via goto; on va tenter une requête fetch depuis le contexte page (simulate browser fetch).');
            // fallthrough to next attempt which will run the page-eval fetch block
          }
        }
      } catch (err) {
        attemptDetails.push({ attempt, method: 'goto', status: null, error: String(err) });
        console.warn('Erreur lors de goto:', String(err));
      }

      // Si on arrive ici et que ce n'était pas concluant, essayer un fetch remplaçant (depuis la page)
      try {
        console.log(`Tentative ${attempt} (fetch via page) : exécute fetch() dans le contexte navigateur...`);
        // Passe un seul objet (Playwright limitation sur arguments)
        const result = await page.evaluate(async ({ url, ua, cookieString }) => {
          try {
            // Construire headers similaires à un navigateur
            const headers = {
              'accept': '*/*',
              'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
              'cache-control': 'max-age=0',
              'referer': 'https://www.sofascore.com/tournament/football/europe/uefa-champions-league/7',
              'user-agent': ua,
              'x-requested-with': '335131'
            };
            if (cookieString && cookieString.length) headers['cookie'] = cookieString;

            const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
            const status = resp.status;
            const ct = resp.headers.get('content-type') || '';
            let body = null;
            if (ct.includes('application/json') || ct.includes('text/json')) {
              body = await resp.json();
            } else {
              const text = await resp.text();
              try { body = JSON.parse(text); } catch { body = { text }; }
            }
            return { status, ok: resp.ok, body };
          } catch (err) {
            return { error: String(err) };
          }
        }, { url: SOFA_ENDPOINT, ua, cookieString: COOKIE });

        attemptDetails.push({ attempt, method: 'page.fetch', result: (result && (result.status || result.error)) || 'no-result' });

        if (result && result.body) {
          finalData = result.body;
          finalStatus = result.status ?? finalStatus;
          console.log('Récupération OK via page.fetch, status:', result.status);
          break;
        } else {
          console.warn('page.fetch n’a pas retourné de body ou erreur:', result && result.error);
        }
      } catch (err) {
        attemptDetails.push({ attempt, method: 'page.fetch', error: String(err) });
        console.warn('Erreur lors de page.evaluate fetch:', String(err));
      }

      // petite pause entre tentatives (optionnel)
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000));
    } // end attempts loop

    // Prépare payload final de debug + data
    const payloadToSend = {
      source: 'sofascore',
      timestamp: Date.now(),
      endpoint: SOFA_ENDPOINT,
      attempts: attemptDetails,
      status: finalStatus,
      payload: finalData ?? null
    };

    // Envoi au VPS
    const posted = await sendToVPS(VPS_WEBHOOK, payloadToSend);
    if (posted && posted.ok) {
      console.log('✅ Données envoyées au VPS avec succès. status POST:', posted.status);
      process.exit(0);
    } else {
      console.error('⛔ Erreur lors du POST vers VPS:', posted);
      // Si on a récupéré des données mais POST échoue, quitte avec code 3
      process.exit(3);
    }

  } catch (err) {
    console.error('Erreur inattendue :', err);
    process.exit(5);
  } finally {
    await browser.close();
  }

  // helper pour poster vers le webhook (utilise global fetch de node18+)
  async function sendToVPS(url, body) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

})();
