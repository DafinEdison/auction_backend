# Amazon Linux EC2 Deployment Walkthrough (Socket.IO Server)

This guide walks you through launching an EC2 instance running Amazon Linux, connecting via SSH, installing Node.js, deploying the Socket.IO server, and optionally configuring Nginx and TLS.

## Prerequisites
- AWS account with permission to create EC2 instances and security groups.
- Key pair (`.pem` file) downloaded when creating the instance.
- Security Group allowing inbound:
  - `80` and `443` for HTTP/HTTPS (recommended), and
  - optionally `3001` if you choose to expose the Node server directly.
- Domain name (optional, for TLS with Nginx or load balancer).

## 1) Launch and Connect to EC2 (Amazon Linux)
1. Launch an instance:
   - AMI: Amazon Linux 2023 or Amazon Linux 2.
   - Instance type: `t4g.micro` (ARM, low cost) or `t3.micro` (x86, Free Tier). Use `arm64` AMI for `t4g.*`, `x86_64` AMI for `t3/t2.*`.
   - Attach a small `gp3` EBS volume (e.g., 10 GB).
   - Security group: allow inbound `80`, `443` (and optionally `3001`).
   - Key pair: download and keep safe.
2. Connect via SSH (replace placeholders):
   ```sh
   chmod 400 /path/to/your-key.pem
   ssh -i /path/to/your-key.pem ec2-user@EC2_PUBLIC_DNS
   ```
   - Default user for Amazon Linux is `ec2-user`.

## 2) System Prep
Check OS version:
```sh
cat /etc/os-release
```
Update packages (choose the command that matches your OS):
- Amazon Linux 2023:
```sh
sudo dnf update -y
```
- Amazon Linux 2:
```sh
sudo yum update -y
```
Install Git and Nginx:
- AL2023:
```sh
sudo dnf install -y git nginx
```
- AL2:
```sh
sudo yum install -y git nginx
```

Enable and start Nginx (we’ll configure it later):
```sh
sudo systemctl enable nginx
sudo systemctl start nginx
```

## 3) Install Node.js (NVM recommended)
Using NVM works uniformly on Amazon Linux 2 and 2023:
```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 18
nvm alias default 18
node -v
npm -v
```

Alternatively, AL2023 can use `dnf` modules:
```sh
sudo dnf module list nodejs
sudo dnf module install -y nodejs:18
node -v
```

## 4) Clone and Configure the Socket Server
```sh
cd ~
git clone https://github.com/DafinEdison/auction_backend.git
cd auction_backend
npm install
cp .env.example .env
```
Edit `.env` with your values:
```env
PORT=3001
SOCKET_PATH=/socketio
CLIENT_ORIGIN=https://cricketmockauction.netlify.app
# Optional: set if you want DB writes on auction completion
# MONGO_URL=mongodb+srv://user:pass@host/dbname
```

Start the server and test locally:
```sh
npm start
curl http://localhost:3001/health
# Expect: {"ok":true}
```

## 5) Keep It Running with PM2
```sh
npm install -g pm2
pm2 start server.js --name ipl-auction-socket
pm2 save
pm2 startup systemd
# Follow the printed instructions to run the sudo command
```

Common PM2 commands:
```sh
pm2 status
pm2 logs ipl-auction-socket
pm2 restart ipl-auction-socket
pm2 stop ipl-auction-socket
```

## 6) Configure Nginx Reverse Proxy (Recommended)
Create a site config (AL paths use `/etc/nginx/conf.d/`):
```sh
sudo tee /etc/nginx/conf.d/auction.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_PUBLIC_DNS;

    # Proxy for Socket.IO path
    location /socketio {
        proxy_pass http://127.0.0.1:3001/socketio;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 600s;
    }

    # Optional: health check proxy
    location /health {
        proxy_pass http://127.0.0.1:3001/health;
    }
}
EOF
```
Test and reload Nginx:
```sh
sudo nginx -t
sudo systemctl reload nginx
```

Ensure your Security Group allows inbound `80` and `443` from the internet.

## 7) TLS Options
- Option A: Use an Application Load Balancer (ALB) with ACM certificate for TLS termination; target group forwards to EC2 on port `3001` or `80`.
- Option B: Use Certbot on the instance:
  - Amazon Linux 2023:
    ```sh
    sudo dnf install -y certbot python3-certbot-nginx
    sudo certbot --nginx -d YOUR_DOMAIN
    ```
  - Amazon Linux 2 (EPEL may be required):
    ```sh
    sudo amazon-linux-extras install epel -y
    sudo yum install -y certbot python2-certbot-nginx
    sudo certbot --nginx -d YOUR_DOMAIN
    ```
  - Renewals: `sudo crontab -e` and add `0 3 * * * certbot renew --quiet`.

If Certbot packages are unavailable in your region/AMI, consider ALB+ACM or using Cloudflare for TLS.

## 8) Netlify Frontend Configuration
In Netlify → Site settings → Environment variables:
```
NEXT_PUBLIC_SOCKET_URL=https://YOUR_DOMAIN_OR_PUBLIC_DNS
NEXT_PUBLIC_SOCKET_PATH=/socketio
```
Redeploy the site and verify the browser connects to `wss://YOUR_DOMAIN/socketio`.

## 9) Troubleshooting
- CORS errors: Ensure `.env` `CLIENT_ORIGIN` matches your frontend origin exactly, including scheme and host.
- Path mismatch: Client `NEXT_PUBLIC_SOCKET_PATH` must match server `SOCKET_PATH`.
- Security Group: Open `80/443`. Avoid exposing `3001` publicly when using Nginx.
- WebSocket upgrade: Confirm Nginx config includes `Upgrade` and `Connection` headers.
- Health check: `curl http://localhost:3001/health` should return `{ "ok": true }`.
- Logs: `pm2 logs ipl-auction-socket` for server runtime messages.

## 10) Updating the Server
```sh
cd ~/auction_backend
git pull
npm ci
pm2 restart ipl-auction-socket
```

---
If you want, you can share your domain and preferred instance type (ARM vs x86), and I’ll tailor an exact Nginx + TLS config ready to paste.