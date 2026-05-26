import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
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
const normalScreen = document.querySelector("#normalScreen");
const roomIdInput = document.querySelector("#roomIdInput");
const joinRoomButton = document.querySelector("#joinRoomButton");
const currentRoomLabel = document.querySelector("#currentRoomLabel");
const teamNameInput = document.querySelector("#teamNameInput");
const currentTeamLabel = document.querySelector("#currentTeamLabel");
const nextRoundLabel = document.querySelector("#nextRoundLabel");
const draftInputScreen = document.querySelector("#draftInputScreen");
const draftWaitingScreen = document.querySelector("#draftWaitingScreen");
const playerNameInput = document.querySelector("#playerName");
const announceButton = document.querySelector("#announceButton");
const startMessage = document.querySelector("#startMessage");
const message = document.querySelector("#message");
const waitingTitle = document.querySelector("#waitingTitle");
const waitingMessage = document.querySelector("#waitingMessage");
const remainingCountText = document.querySelector("#remainingCountText");
const remainingParticipantsList = document.querySelector("#remainingParticipantsList");
const announceReadyButton = document.querySelector("#announceReadyButton");
const announcementPlaceholder = document.querySelector("#announcementPlaceholder");
const announcementScreen = document.querySelector("#announcementScreen");
const announcementCard = document.querySelector("#announcementCard");
const announcementProgressText = document.querySelector("#announcementProgressText");
const announcementRoundText = document.querySelector("#announcementRoundText");
const announcingTeamName = document.querySelector("#announcingTeamName");
const announcingPlayerName = document.querySelector("#announcingPlayerName");
const nextAnnouncementButton = document.querySelector("#nextAnnouncementButton");
const roundSummaryScreen = document.querySelector("#roundSummaryScreen");
const roundSummaryTitle = document.querySelector("#roundSummaryTitle");
const roundSummaryList = document.querySelector("#roundSummaryList");
const nextRoundButton = document.querySelector("#nextRoundButton");
const announcement = document.querySelector("#announcement");
const roundText = document.querySelector("#roundText");
const announcementTeamName = document.querySelector("#announcementTeamName");
const announcedName = document.querySelector("#announcedName");
const participantsList = document.querySelector("#participantsList");
const draftHistory = document.querySelector("#draftHistory");
const playerHistory = document.querySelector("#playerHistory");
const overallHistoryTab = document.querySelector("#overallHistoryTab");
const playerHistoryTab = document.querySelector("#playerHistoryTab");
const overallHistoryPanel = document.querySelector("#overallHistoryPanel");
const playerHistoryPanel = document.querySelector("#playerHistoryPanel");
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
let participantsData = [];
let pendingPicksData = {};
let announcementQueueData = [];
let currentAnnouncementIndex = 0;
let currentPhase = "drafting";
let hasRenderedRoomSnapshot = false;
let lastRoomAnnouncementSignature = "";
let lastRevealedAnnouncementSignature = "";

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

function normalizeParticipant(participant) {
  if (participant === null || typeof participant !== "object" || typeof participant.teamName !== "string") {
    return null;
  }

  const joinedAt = typeof participant.joinedAt === "string" ? participant.joinedAt : "";
  const lastSeenAt = typeof participant.lastSeenAt === "string" ? participant.lastSeenAt : joinedAt;

  return {
    teamName: participant.teamName,
    joinedAt: joinedAt,
    lastSeenAt: lastSeenAt,
  };
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) {
    return [];
  }

  return participants
    .map((participant) => normalizeParticipant(participant))
    .filter((participant) => participant !== null && participant.teamName.trim() !== "");
}

function addOrUpdateParticipant(participants, teamName, now) {
  const nextParticipants = normalizeParticipants(participants);
  const existingParticipant = nextParticipants.find((participant) => {
    return participant.teamName === teamName;
  });

  if (existingParticipant) {
    existingParticipant.lastSeenAt = now;
    return nextParticipants;
  }

  return nextParticipants.concat({
    teamName: teamName,
    joinedAt: now,
    lastSeenAt: now,
  });
}

function normalizePendingPick(pendingPick) {
  if (pendingPick === null || typeof pendingPick !== "object") {
    return null;
  }

  const roundNumber = Number(pendingPick.round ?? pendingPick.roundNumber);

  if (
    typeof pendingPick.teamName !== "string" ||
    typeof pendingPick.playerName !== "string" ||
    !Number.isInteger(roundNumber) ||
    roundNumber < 1
  ) {
    return null;
  }

  return {
    teamName: pendingPick.teamName,
    playerName: pendingPick.playerName,
    round: roundNumber,
    submittedAt: typeof pendingPick.submittedAt === "string" ? pendingPick.submittedAt : "",
  };
}

