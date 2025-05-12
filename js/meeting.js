const queryParams = getQueryParams();
const room = queryParams.room;
const name = queryParams.name;
let isMuted = false;
let isVideoOff = false;

const localVideo = document.getElementById("large-video");
const videoGrid = document.getElementById("video-grid");
const chatMessages = document.getElementById("chat-messages");
const chatInputField = document.getElementById("chat-input-field");
const participantsList = document.getElementById("participants-list");

const SIGNALING_SERVER_URL = window.location.hostname === "localhost"
  ? "ws://localhost:3001"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://video-conference-project-production-65d5.up.railway.app`;

console.log("🔗 Connecting to signaling server at", SIGNALING_SERVER_URL);
const ws = new WebSocket(SIGNALING_SERVER_URL);

const peers = {};
let localStream;

document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("meeting-id-display")) document.getElementById("meeting-id-display").textContent = `#${room}`;
  if (document.getElementById("user-name-display")) document.getElementById("user-name-display").textContent = name;
  await startCamera();
});

async function startCamera() {
  console.log("🎥 Attempting to access camera and microphone...");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log("✅ Local media stream acquired", localStream);
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    await localVideo.play();
  } catch (error) {
    console.error("❌ Failed to access media devices:", error);
    alert("Please allow access to camera and microphone.");
  }
}

ws.onopen = () => {
  console.log("✅ WebSocket connected");
  ws.send(JSON.stringify({ type: "join", room, user: name }));
  addParticipant(name);
};

ws.onmessage = async (message) => {
  const data = JSON.parse(message.data);
  console.log("📩 WebSocket message received:", data);

  if (!data.type) return;

  switch (data.type) {
    case "new-user":
      if (data.user !== name) {
        console.log(`✨ New user joined: ${data.user}`);
        addParticipant(data.user);

        if (name < data.user) {
          console.log(`📞 I (${name}) will initiate offer to ${data.user}`);
          await createOffer(data.user);
        } else {
          console.log(`⏳ I (${name}) will wait for offer from ${data.user} and will NOT create offer.`);
        }
      }
      break;

    case "offer":
      if (data.to === name) {
        console.log(`📨 Offer received from ${data.user}`);
        await createAnswer(data.offer, data.user);
      }
      break;

    case "answer":
      if (data.to === name) {
        console.log(`📬 Answer received from ${data.user}`);
        if (peers[data.user]) {
          await peers[data.user].setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      }
      break;

    case "candidate":
      if (data.to === name && peers[data.user]) {
        console.log(`🧊 ICE candidate received from ${data.user}`);
        await peers[data.user].addIceCandidate(new RTCIceCandidate(data.candidate));
      }
      break;

    case "user-left":
      removeVideoStream(data.user);
      removeParticipant(data.user);
      break;

    case "chat":
      displayMessage({ user: data.user, text: data.text, own: data.user === name });
      break;

    default:
      console.warn(`⚠️ Unknown message type: ${data.type}`);
  }
};

async function createPeer(user) {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "candidate",
        candidate: event.candidate,
        room,
        user: name,
        to: user
      }));
    }
  };

  peer.ontrack = (event) => {
    console.log(`🎥 Received track event for ${user}`, event);
    console.log(`🎥 Event streams:`, event.streams);
    if (event.streams && event.streams[0]) {
      console.log(`✅ Stream received from ${user}:`, event.streams[0]);
      addVideoStream(event.streams[0], user);
    } else {
      console.warn(`⚠️ No streams received from ${user}`);
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      console.log(`➕ Adding track ${track.kind} for ${user}`);
      peer.addTrack(track, localStream);
    });
  } else {
    console.warn(`⚠️ No local stream to add for ${user}`);
  }

  peers[user] = peer;
  return peer;
}

async function createOffer(user) {
  const peer = await createPeer(user);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", offer, room, user: name, to: user }));
}

async function createAnswer(offer, user) {
  const peer = await createPeer(user);
  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: "answer", answer, room, user: name, to: user }));
}

function addVideoStream(stream, user) {
  if (document.querySelector(`video[data-user="${user}"]`)) return;
  console.log(`➕ Adding video stream for ${user}`);

  const container = document.createElement("div");
  container.classList.add("video-container");
  container.setAttribute("data-user-container", user);

  const videoEl = document.createElement("video");
  videoEl.setAttribute("data-user", user);
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.srcObject = stream;

  const nameTag = document.createElement("p");
  nameTag.textContent = user;

  container.appendChild(videoEl);
  container.appendChild(nameTag);
  videoGrid.appendChild(container);

  // ✅ إجبار تشغيل الفيديو عند التحميل
  videoEl.onloadedmetadata = () => {
    videoEl.play().then(() => {
      console.log(`▶️ Video started for ${user}`);
    }).catch(err => {
      console.error(`❌ Failed to play remote video for ${user}:`, err);
    });
  };
}

function removeVideoStream(user) {
  const container = document.querySelector(`div[data-user-container="${user}"]`);
  if (container) container.remove();
  if (peers[user]) {
    peers[user].close();
    delete peers[user];
  }
}

function addParticipant(user) {
  if (!document.getElementById(`participant-${user}`)) {
    const p = document.createElement("p");
    p.textContent = user;
    p.id = `participant-${user}`;
    participantsList.appendChild(p);
  }
}

function removeParticipant(user) {
  const p = document.getElementById(`participant-${user}`);
  if (p) p.remove();
}

function sendMessage() {
  const msg = chatInputField.value.trim();
  if (!msg) return;
  ws.send(JSON.stringify({ type: "chat", user: name, text: msg, room }));
  displayMessage({ user: name, text: msg, own: true });
  chatInputField.value = "";
}

function displayMessage({ user, text, own }) {
  const el = document.createElement("p");
  el.innerHTML = `<strong>${user}:</strong> ${text}`;
  if (own) el.classList.add("own-message");
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function toggleMute() {
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length) {
    isMuted = !isMuted;
    audioTracks[0].enabled = !isMuted;
    document.getElementById("mute-btn")?.classList.toggle("active", isMuted);
  }
}

function toggleVideo() {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length) {
    isVideoOff = !isVideoOff;
    videoTracks[0].enabled = !isVideoOff;
    document.getElementById("video-btn")?.classList.toggle("active", isVideoOff);
  }
}

function leaveMeeting() {
  if (!confirm("Are you sure you want to leave the meeting?")) return;
  localStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(p => p.close());
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave", room, user: name }));
    ws.close();
  }
  window.location.href = "dashboard.html";
}

function getQueryParams() {
  const params = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}
