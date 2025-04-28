/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */
import express from "express";
const app = express();

import https from "httpolyglot";
import fs from "fs";
import path from "path";
import { Server } from "socket.io";
import mediasoup from "mediasoup";
// Add new imports
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.resolve();
const recordingsPath = path.join(__dirname, "recordings");

// Enhanced logging function
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args), // Added warn level
};

// Ensure recordings directory exists with logging
if (!fs.existsSync(recordingsPath)) {
  try {
    fs.mkdirSync(recordingsPath, { recursive: true });
    log.info(`Created recordings directory at: ${recordingsPath}`);
  } catch (error) {
    log.error(`Failed to create recordings directory: ${error.message}`);
  }
}

// Enhanced startRecording function with logging
// const startRecording = async (producer, roomName, socketId) => {
//   try {
//     log.info(`Starting recording for room: ${roomName}, socketId: ${socketId}`);

//     // Ensure recordings directory exists
//     if (!fs.existsSync(recordingsPath)) {
//       fs.mkdirSync(recordingsPath, { recursive: true });
//     }

//     const recordingPath = path.join(
//       recordingsPath,
//       `${roomName}_${socketId}_${Date.now()}.webm`
//     );

//     // Create a plain transport for recording
//     const router = rooms[roomName].router;
//     const transport = await router.createPlainTransport({
//       listenIp: { ip: "127.0.0.1", announcedIp: null },
//       rtcpMux: true,
//       comedia: true,
//       preferUdp: true,
//       enableSctp: false,
//       port: Math.floor(Math.random() * (65000 - 50000) + 50000),
//     });

//     // Connect the transport to the producer
//     const consumer = await transport.consume({
//       producerId: producer.id,
//       rtpCapabilities: router.rtpCapabilities,
//       paused: false,
//     });

//     // Get the RTP parameters
//     const remoteRtpParameters = consumer.rtpParameters;

//     // Enhanced SDP content with more specific video parameters
//     //     const sdpContent = `v=0
//     // o=- 0 0 IN IP4 127.0.0.1
//     // s=FFmpeg
//     // c=IN IP4 127.0.0.1
//     // t=0 0
//     // m=video ${transport.tuple.localPort} RTP/AVP ${remoteRtpParameters.codecs[0].payloadType}
//     // a=rtpmap:${remoteRtpParameters.codecs[0].payloadType} VP8/90000
//     // a=recvonly
//     // a=rtcp-mux
//     // a=setup:passive
//     // a=mid:video
//     // a=ssrc:${remoteRtpParameters.encodings[0].ssrc} cname:ffmpeg
//     // `;

//     const sdpContent = `
//     v=0
// o=- 0 0 IN IP4 127.0.0.1
// s=FFmpeg
// c=IN IP4 127.0.0.1
// t=0 0
// m=video 58257 RTP/AVP 100
// a=rtpmap:100 VP8/90000
// a=fmtp:100 max-fr=30;max-fs=3600
// a=framesize:100 640-480
// a=recvonly
// a=rtcp-mux
// a=setup:passive
// a=mid:video
// a=ssrc:628231417 cname:ffmpeg

//     `;

//     const sdpPath = path.join(recordingsPath, `${socketId}.sdp`);
//     fs.writeFileSync(sdpPath, sdpContent);
//     log.debug("Created SDP file:", sdpContent);

//     // Modified FFmpeg arguments with more specific parameters
//     const ffmpegArgs = [
//       "-hide_banner",
//       "-loglevel",
//       "debug",
//       "-protocol_whitelist",
//       "file,rtp,udp",
//       "-i",
//       sdpPath,
//       "-c:v",
//       "copy",
//       "-an",
//       // "-y",
//       // "-analyzeduration 5000000",
//       // "-probesize 5000000",
//       recordingPath,
//     ];

//     log.debug("Starting FFmpeg with args:", ffmpegArgs.join(" "));

//     try {
//       await transport.connect({
//         ip: "127.0.0.1",
//         port: transport.tuple.localPort,
//         rtcpPort: transport.tuple.localPort,
//       });

//       // Only start FFmpeg after successful transport connection
//       const ffmpeg = spawn("ffmpeg", ffmpegArgs);

//       // Resume the consumer immediately
//       await consumer.resume();

//       ffmpeg.stdout.on("data", (data) => {
//         log.debug(`FFmpeg stdout: ${data}`);
//       });

