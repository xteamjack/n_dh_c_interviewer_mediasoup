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
          <video ref="localVideo" autoplay muted playsinline></video>
        </div>
        <div v-for="(stream, peerId) in remoteStreams" :key="peerId">
          <h3>Peer {{ peerId }}</h3>
          <video :ref="(el) => setRemoteVideo(peerId, el)" autoplay playsinline></video>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from "vue";
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
      console.log("Setting remote stream for", peerId);
      el.srcObject = remoteStreams.value[peerId];
      el.play().catch((e) => console.error("Remote video play failed:", e));
    }
  }
};

async function joinRoom() {
  joining.value = true;
  try {
    // Get user media (video only for testing)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    console.log(
      "Local stream tracks:",
      stream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState,
        id: t.id,
      }))
    );

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
    const producerTransport = device.value.createSendTransport({
      ...producerTransportData,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    producerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      console.log("Producer transport connect:", dtlsParameters);
      socket.emit(
        "connectTransport",
        {
          transportId: producerTransportData.id,
          dtlsParameters,
          direction: "producer",
        },
        (response) => {
          console.log("Producer connect response:", response);
          if (response.error) {
            errback(new Error(response.error));
          } else {
            callback();
          }
        }
      );
    });

    producerTransport.on("connectionstatechange", (state) => {
      console.log("Producer transport state:", state);
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

    // Produce tracks with validation
    const tracks = stream.getTracks().map((track) => {
      const newStream = new MediaStream([track]);
      return newStream.getTracks().find((t) => t.kind === track.kind);
    });
    for (const track of tracks) {
      console.log(
        `Producing track: ${track.kind}, id: ${track.id}, readyState: ${
          track.readyState
        }, enabled: ${track.enabled}, instanceof MediaStreamTrack: ${
          track instanceof MediaStreamTrack
        }`
      );
      try {
        structuredClone(track);
        console.log(`Track ${track.kind} is serializable`);
      } catch (error) {
        console.error(`Track ${track.kind} serialization test failed:`, error);
      }
      if (
        track.readyState === "live" &&
        track.enabled &&
        track instanceof MediaStreamTrack
      ) {
        try {
          const producer = await producerTransport.produce({ track });
          console.log(
            `Successfully produced ${track.kind} track, producer ID: ${producer.id}`
          );
        } catch (error) {
          console.error(`Failed to produce ${track.kind} track:`, error);
        }
      } else {
        console.warn(
          `Skipping invalid track: ${track.kind}, readyState: ${track.readyState}, enabled: ${track.enabled}`
        );
      }
    }

    // Create consumer transport
    const consumerTransportData = await new Promise((resolve) => {
      socket.emit("createTransport", { direction: "consumer" }, resolve);
    });
    const consumerTransport = device.value.createRecvTransport({
      ...consumerTransportData,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    consumerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      console.log("Consumer transport connect:", dtlsParameters);
      socket.emit(
        "connectTransport",
        {
          transportId: consumerTransportData.id,
          dtlsParameters,
          direction: "consumer",
        },
        (response) => {
          console.log("Consumer connect response:", response);
          if (response.error) {
            errback(new Error(response.error));
          } else {
            callback();
          }
        }
      );
    });

    // Set joined to true and assign stream
    joined.value = true;
    await nextTick();
    if (localVideo.value) {
      console.log("Assigning stream to localVideo");
      localVideo.value.srcObject = stream;
      localVideo.value.play().catch((e) => console.error("Local video play failed:", e));
    } else {
      console.error("localVideo ref is null after join");
    }
  } catch (error) {
    console.error("Error joining room:", error);
  } finally {
    joining.value = false;
  }
}

socket.on("newProducer", async ({ producerId, kind, socketId }) => {
  if (!joined.value) return;
  console.log("Received newProducer:", { producerId, kind, socketId });

  const consumerData = await new Promise((resolve) => {
    socket.emit(
      "consume",
      {
        rtpCapabilities: device.value.rtpCapabilities,
        producerId,
        socketId,
      },
      (response) => {
        console.log("Consume response:", response);
        resolve(response);
      }
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
  console.log("Adding remote stream for", socketId, stream);
  remoteStreams.value[socketId] = stream;
  remoteStreams.value = { ...remoteStreams.value };
  if (remoteVideos.value[socketId]) {
    remoteVideos.value[socketId].srcObject = stream;
    remoteVideos.value[socketId]
      .play()
      .catch((e) => console.error("Remote play failed:", e));
  }

  socket.emit("resumeConsumer", { consumerId: consumer.id }, (response) => {
    console.log("Resume consumer response:", response);
  });
});

socket.on("peerDisconnected", (peerId) => {
  console.log("Peer disconnected:", peerId);
  delete remoteStreams.value[peerId];
  delete remoteVideos.value[peerId];
  remoteStreams.value = { ...remoteStreams.value };
});

onMounted(() => {
  socket.connect();
  socket.on("connect", () => console.log("Socket connected:", socket.id));
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
