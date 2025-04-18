const express = require("express");
// const http = require("http");
const fs = require("fs");
const https = require("https");
const socketIO = require("socket.io");
const mediasoupManager = require("./mediasoupManager");

const app = express();
// const server = http.createServer(app);
const server = https.createServer(
  {
    key: fs.readFileSync("../certs/key.pem"),
    cert: fs.readFileSync("../certs/cert.pem"),
  },
  app
);
const io = socketIO(server, { cors: { origin: "*" } });

let room = null;

io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  if (!room) {
    room = await mediasoupManager.createRoom();
  }

  socket.emit("routerRtpCapabilities", room.router.rtpCapabilities);

  socket.on("createWebRtcTransport", async (_, callback) => {
    const transport = await mediasoupManager.createWebRtcTransport(room.router);
    mediasoupManager.addTransport(socket.id, transport);
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });
  });

  socket.on("connectTransport", async ({ dtlsParameters }) => {
    await mediasoupManager.connectTransport(socket.id, dtlsParameters);
  });

  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    const producer = await mediasoupManager.createProducer(
      socket.id,
      kind,
      rtpParameters
    );
    callback({ id: producer.id });
  });

  socket.on("consume", async ({ rtpCapabilities }, callback) => {
    const consumer = await mediasoupManager.createConsumer(
      socket.id,
      rtpCapabilities
    );
    callback({
      producerId: consumer.producerId,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  });

  socket.on("disconnect", () => {
    mediasoupManager.removeClient(socket.id);
  });
});

server.listen(3000, () =>
  console.log("Server running on https://0.0.0.0:3000")
);
