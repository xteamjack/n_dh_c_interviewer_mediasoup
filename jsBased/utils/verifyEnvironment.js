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

  module.exports = verifyEnvironment;