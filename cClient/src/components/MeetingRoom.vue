<template>
  <div>
    <h1 class="text-xl font-bold mb-4">Room001 Video Call</h1>
    <video ref="localVideo" autoplay muted class="w-1/2"></video>
    <video ref="remoteVideo" autoplay class="w-1/2"></video>
    <button @click="start" class="mt-4 bg-blue-600 text-white p-2 rounded">Join</button>
  </div>
</template>

<script setup>
import { ref } from "vue";
import io from "socket.io-client";

const localVideo = ref(null);
const remoteVideo = ref(null);

const socket = io("http://localhost:3000");
let device, sendTransport, recvTransport, producer;

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.value.srcObject = stream;

  const mediasoupClient = await import("mediasoup-client");
  const rtpCapabilities = await new Promise((resolve) => {
    socket.on("routerRtpCapabilities", resolve);
  });

  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities });

  const { params: sendParams } = await new Promise((resolve) => {
    socket.emit("createWebRtcTransport", null, resolve);
  });

  sendTransport = device.createSendTransport(sendParams);

  sendTransport.on("connect", ({ dtlsParameters }, callback) => {
    socket.emit("connectTransport", { dtlsParameters });
    callback();
  });

  sendTransport.on("produce", ({ kind, rtpParameters }, callback) => {
    socket.emit("produce", { kind, rtpParameters }, ({ id }) => {
      callback({ id });
    });
  });

  const track = stream.getVideoTracks()[0];
  producer = await sendTransport.produce({ track });

  const { params: recvParams } = await new Promise((resolve) => {
    socket.emit("createWebRtcTransport", null, resolve);
  });

  recvTransport = device.createRecvTransport(recvParams);

  recvTransport.on("connect", ({ dtlsParameters }, callback) => {
    socket.emit("connectTransport", { dtlsParameters });
    callback();
  });

  socket.emit("consume", { rtpCapabilities: device.rtpCapabilities }, async (data) => {
    const consumer = await recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });

    const remoteStream = new MediaStream();
    remoteStream.addTrack(consumer.track);
    remoteVideo.value.srcObject = remoteStream;
  });
}
</script>
