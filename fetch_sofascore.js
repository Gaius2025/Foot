// fetch_sofascore_debug.js
// Playwright script -> récupère l'API interne Sofascore et poste le JSON au webhook VPS
// Avec logs complets pour debug
// Usage via GitHub Actions (node 18+, playwright installé)

const { chromium } = require('playwright');

(async () => {
  const SOFA_ENDPOINT = 'https://www.sofascore.com/api/v1/unique-tournament/7/season/76953/standings/total';
  const VPS_WEBHOOK = process.env.VPS_WEBHOOK;
  const COOKIE = process.env.SOFASCORE_COOKIE || '';
  const MAX_ATTEMPTS = 2;

  if (!VPS_WEBHOOK) {
    console.error("Erreur: VPS_WEBHOOK non défini dans les secrets GitHub.");
    process.exit(2);
  }

  const ua = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: ua, locale: 'fr-FR', viewport: { width: 360, height: 800 } });

    if (COOKIE.trim()) {
      const cookiePairs = COOKIE.split(';').map(s => s.trim()).filter(Boolean);
      const cookies = cookiePairs.map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name: name.trim(), value: rest.join('='), domain: 'www.sofascore.com', path: '/', httpOnly: false, secure: true };
      });
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();

    let finalData = null;
    let finalStatus = null;
    let attemptDetails = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await page.goto(SOFA_ENDPOINT, { waitUntil: 'networkidle', timeout: 20000 });
        if (response) {
          const status = response.status();
          finalStatus = status;
          attemptDetails.push({ attempt, method: 'goto', status });

          if (status === 200 || status === 304) {
            try { finalData = await response.json(); } 
            catch { 
              const txt = await response.text(); 
              try { finalData = JSON.parse(txt); } catch { finalData = { text: txt }; } 
            }
            break;
          }
        } else {
          attemptDetails.push({ attempt, method: 'goto', status: null, note: 'no response' });
        }
      } catch (err) {
        attemptDetails.push({ attempt, method: 'goto', status: null, error: String(err) });
      }

      try {
        const result = await page.evaluate(async ({ url, ua, cookieString }) => {
          try {
            const headers = {
              'accept': '*/*',
              'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
              'cache-control': 'max-age=0',
              'referer': 'https://www.sofascore.com/tournament/football/europe/uefa-champions-league/7',
              'user-agent': ua,
              'x-requested-with': '335131'
            };
            if (cookieString) headers['cookie'] = cookieString;

            const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
            const status = resp.status;
            const ct = resp.headers.get('content-type') || '';
            let body = null;
            if (ct.includes('application/json') || ct.includes('text/json')) body = await resp.json();
            else { const text = await resp.text(); try { body = JSON.parse(text); } catch { body = { text }; } }
            return { status, ok: resp.ok, body };
          } catch (err) { return { error: String(err) }; }
        }, { url: SOFA_ENDPOINT, ua, cookieString: COOKIE });

        attemptDetails.push({ attempt, method: 'page.fetch', result: (result && (result.status || result.error)) || 'no-result' });

        if (result && result.body) {
          finalData = result.body;
          finalStatus = result.status ?? finalStatus;
          break;
        }
      } catch (err) {
        attemptDetails.push({ attempt, method: 'page.fetch', error: String(err) });
      }

      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000));
    }

    function filterTop3(rawData) {
      const rows = rawData?.standings?.[0]?.rows || [];
      return rows.slice(0, 3).map(row => ({
        position: row.position,
        team: row.team?.name || null,
        country: row.team?.country?.name || null,
        matches: row.matches,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        scoresFor: row.scoresFor,
        scoresAgainst: row.scoresAgainst,
        points: row.points,
        scoreDiff: row.scoreDiffFormatted
      }));
    }

    const top3 = finalData ? filterTop3(finalData) : [];

    const payloadToSend = { source: 'sofascore', timestamp: Date.now(), endpoint: SOFA_ENDPOINT, attempts: attemptDetails, status: finalStatus, payload: top3 };

    // Debug complet: log JSON final
    console.log('📡 JSON envoyé au VPS:\n', JSON.stringify(payloadToSend, null, 2));

    const posted = await sendToVPS(VPS_WEBHOOK, payloadToSend);
    if (!posted.ok) console.error('⛔ Erreur lors du POST vers VPS:', posted);

    process.exit(0);

  } catch (err) {
    console.error('Erreur inattendue :', err);
    process.exit(5);
  } finally {
    await browser.close();
  }

  async function sendToVPS(url, body) {
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

})();
