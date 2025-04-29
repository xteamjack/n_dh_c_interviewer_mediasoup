// If using ES modules (type: "module" in package.json)
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import https from 'httpolyglot';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import mediasoup from 'mediasoup';
import { spawn } from 'child_process';
import dgram from 'dgram';
import net from 'net';
import os from 'os';
import { verifyToken } from './middleware/auth.js';
import createWebRtcTransport from './mediaSoup/createWebRtcTransport.js';
import log from './utils/logger.js';
import routes from './routes.js';
import checkFFmpeg from './utils/checkFFmpeg.js';
import verifyEnvironment from './utils/verifyEnvironment.js';

// Initialize dotenv
dotenv.config();

// Set up __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();

// Add CORS support if the AI moderator will be calling from a different origin
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || '*', // Ideally, restrict this to specific origins
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add middleware
app.use(express.json());
app.use(express.static('public'));

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

    // Create a transport without specifying a port, letting mediasoup choose one
    const transport = await router.createPlainTransport({
      listenIp: { ip: "0.0.0.0", announcedIp: "127.0.0.1" },
      rtcpMux: true,
      comedia: false,
    });

    log.debug(`📡 Created plain transport at port: ${transport.tuple.localPort}`);

    // Use the port that mediasoup has already bound successfully
    const boundPort = transport.tuple.localPort;
    log.debug(`Using mediasoup-bound port: ${boundPort}`);

    // Make sure to properly close any existing recording for this room
    if (roomRecordings[roomName]) {
      log.info(`Closing existing recording for room ${roomName}`);
      try {
        clearInterval(roomRecordings[roomName].monitorInterval);
        clearInterval(roomRecordings[roomName].packetMonitor); // Clear packet monitor
        roomRecordings[roomName].ffmpeg.kill("SIGTERM");
        roomRecordings[roomName].transport.close();
        roomRecordings[roomName].consumer.close();
        delete roomRecordings[roomName];
        
        // Add a delay to ensure resources are released
        await new Promise(resolve => setTimeout(resolve, 2000));
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

    // Generate a unique SDP filename with absolute path
    const sdpFilename = `${roomName}_room-recording_${Date.now()}.sdp`;
    const sdpPath = path.resolve(path.join(recordingsPath, sdpFilename));
    log.info(`Creating SDP file at: ${sdpPath}`);

    // Find an available port for RTP
    const getAvailablePort = () => {
      return new Promise((resolve, reject) => {
        const server = dgram.createSocket('udp4');
        server.on('error', reject);
        server.bind(0, () => {
          const port = server.address().port;
          server.close(() => resolve(port));
        });
      });
    };

    // Get an available port
    const rtpPort = await getAvailablePort();
    log.info(`Found available UDP port: ${rtpPort}`);

    // Update the SDP content to include size information and more detailed codec parameters
    const sdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFmpeg
c=IN IP4 127.0.0.1
t=0 0
m=video ${rtpPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${mimeType.split("/")[1]}/${clockRate}
a=fmtp:${payloadType} max-fr=30;max-recv-width=${width};max-recv-height=${height}
a=recvonly
a=rtcp-mux
a=ssrc:${ssrc} cname:ffmpeg
`.trim();

    // Create the SDP file
    const sdpCreated = createSdpFile(sdpPath, sdpContent);
    if (!sdpCreated) {
      throw new Error("Failed to create SDP file");
    }

    // Create a debug copy in a more accessible location
    const debugCopy = path.join(process.cwd(), 'debug-latest.sdp');
    fs.copyFileSync(sdpPath, debugCopy);
    log.info(`Debug copy created at: ${debugCopy}`);

    // Update FFmpeg args with more explicit options
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel", "debug",
      "-protocol_whitelist", "file,udp,rtp",
      "-analyzeduration", "10000000",  // Increase analysis duration
      "-probesize", "10000000",        // Increase probe size
      "-i", sdpPath,
      "-map", "0:v:0",                 // Explicitly map video stream
      "-c:v", "copy",                  // Copy video codec
      "-f", "webm",                    // Force webm format
      "-y",                            // Overwrite output file if it exists
      recordingPath
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

    // Add this function to make important messages stand out
    const logHighlight = (message) => {
      log.info(`\x1b[33m\x1b[1m${message}\x1b[0m`); // Bright yellow
    };

    // Update the FFmpeg command logging
    logHighlight(`\n==== FFMPEG COMMAND FOR MANUAL TESTING ====\nffmpeg ${ffmpegArgs.join(" ")}\n=======================================`);

    // Start FFmpeg process with better error handling
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);
    let ffmpegStarted = false;

    ffmpeg.stdout.on("data", (data) => {
      const msg = data.toString();
      log.debug(`FFmpeg stdout: ${msg}`);
      ffmpegStarted = true;
    });

    ffmpeg.stderr.on("data", (data) => {
      const msg = data.toString();
      log.debug(`FFmpeg stderr: ${msg}`);
      
      // Check for specific error patterns
      if (msg.includes("bind failed") || msg.includes("Error number -10048")) {
        log.error(`❌ FFmpeg port binding error detected`);
      }
      
      if (msg.includes("Error") || msg.includes("error") || msg.includes("Invalid")) {
        log.warn(`⚠️ FFmpeg issue detected: ${msg.trim()}`);
      }
      
      ffmpegStarted = true;
    });

    // Wait a moment to ensure FFmpeg has started before connecting the transport
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (!ffmpegStarted) {
      log.error("❌ FFmpeg failed to start properly");
      throw new Error("FFmpeg failed to start");
    }

    // Connect transport
    await transport.connect({
      ip: '127.0.0.1',
      port: rtpPort
      // Remove rtcpPort parameter since rtcpMux is enabled
    });
    log.debug("✅ Transport connected");

    // Add slight delay before resuming consumer to ensure FFmpeg is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await consumer.resume();
    log.debug("🎥 Consumer resumed");

    // Add more detailed RTP monitoring
    const packetMonitor = setInterval(async () => {
      if (consumer) {
        try {
          const stats = await consumer.getStats();
          
          // Check if stats is an array or convert it to an array if it's not
          let packetsReceived = 0;
          
          if (Array.isArray(stats)) {
            packetsReceived = stats.reduce((count, stat) => count + (stat.packetsReceived || 0), 0);
          } else if (typeof stats === 'object') {
            // If stats is an object, iterate through its properties
            Object.values(stats).forEach(stat => {
              packetsReceived += (stat.packetsReceived || 0);
            });
          }
          
          if (packetsReceived === 0) {
            log.warn("⚠️ No RTP packets received yet - check network and ports");
          } else {
            log.info(`RTP packets received: ${packetsReceived}`);
          }
          
          // Log the structure of stats for debugging
          log.debug(`Stats structure: ${JSON.stringify(stats, null, 2).substring(0, 200)}...`);
        } catch (error) {
          log.error(`Error getting consumer stats: ${error.message}`);
        }
      }
    }, 5000);

    // Trace RTP packets for debugging
    consumer.observer.on("trace", (trace) => {
      if (trace.type === "rtp") {
        packetCount++;
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
      packetMonitor: packetMonitor // Add this to clean up later
    };
  } catch (error) {
    log.error("❌ Error in startRecording:", error);
    throw error;
  }
};

// Apply routes
app.use(routes);

// Add these API endpoints before your existing routes

// API endpoint for AI to start recording
// POST https://192.168.0.51:3000/api/ai/rooms/:roomName/recording/start
app.post('/api/ai/rooms/:roomName/recording/start', verifyToken, async (req, res) => {
  try {
    const { roomName } = req.params;
    
    log.info(`Authenticated request to start recording for room ${roomName}`);
    
    const recordingPath = await startAIMeetingRecording(roomName);
    res.json({ 
      success: true, 
      message: recordingPath ? 'Recording started' : 'Recording will start when video is available',
      path: recordingPath
    });
  } catch (error) {
    log.error(`API error starting recording: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for AI to stop recording
// POST https://192.168.0.51:3000/api/ai/rooms/:roomName/recording/stop
app.post('/api/ai/rooms/:roomName/recording/stop', verifyToken, async (req, res) => {
  try {
    const { roomName } = req.params;
    
    log.info(`Authenticated request to stop recording for room ${roomName}`);
    
    const recordingPath = await stopAIMeetingRecording(roomName);
    res.json({ 
      success: true, 
      message: recordingPath ? 'Recording stopped' : 'No recording was in progress',
      path: recordingPath
    });
  } catch (error) {
    log.error(`API error stopping recording: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Add a test endpoint to verify authentication
app.get('/api/test-auth', verifyToken, (req, res) => {
  // If we get here, authentication was successful
  res.json({ 
    success: true, 
    message: 'Authentication successful',
    tokenProvided: 'Valid token',
    expectedToken: process.env.AI_MODERATOR_TOKEN === 'your-secure-token-here' ? 
      'Default token not changed in .env' : 
      'Custom token configured'
  });
});

// Debug endpoint to check environment variables
app.get('/api/debug/env', (req, res) => {
  res.json({
    AI_MODERATOR_TOKEN_LENGTH: process.env.AI_MODERATOR_TOKEN ? process.env.AI_MODERATOR_TOKEN.length : 0,
    AI_MODERATOR_TOKEN_FIRST_CHARS: process.env.AI_MODERATOR_TOKEN ? process.env.AI_MODERATOR_TOKEN.substring(0, 3) + '...' : 'not set',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
  });
});

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
  const workerInstance = await mediasoup.createWorker(workerSettings);
  console.log(`worker pid ${workerInstance.pid}`);

  workerInstance.on("died", (error) => {
    // This implies something serious happened, so kill the application
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return workerInstance;
};

// Initialize worker
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
    const { roomName } = peers[socket.id] || {};
    
    // If this peer doesn't exist or has no room, just clean up
    if (!roomName) {
      log.warn(`Peer ${socket.id} disconnected but had no associated room`);
      delete peers[socket.id];
      consumers = removeItems(consumers, socket.id, "consumer");
      producers = removeItems(producers, socket.id, "producer");
      transports = removeItems(transports, socket.id, "transport");
      return;
    }
    
    // Remove the peer and update room peers list
    delete peers[socket.id];
    if (rooms[roomName]) {
      rooms[roomName].peers = rooms[roomName].peers.filter(id => id !== socket.id);
      
      // If this was the last peer, stop the room recording
      if (rooms[roomName].peers.length === 0 && roomRecordings[roomName]) {
        log.info(`Last participant left room ${roomName}, stopping recording`);
        cleanupRecording(roomName);
      }
    }
    
    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");
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
      const workerInstance = await worker;
      router1 = await workerInstance.createRouter({ mediaCodecs });
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
    // Push to the array instead of reassigning
    transports.push({ 
      socketId: socket.id, 
      transport, 
      roomName, 
      consumer 
    });

    // Update the peer's transports array
    if (!peers[socket.id]) {
      peers[socket.id] = {
        socket,
        roomName,
        transports: [],
        producers: [],
        consumers: [],
        peerDetails: {
          name: "",
          isAdmin: false,
        }
      };
    }
    
    peers[socket.id].transports.push(transport.id);
  };

  const addProducer = (producer, roomName) => {
    producers.push({ socketId: socket.id, producer, roomName });

    if (peers[socket.id]) {
      peers[socket.id].producers.push(producer.id);
    }
  };

  const addConsumer = (consumer, roomName) => {
    consumers.push({ socketId: socket.id, consumer, roomName });

    if (peers[socket.id]) {
      peers[socket.id].consumers.push(consumer.id);
    }
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

        // Add this block to check for pending AI recordings
        if (kind === "video" && rooms[roomName] && rooms[roomName].pendingAIRecording) {
          log.info(`Video producer created in room with pending AI recording: ${roomName}`);
          try {
            // Add a small delay to ensure producer is fully established
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const recording = await startRecording(producer, roomName, "ai-moderator");
            roomRecordings[roomName] = recording;
            rooms[roomName].pendingAIRecording = false;
            log.info(`Pending AI recording started for ${roomName}`);
          } catch (error) {
            log.error(`Failed to start pending AI recording: ${error.message}`);
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

// Improved findAvailablePort function with better error handling
const findAvailablePort = async (start = 10000, end = 59999, maxRetries = 20) => {
  let retries = 0;
  let lastError = null;

  while (retries < maxRetries) {
    const port = Math.floor(Math.random() * (end - start + 1)) + start;
    
    try {
      // Test if port is available by creating a temporary UDP socket
      const testSocket = dgram.createSocket('udp4');
      
      await new Promise((resolve, reject) => {
        testSocket.on('error', (err) => {
          reject(err);
        });
        
        testSocket.bind(port, '0.0.0.0', () => {
          testSocket.close();
          resolve();
        });
      });
      
      log.debug(`Found available port: ${port}`);
      return port;
    } catch (error) {
      lastError = error;
      log.debug(`Port ${port} is not available: ${error.message}`);
      retries++;
    }
  }
  
  log.error(`Failed to find available port after ${maxRetries} attempts. Last error: ${lastError?.message}`);
  throw new Error(`Failed to find available port after ${maxRetries} attempts`);
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
    
    if (roomRecordings[roomName].packetMonitor) {
      clearInterval(roomRecordings[roomName].packetMonitor);
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

/**
 * Starts a recording for an AI-moderated meeting
 * @param {string} roomName - The room to record
 * @returns {Promise<string|null>} - Path to the recording file or null if pending
 */
const startAIMeetingRecording = async (roomName) => {
  try {
    if (!rooms[roomName]) {
      log.error(`Room ${roomName} not found for AI recording`);
      return null;
    }
    
    if (roomRecordings[roomName]) {
      log.info(`Recording already in progress for room ${roomName}`);
      return roomRecordings[roomName].path;
    }
    
    log.info(`AI initiating recording for room ${roomName}`);
    
    // Find the first video producer in the room to record
    let producerToRecord = null;
    for (const producer of producers) {
      if (producer.roomName === roomName && producer.producer.kind === 'video') {
        producerToRecord = producer.producer;
        break;
      }
    }
    
    if (!producerToRecord) {
      log.warn(`No video producers found in room ${roomName}, waiting for one`);
      rooms[roomName].pendingAIRecording = true;
      return null;
    }
    
    const recording = await startRecording(producerToRecord, roomName, "ai-moderator");
    roomRecordings[roomName] = recording;
    
    log.info(`AI recording started for ${roomName}: ${recording.path}`);
    return recording.path;
  } catch (error) {
    log.error(`Failed to start AI recording: ${error.message}`);
    throw error;
  }
};

/**
 * Stops an AI-moderated meeting recording
 * @param {string} roomName - The room to stop recording
 * @returns {Promise<string|null>} - Path to the completed recording file
 */
const stopAIMeetingRecording = async (roomName) => {
  try {
    if (!roomRecordings[roomName]) {
      log.warn(`No recording in progress for room ${roomName}`);
      return null;
    }
    
    log.info(`AI stopping recording for room ${roomName}`);
    
    // Store path before cleanup
    const recordingPath = roomRecordings[roomName].path;
    
    // Clean up recording resources
    clearInterval(roomRecordings[roomName].monitorInterval);
    clearInterval(roomRecordings[roomName].packetMonitor);
    roomRecordings[roomName].ffmpeg.kill("SIGTERM");
    roomRecordings[roomName].transport.close();
    roomRecordings[roomName].consumer.close();
    delete roomRecordings[roomName];
    
    log.info(`AI recording stopped for ${roomName}`);
    return recordingPath;
  } catch (error) {
    log.error(`Failed to stop AI recording: ${error.message}`);
    throw error;
  }
};

// First, let's add a function to verify SDP file creation with better error handling
const createSdpFile = (sdpPath, sdpContent) => {
  try {
    // Make sure the directory exists
    const sdpDir = path.dirname(sdpPath);
    if (!fs.existsSync(sdpDir)) {
      fs.mkdirSync(sdpDir, { recursive: true });
      log.info(`Created directory for SDP file: ${sdpDir}`);
    }
    
    // Write the SDP file with explicit encoding
    fs.writeFileSync(sdpPath, sdpContent, { encoding: 'utf8' });
    
    // Verify the file was created
    if (fs.existsSync(sdpPath)) {
      const stats = fs.statSync(sdpPath);
      log.info(`✅ SDP file created successfully: ${sdpPath} (${stats.size} bytes)`);
      
      // Read back the content to verify
      const readContent = fs.readFileSync(sdpPath, 'utf8');
      log.debug(`SDP content verification: ${readContent.length} bytes read`);
      
      return true;
    } else {
      log.error(`❌ SDP file not found after writing: ${sdpPath}`);
      return false;
    }
  } catch (error) {
    log.error(`❌ Error creating SDP file: ${error.message}`);
    log.error(`Path: ${sdpPath}`);
    log.error(`Current working directory: ${process.cwd()}`);
    return false;
  }
};
