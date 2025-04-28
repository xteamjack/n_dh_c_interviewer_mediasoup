import express from "express";
import https from "httpolyglot";
import fs from "fs";
import path from "path";
import { Server } from "socket.io";
import mediasoup from "mediasoup";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import createWebRtcTransport from './mediaSoup/createWebRtcTransport.js';
import dgram from 'dgram';
import net from 'net';
import * as os from 'os';
import log from './utils/logger.js';
import routes from './routes.js';
import checkFFmpeg from './utils/checkFFmpeg.js';
import verifyEnvironment from './utils/verifyEnvironment.js';

// Create Express app
const app = express();

// Add middleware
app.use(express.json());
app.use(express.static('public'));

const __dirname = path.resolve();
const recordingsPath = path.join(__dirname, "recordings");

// Ensure recordings directory exists with logging
if (!fs.existsSync(recordingsPath)) {
  try {
    fs.mkdirSync(recordingsPath, { recursive: true });
    log.info(`Created recordings directory at: ${recordingsPath}`);
  } catch (error) {
    log.error(`Failed to create recordings directory: ${error.message}`);
  }
}

// Test file writing to verify permissions
try {
  const testFilePath = path.join(recordingsPath, `test-file-${Date.now()}.txt`);
  fs.writeFileSync(testFilePath, 'This is a test file to verify write permissions');
  log.info(`✅ Successfully wrote test file to: ${testFilePath}`);
  
  // Read the file back to verify read permissions
  const content = fs.readFileSync(testFilePath, 'utf8');
  log.info(`✅ Successfully read test file with content length: ${content.length}`);
  
  // Clean up the test file
  // fs.unlinkSync(testFilePath);
  // log.info(`✅ Successfully deleted test file`);
} catch (error) {
  log.error(`❌ File system permission test failed: ${error.message}`);
  log.error(`Current working directory: ${process.cwd()}`);
  log.error(`Recordings path: ${recordingsPath}`);
  log.error(`User running process: ${process.env.USER || process.env.USERNAME}`);
}

const checkNetworkConnectivity = () => {
  try {
    // Create a simple UDP server and client to test local UDP connectivity
    const server = dgram.createSocket('udp4');
    const client = dgram.createSocket('udp4');
    
    let testPassed = false;
    
    server.on('listening', () => {
      const port = server.address().port;
      log.info(`UDP test server listening on port ${port}`);
      
      // Send a test message
      client.send('UDP connectivity test', port, '127.0.0.1', (err) => {
        if (err) {
          log.error(`❌ Failed to send UDP test message: ${err.message}`);
        } else {
          log.debug(`UDP test message sent to port ${port}`);
        }
      });
      
      // Set a timeout in case we don't receive the message
      setTimeout(() => {
        if (!testPassed) {
          log.error('❌ UDP connectivity test failed: timeout waiting for message');
          server.close();
          client.close();
        }
      }, 5000);
    });
    
    server.on('message', (msg, rinfo) => {
      log.info(`✅ UDP connectivity test passed: received message from ${rinfo.address}:${rinfo.port}`);
      testPassed = true;
      server.close();
      client.close();
    });
    
    server.on('error', (err) => {
      log.error(`❌ UDP server error: ${err.message}`);
      client.close();
    });
    
    client.on('error', (err) => {
      log.error(`❌ UDP client error: ${err.message}`);
      server.close();
    });
    
    server.bind();
  } catch (error) {
    log.error(`❌ Network connectivity test failed: ${error.message}`);
  }
};

// Call this function at server startup
checkNetworkConnectivity();

