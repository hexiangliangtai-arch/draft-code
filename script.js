// HTMLの部品をJavaScriptで使えるように取得します
const playerNameInput = document.querySelector("#playerName");
const announceButton = document.querySelector("#announceButton");
const message = document.querySelector("#message");
const announcement = document.querySelector("#announcement");
const roundText = document.querySelector("#roundText");
const announcedName = document.querySelector("#announcedName");
const draftHistory = document.querySelector("#draftHistory");
const resetButton = document.querySelector("#resetButton");

let draftCount = 0;

function announcePlayer() {
  const playerName = playerNameInput.value.trim();

  // 名前が空のときは、発表せずにメッセージを表示します
  if (playerName === "") {
    message.textContent = "名前を入力してください";
    return;
  }

  message.textContent = "";
  announcedName.textContent = playerName;
  draftCount = draftCount + 1;
  roundText.textContent = `第${draftCount}巡選択希望選手`;

  addDraftHistory(playerName, draftCount);
  playerNameInput.value = "";

  // 連続で押しても毎回アニメーションするように、一度クラスを外します
  announcement.classList.remove("is-active");

  setTimeout(() => {
    announcement.classList.add("is-active");
  }, 10);
}

function addDraftHistory(playerName, roundNumber) {
  // 新しい履歴を1行作って、履歴リストの下に追加します
  const historyItem = document.createElement("li");
  const roundText = document.createElement("span");
  const nameText = document.createElement("span");

  roundText.className = "history-round";
  roundText.textContent = `第${roundNumber}巡目`;

  nameText.className = "history-name";
  nameText.textContent = playerName;

  historyItem.appendChild(roundText);
  historyItem.appendChild(nameText);
  draftHistory.appendChild(historyItem);
}

announceButton.addEventListener("click", announcePlayer);

resetButton.addEventListener("click", () => {
  // 履歴と巡目番号を最初の状態に戻します
  draftHistory.innerHTML = "";
  draftCount = 0;
  roundText.textContent = "第1巡選択希望選手";
  message.textContent = "";
});

// Enterキーでも指名できるようにします
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    announcePlayer();
  }
});
