# IPL Auction Socket Server

Standalone Socket.IO server to support real-time auction rooms in production (e.g., when hosting the Next.js app on Netlify).

## Prerequisites
- Node.js 18.x
- Git access to this repository

## Environment
Create a `.env` file (see `.env.example`):

```
PORT=3001
SOCKET_PATH=/socketio
CLIENT_ORIGIN=https://cricketmockauction.netlify.app
```

## Install & Run
```
cd socket-server
npm install
npm start
```

The server listens on `PORT` and Socket.IO uses `SOCKET_PATH`.

## Netlify Frontend Settings
In Netlify, set:
- `NEXT_PUBLIC_SOCKET_URL` = `https://YOUR_EC2_PUBLIC_DNS_OR_DOMAIN` (include protocol)
- `NEXT_PUBLIC_SOCKET_PATH` = `/socketio` (or your chosen path)

## EC2 Deployment (Quick Start)
1. Provision an Ubuntu EC2 instance and open port `3001` (or reverse proxy via Nginx on 80/443).
2. SSH into EC2 and install Node 18:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Clone repo and start server:
   ```bash
   git clone <your-repo-url>
   cd <repo>/socket-server
   npm install
   cp .env.example .env
   # edit .env with your Netlify domain and desired port
   npm start
   ```
4. Optional: run with PM2 for persistence:
   ```bash
   npm i -g pm2
   pm2 start server.js --name ipl-auction-socket
   pm2 save
   pm2 startup
   ```

## Nginx Reverse Proxy (optional)
Proxy `https://your-domain/socketio` to the Node server:

```
location /socketio {
  proxy_pass http://127.0.0.1:3001/socketio;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

## Notes
- CORS allows `CLIENT_ORIGIN` only. Update it when your frontend domain changes.
- The server reuses `../ipl-auction-next/lib/game` so keep both folders together.