const startRecording = async (producer, roomName, socketId) => {
  try {
    // Ensure roomName is valid
    if (!roomName || roomName === 'undefined') {
      roomName = 'default-room';
      log.warn(`Invalid room name detected, using '${roomName}' instead`);
    }
    
    log.info(
      `🎬 Starting recording for room: ${roomName}, socketId: ${socketId}`
    );

    // Check if room exists, create it if not
    if (!rooms[roomName]) {
      log.warn(`Room ${roomName} not found, creating it now`);
      await createRoom(roomName, socketId);
    }

    // Log producer's rtpParameters for debugging
    log.info(
      "Producer rtpParameters:",
      JSON.stringify(producer.rtpParameters, null, 2)
    );

    const { codecs, encodings } = producer.rtpParameters;
    
    // Try to find VP8 first, then fall back to other video codecs
    let videoCodec = codecs.find(c => c.mimeType.toLowerCase() === "video/vp8");
    
    if (!videoCodec) {
      // Try H264 as fallback
      videoCodec = codecs.find(c => c.mimeType.toLowerCase() === "video/h264");
    }
    
    if (!videoCodec) {
      // Try any video codec as last resort
      videoCodec = codecs.find(c => c.mimeType.toLowerCase().startsWith("video/"));
    }
    
    if (!videoCodec) {
      log.error("❌ No video codec found in producer parameters");
      log.info("Available codecs:", JSON.stringify(codecs, null, 2));
      throw new Error("No video codec found");
    }

    log.info(`Using codec: ${videoCodec.mimeType}`);

    // Extract resolution and framerate from encodings or fmtp (if available)
    const encoding = encodings[0] || {};
    const fmtpParams = videoCodec.parameters || {};
    
    // Set explicit dimensions with fallbacks
    const width = encoding.maxWidth || 640;
    const height = encoding.maxHeight || 480;
    const framerate = encoding.maxFramerate || fmtpParams["max-fr"] || 30;

    log.info(`Using resolution: ${width}x${height}, framerate: ${framerate}`);

    if (!fs.existsSync(recordingsPath)) {
      fs.mkdirSync(recordingsPath, { recursive: true });
    }

    const filename = `${roomName}_${socketId}_${Date.now()}.webm`;
    const recordingPath = path.join(recordingsPath, filename);

    const router = rooms[roomName].router;

    // Find an available port with a wider range and more retries
    const availablePort = await findAvailablePort(10000, 59999);

    // Create PlainTransport with specific port and different IP settings
    const transport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" }, // Use loopback directly
      rtcpMux: true,
      comedia: true, // Enable comedia mode to handle NAT issues
      port: availablePort
    });

    log.debug(`📡 Created plain transport at port: ${transport.tuple.localPort}`);

    // Make sure to properly close any existing recording for this room
    if (roomRecordings[roomName]) {
      log.info(`Closing existing recording for room ${roomName}`);
      try {
        clearInterval(roomRecordings[roomName].monitorInterval);
        roomRecordings[roomName].ffmpeg.kill("SIGTERM");
        roomRecordings[roomName].transport.close();
        roomRecordings[roomName].consumer.close();
        delete roomRecordings[roomName];
      } catch (error) {
        log.error(`Error closing existing recording: ${error.message}`);
      }
    }

    // Create consumer for producer
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: true, // Pause initially
    });

    const { payloadType, clockRate, mimeType } =
      consumer.rtpParameters.codecs[0];
    const { ssrc } = consumer.rtpParameters.encodings[0];

    log.debug(
      `Consumer params: port=${transport.tuple.localPort}, payloadType=${payloadType}, clockRate=${clockRate}, mimeType=${mimeType}, ssrc=${ssrc}`
    );

    // Generate a unique SDP filename for each recording session
    const sdpFilename = `${roomName}_${socketId}_${Date.now()}.sdp`;
    const sdpPath = path.join(recordingsPath, sdpFilename);

    // Generate a more detailed SDP with explicit dimensions
    const sdpContent = `
v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFmpeg
c=IN IP4 127.0.0.1
t=0 0
m=video ${transport.tuple.localPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${mimeType.split("/")[1]}/${clockRate}
a=fmtp:${payloadType} max-fr=${framerate};max-fs=3600
a=sendonly
a=rtcp-mux
a=ssrc:${ssrc} cname:ffmpeg
a=width:${width}
a=height:${height}
`.trim();

    fs.writeFileSync(sdpPath, sdpContent);
    log.debug(`📝 SDP written to ${sdpPath}\n${sdpContent}`);

    // Test if SDP file is readable
    try {
      const readSdp = fs.readFileSync(sdpPath, 'utf8');
      log.debug(`✅ SDP file is readable, content length: ${readSdp.length}`);
    } catch (error) {
      log.error(`❌ Failed to read SDP file: ${error.message}`);
    }

    // More robust FFmpeg args with explicit encoding
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel",
      "debug",
      "-protocol_whitelist",
      "file,udp,rtp",
      "-analyzeduration",
      "30000000",
      "-probesize",
      "30000000",
      "-i",
      sdpPath,
      "-map",
      "0:v",
      "-c:v",
      "libvpx", // Use libvpx encoder instead of copy
      "-b:v",
      "1M",     // Set bitrate
      "-auto-alt-ref",
      "0",
      "-deadline",
      "realtime",
      "-an",
      recordingPath,
    ];

    log.debug("🚀 FFmpeg args:", ffmpegArgs.join(" "));

    // Check if FFmpeg is installed and accessible
    try {
      const ffmpegVersionOutput = spawn("ffmpeg", ["-version"]);
      ffmpegVersionOutput.stdout.on("data", (data) => {
        log.info(`FFmpeg version check: ${data.toString().split('\n')[0]}`);
      });
      ffmpegVersionOutput.stderr.on("data", (data) => {
        log.error(`FFmpeg version check error: ${data.toString()}`);
      });
    } catch (error) {
      log.error(`❌ FFmpeg check failed: ${error.message}`);
    }

    // Connect transport with explicit parameters
    await transport.connect({
      ip: "127.0.0.1",
      port: transport.tuple.localPort
    });
    log.debug("✅ Transport connected");

    // Start FFmpeg
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stdout.on("data", (data) => {
      log.debug(`FFmpeg stdout: ${data.toString().trim()}`);
    });

    ffmpeg.stderr.on("data", (data) => {
      const output = data.toString().trim();
      log.debug(`FFmpeg stderr: ${output}`);
      
      // Log specific FFmpeg errors or warnings that might indicate issues
      if (output.includes("Error") || output.includes("error") || 
          output.includes("Warning") || output.includes("warning")) {
        log.warn(`⚠️ FFmpeg issue detected: ${output}`);
      }
      
      // Log RTP packet reception
      if (output.includes("RTP Packet")) {
        log.debug(`📦 FFmpeg received RTP packet`);
      }
    });

    ffmpeg.on("error", (err) => {
      log.error("❌ FFmpeg process error:", err);
    });

    ffmpeg.on("exit", (code, signal) => {
      if (code === 0) {
        log.info(`✅ FFmpeg finished: ${recordingPath}`);
      } else {
        log.error(`❌ FFmpeg exited with code ${code}, signal ${signal}`);
      }
      if (fs.existsSync(sdpPath)) fs.unlinkSync(sdpPath);
    });

    // Add slight delay before resuming consumer to ensure FFmpeg is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await consumer.resume();
    log.debug("🎥 Consumer resumed");

    // Trace RTP packets for debugging
    consumer.observer.on("trace", (trace) => {
      if (trace.type === "rtp") {
        log.debug(`📦 RTP packet received: seq=${trace.info.sequenceNumber}`);
      }
    });

    // File monitoring
    const maxRetries = 20; // Increased to 40s
    let retryCount = 0;

    const monitorRecording = setInterval(() => {
      try {
        if (fs.existsSync(recordingPath)) {
          const stats = fs.statSync(recordingPath);
          if (stats.size > 0) {
            log.info(
              `📁 Recording file created: ${recordingPath}, size: ${stats.size} bytes`
            );
            clearInterval(monitorRecording);
          } else if (retryCount++ >= maxRetries) {
            log.error("❌ File empty after retries");
            clearInterval(monitorRecording);
          }
        } else if (retryCount++ >= maxRetries) {
          log.error("❌ Recording file not created after retries");
          clearInterval(monitorRecording);
        }
      } catch (err) {
        log.error("📉 Monitor error:", err.message);
      }
    }, 2000);

    return {
      transport,
      consumer,
      ffmpeg,
      path: recordingPath,
      sdpPath: sdpPath, // Add this line to store the SDP path
      monitorInterval: monitorRecording,
    };
  } catch (error) {
    log.error("❌ Error in startRecording:", error);
    throw error;
  }
};

