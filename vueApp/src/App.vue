<template>
  <div class="container">
    <h1>Meeting Room: room001</h1>
    <div v-if="!joined">
      <button @click="joinRoom" :disabled="joining">Join Room</button>
    </div>
    <div v-else>
      <div class="video-grid">
        <div>
          <h3>Local Video</h3>
          <video ref="localVideo" autoplay muted></video>
        </div>
        <div v-for="(stream, peerId) in remoteStreams" :key="peerId">
          <h3>Peer {{ peerId }}</h3>
          <video :ref="(el) => setRemoteVideo(peerId, el)" autoplay></video>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { Device } from "mediasoup-client";
import io from "socket.io-client";

const socket = io("http://localhost:3000");
const device = ref(null);
const localVideo = ref(null);
const joined = ref(false);
const joining = ref(false);
const remoteStreams = ref({});
const remoteVideos = ref({});

const setRemoteVideo = (peerId, el) => {
  if (el && !remoteVideos.value[peerId]) {
    remoteVideos.value[peerId] = el;
    if (remoteStreams.value[peerId]) {
      el.srcObject = remoteStreams.value[peerId];
    }
  }
};

async function joinRoom() {
  joining.value = true;
  try {
    // Get user media
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.value.srcObject = stream;

    // Initialize MediaSoup device
    device.value = new Device();
    const routerRtpCapabilities = await new Promise((resolve) => {
      socket.emit("getRouterRtpCapabilities", resolve);
    });
    await device.value.load({ routerRtpCapabilities });

    // Create producer transport
    const producerTransportData = await new Promise((resolve) => {
      socket.emit("createTransport", { direction: "producer" }, resolve);
    });
    const producerTransport = device.value.createSendTransport(producerTransportData);

    producerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      socket.emit(
        "connectTransport",
        {
          transportId: producerTransportData.id,
          dtlsParameters,
          direction: "producer",
        },
        (response) => {
          if (response.error) {
            errback(response.error);
          } else {
            callback();
          }
        }
      );
    });

    producerTransport.on("produce", async ({ kind, rtpParameters }, callback) => {
      socket.emit(
        "produce",
        {
          kind,
          rtpParameters,
          transportId: producerTransportData.id,
        },
        ({ id }) => callback({ id })
      );
    });

    // Produce audio and video
    for (const track of stream.getTracks()) {
      await producerTransport.produce({ track });
    }

    // Create consumer transport
    const consumerTransportData = await new Promise((resolve) => {
      socket.emit("createTransport", { direction: "consumer" }, resolve);
    });
    const consumerTransport = device.value.createRecvTransport(consumerTransportData);

    consumerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      socket.emit(
        "connectTransport",
        {
          transportId: consumerTransportData.id,
          dtlsParameters,
          direction: "consumer",
        },
        (response) => {
          if (response.error) {
            errback(response.error);
          } else {
            callback();
          }
        }
      );
    });

    joined.value = true;
  } catch (error) {
    console.error("Error joining room:", error);
  }
  joining.value = false;
}

// Handle new producer
socket.on("newProducer", async ({ producerId, kind, socketId }) => {
  if (!joined.value) return;

  const consumerData = await new Promise((resolve) => {
    socket.emit(
      "consume",
      {
        rtpCapabilities: device.value.rtpCapabilities,
        producerId,
        socketId,
      },
      resolve
    );
  });

  if (consumerData.error) {
    console.error("Cannot consume:", consumerData.error);
    return;
  }

  const consumerTransport = device.value._recvTransports[0];
  const consumer = await consumerTransport.consume({
    id: consumerData.id,
    producerId: consumerData.producerId,
    kind: consumerData.kind,
    rtpParameters: consumerData.rtpParameters,
  });

  const stream = new MediaStream([consumer.track]);
  remoteStreams.value[socketId] = stream;
  if (remoteVideos.value[socketId]) {
    remoteVideos.value[socketId].srcObject = stream;
  }

  socket.emit("resumeConsumer", { consumerId: consumer.id });
});

// Handle peer disconnect
socket.on("peerDisconnected", (peerId) => {
  delete remoteStreams.value[peerId];
  delete remoteVideos.value[peerId];
  remoteStreams.value = { ...remoteStreams.value };
});

onMounted(() => {
  socket.connect();
});

onUnmounted(() => {
  socket.disconnect();
});
</script>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}
video {
  width: 100%;
  max-width: 300px;
  border: 1px solid #ccc;
}
button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
