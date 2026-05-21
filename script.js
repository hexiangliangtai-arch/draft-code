// HTMLの部品をJavaScriptで使えるように取得します
const teamNameInput = document.querySelector("#teamNameInput");
const setTeamButton = document.querySelector("#setTeamButton");
const currentTeamLabel = document.querySelector("#currentTeamLabel");
const playerNameInput = document.querySelector("#playerName");
const announceButton = document.querySelector("#announceButton");
const message = document.querySelector("#message");
const announcement = document.querySelector("#announcement");
const roundText = document.querySelector("#roundText");
const announcementTeamName = document.querySelector("#announcementTeamName");
const announcedName = document.querySelector("#announcedName");
const draftHistory = document.querySelector("#draftHistory");
const resetButton = document.querySelector("#resetButton");

const STORAGE_KEYS = {
  history: "draftHistory",
  roundNumber: "draftRoundNumber",
  currentTeamName: "draftCurrentTeamName",
};

let currentTeamName = "";
let draftCount = 0;
let draftHistoryData = [];

function saveDraftData() {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(draftHistoryData));
    localStorage.setItem(STORAGE_KEYS.roundNumber, String(draftCount));
    localStorage.setItem(STORAGE_KEYS.currentTeamName, currentTeamName);
  } catch (error) {
    console.error("ドラフト情報の保存に失敗しました", error);
  }
}

function loadDraftData() {
  try {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.history);
    const savedRoundNumber = localStorage.getItem(STORAGE_KEYS.roundNumber);
    const savedTeamName = localStorage.getItem(STORAGE_KEYS.currentTeamName);

    if (savedHistory !== null) {
      try {
        const parsedHistory = JSON.parse(savedHistory);

        if (Array.isArray(parsedHistory)) {
          draftHistoryData = parsedHistory
            .filter((historyItem) => {
              return (
                historyItem !== null &&
                typeof historyItem.playerName === "string" &&
                typeof historyItem.teamName === "string" &&
                Number.isInteger(historyItem.roundNumber)
              );
            })
            .map((historyItem) => {
              return {
                playerName: historyItem.playerName,
                teamName: historyItem.teamName,
                roundNumber: historyItem.roundNumber,
              };
            });
        }
      } catch (error) {
        console.error("保存された指名履歴の読み込みに失敗しました", error);
        draftHistoryData = [];
      }
    }

    if (savedTeamName !== null) {
      currentTeamName = savedTeamName;
    }

    const parsedRoundNumber = Number(savedRoundNumber);
    const lastHistoryRoundNumber = draftHistoryData.reduce((largestRoundNumber, historyItem) => {
      return Math.max(largestRoundNumber, historyItem.roundNumber);
    }, 0);

    if (Number.isInteger(parsedRoundNumber) && parsedRoundNumber >= 0) {
      draftCount = Math.max(parsedRoundNumber, lastHistoryRoundNumber);
    } else {
      draftCount = lastHistoryRoundNumber;
    }
  } catch (error) {
    console.error("保存されたドラフト情報の読み込みに失敗しました", error);
    draftHistoryData = [];
    draftCount = 0;
    currentTeamName = "";
  }

  if (currentTeamName !== "") {
    teamNameInput.value = currentTeamName;
    currentTeamLabel.textContent = `現在のチーム：${currentTeamName}`;
    announcementTeamName.textContent = currentTeamName;
  }

  if (draftCount > 0) {
    roundText.textContent = `第${draftCount}巡選択希望選手`;
  }

  const latestHistory = draftHistoryData[draftHistoryData.length - 1];

  if (latestHistory) {
    announcedName.textContent = latestHistory.playerName;
  }

  renderDraftHistory();
}

function renderDraftHistory() {
  draftHistory.innerHTML = "";

  draftHistoryData.forEach((historyItem) => {
    const listItem = document.createElement("li");
    const roundText = document.createElement("span");
    const teamText = document.createElement("span");
    const nameText = document.createElement("span");

    roundText.className = "history-round";
    roundText.textContent = `第${historyItem.roundNumber}巡目`;

    teamText.className = "history-team";
    teamText.textContent = historyItem.teamName;

    nameText.className = "history-name";
    nameText.textContent = historyItem.playerName;

    listItem.appendChild(roundText);
    listItem.appendChild(teamText);
    listItem.appendChild(nameText);
    draftHistory.appendChild(listItem);
  });
}

function resetDraftHistory() {
  const shouldReset = confirm("本当に指名履歴をリセットしますか？");

  if (!shouldReset) {
    return;
  }

  draftHistoryData = [];
  draftCount = 0;
  roundText.textContent = "第1巡選択希望選手";
  announcedName.textContent = "ここに名前が表示されます";
  message.textContent = "";

  if (currentTeamName !== "") {
    announcementTeamName.textContent = currentTeamName;
  } else {
    announcementTeamName.textContent = "チーム名を設定してください";
  }

  renderDraftHistory();

  try {
    localStorage.removeItem(STORAGE_KEYS.history);
    localStorage.removeItem(STORAGE_KEYS.roundNumber);

    if (currentTeamName !== "") {
      localStorage.setItem(STORAGE_KEYS.currentTeamName, currentTeamName);
    } else {
      localStorage.removeItem(STORAGE_KEYS.currentTeamName);
    }
  } catch (error) {
    console.error("ドラフト情報のリセットに失敗しました", error);
  }
}

function setTeamName() {
  const teamName = teamNameInput.value.trim();

  // チーム名が空のときは、設定せずにメッセージを表示します
  if (teamName === "") {
    message.textContent = "チーム名を入力してください";
    return;
  }

  currentTeamName = teamName;
  currentTeamLabel.textContent = `現在のチーム：${currentTeamName}`;
  announcementTeamName.textContent = currentTeamName;
  message.textContent = "";
  saveDraftData();
}

function announcePlayer() {
  const playerName = playerNameInput.value.trim();

  // チーム名が未設定のときは、先にチーム名を設定してもらいます
  if (currentTeamName === "") {
    message.textContent = "先にチーム名を設定してください";
    return;
  }

  // 名前が空のときは、発表せずにメッセージを表示します
  if (playerName === "") {
    message.textContent = "名前を入力してください";
    return;
  }

  message.textContent = "";
  announcedName.textContent = playerName;
  draftCount = draftCount + 1;
  roundText.textContent = `第${draftCount}巡選択希望選手`;
  announcementTeamName.textContent = currentTeamName;

  addDraftHistory(playerName, currentTeamName, draftCount);
  saveDraftData();
  playerNameInput.value = "";

  // 連続で押しても毎回アニメーションするように、一度クラスを外します
  announcement.classList.remove("is-active");

  setTimeout(() => {
    announcement.classList.add("is-active");
  }, 10);
}

function addDraftHistory(playerName, teamName, roundNumber) {
  // 新しい履歴をデータに追加して、履歴リストを表示し直します
  draftHistoryData.push({
    playerName: playerName,
    teamName: teamName,
    roundNumber: roundNumber,
  });

  renderDraftHistory();
}

setTeamButton.addEventListener("click", setTeamName);

announceButton.addEventListener("click", announcePlayer);

resetButton.addEventListener("click", resetDraftHistory);

// Enterキーでも指名できるようにします
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    announcePlayer();
  }
});

// チーム名の入力欄でもEnterキーで設定できるようにします
teamNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    setTeamName();
  }
});

loadDraftData();