function normalizePendingPicks(pendingPicks) {
  const normalizedPendingPicks = {};

  if (pendingPicks === null || typeof pendingPicks !== "object" || Array.isArray(pendingPicks)) {
    return normalizedPendingPicks;
  }

  Object.keys(pendingPicks).forEach((teamName) => {
    const normalizedPendingPick = normalizePendingPick(pendingPicks[teamName]);

    if (normalizedPendingPick !== null) {
      normalizedPendingPicks[teamName] = normalizedPendingPick;
    }
  });

  return normalizedPendingPicks;
}

function normalizeAnnouncementItem(announcementItem) {
  if (announcementItem === null || typeof announcementItem !== "object") {
    return null;
  }

  const roundNumber = Number(announcementItem.round ?? announcementItem.roundNumber);

  if (
    typeof announcementItem.teamName !== "string" ||
    typeof announcementItem.playerName !== "string" ||
    !Number.isInteger(roundNumber) ||
    roundNumber < 1
  ) {
    return null;
  }

  return {
    teamName: announcementItem.teamName,
    playerName: announcementItem.playerName,
    round: roundNumber,
    announced: announcementItem.announced === true,
    roundKey: typeof announcementItem.roundKey === "string" ? announcementItem.roundKey : "",
    submittedAt: typeof announcementItem.submittedAt === "string" ? announcementItem.submittedAt : "",
  };
}

function normalizeAnnouncementQueue(announcementQueue) {
  if (!Array.isArray(announcementQueue)) {
    return [];
  }

  return announcementQueue
    .map((announcementItem) => normalizeAnnouncementItem(announcementItem))
    .filter((announcementItem) => announcementItem !== null);
}

function toFirestoreAnnouncementItem(announcementItem) {
  return {
    teamName: announcementItem.teamName,
    playerName: announcementItem.playerName,
    round: announcementItem.round,
    announced: announcementItem.announced === true,
    roundKey: announcementItem.roundKey || "",
    submittedAt: announcementItem.submittedAt || "",
  };
}

function buildAnnouncementQueue(participants, pendingPicks, roundKey) {
  return participants.map((participant) => {
    const pendingPick = pendingPicks[participant.teamName];

    return {
      teamName: pendingPick.teamName,
      playerName: pendingPick.playerName,
      round: pendingPick.round,
      announced: false,
      roundKey: roundKey,
      submittedAt: pendingPick.submittedAt,
    };
  });
}

function getSubmissionStatus(participants, pendingPicks) {
  const remainingParticipants = participants.filter((participant) => {
    return pendingPicks[participant.teamName] === undefined;
  });
  const allSubmitted = participants.length > 0 && remainingParticipants.length === 0;

  return {
    allSubmitted: allSubmitted,
    remainingParticipants: remainingParticipants,
    remainingCount: remainingParticipants.length,
  };
}

function hasCurrentPlayerSubmitted() {
  return currentTeamName !== "" && pendingPicksData[currentTeamName] !== undefined;
}

function hideRoomPhaseScreens() {
  draftInputScreen.classList.add("is-hidden");
  draftWaitingScreen.classList.add("is-hidden");
  announcementScreen.classList.add("is-hidden");
  roundSummaryScreen.classList.add("is-hidden");
}

function showNormalScreen() {
  normalScreen.classList.remove("is-hidden");
  announcementScreen.classList.add("is-hidden");
  roundSummaryScreen.classList.add("is-hidden");
}

function showDraftInputScreen() {
  hideRoomPhaseScreens();
  showNormalScreen();
  draftInputScreen.classList.remove("is-hidden");
  announcement.classList.remove("is-hidden");
}

function showDraftWaitingScreen() {
  hideRoomPhaseScreens();
  showNormalScreen();
  draftWaitingScreen.classList.remove("is-hidden");
  announcement.classList.remove("is-hidden");
}

function showAnnouncementScreen() {
  hideRoomPhaseScreens();
  normalScreen.classList.add("is-hidden");
  roundSummaryScreen.classList.add("is-hidden");
  announcementScreen.classList.remove("is-hidden");
}