// Apply routes
app.use(routes);

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync("./server/ssl/key.pem", "utf-8"),
  cert: fs.readFileSync("./server/ssl/cert.pem", "utf-8"),
};

const httpsServer = https.createServer(options, app);
httpsServer.listen(3000, () => {
  console.log("listening on port: " + 3000);
});

const io = new Server(httpsServer);

// socket.io namespace (could represent a room?)
const connections = io.of("/mediasoup");

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer
 **/
let worker;
let rooms = {}; // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}; // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []; // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []; // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []; // [ { socketId1, roomName1, consumer, }, ... ]
let roomRecordings = {}; // { roomName: { ffmpeg, transport, consumer, path, monitorInterval } }

// Import mediaCodecs from the config file
import { mediaCodecs, workerSettings } from './mediaSoup/config.js';

const createWorker = async () => {
  worker = await mediasoup.createWorker(workerSettings);
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    // This implies something serious happened, so kill the application
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

// We create a Worker as soon as our application starts
worker = createWorker();

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
connections.on("connection", async (socket) => {
  console.log(socket.id);
  socket.emit("connection-success", {
    socketId: socket.id,
  });

  const removeItems = (items, socketId, type) => {
    items.forEach((item) => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter((item) => item.socketId !== socket.id);

    return items;
  };

  socket.on("disconnect", () => {
    log.info(`Peer disconnected: ${socket.id}`);
    
    // Get room info before removing the peer
    const { roomName } = peers[socket.id];
    
    // Remove the peer and update room peers list
    delete peers[socket.id];
    if (rooms[roomName]) {
      rooms[roomName].peers = rooms[roomName].peers.filter(id => id !== socket.id);
      
      // If this was the last peer, stop the room recording
      if (rooms[roomName].peers.length === 0 && roomRecordings[roomName]) {
        log.info(`Last participant left room ${roomName}, stopping recording`);
        try {
          // Clean up recording resources
          clearInterval(roomRecordings[roomName].monitorInterval);
          roomRecordings[roomName].ffmpeg.stdin.end();
          roomRecordings[roomName].ffmpeg.kill("SIGTERM");
          
          // Make sure to close the transport and consumer
          if (roomRecordings[roomName].transport) {
            roomRecordings[roomName].transport.close();
          }
          if (roomRecordings[roomName].consumer) {
            roomRecordings[roomName].consumer.close();
          }
          
          log.info(`Recording stopped for room ${roomName}, file: ${roomRecordings[roomName].path}`);
          delete roomRecordings[roomName];
        } catch (error) {
          log.error(`Error stopping room recording: ${error.message}`);
        }
      }
    }
    
    // Stop any ongoing recordings
    if (peers[socket.id]?.recording) {
      log.info(`Stopping recording for peer ${socket.id}`);
      try {
        // Clear the monitoring interval
        if (peers[socket.id].recording.monitorInterval) {
          clearInterval(peers[socket.id].recording.monitorInterval);
        }

        // Gracefully close FFmpeg
        if (peers[socket.id].recording.ffmpeg) {
          peers[socket.id].recording.ffmpeg.stdin.end();
          peers[socket.id].recording.ffmpeg.kill("SIGTERM");
        }

        // Close transport and consumer
        if (peers[socket.id].recording.transport) {
          peers[socket.id].recording.transport.close();
        }
        if (peers[socket.id].recording.consumer) {
          peers[socket.id].recording.consumer.close();
        }

        log.info("Recording stopped successfully");

        // Check final file size
        const finalStats = fs.statSync(peers[socket.id].recording.path);
        log.info(`Final recording file size: ${finalStats.size} bytes`);
      } catch (error) {
        log.error(`Error stopping recording: ${error.message}`);
      }
    }

    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");

    // const { roomName } = peers[socket.id];
    delete peers[socket.id];

    // remove socket from room
    rooms[roomName] = {
      router: rooms[roomName].router,
      peers: rooms[roomName].peers.filter((socketId) => socketId !== socket.id),
    };
  });

  socket.on("joinRoom", async ({ roomName }, callback) => {
    const router1 = await createRoom(roomName, socket.id);
    
    peers[socket.id] = {
      socket,
      roomName,
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin: false,
      },
    };
    
    // Start recording if this is the first peer in the room
    if (rooms[roomName].peers.length === 1 && !roomRecordings[roomName]) {
      log.info(`First participant joined room ${roomName}, will start recording when video producer is created`);
      // We'll start the actual recording when the first video producer is created
      // with a small delay to ensure any previous resources are released
    }
    
    const rtpCapabilities = router1.rtpCapabilities;
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName, socketId) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1;
    let peers = [];
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      peers = rooms[roomName].peers || [];
    } else {
      router1 = await worker.createRouter({ mediaCodecs });
    }

    console.log(`Router ID: ${router1.id}`, peers.length);

    rooms[roomName] = {
      router: router1,
      peers: [...peers, socketId],
    };

    return router1;
  };

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    // get Room Name from Peer's properties
    const roomName = peers[socket.id].roomName;

    // get Router (Room) object this peer is in based on RoomName
    const router = rooms[roomName].router;

    createWebRtcTransport(router).then(
      (transport) => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });

        // add transport to Peer's properties
        addTransport(transport, roomName, consumer);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  const addTransport = (transport, roomName, consumer) => {
    transports = [
      ...transports,
      { socketId: socket.id, transport, roomName, consumer },
    ];

    peers[socket.id] = {
      ...peers[socket.id],
      transports: [...peers[socket.id].transports, transport.id],
    };
  };

  const addProducer = (producer, roomName) => {
    producers = [...producers, { socketId: socket.id, producer, roomName }];

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [...peers[socket.id].producers, producer.id],
    };
  };

  const addConsumer = (consumer, roomName) => {
    // add the consumer to the consumers list
    consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [...peers[socket.id].consumers, consumer.id],
    };
  };

  socket.on("getProducers", (callback) => {
    //return all producer transports
    const { roomName } = peers[socket.id];

    let producerList = [];
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socket.id &&
        producerData.roomName === roomName
      ) {
        producerList = [...producerList, producerData.producer.id];
      }
    });

    // return the producer list back to the client
    callback(producerList);
  });

  const informConsumers = (roomName, socketId, id) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        const producerSocket = peers[producerData.socketId].socket;
        // use socket to send producer id to producer
        producerSocket.emit("new-producer", { producerId: id });
      }
    });
  };

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(
      (transport) => transport.socketId === socketId && !transport.consumer
    );
    return producerTransport.transport;
  };

  // see client's socket.emit('transport-connect', ...)
  socket.on("transport-connect", ({ dtlsParameters }) => {
    console.log("DTLS PARAMS... ", { dtlsParameters });

    getTransport(socket.id).connect({ dtlsParameters });
  });

  // Add this function to create a test file with meeting parameters
  const createMeetingParametersTestFile = (roomName, socketId, producer) => {
    try {
      const testFilePath = path.join(recordingsPath, `meeting-params-${roomName}-${Date.now()}.json`);
      
      // Use the imported os module directly
      const params = {
        timestamp: new Date().toISOString(),
        roomName,
        socketId,
        producerId: producer?.id,
        rtpParameters: producer?.rtpParameters,
        routerRtpCapabilities: rooms[roomName]?.router?.rtpCapabilities,
        systemInfo: {
          platform: process.platform,
          nodeVersion: process.version,
          mediasoupVersion: mediasoup.version,
          hostname: os.hostname(),
          networkInterfaces: os.networkInterfaces(),
        }
      };
      
      // Write to file
      fs.writeFileSync(testFilePath, JSON.stringify(params, null, 2));
      log.info(`Meeting parameters test file created: ${testFilePath}`);
    } catch (error) {
      log.error(`❌ Failed to create meeting parameters test file: ${error.message}`);
    }
  };

  // see client's socket.emit('transport-produce', ...)
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      try {
        log.info(`New transport-produce request for kind: ${kind}`);
        const producer = await getTransport(socket.id).produce({
          kind,
          rtpParameters,
        });

        const { roomName } = peers[socket.id];
        addProducer(producer, roomName);
        informConsumers(roomName, socket.id, producer.id);

        // Create a test file with meeting parameters
        if (kind === "video") {
          createMeetingParametersTestFile(roomName, socket.id, producer);
        }

        // Start room recording when first video producer is created
        if (kind === "video" && !roomRecordings[roomName]) {
          log.info(`First video producer in room ${roomName}, starting room recording`);
          try {
            // Add a small delay to ensure any previous resources are released
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Ensure room exists before starting recording
            if (!rooms[roomName]) {
              log.warn(`Room ${roomName} not found for recording, creating it`);
              await createRoom(roomName, socket.id);
            }
            
            const recording = await startRecording(producer, roomName, "room-recording");
            roomRecordings[roomName] = recording;
            log.info(`Room recording started for ${roomName}`);
          } catch (error) {
            log.error(`Failed to start room recording: ${error.message}`);
          }
        }

        log.debug("Producer created:", {
          id: producer.id,
          kind: producer.kind,
        });

        callback({
          id: producer.id,
          producersExist: producers.length > 1 ? true : false,
        });
      } catch (error) {
        log.error(`Error in transport-produce: ${error.message}`);
        log.error(error.stack);
        callback({ error: error.message });
      }
    }
  );

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      const consumerTransport = transports.find(
        (transportData) =>
          transportData.consumer &&
          transportData.transport.id == serverConsumerTransportId
      ).transport;
      await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback
    ) => {
      try {
        const { roomName } = peers[socket.id];
        const router = rooms[roomName].router;
        let consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId
        ).transport;

        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit("producer-closed", { remoteProducerId });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id
            );
          });

          addConsumer(consumer, roomName);

          // from the consumer extract the following params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
          };

          // send the parameters to the client
          callback({ params });
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    }
  );

  socket.on("consumer-resume", async ({ serverConsumerId }) => {
    console.log("consumer resume");
    const { consumer } = consumers.find(
      (consumerData) => consumerData.consumer.id === serverConsumerId
    );
    await consumer.resume();
  });
});

