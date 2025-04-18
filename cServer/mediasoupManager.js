const mediasoup = require("mediasoup");

let worker;
const transports = {};
const producers = {};
const consumers = {};
let router;

async function createRoom() {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
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
      },
    ],
  });
  return { router };
}

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "127.0.0.1", announcedIp: null }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  return transport;
}

function addTransport(clientId, transport) {
  transports[clientId] = transport;
}

async function connectTransport(clientId, dtlsParameters) {
  await transports[clientId].connect({ dtlsParameters });
}

async function createProducer(clientId, kind, rtpParameters) {
  const producer = await transports[clientId].produce({ kind, rtpParameters });
  producers[clientId] = producer;
  return producer;
}

async function createConsumer(clientId, rtpCapabilities) {
  const producer = Object.values(producers).find((p) =>
    router.canConsume({ producerId: p.id, rtpCapabilities })
  );
  if (!producer) throw new Error("No producer available");
  const consumer = await transports[clientId].consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: false,
  });
  consumers[clientId] = consumer;
  return consumer;
}

function removeClient(clientId) {
  transports[clientId]?.close();
  producers[clientId]?.close();
  consumers[clientId]?.close();
  delete transports[clientId];
  delete producers[clientId];
  delete consumers[clientId];
}

module.exports = {
  createRoom,
  createWebRtcTransport,
  addTransport,
  connectTransport,
  createProducer,
  createConsumer,
  removeClient,
};
