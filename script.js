import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// TODO: Firebaseコンソールで取得したWebアプリ用のfirebaseConfigに貼り替えてください。
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "draft-code.firebaseapp.com",
  projectId: "draft-code",
  storageBucket: "draft-code.firebasestorage.app",
  messagingSenderId: "611009764252",
  appId: "1:611009764252:web:..."
};

const INITIAL_ROUND_TEXT = "第1巡選択希望選手";
const INITIAL_TEAM_TEXT = "チーム名を設定してください";
const INITIAL_PLAYER_TEXT = "ここに名前が表示されます";

// HTMLの部品をJavaScriptで使えるように取得します
const startScreen = document.querySelector("#startScreen");
const draftScreen = document.querySelector("#draftScreen");
const roomIdInput = document.querySelector("#roomIdInput");
const joinRoomButton = document.querySelector("#joinRoomButton");
const currentRoomLabel = document.querySelector("#currentRoomLabel");
const teamNameInput = document.querySelector("#teamNameInput");
const currentTeamLabel = document.querySelector("#currentTeamLabel");
const playerNameInput = document.querySelector("#playerName");
const announceButton = document.querySelector("#announceButton");
const startMessage = document.querySelector("#startMessage");
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
  lastRoomId: "draftLastRoomId",
};

let db = null;
let currentRoomId = "";
let currentRoomRef = null;
let unsubscribeRoom = null;
let currentTeamName = "";
let draftCount = 0;
let draftHistoryData = [];
let hasRenderedRoomSnapshot = false;
let lastRoomAnnouncementSignature = "";

function isFirebaseConfigReady() {
  return (
    firebaseConfig.apiKey.trim() !== "" &&
    firebaseConfig.projectId.trim() !== "" &&
    firebaseConfig.appId.trim() !== ""
  );
}

