import http from 'node:http';
import { config, log } from './config';
import { openDatabase } from './db/database';
import { AuthService } from './auth/auth.service';
import { World } from './game/world';
import { createApp } from './http/app';
import { attachGateway } from './ws/gateway';

const db = openDatabase();
const auth = new AuthService(db);
const world = new World(db);
const app = createApp(auth);
const server = http.createServer(app);
attachGateway(server, world, auth);
world.start();

server.listen(config.port, config.host, () => {
  log.info(`Nexus Park server listening on http://${config.host}:${config.port}`);
  log.info(`WebSocket endpoint: ws://${config.host}:${config.port}/ws`);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — persisting world state...`);
  world.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