//       ffmpeg.stderr.on("data", (data) => {
//         const message = data.toString();
//         log.debug(`FFmpeg stderr: ${message}`);
//       });

//       ffmpeg.on("error", (error) => {
//         log.error(`FFmpeg process error: ${error.message}`);
//         log.error(error.stack);
//       });

//       ffmpeg.on("exit", (code, signal) => {
//         if (code === 0) {
//           log.info(
//             `FFmpeg process completed successfully for ${recordingPath}`
//           );
//         } else {
//           log.error(
//             `FFmpeg process exited with code ${code} and signal ${signal}`
//           );
//         }
//         if (fs.existsSync(sdpPath)) {
//           fs.unlinkSync(sdpPath);
//         }
//       });

//       // Modified monitoring logic
//       const maxRetries = 15;
//       let retryCount = 0;
//       const monitorRecording = setInterval(() => {
//         try {
//           if (fs.existsSync(recordingPath)) {
//             const stats = fs.statSync(recordingPath);
//             if (stats.size > 0) {
//               log.info(
//                 `Recording file created successfully, size: ${stats.size} bytes`
//               );
//               clearInterval(monitorRecording);
//             } else if (retryCount < maxRetries) {
//               log.info(
//                 `Recording file empty, retry ${retryCount + 1}/${maxRetries}`
//               );
//               retryCount++;
//             } else {
//               log.error(
//                 "Failed to create recording file after maximum retries"
//               );
//               clearInterval(monitorRecording);
//             }
//           } else if (retryCount < maxRetries) {
//             log.info(
//               `Recording file not created yet, retry ${
//                 retryCount + 1
//               }/${maxRetries}`
//             );
//             retryCount++;
//           } else {
//             log.error("Failed to create recording file after maximum retries");
//             clearInterval(monitorRecording);
//           }
//         } catch (error) {
//           log.error(`Error checking recording file: ${error.message}`);
//         }
//       }, 2000);

//       // Add debug logging for RTP flow
//       transport.observer.on("newrtptransceiver", (rtpTransceiver) => {
//         log.debug("New RTP transceiver:", rtpTransceiver.mid);
//       });

//       consumer.observer.on("close", () => {
//         log.debug("Consumer closed");
//       });

//       consumer.observer.on("pause", () => {
//         log.debug("Consumer paused");
//       });

//       consumer.observer.on("resume", () => {
//         log.debug("Consumer resumed");
//       });

//       return {
//         transport,
//         consumer,
//         ffmpeg,
//         path: recordingPath,
//         monitorInterval: monitorRecording,
//       };
//     } catch (error) {
//       log.error(`Transport connection failed: ${error.message}`);
//       throw error;
//     }
//   } catch (error) {
//     log.error(`Error in startRecording: ${error.message}`);
//     throw error;
//   }
// };

// const fs = require("fs");
// const path = require("path");
// const { spawn } = require("child_process");

// const startRecording = async (producer, roomName, socketId) => {
//   try {
//     log.info(`Starting recording for room: ${roomName}, socketId: ${socketId}`);

//     // Ensure recordings directory exists
//     if (!fs.existsSync(recordingsPath)) {
//       fs.mkdirSync(recordingsPath, { recursive: true });
//     }

//     const timestamp = Date.now();
//     const recordingPath = path.join(
//       recordingsPath,
//       `${roomName}_${socketId}_${timestamp}.webm`
//     );
//     const sdpPath = path.join(recordingsPath, `${socketId}_${timestamp}.sdp`);

//     const router = rooms[roomName].router;

//     // Create a plain transport
//     const transport = await router.createPlainTransport({
//       listenIp: { ip: "127.0.0.1", announcedIp: null },
//       rtcpMux: true,
//       comedia: true,
//       enableSctp: false,
//       preferUdp: true,
//       port: Math.floor(Math.random() * (65000 - 50000) + 50000),
//     });

//     // Create consumer
//     const consumer = await transport.consume({
//       producerId: producer.id,
//       rtpCapabilities: router.rtpCapabilities,
//       paused: true,
//     });

//     const { codecs, encodings } = consumer.rtpParameters;
//     const port = transport.tuple.localPort;
//     const payloadType = codecs[0].payloadType;
//     const ssrc = encodings[0].ssrc;