function initializeFirebase() {
  if (!isFirebaseConfigReady()) {
    currentRoomLabel.textContent = "現在のルーム：未入室";
    console.warn("script.jsのfirebaseConfigを設定するとオンライン機能を使えます。");
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (error) {
    console.error("Firebaseの初期化に失敗しました", error);
    startMessage.textContent = "Firebaseの初期化に失敗しました。設定内容を確認してください。";
  }
}

function getNowISOString() {
  return new Date().toISOString();
}

function saveLocalSettings() {
  try {
    localStorage.setItem(STORAGE_KEYS.currentTeamName, currentTeamName);

    if (currentRoomId !== "") {
      localStorage.setItem(STORAGE_KEYS.lastRoomId, currentRoomId);
    }
  } catch (error) {
    console.error("ローカル設定の保存に失敗しました", error);
  }
}

function showDraftScreen() {
  startScreen.classList.add("is-hidden");
  draftScreen.classList.remove("is-hidden");
}

function normalizeHistoryItem(historyItem) {
  if (historyItem === null || typeof historyItem !== "object") {
    return null;
  }

  const roundNumber = Number(historyItem.round ?? historyItem.roundNumber);

  if (
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    typeof historyItem.teamName !== "string" ||
    typeof historyItem.playerName !== "string"
  ) {
    return null;
  }

  return {
    roundNumber: roundNumber,
    teamName: historyItem.teamName,
    playerName: historyItem.playerName,
    createdAt: typeof historyItem.createdAt === "string" ? historyItem.createdAt : "",
  };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((historyItem) => normalizeHistoryItem(historyItem))
    .filter((historyItem) => historyItem !== null);
}

function toFirestoreHistoryItem(historyItem) {
  return {
    round: historyItem.roundNumber,
    teamName: historyItem.teamName,
    playerName: historyItem.playerName,
    createdAt: historyItem.createdAt || getNowISOString(),
  };
}

function getCurrentRound(roomData, history) {
  const currentRound = Number(roomData.currentRound);

  if (Number.isInteger(currentRound) && currentRound >= 1) {
    return currentRound;
  }

  return history.length + 1;
}

function createInitialRoomData(roomId) {
  const now = getNowISOString();

  return {
    roomId: roomId,
    currentRound: 1,
    currentTeamName: "",
    currentPlayerName: "",
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadDraftData() {
  try {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.history);
    const savedRoundNumber = localStorage.getItem(STORAGE_KEYS.roundNumber);
    const savedTeamName = localStorage.getItem(STORAGE_KEYS.currentTeamName);
    const savedRoomId = localStorage.getItem(STORAGE_KEYS.lastRoomId);

    if (savedRoomId !== null) {
      roomIdInput.value = savedRoomId;
    }

    if (savedHistory !== null) {
      try {
        draftHistoryData = normalizeHistory(JSON.parse(savedHistory));
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

function playAnnouncementAnimation() {
  announcement.classList.remove("is-active");

  setTimeout(() => {
    announcement.classList.add("is-active");
  }, 10);
}

function applyRoomData(roomData) {
  const history = normalizeHistory(roomData.history);
  const latestHistory = history[history.length - 1];
  const currentRound = getCurrentRound(roomData, history);
  const nextSignature = latestHistory
    ? `${currentRoomId}:${latestHistory.roundNumber}:${latestHistory.teamName}:${latestHistory.playerName}`
    : `${currentRoomId}:empty`;
  const shouldAnimate =
    hasRenderedRoomSnapshot &&
    latestHistory !== undefined &&
    nextSignature !== lastRoomAnnouncementSignature;

  draftHistoryData = history;
  draftCount = latestHistory ? latestHistory.roundNumber : 0;
  renderDraftHistory();

  if (latestHistory) {
    roundText.textContent = `第${latestHistory.roundNumber}巡選択希望選手`;
    announcementTeamName.textContent = roomData.currentTeamName || latestHistory.teamName;
    announcedName.textContent = roomData.currentPlayerName || latestHistory.playerName;
  } else {
    roundText.textContent = `第${currentRound}巡選択希望選手`;
    announcementTeamName.textContent = currentTeamName !== "" ? currentTeamName : INITIAL_TEAM_TEXT;
    announcedName.textContent = INITIAL_PLAYER_TEXT;
  }

  if (shouldAnimate) {
    playAnnouncementAnimation();
  }

  hasRenderedRoomSnapshot = true;
  lastRoomAnnouncementSignature = nextSignature;
}

function startRoomListener() {
  if (unsubscribeRoom !== null) {
    unsubscribeRoom();
  }

  hasRenderedRoomSnapshot = false;
  lastRoomAnnouncementSignature = "";

  unsubscribeRoom = onSnapshot(
    currentRoomRef,
    (roomSnapshot) => {
      if (!roomSnapshot.exists()) {
        message.textContent = "ルーム情報が見つかりませんでした。もう一度入室してください。";
        return;
      }

      applyRoomData(roomSnapshot.data());
    },
    (error) => {
      console.error("Firebaseからの読み込みに失敗しました", error);
      message.textContent = "Firebaseからルーム情報を読み込めませんでした。時間をおいて再度お試しください。";
    }
  );
}

async function joinRoom() {
  const roomId = roomIdInput.value.trim();
  const teamName = teamNameInput.value.trim();

  if (roomId === "") {
    startMessage.textContent = "ルームIDを入力してください";
    return;
  }

  if (teamName === "") {
    startMessage.textContent = "チーム名を入力してください";
    return;
  }

  if (roomId.includes("/")) {
    startMessage.textContent = "ルームIDには「/」を使わないでください";
    return;
  }

  if (db === null) {
    startMessage.textContent = "Firebase設定がまだ入っていません。script.jsのfirebaseConfigを設定してください。";
    return;
  }

  joinRoomButton.disabled = true;
  joinRoomButton.textContent = "入室中";
  startMessage.textContent = "";

  try {
    currentRoomId = roomId;
    currentTeamName = teamName;
    currentRoomRef = doc(db, "rooms", currentRoomId);

    const roomSnapshot = await getDoc(currentRoomRef);

    if (!roomSnapshot.exists()) {
      await setDoc(currentRoomRef, createInitialRoomData(currentRoomId));
    }

    currentRoomLabel.textContent = `現在のルーム：${currentRoomId}`;
    currentTeamLabel.textContent = `現在のチーム：${currentTeamName}`;
    announcementTeamName.textContent = currentTeamName;
    message.textContent = "";
    saveLocalSettings();
    startRoomListener();
    showDraftScreen();
  } catch (error) {
    console.error("ルームへの入室に失敗しました", error);
    currentRoomId = "";
    currentRoomRef = null;
    currentRoomLabel.textContent = "現在のルーム：未入室";
    startMessage.textContent = "Firebaseへの接続に失敗しました。設定や通信状態を確認してください。";
  } finally {
    joinRoomButton.disabled = false;
    joinRoomButton.textContent = "入室する";
  }
}

async function resetDraftHistory() {
  if (currentRoomId === "" || currentRoomRef === null) {
    message.textContent = "先にルームへ入室してください";
    return;
  }

  const shouldReset = confirm("このルームの指名履歴を全員分リセットします。本当によろしいですか？");

  if (!shouldReset) {
    return;
  }

  resetButton.disabled = true;
  message.textContent = "";

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);
      const now = getNowISOString();

      if (roomSnapshot.exists()) {
        transaction.update(currentRoomRef, {
          history: [],
          currentRound: 1,
          currentPlayerName: "",
          updatedAt: now,
        });
      } else {
        transaction.set(currentRoomRef, {
          ...createInitialRoomData(currentRoomId),
          currentTeamName: currentTeamName,
          updatedAt: now,
        });
      }
    });
  } catch (error) {
    console.error("Firebase上の指名履歴のリセットに失敗しました", error);
    message.textContent = "Firebase上の指名履歴をリセットできませんでした。もう一度お試しください。";
  } finally {
    resetButton.disabled = false;
  }
}

async function announcePlayer() {
  const playerName = playerNameInput.value.trim();

  if (currentRoomId === "" || currentRoomRef === null) {
    message.textContent = "先にルームへ入室してください";
    return;
  }

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

  announceButton.disabled = true;
  message.textContent = "";

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);
      const now = getNowISOString();
      const roomData = roomSnapshot.exists() ? roomSnapshot.data() : createInitialRoomData(currentRoomId);
      const latestHistory = normalizeHistory(roomData.history);
      const nextRound = latestHistory.length + 1;
      const newHistoryItem = {
        roundNumber: nextRound,
        teamName: currentTeamName,
        playerName: playerName,
        createdAt: now,
      };
      const nextHistory = latestHistory.concat(newHistoryItem).map((historyItem) => {
        return toFirestoreHistoryItem(historyItem);
      });
      const nextRoomData = {
        roomId: currentRoomId,
        currentRound: nextRound + 1,
        currentTeamName: currentTeamName,
        currentPlayerName: playerName,
        history: nextHistory,
        updatedAt: now,
      };

      if (roomSnapshot.exists()) {
        transaction.update(currentRoomRef, nextRoomData);
      } else {
        transaction.set(currentRoomRef, {
          ...nextRoomData,
          createdAt: now,
        });
      }
    });

    playerNameInput.value = "";
  } catch (error) {
    console.error("Firebaseへの指名結果の保存に失敗しました", error);
    message.textContent = "Firebaseへの保存に失敗しました。時間をおいてもう一度お試しください。";
  } finally {
    announceButton.disabled = false;
  }
}

joinRoomButton.addEventListener("click", joinRoom);

announceButton.addEventListener("click", announcePlayer);

resetButton.addEventListener("click", resetDraftHistory);

// ルームIDの入力欄でもEnterキーで入室できるようにします
roomIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

// Enterキーでも指名できるようにします
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    announcePlayer();
  }
});

// チーム名の入力欄でもEnterキーで入室できるようにします
teamNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

initializeFirebase();
loadDraftData();
