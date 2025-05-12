const WebSocket = require("ws");

const PORT = process.env.PORT || 3001;
const server = new WebSocket.Server({ port: PORT });
const rooms = {};

console.log(`✅ WebRTC Signaling Server running on ws://localhost:${PORT}`);

server.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (origin !== "https://seenmeet.vercel.app") {
    ws.close(1008, "Unauthorized origin");
    console.warn(`🚫 Connection rejected from unauthorized origin: ${origin}`);
    return;
  }

  console.log("🔗 New WebSocket connection established from", origin);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (!data.type || !data.room) return;

      const { type, room, user, to } = data;

      if (!rooms[room]) rooms[room] = [];

      switch (type) {
        case "join":
          ws.room = room;
          ws.user = user || `User-${Math.floor(Math.random() * 1000)}`;
          rooms[room].push(ws);
          console.log(`👤 ${ws.user} joined room "${room}". Total: ${rooms[room].length}`);

          // Send to joining user the list of existing users
          const existingUsers = rooms[room]
            .filter(client => client !== ws && client.readyState === WebSocket.OPEN)
            .map(client => client.user);

          existingUsers.forEach(u => {
            ws.send(JSON.stringify({ type: "new-user", user: u }));
          });

          // Notify others about the new user
          broadcast(ws, room, { type: "new-user", user: ws.user });
          break;

        case "offer":
        case "answer":
        case "candidate":
          if (!to) {
            console.warn(`⚠️ No target user (to) provided for ${type}`);
            return;
          }
          sendToUser(room, to, { ...data });
          break;

        case "chat":
          broadcast(ws, room, { type: "chat", user: ws.user, text: data.text, room });
          break;

        case "leave":
          removeUserFromRoom(ws);
          break;

        default:
          console.warn(`⚠️ Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error("❌ Error processing message:", error);
    }
  });

  ws.on("close", () => {
    removeUserFromRoom(ws);
  });

  ws.on("error", (error) => {
    console.error("⚠️ WebSocket error:", error);
  });
});

// ✅ إرسال رسالة إلى مستخدم محدد في نفس الغرفة
function sendToUser(room, targetUser, data) {
  const clients = rooms[room] || [];
  const target = clients.find(client => client.user === targetUser);
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify(data));
    console.log(`📤 Sent ${data.type} to ${targetUser}`);
  } else {
    console.warn(`⚠️ Target user ${targetUser} not found or not connected`);
  }
}

// ✅ إرسال رسالة لجميع الموجودين في الغرفة باستثناء المرسل
function broadcast(sender, room, data) {
  const clients = rooms[room] || [];
  clients.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ✅ إزالة المستخدم من الغرفة عند الخروج أو انقطاع الاتصال
function removeUserFromRoom(ws) {
  if (!ws.room || !rooms[ws.room]) return;

  rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
  console.log(`🔴 ${ws.user} left room "${ws.room}". Remaining: ${rooms[ws.room].length}`);

  broadcast(ws, ws.room, { type: "user-left", user: ws.user });

  if (rooms[ws.room].length === 0) {
    delete rooms[ws.room];
  }
}

server.on("listening", () => {
  console.log(`✅ WebSocket Server is running on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("❌ WebSocket Server Error:", err);
});
