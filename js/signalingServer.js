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

      if (!rooms[data.room]) rooms[data.room] = [];

      console.log(`📩 Received message of type "${data.type}" in room "${data.room}" from ${ws.user || 'unknown'}`);

      switch (data.type) {
        case "join":
          rooms[data.room].push(ws);
          ws.room = data.room;
          ws.user = data.user || `User-${Math.floor(Math.random() * 1000)}`;
          console.log(`👤 ${ws.user} joined room "${ws.room}". Total participants: ${rooms[ws.room].length}`);

          // ✅ Assign role to client based on join order
          const role = rooms[data.room].length === 1 ? "wait" : "offer";
          ws.send(JSON.stringify({ type: "room-role", role }));

          const existingUsers = rooms[data.room]
            .filter(client => client !== ws && client.readyState === WebSocket.OPEN)
            .map(client => client.user);

          existingUsers.forEach(user => {
            ws.send(JSON.stringify({ type: "new-user", user }));
          });

          broadcast(ws, data.room, { type: "new-user", user: ws.user });
          break;

        case "offer":
          console.log(`📢 Broadcasting offer from ${ws.user} in room "${data.room}"`);
          broadcast(ws, data.room, { type: "offer", offer: data.offer, user: ws.user, room: data.room });
          break;

        case "answer":
          console.log(`📢 Broadcasting answer from ${ws.user} in room "${data.room}"`);
          broadcast(ws, data.room, { type: "answer", answer: data.answer, user: ws.user, room: data.room });
          break;

        case "candidate":
          console.log(`📢 Broadcasting candidate from ${ws.user} in room "${data.room}"`);
          broadcast(ws, data.room, { type: "candidate", candidate: data.candidate, user: ws.user, room: data.room });
          break;

        case "chat":
          console.log(`📢 Broadcasting chat message from ${ws.user} in room "${data.room}"`);
          broadcast(ws, data.room, { type: "chat", user: ws.user, text: data.text, room: data.room });
          break;

        case "leave":
          removeUserFromRoom(ws);
          break;

        default:
          console.warn(`⚠️ Unknown message type: ${data.type}`);
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

  function broadcast(sender, room, data) {
    const clients = rooms[room] || [];
    console.log(`📢 Broadcasting to ${clients.length - 1} clients in room "${room}"`);
    clients.forEach(client => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  function removeUserFromRoom(ws) {
    if (!ws.room || !rooms[ws.room]) return;

    rooms[ws.room] = rooms[ws.room].filter(client => client !== ws);
    console.log(`🔴 ${ws.user} left room "${ws.room}". Remaining: ${rooms[ws.room].length}`);

    broadcast(ws, ws.room, { type: "user-left", user: ws.user });

    if (rooms[ws.room].length === 0) {
      delete rooms[ws.room];
    }
  }
});

server.on("listening", () => {
  console.log(`✅ WebSocket Server is running on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("❌ WebSocket Server Error:", err);
});
