const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// MediaSoup configuration
let worker;
let router;
let producerTransports = {};
let consumerTransports = {};
let producers = {};
let consumers = {};

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

async function startMediasoup() {
  worker = await mediasoup.createWorker({
    logLevel: "warn",
  });

  worker.on("died", () => {
    console.error("MediaSoup worker died, exiting...");
    process.exit(1);
  });

  router = await worker.createRouter({ mediaCodecs });
  console.log("MediaSoup router created");
}

startMediasoup();

app.use(express.static("public"));

io.on("connection", async (socket) => {
  console.log("New client connected:", socket.id);

  // Send router RTP capabilities to client
  socket.on("getRouterRtpCapabilities", (callback) => {
    callback(router.rtpCapabilities);
  });

  // Create WebRTC transport
  socket.on("createTransport", async ({ direction }, callback) => {
    const transportOptions = {
      listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await router.createWebRtcTransport(transportOptions);
    if (direction === "producer") {
      producerTransports[socket.id] = transport;
    } else {
      consumerTransports[socket.id] = transport;
    }

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "connected") {
        console.log(`${direction} transport connected for ${socket.id}`);
      }
    });
  });

  // Connect transport
  socket.on(
    "connectTransport",
    async ({ transportId, dtlsParameters, direction }, callback) => {
      const transport =
        direction === "producer"
          ? producerTransports[socket.id]
          : consumerTransports[socket.id];

      if (!transport) {
        callback({ error: "Transport not found" });
        return;
      }

      await transport.connect({ dtlsParameters });
      callback({});
    }
  );

  // Produce media
  socket.on(
    " produce",
    async ({ kind, rtpParameters, transportId }, callback) => {
      const transport = producerTransports[socket.id];
      if (!transport) {
        callback({ error: "Transport not found" });
        return;
      }

      const producer = await transport.produce({ kind, rtpParameters });
      producers[socket.id] = producers[socket.id] || {};
      producers[socket.id][kind] = producer;

      producer.on("transportclose", () => {
        console.log(`Producer closed for ${kind}`);
        producer.close();
      });

      // Notify other clients about new producer
      socket.broadcast.emit("newProducer", {
        producerId: producer.id,
        kind,
        socketId: socket.id,
      });

      callback({ id: producer.id });
    }
  );

  // Consume media
  socket.on(
    "consume",
    async ({ rtpCapabilities, producerId, socketId }, callback) => {
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        callback({ error: "Cannot consume" });
        return;
      }

      const transport = consumerTransports[socket.id];
      if (!transport) {
        callback({ error: "Transport not found" });
        return;
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      consumers[socket.id] = consumers[socket.id] || {};
      consumers[socket.id][producerId] = consumer;

      consumer.on("transportclose", () => {
        console.log("Consumer closed");
        consumer.close();
      });

      callback({
        producerId,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
      });
    }
  );

  // Resume consumer
  socket.on("resumeConsumer", async ({ consumerId }, callback) => {
    const consumer = Object.values(consumers[socket.id] || {}).find(
      (c) => c.id === consumerId
    );
    if (consumer) {
      await consumer.resume();
      callback({});
    } else {
      callback({ error: "Consumer not found" });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (producerTransports[socket.id]) {
      producerTransports[socket.id].close();
      delete producerTransports[socket.id];
    }
    if (consumerTransports[socket.id]) {
      consumerTransports[socket.id].close();
      delete consumerTransports[socket.id];
    }
    if (producers[socket.id]) {
      Object.values(producers[socket.id]).forEach((p) => p.close());
      delete producers[socket.id];
    }
    if (consumers[socket.id]) {
      Object.values(consumers[socket.id]).forEach((c) => c.close());
      delete consumers[socket.id];
    }
    socket.broadcast.emit("peerDisconnected", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