//     const sdpContent = `
// v=0
// o=- 0 0 IN IP4 127.0.0.1
// s=Mediasoup Recording
// c=IN IP4 127.0.0.1
// t=0 0
// m=video ${port} RTP/AVP ${payloadType}
// a=rtpmap:${payloadType} VP8/90000
// a=recvonly
// a=rtcp-mux
// a=setup:passive
// a=mid:video
// a=ssrc:${ssrc} cname:ffmpeg
// a=framesize:${payloadType} 640-480
// `.trim();

//     fs.writeFileSync(sdpPath, sdpContent);
//     log.debug("SDP file created:", sdpPath);

//     const ffmpegArgs = [
//       "-hide_banner",
//       "-loglevel",
//       "debug",
//       "-protocol_whitelist",
//       "file,rtp,udp",
//       "-analyzeduration",
//       "5000000",
//       "-probesize",
//       "5000000",
//       "-i",
//       sdpPath,
//       "-c:v",
//       "copy",
//       "-an",
//       recordingPath,
//     ];

//     await transport.connect({
//       ip: "127.0.0.1",
//       port: port,
//       rtcpPort: port,
//     });

//     const ffmpeg = spawn("ffmpeg", ffmpegArgs);

//     ffmpeg.stdout.on("data", (data) => {
//       log.debug(`FFmpeg stdout: ${data}`);
//     });

//     ffmpeg.stderr.on("data", (data) => {
//       log.debug(`FFmpeg stderr: ${data}`);
//     });

//     ffmpeg.on("error", (error) => {
//       log.error(`FFmpeg error: ${error.message}`);
//     });

//     ffmpeg.on("exit", (code, signal) => {
//       if (code === 0) {
//         log.info(`FFmpeg exited successfully for ${recordingPath}`);
//       } else {
//         log.error(`FFmpeg exited with code ${code} and signal ${signal}`);
//       }
//       if (fs.existsSync(sdpPath)) {
//         fs.unlinkSync(sdpPath);
//       }
//     });

//     await consumer.resume();

//     // Monitor file growth
//     const maxRetries = 15;
//     let retryCount = 0;
//     const monitorInterval = setInterval(() => {
//       try {
//         if (fs.existsSync(recordingPath)) {
//           const stats = fs.statSync(recordingPath);
//           if (stats.size > 0) {
//             log.info(`Recording file size: ${stats.size} bytes`);
//             clearInterval(monitorInterval);
//           } else if (++retryCount >= maxRetries) {
//             log.error("Recording file empty after max retries");
//             clearInterval(monitorInterval);
//           }
//         } else if (++retryCount >= maxRetries) {
//           log.error("Recording file not found after max retries");
//           clearInterval(monitorInterval);
//         }
//       } catch (err) {
//         log.error(`Error monitoring recording file: ${err.message}`);
//       }
//     }, 2000);

//     // Optional: Add observers for debugging
//     consumer.observer.on("close", () => log.debug("Consumer closed"));
//     consumer.observer.on("pause", () => log.debug("Consumer paused"));
//     consumer.observer.on("resume", () => log.debug("Consumer resumed"));

//     return {
//       transport,
//       consumer,
//       ffmpeg,
//       path: recordingPath,
//       monitorInterval,
//     };
//   } catch (error) {
//     log.error(`Failed to start recording: ${error.message}`);
//     throw error;
//   }
// };

// const startRecording = async (producer, roomName, socketId) => {
//   try {
//     log.info(
//       `🎬 Starting recording for room: ${roomName}, socketId: ${socketId}`
//     );

//     log.info(JSON.stringify(producer.rtpParameters, null, 2));

//     const { codecs } = producer.rtpParameters;
//     const videoCodec = codecs.find(
//       (c) => c.mimeType.toLowerCase() === "video/vp8"
//     );
//     if (!videoCodec) throw new Error("VP8 codec not found");

//     if (!fs.existsSync(recordingsPath)) {
//       fs.mkdirSync(recordingsPath, { recursive: true });
//     }

//     const filename = `${roomName}_${socketId}_${Date.now()}.webm`;
//     const recordingPath = path.join(recordingsPath, filename);

//     const router = rooms[roomName].router;

//     // Create PlainTransport
//     const transport = await router.createPlainTransport({
//       listenIp: { ip: "127.0.0.1", announcedIp: null },
//       rtcpMux: true,
//       comedia: true,
//       preferUdp: true,
//     });

//     log.debug(
//       `📡 Created plain transport at port: ${transport.tuple.localPort}`
//     );