function showRoundSummaryScreen() {
  hideRoomPhaseScreens();
  normalScreen.classList.add("is-hidden");
  announcementScreen.classList.add("is-hidden");
  roundSummaryScreen.classList.remove("is-hidden");
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
    roundKey: typeof historyItem.roundKey === "string" ? historyItem.roundKey : "",
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
  const firestoreHistoryItem = {
    round: historyItem.roundNumber,
    teamName: historyItem.teamName,
    playerName: historyItem.playerName,
    createdAt: historyItem.createdAt || getNowISOString(),
  };

  if (historyItem.roundKey) {
    firestoreHistoryItem.roundKey = historyItem.roundKey;
  }

  return firestoreHistoryItem;
}

function getNextRoundForTeam(history, teamName) {
  if (teamName === "") {
    return 1;
  }

  const teamHistory = history.filter((historyItem) => {
    return historyItem.teamName === teamName;
  });

  return teamHistory.length + 1;
}

function updateNextRoundLabel() {
  const nextRound = getNextRoundForTeam(draftHistoryData, currentTeamName);
  nextRoundLabel.textContent = `次のあなたの指名：第${nextRound}巡目`;
}

function createInitialRoomData(roomId, participantTeamName = "") {
  const now = getNowISOString();

  return {
    roomId: roomId,
    currentRound: 1,
    currentTeamName: "",
    currentPlayerName: "",
    history: [],
    participants: participantTeamName !== "" ? addOrUpdateParticipant([], participantTeamName, now) : [],
    pendingPicks: {},
    announcementQueue: [],
    currentAnnouncementIndex: 0,
    phase: "drafting",
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
  playerHistory.innerHTML = "";

  if (draftHistoryData.length === 0) {
    const emptyHistoryItem = document.createElement("li");
    emptyHistoryItem.className = "history-empty";
    emptyHistoryItem.textContent = "履歴はまだありません";
    draftHistory.appendChild(emptyHistoryItem);

    const emptyPlayerHistory = document.createElement("p");
    emptyPlayerHistory.className = "history-empty";
    emptyPlayerHistory.textContent = "プレイヤー別履歴はまだありません";
    playerHistory.appendChild(emptyPlayerHistory);
    updateNextRoundLabel();
    return;
  }

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

  renderPlayerHistory();
  updateNextRoundLabel();
}

function renderParticipants() {
  participantsList.innerHTML = "";

  if (participantsData.length === 0) {
    const emptyParticipant = document.createElement("li");
    emptyParticipant.textContent = "参加者はまだいません";
    participantsList.appendChild(emptyParticipant);
    return;
  }

  participantsData.forEach((participant) => {
    const listItem = document.createElement("li");
    const statusText = document.createElement("span");
    const hasSubmitted = pendingPicksData[participant.teamName] !== undefined;
    const participantLabel = participant.teamName === currentTeamName
      ? `${participant.teamName}（自分）`
      : participant.teamName;

    if (participant.teamName === currentTeamName) {
      listItem.className = "is-current";
    }

    statusText.className = hasSubmitted ? "participant-status" : "participant-status is-waiting";
    statusText.textContent = hasSubmitted ? "指名済み" : "未指名";

    listItem.textContent = participantLabel;
    listItem.appendChild(statusText);
    participantsList.appendChild(listItem);
  });
}

function renderWaitingScreen() {
  const status = getSubmissionStatus(participantsData, pendingPicksData);
  const submitted = hasCurrentPlayerSubmitted();

  if (!submitted) {
    showDraftInputScreen();
    announcementPlaceholder.classList.add("is-hidden");
    return;
  }

  showDraftWaitingScreen();
  remainingParticipantsList.innerHTML = "";

  if (status.allSubmitted) {
    waitingTitle.textContent = "全員の指名が完了しました";
    waitingMessage.textContent = "発表の準備ができました。発表前のため、履歴にはまだ追加されません。";
    remainingCountText.textContent = "あと0人";
    announceReadyButton.classList.remove("is-hidden");

    const completeItem = document.createElement("li");
    completeItem.textContent = "未指名の参加者はいません";
    remainingParticipantsList.appendChild(completeItem);
  } else {
    waitingTitle.textContent = "他の参加者の指名を待っています";
    waitingMessage.textContent = "発表前のため、履歴にはまだ追加されません。";
    remainingCountText.textContent = `あと${status.remainingCount}人`;
    announceReadyButton.classList.add("is-hidden");
    announcementPlaceholder.classList.add("is-hidden");

    status.remainingParticipants.forEach((participant) => {
      const listItem = document.createElement("li");
      listItem.textContent = participant.teamName;
      remainingParticipantsList.appendChild(listItem);
    });
  }
}

function renderAnnouncementScreen() {
  showAnnouncementScreen();

  if (announcementQueueData.length === 0) {
    announcementProgressText.textContent = "0人目 / 0人";
    announcementRoundText.textContent = "発表待ち";
    announcingTeamName.textContent = "指名データがありません";
    announcingPlayerName.textContent = "";
    nextAnnouncementButton.disabled = true;
    return;
  }

  const safeIndex = Math.min(Math.max(currentAnnouncementIndex, 0), announcementQueueData.length - 1);
  const currentAnnouncement = announcementQueueData[safeIndex];

  announcementProgressText.textContent = `${safeIndex + 1}人目 / ${announcementQueueData.length}人`;
  announcementRoundText.textContent = `第${currentAnnouncement.round}巡目`;
  announcingTeamName.textContent = currentAnnouncement.teamName;
  announcingPlayerName.textContent = currentAnnouncement.playerName;
  nextAnnouncementButton.textContent =
    safeIndex >= announcementQueueData.length - 1 ? "この巡目の結果へ" : "次の発表へ";
  nextAnnouncementButton.disabled = false;

  playAnnouncementRevealAnimation(
    `${currentRoomId}:${safeIndex}:${currentAnnouncement.round}:${currentAnnouncement.teamName}:${currentAnnouncement.playerName}`
  );
}

function renderRoundSummaryScreen() {
  showRoundSummaryScreen();
  roundSummaryList.innerHTML = "";

  if (announcementQueueData.length === 0) {
    roundSummaryTitle.textContent = "指名結果はありません";

    const emptySummaryItem = document.createElement("li");
    const emptyText = document.createElement("span");

    emptyText.className = "summary-player";
    emptyText.textContent = "この巡目の指名結果はありません";
    emptySummaryItem.appendChild(emptyText);
    roundSummaryList.appendChild(emptySummaryItem);
    return;
  }

  const firstAnnouncement = announcementQueueData[0];
  roundSummaryTitle.textContent = `第${firstAnnouncement.round}巡目`;

  announcementQueueData.forEach((announcementItem) => {
    const listItem = document.createElement("li");
    const teamText = document.createElement("span");
    const playerText = document.createElement("span");

    teamText.className = "summary-team";
    teamText.textContent = announcementItem.teamName;

    playerText.className = "summary-player";
    playerText.textContent = announcementItem.playerName;

    listItem.appendChild(teamText);
    listItem.appendChild(playerText);
    roundSummaryList.appendChild(listItem);
  });
}

function renderPlayerHistory() {
  const teamNames = [];

  draftHistoryData.forEach((historyItem) => {
    if (!teamNames.includes(historyItem.teamName)) {
      teamNames.push(historyItem.teamName);
    }
  });

  if (currentTeamName !== "" && teamNames.includes(currentTeamName)) {
    teamNames.sort((firstTeamName, secondTeamName) => {
      if (firstTeamName === currentTeamName) {
        return -1;
      }

      if (secondTeamName === currentTeamName) {
        return 1;
      }

      return 0;
    });
  }

  teamNames.forEach((teamName) => {
    const group = document.createElement("section");
    const title = document.createElement("h3");
    const list = document.createElement("ol");
    const teamHistory = draftHistoryData.filter((historyItem) => {
      return historyItem.teamName === teamName;
    });

    group.className = "player-history-group";

    if (teamName === currentTeamName) {
      group.classList.add("is-current");
      title.textContent = `自分の指名履歴：${teamName}`;
    } else {
      title.textContent = `【${teamName}】`;
    }

    title.className = "player-history-title";
    list.className = "player-history-list";

    teamHistory.forEach((historyItem) => {
      const listItem = document.createElement("li");
      listItem.textContent = `第${historyItem.roundNumber}巡目　${historyItem.playerName}`;
      list.appendChild(listItem);
    });

    group.appendChild(title);
    group.appendChild(list);
    playerHistory.appendChild(group);
  });
}

function showHistoryView(viewName) {
  const isPlayerHistory = viewName === "player";

  overallHistoryPanel.classList.toggle("is-hidden", isPlayerHistory);
  playerHistoryPanel.classList.toggle("is-hidden", !isPlayerHistory);
  overallHistoryTab.classList.toggle("is-active", !isPlayerHistory);
  playerHistoryTab.classList.toggle("is-active", isPlayerHistory);
}

function playAnnouncementAnimation() {
  announcement.classList.remove("is-active");

  setTimeout(() => {
    announcement.classList.add("is-active");
  }, 10);
}

function playAnnouncementRevealAnimation(announcementSignature) {
  if (announcementSignature === "" || announcementSignature === lastRevealedAnnouncementSignature) {
    return;
  }

  lastRevealedAnnouncementSignature = announcementSignature;
  announcementCard.classList.remove("is-revealed");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      announcementCard.classList.add("is-revealed");
    });
  });
}

