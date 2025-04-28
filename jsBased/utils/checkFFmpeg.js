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

  module.exports = checkFFmpeg;