//     // Create consumer for producer
//     const consumer = await transport.consume({
//       producerId: producer.id,
//       rtpCapabilities: router.rtpCapabilities,
//       paused: true, // Pause initially
//     });

//     const { payloadType, clockRate, mimeType } =
//       consumer.rtpParameters.codecs[0];
//     const { ssrc } = consumer.rtpParameters.encodings[0];

//     log.debug(
//       transport.tuple.localPort,
//       payloadType,
//       clockRate,
//       mimeType,
//       ssrc
//     );

//     // Generate dynamic SDP
//     const sdpContent = `
// v=0
// o=- 0 0 IN IP4 127.0.0.1
// s=FFmpeg
// c=IN IP4 127.0.0.1
// t=0 0
// m=video ${transport.tuple.localPort} RTP/AVP ${payloadType}
// a=rtpmap:${payloadType} ${mimeType.split("/")[1]}/${clockRate}
// a=fmtp:${payloadType} max-fr=30;max-fs=3600
// a=framesize:${payloadType} 640-480
// a=recvonly
// a=rtcp-mux
// a=setup:passive
// a=mid:video
// a=ssrc:${ssrc} cname:ffmpeg
// `.trim();

//     const sdpPath = path.join(recordingsPath, `${socketId}.sdp`);
//     fs.writeFileSync(sdpPath, sdpContent);
//     log.debug(`📝 SDP written to ${sdpPath}\n${sdpContent}`);

//     // FFmpeg args
//     const ffmpegArgs = [
//       "-hide_banner",
//       "-loglevel",
//       "debug",
//       "-protocol_whitelist",
//       "file,udp,rtp",
//       "-analyzeduration",
//       "20000000",
//       "-probesize",
//       "20000000",
//       "-i",
//       sdpPath,
//       "-c:v",
//       "copy",
//       "-an",
//       recordingPath,
//     ];

//     log.debug("🚀 FFmpeg args:", ffmpegArgs.join(" "));

//     // Connect transport
//     await transport.connect({
//       ip: "127.0.0.1",
//       port: transport.tuple.localPort,
//     });
//     log.debug("✅ Transport connected");

//     // Start FFmpeg
//     const ffmpeg = spawn("ffmpeg", ffmpegArgs);

//     ffmpeg.stdout.on("data", (data) => {
//       log.debug(`FFmpeg stdout: ${data.toString().trim()}`);
//     });

//     ffmpeg.stderr.on("data", (data) => {
//       log.debug(`FFmpeg stderr: ${data.toString().trim()}`);
//     });

//     ffmpeg.on("error", (err) => {
//       log.error("FFmpeg error:", err);
//     });

//     ffmpeg.on("exit", (code, signal) => {
//       if (code === 0) {
//         log.info(`✅ FFmpeg finished: ${recordingPath}`);
//       } else {
//         log.error(`❌ FFmpeg exited with code ${code}, signal ${signal}`);
//       }
//       if (fs.existsSync(sdpPath)) fs.unlinkSync(sdpPath);
//     });

//     // Resume consumer after FFmpeg has started
//     await consumer.resume();
//     log.debug("🎥 Consumer resumed");

//     // Trace packets
//     consumer.observer.on("trace", (trace) => {
//       if (trace.type === "rtp") {
//         log.debug("📦 RTP packet received");
//       }
//     });

//     // File monitoring
//     const maxRetries = 15;
//     let retryCount = 0;

//     const monitorRecording = setInterval(() => {
//       try {
//         if (fs.existsSync(recordingPath)) {
//           const stats = fs.statSync(recordingPath);
//           if (stats.size > 0) {
//             log.info(
//               `📁 Recording file created: ${recordingPath}, size: ${stats.size} bytes`
//             );
//             clearInterval(monitorRecording);
//           } else if (retryCount++ >= maxRetries) {
//             log.error("❌ File empty after retries");
//             clearInterval(monitorRecording);
//           }
//         } else if (retryCount++ >= maxRetries) {
//           log.error("❌ Recording file not created after retries");
//           clearInterval(monitorRecording);
//         }
//       } catch (err) {
//         log.error("📉 Monitor error:", err.message);
//       }
//     }, 2000);

//     return {
//       transport,
//       consumer,
//       ffmpeg,
//       path: recordingPath,
//       monitorInterval: monitorRecording,
//     };
//   } catch (error) {
//     log.error("❌ Error in startRecording:", error);
//     throw error;
//   }
// };