function applyRoomData(roomData) {
  const history = normalizeHistory(roomData.history);
  const participants = normalizeParticipants(roomData.participants);
  const pendingPicks = normalizePendingPicks(roomData.pendingPicks);
  const announcementQueue = normalizeAnnouncementQueue(roomData.announcementQueue);
  const announcementIndex = Number(roomData.currentAnnouncementIndex);
  const phase = typeof roomData.phase === "string" ? roomData.phase : "drafting";
  const latestHistory = history[history.length - 1];
  const nextMyRound = getNextRoundForTeam(history, currentTeamName);
  const nextSignature = latestHistory
    ? `${currentRoomId}:${latestHistory.roundNumber}:${latestHistory.teamName}:${latestHistory.playerName}`
    : `${currentRoomId}:empty`;
  const shouldAnimate =
    hasRenderedRoomSnapshot &&
    latestHistory !== undefined &&
    nextSignature !== lastRoomAnnouncementSignature;

  draftHistoryData = history;
  participantsData = participants;
  pendingPicksData = pendingPicks;
  announcementQueueData = announcementQueue;
  currentAnnouncementIndex = Number.isInteger(announcementIndex) && announcementIndex >= 0 ? announcementIndex : 0;
  currentPhase = phase;
  draftCount = nextMyRound - 1;
  renderDraftHistory();
  renderParticipants();

  if (latestHistory) {
    roundText.textContent = `第${latestHistory.roundNumber}巡選択希望選手`;
    announcementTeamName.textContent = roomData.currentTeamName || latestHistory.teamName;
    announcedName.textContent = roomData.currentPlayerName || latestHistory.playerName;
  } else {
    roundText.textContent = `第${nextMyRound}巡選択希望選手`;
    announcementTeamName.textContent = currentTeamName !== "" ? currentTeamName : INITIAL_TEAM_TEXT;
    announcedName.textContent = INITIAL_PLAYER_TEXT;
  }

  if (shouldAnimate) {
    playAnnouncementAnimation();
  }

  if (phase === "announcing") {
    renderAnnouncementScreen();
  } else if (phase === "roundSummary") {
    lastRevealedAnnouncementSignature = "";
    renderRoundSummaryScreen();
  } else {
    lastRevealedAnnouncementSignature = "";
    renderWaitingScreen();
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

    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);
      const now = getNowISOString();

      if (roomSnapshot.exists()) {
        const roomData = roomSnapshot.data();
        const nextParticipants = addOrUpdateParticipant(roomData.participants, currentTeamName, now);
        const nextPendingPicks = normalizePendingPicks(roomData.pendingPicks);
        const nextAnnouncementQueue = normalizeAnnouncementQueue(roomData.announcementQueue);
        const storedAnnouncementIndex = Number(roomData.currentAnnouncementIndex);
        const nextAnnouncementIndex =
          Number.isInteger(storedAnnouncementIndex) && storedAnnouncementIndex >= 0 ? storedAnnouncementIndex : 0;
        const roomPhase = typeof roomData.phase === "string" ? roomData.phase : "drafting";
        const nextStatus = getSubmissionStatus(nextParticipants, nextPendingPicks);
        const nextPhase =
          roomPhase === "announcing" || roomPhase === "roundSummary"
            ? roomPhase
            : nextStatus.allSubmitted
              ? "readyToAnnounce"
              : nextPendingPicks[currentTeamName]
                ? "waiting"
                : "drafting";

        transaction.update(currentRoomRef, {
          participants: nextParticipants,
          pendingPicks: nextPendingPicks,
          announcementQueue: nextAnnouncementQueue.map((announcementItem) => {
            return toFirestoreAnnouncementItem(announcementItem);
          }),
          currentAnnouncementIndex: nextAnnouncementIndex,
          phase: nextPhase,
          updatedAt: now,
        });
      } else {
        transaction.set(currentRoomRef, createInitialRoomData(currentRoomId, currentTeamName));
      }
    });

    currentRoomLabel.textContent = `現在のルーム：${currentRoomId}`;
    currentTeamLabel.textContent = `現在のチーム：${currentTeamName}`;
    announcementTeamName.textContent = currentTeamName;
    updateNextRoundLabel();
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
          pendingPicks: {},
          announcementQueue: [],
          currentAnnouncementIndex: 0,
          currentRound: 1,
          currentPlayerName: "",
          phase: "drafting",
          updatedAt: now,
        });
      } else {
        transaction.set(currentRoomRef, {
          ...createInitialRoomData(currentRoomId, currentTeamName),
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
    message.textContent = "選手名を入力してください";
    return;
  }

  announceButton.disabled = true;
  message.textContent = "";

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);
      const now = getNowISOString();
      const roomData = roomSnapshot.exists() ? roomSnapshot.data() : createInitialRoomData(currentRoomId, currentTeamName);
      const latestHistory = normalizeHistory(roomData.history);
      const myHistory = latestHistory.filter((historyItem) => {
        return historyItem.teamName === currentTeamName;
      });
      const nextRound = myHistory.length + 1;
      const nextParticipants = addOrUpdateParticipant(roomData.participants, currentTeamName, now);
      const nextPendingPicks = {
        ...normalizePendingPicks(roomData.pendingPicks),
        [currentTeamName]: {
          teamName: currentTeamName,
          playerName: playerName,
          round: nextRound,
          submittedAt: now,
        },
      };
      const nextStatus = getSubmissionStatus(nextParticipants, nextPendingPicks);
      const nextRoomData = {
        roomId: currentRoomId,
        currentRound: nextRound,
        currentTeamName: currentTeamName,
        history: latestHistory.map((historyItem) => {
          return toFirestoreHistoryItem(historyItem);
        }),
        participants: nextParticipants,
        pendingPicks: nextPendingPicks,
        phase: nextStatus.allSubmitted ? "readyToAnnounce" : "waiting",
        updatedAt: now,
      };

      if (roomSnapshot.exists()) {
        transaction.update(currentRoomRef, nextRoomData);
      } else {
        transaction.set(currentRoomRef, {
          ...nextRoomData,
          currentPlayerName: "",
          createdAt: now,
        });
      }
    });

    playerNameInput.value = "";
    showDraftWaitingScreen();
  } catch (error) {
    console.error("Firebaseへの指名結果の保存に失敗しました", error);
    message.textContent = "Firebaseへの保存に失敗しました。時間をおいてもう一度お試しください。";
  } finally {
    announceButton.disabled = false;
  }
}

