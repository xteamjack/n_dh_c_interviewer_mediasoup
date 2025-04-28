import log from '../utils/logger.js';

/**
 * Creates a WebRTC transport with the specified router
 * @param {Object} router - The mediasoup router
 * @returns {Promise<Object>} - The created WebRTC transport
 */
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
      log.info(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        log.info("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};

export default createWebRtcTransport;