const startRecording = async (producer, roomName, socketId) => {
  try {
    log.info(
      `🎬 Starting recording for room: ${roomName}, socketId: ${socketId}`
    );

    // Log producer's rtpParameters for debugging
    log.info(
      "Producer rtpParameters:",
      JSON.stringify(producer.rtpParameters, null, 2)
    );

    const { codecs, encodings } = producer.rtpParameters;
    const videoCodec = codecs.find(
      (c) => c.mimeType.toLowerCase() === "video/vp8"
    );
    if (!videoCodec) throw new Error("VP8 codec not found");

    // Extract resolution and framerate from encodings or fmtp (if available)
    const encoding = encodings[0] || {};
    const fmtpParams = videoCodec.parameters || {};
    const resolution =
      encoding.maxWidth && encoding.maxHeight
        ? `${encoding.maxWidth}-${encoding.maxHeight}`
        : "640-480"; // Fallback to default
    const framerate = encoding.maxFramerate || fmtpParams["max-fr"] || 30;

    log.info(`Detected resolution: ${resolution}, framerate: ${framerate}`);

    if (!fs.existsSync(recordingsPath)) {
      fs.mkdirSync(recordingsPath, { recursive: true });
    }

    const filename = `${roomName}_${socketId}_${Date.now()}.webm`;
    const recordingPath = path.join(recordingsPath, filename);

    const router = rooms[roomName].router;

    // Create PlainTransport
    const transport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: null },
      rtcpMux: true,
      comedia: true,
      preferUdp: true,
    });

    log.debug(
      `📡 Created plain transport at port: ${transport.tuple.localPort}`
    );

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

    // Generate dynamic SDP
    const sdpContent = `
v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFmpeg
c=IN IP4 127.0.0.1
t=0 0
m=video ${transport.tuple.localPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${mimeType.split("/")[1]}/${clockRate}
a=fmtp:${payloadType} max-fr=${framerate};max-fs=3600
a=framesize:${payloadType} ${resolution}
a=framerate:${framerate}
a=recvonly
a=rtcp-mux
a=setup:passive
a=mid:video
a=ssrc:${ssrc} cname:ffmpeg
`.trim();

    const sdpPath = path.join(recordingsPath, `${socketId}.sdp`);
    fs.writeFileSync(sdpPath, sdpContent);
    log.debug(`📝 SDP written to ${sdpPath}\n${sdpContent}`);

    // FFmpeg args
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel",
      "debug",
      "-protocol_whitelist",
      "file,udp,rtp",
      "-analyzeduration",
      "30000000", // Increased to 30s
      "-probesize",
      "30000000", // Increased to 30MB
      "-i",
      sdpPath,
      "-c:v",
      "copy",
      "-an",
      recordingPath,
    ];

    log.debug("🚀 FFmpeg args:", ffmpegArgs.join(" "));

    // Connect transport (comedia handles port negotiation)
    await transport.connect({});
    log.debug("✅ Transport connected");

    // Start FFmpeg
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    ffmpeg.stdout.on("data", (data) => {
      log.debug(`FFmpeg stdout: ${data.toString().trim()}`);
    });

    ffmpeg.stderr.on("data", (data) => {
      log.debug(`FFmpeg stderr: ${data.toString().trim()}`);
    });

    ffmpeg.on("error", (err) => {
      log.error("FFmpeg error:", err);
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
      monitorInterval: monitorRecording,
    };
  } catch (error) {
    log.error("❌ Error in startRecording:", error);
    throw error;
  }
};

app.get("*", (req, res, next) => {
  const path = "/sfu/";

  if (req.path.indexOf(path) == 0 && req.path.length > path.length)
    return next();

  res.set("Content-Type", "text/html");
  res.send(
    Buffer.from(
      `<body bgcolor="black" text="silver">
      <h2>Meeting App</h2>
    <p>You need to specify a room name in the path e.g. 
    <a href='https://192.168.0.51:3000/sfu/r1'>https://192.168.0.51:3000/sfu/r1</a></p>
    `
    )
  );
  // res.send(
  //   `You need to specify a room name in the path e.g. 'https://127.0.0.1/sfu/room'`
  // );
});