function getHistoryIdentity(historyItem) {
  if (historyItem.roundKey) {
    return `${historyItem.roundKey}:${historyItem.teamName}`;
  }

  return `${historyItem.roundNumber}:${historyItem.teamName}:${historyItem.playerName}`;
}

async function startAnnouncement() {
  if (currentRoomId === "" || currentRoomRef === null) {
    message.textContent = "先にルームへ入室してください";
    return;
  }

  announceReadyButton.disabled = true;
  announcementPlaceholder.classList.add("is-hidden");

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);

      if (!roomSnapshot.exists()) {
        throw new Error("ルーム情報が見つかりません");
      }

      const now = getNowISOString();
      const roomData = roomSnapshot.data();
      const participants = normalizeParticipants(roomData.participants);
      const pendingPicks = normalizePendingPicks(roomData.pendingPicks);
      const status = getSubmissionStatus(participants, pendingPicks);

      if (!status.allSubmitted) {
        throw new Error("まだ全員の指名が完了していません");
      }

      const roundKey = `${currentRoomId}-${now}`;
      const announcementQueue = buildAnnouncementQueue(participants, pendingPicks, roundKey);

      transaction.update(currentRoomRef, {
        announcementQueue: announcementQueue.map((announcementItem) => {
          return toFirestoreAnnouncementItem(announcementItem);
        }),
        currentAnnouncementIndex: 0,
        phase: "announcing",
        updatedAt: now,
      });
    });
  } catch (error) {
    console.error("発表開始に失敗しました", error);
    announcementPlaceholder.textContent =
      error.message === "まだ全員の指名が完了していません"
        ? "まだ全員の指名が完了していません"
        : "発表を開始できませんでした。もう一度お試しください。";
    announcementPlaceholder.classList.remove("is-hidden");
  } finally {
    announceReadyButton.disabled = false;
  }
}

