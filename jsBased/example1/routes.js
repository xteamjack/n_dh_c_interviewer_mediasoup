import express from 'express';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const __dirname = path.resolve();

// Main route handler
router.get("*", (req, res, next) => {
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
});

// SFU room route
router.use("/sfu/:room", express.static(path.join(__dirname, "public")));

export default router;