app.use("/sfu/:room", express.static(path.join(__dirname, "public")));

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

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
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
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
    parameters: {
      minptime: 10,
      useinbandfec: 1,
    },
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

    const { roomName } = peers[socket.id];
    delete peers[socket.id];

    // remove socket from room
    rooms[roomName] = {
      router: rooms[roomName].router,
      peers: rooms[roomName].peers.filter((socketId) => socketId !== socket.id),
    };
  });

  socket.on("joinRoom", async ({ roomName }, callback) => {
    // create Router if it does not exist
    // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
    const router1 = await createRoom(roomName, socket.id);

    peers[socket.id] = {
      socket,
      roomName, // Name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin: false, // Is this Peer the Admin?
      },
    };

    // get Router RTP Capabilities
    const rtpCapabilities = router1.rtpCapabilities;

    // call callback from the client and send back the rtpCapabilities
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

  // socket.on('createRoom', async (callback) => {
  //   if (router === undefined) {
  //     // worker.createRouter(options)
  //     // options = { mediaCodecs, appData }
  //     // mediaCodecs -> defined above
  //     // appData -> custom application data - we are not supplying any
  //     // none of the two are required
  //     router = await worker.createRouter({ mediaCodecs, })
  //     console.log(`Router ID: ${router.id}`)
  //   }

  //   getRtpCapabilities(callback)
  // })

  // const getRtpCapabilities = (callback) => {
  //   const rtpCapabilities = router.rtpCapabilities

  //   callback({ rtpCapabilities })
  // }

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

        // Start recording when a new producer is created
        if (kind === "video") {
          log.info("Video producer detected, starting recording");
          const recording = await startRecording(producer, roomName, socket.id);

          // Store recording reference
          peers[socket.id].recording = recording;
          log.info(`Recording stored for peer ${socket.id}`);

          producer.on("transportclose", () => {
            log.info(`Transport closed for producer ${producer.id}`);
            if (peers[socket.id]?.recording) {
              log.info("Cleaning up recording resources");
              peers[socket.id].recording.ffmpeg.stdin.end();
              peers[socket.id].recording.transport.close();
              peers[socket.id].recording.consumer.close();
            }
          });
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

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: "0.0.0.0", // replace with relevant IP address
            announcedIp: "192.168.0.51",
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};

// Add FFmpeg version check on startup
const checkFFmpeg = async () => {
  try {
    const ffmpeg = spawn("ffmpeg", ["-version"]);
    ffmpeg.on("error", (error) => {
      log.error("FFmpeg is not installed or not in PATH");
      log.error(error.message);
    });
    ffmpeg.stdout.on("data", (data) => {
      log.info(`FFmpeg version: ${data.toString().split("\n")[0]}`);
    });
  } catch (error) {
    log.error("Failed to check FFmpeg version:", error);
  }
};

// Call FFmpeg check on startup
checkFFmpeg();

// Add this near the start of your application
const verifyEnvironment = async () => {
  // Check recordings directory permissions
  try {
    const testFile = path.join(recordingsPath, "test.txt");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    log.info("Recordings directory is writable");
  } catch (error) {
    log.error(`Recordings directory is not writable: ${error.message}`);
  }

  // Check available disk space - Windows compatible version
  try {
    if (process.platform === "win32") {
      const { exec } = await import("child_process");
      exec("wmic logicaldisk get size,freespace,caption", (error, stdout) => {
        if (error) {
          log.error(`Unable to check disk space: ${error.message}`);
          return;
        }
        const drive = path.parse(recordingsPath).root.charAt(0);
        const lines = stdout.trim().split("\n");
        const driveInfo = lines
          .filter((line) => line.startsWith(drive))
          .map((line) => line.trim().split(/\s+/));

        if (driveInfo.length > 0) {
          const [caption, freeSpace, size] = driveInfo[0];
          const freeGB = Math.round(freeSpace / (1024 * 1024 * 1024));
          const totalGB = Math.round(size / (1024 * 1024 * 1024));
          log.info(
            `Drive ${caption} - Free: ${freeGB}GB / Total: ${totalGB}GB`
          );
        }
      });
    } else {
      // Unix/Linux systems
      const { exec } = await import("child_process");
      exec(`df -h "${recordingsPath}"`, (error, stdout) => {
        if (error) {
          log.error(`Unable to check disk space: ${error.message}`);
          return;
        }
        log.info(`Available disk space:\n${stdout}`);
      });
    }
  } catch (error) {
    log.error(`Unable to check disk space: ${error.message}`);
  }
};

// Call this during startup
verifyEnvironment();