async function showNextAnnouncement() {
  if (currentRoomId === "" || currentRoomRef === null) {
    message.textContent = "先にルームへ入室してください";
    return;
  }

  nextAnnouncementButton.disabled = true;

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);

      if (!roomSnapshot.exists()) {
        throw new Error("ルーム情報が見つかりません");
      }

      const now = getNowISOString();
      const roomData = roomSnapshot.data();
      const announcementQueue = normalizeAnnouncementQueue(roomData.announcementQueue);
      const storedAnnouncementIndex = Number(roomData.currentAnnouncementIndex);
      const safeAnnouncementIndex =
        Number.isInteger(storedAnnouncementIndex) && storedAnnouncementIndex >= 0 ? storedAnnouncementIndex : 0;

      if (announcementQueue.length === 0) {
        transaction.update(currentRoomRef, {
          phase: "roundSummary",
          updatedAt: now,
        });
        return;
      }

      if (safeAnnouncementIndex < announcementQueue.length - 1) {
        transaction.update(currentRoomRef, {
          currentAnnouncementIndex: safeAnnouncementIndex + 1,
          updatedAt: now,
        });
        return;
      }

      const latestHistory = normalizeHistory(roomData.history);
      const historyIdentities = new Set(latestHistory.map((historyItem) => getHistoryIdentity(historyItem)));
      const announcedHistoryItems = announcementQueue
        .map((announcementItem) => {
          return {
            roundNumber: announcementItem.round,
            teamName: announcementItem.teamName,
            playerName: announcementItem.playerName,
            createdAt: now,
            roundKey: announcementItem.roundKey,
          };
        })
        .filter((historyItem) => {
          const identity = getHistoryIdentity(historyItem);

          if (historyIdentities.has(identity)) {
            return false;
          }

          historyIdentities.add(identity);
          return true;
        });
      const nextHistory = latestHistory.concat(announcedHistoryItems);

      transaction.update(currentRoomRef, {
        history: nextHistory.map((historyItem) => {
          return toFirestoreHistoryItem(historyItem);
        }),
        currentAnnouncementIndex: announcementQueue.length - 1,
        currentRound: announcementQueue[0].round,
        currentTeamName: announcementQueue[announcementQueue.length - 1].teamName,
        currentPlayerName: announcementQueue[announcementQueue.length - 1].playerName,
        phase: "roundSummary",
        updatedAt: now,
      });
    });
  } catch (error) {
    console.error("次の発表への切り替えに失敗しました", error);
    message.textContent = "次の発表へ進めませんでした。もう一度お試しください。";
  } finally {
    nextAnnouncementButton.disabled = false;
  }
}