// The createWebRtcTransport function has been removed from app.js
// The function should be removed from where it's defined in app.js

// Add this utility function to check if a port is in use
const isPortInUse = async (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    
    server.listen(port, '127.0.0.1');
  });
};

// Improve the findAvailablePort function to better handle port conflicts
const findAvailablePort = async (startPort = 10000, endPort = 59999) => {
  let port = startPort;
  while (port <= endPort) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      log.debug(`Found available port: ${port}`);
      return port;
    }
    port++;
  }
  throw new Error('No available ports found in range');
};

// Call FFmpeg check on startup
checkFFmpeg();

// Call this during startup
verifyEnvironment();

// Add a function to properly clean up recording resources
const cleanupRecording = async (roomName) => {
  if (!roomRecordings[roomName]) return;
  
  log.info(`Cleaning up recording for room ${roomName}`);
  
  try {
    // Clear monitoring interval
    if (roomRecordings[roomName].monitorInterval) {
      clearInterval(roomRecordings[roomName].monitorInterval);
    }
    
    // Kill FFmpeg process
    if (roomRecordings[roomName].ffmpeg) {
      roomRecordings[roomName].ffmpeg.kill('SIGTERM');
      // Wait a bit to ensure process is terminated
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Close consumer
    if (roomRecordings[roomName].consumer) {
      roomRecordings[roomName].consumer.close();
    }
    
    // Close transport
    if (roomRecordings[roomName].transport) {
      roomRecordings[roomName].transport.close();
    }
    
    // Delete SDP file if it exists
    const sdpPath = roomRecordings[roomName].sdpPath;
    if (sdpPath && fs.existsSync(sdpPath)) {
      fs.unlinkSync(sdpPath);
      log.debug(`Deleted SDP file: ${sdpPath}`);
    }
    
    // Remove from roomRecordings
    delete roomRecordings[roomName];
    
    log.info(`Recording cleanup completed for room ${roomName}`);
  } catch (error) {
    log.error(`Error during recording cleanup: ${error.message}`);
  }
};
