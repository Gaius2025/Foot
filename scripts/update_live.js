import axios from "axios";
import fs from "fs";

const VPS_URL = "https://tonsite.com/sofascore-ingest/update_live.php";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

async function fetchLiveStatus(matchId) {
  try {
    const { data } = await axios.get(`https://api.sofascore.com/api/v1/event/${matchId}`);
    const match = data.event;
    return {
      status: match.status.type,
      homeScore: match.homeScore.current,
      awayScore: match.awayScore.current,
    };
  } catch {
    return null;
  }
}

(async () => {
  const groupFile = "groupes_json/Groupe_1.js"; // exemple
  const group = readJson(groupFile);

  for (const item of group.matches) {
    const live = await fetchLiveStatus(item.match.matchId);
    if (live) {
      item.live = live;
      item.result =
        live.status === "finished"
          ? live.homeScore > live.awayScore
            ? "homeWin"
            : "lost"
          : "pending";
    }
  }

  await axios.post(VPS_URL, { groupe: "1", matches: group.matches });
  console.log("✅ Scores mis à jour !");
})();