async function goToNextRound() {
  if (currentRoomId === "" || currentRoomRef === null) {
    message.textContent = "先にルームへ入室してください";
    return;
  }

  nextRoundButton.disabled = true;

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnapshot = await transaction.get(currentRoomRef);
      const now = getNowISOString();

      if (roomSnapshot.exists()) {
        transaction.update(currentRoomRef, {
          pendingPicks: {},
          announcementQueue: [],
          currentAnnouncementIndex: 0,
          currentPlayerName: "",
          phase: "drafting",
          updatedAt: now,
        });
      } else {
        transaction.set(currentRoomRef, createInitialRoomData(currentRoomId, currentTeamName));
      }
    });
  } catch (error) {
    console.error("次の巡目への切り替えに失敗しました", error);
    message.textContent = "次の巡目へ進めませんでした。もう一度お試しください。";
  } finally {
    nextRoundButton.disabled = false;
  }
}

joinRoomButton.addEventListener("click", joinRoom);

announceButton.addEventListener("click", announcePlayer);

resetButton.addEventListener("click", resetDraftHistory);

announceReadyButton.addEventListener("click", startAnnouncement);

nextAnnouncementButton.addEventListener("click", showNextAnnouncement);

nextRoundButton.addEventListener("click", goToNextRound);

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

overallHistoryTab.addEventListener("click", () => {
  showHistoryView("overall");
});

playerHistoryTab.addEventListener("click", () => {
  showHistoryView("player");
});

initializeFirebase();
loadDraftData();
