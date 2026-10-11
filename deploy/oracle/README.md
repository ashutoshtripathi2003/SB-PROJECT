# Put RideSync online for free (Oracle Cloud)

RideSync runs on a free Oracle Cloud server, online 24/7, with a fixed `https://` link. Your laptop no longer needs to be on, and `share.bat` is no longer needed.

**What you need:** about 45 minutes, an email address, a phone number and a credit or debit card. The card is only for identity checks; Oracle doesn't charge it while you stay within the free limits.

| Step | What | Time |
|---|---|---|
| 1 | Create an Oracle account | 10 min |
| 2 | Create the free server | 10 min |
| 3 | Open the web ports | 5 min |
| 4 | Get a free name (DuckDNS) | 3 min |
| 5 | Run `oracle.bat` on your laptop | 10 min |
| 6 | Check it works | 2 min |
| 7 | Point the phone app at it | 5 min |
| 8 | Update login and payment settings | 5 min |
| 9 | Stop Oracle reclaiming the server | 3 min |

---

## 1. Create an Oracle account

1. Go to **cloud.oracle.com** and click **Sign up** (or **Start for free**).
2. For **Home region**, choose **India West (Mumbai)** or **India South (Hyderabad)**. This can't be changed later, and the server will live there.
3. Finish the sign-up. Oracle checks your card, and may place a small temporary hold that it returns.

## 2. Create the free server

1. In the Oracle console, open the menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name:** `ridesync`.
3. **Image:** click **Edit** → **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04**.
4. **Shape:** click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**. Set **2 OCPUs** and **12 GB memory**. It's marked **Always Free-eligible**.
   - If it says **out of capacity**, try another *availability domain*, try again later, or pick **VM.Standard.E2.1.Micro** (AMD, also Always Free, 1 GB). The setup script adds swap so it still builds.
5. **Networking:** keep **Create new virtual cloud network** and **public subnet**. Make sure **Assign a public IPv4 address** is on.
6. **SSH keys:** choose **Generate a key pair for me** and click **Save private key**. Keep this `.key` file safe; it's the only way into the server.
7. Click **Create**. After a minute the state turns **Running**. Copy the **Public IP address**, e.g. `140.238.xx.xx`.

## 3. Open the web ports (80 and 443)

Oracle blocks web traffic until you allow it:

1. On the instance page, click the **subnet** link (under *Primary VNIC*), then the **Default Security List**. On newer consoles it's under **Networking** → **Virtual cloud networks** → your network → **Security**.
2. Click **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port range **80**. Click **Add Ingress Rules**.
3. Add a second rule the same way with Destination port range **443**.

The server's own firewall is opened by the setup script.

## 4. Get a free name (DuckDNS)

A name gives you a link that never changes, e.g. `https://ridesync-vit.duckdns.org`:

1. Go to **duckdns.org** and sign in with Google.
2. Under **sub domain**, type a name such as `ridesync-vit` and click **add domain**.
3. In **current ip**, paste the server's public IP from step 2 and click **update ip**.
4. Copy your **token** from the top of the page.

(If you skip this, the script uses a free automatic name like `140-238-xx-xx.sslip.io`. It works, but it's harder to remember.)

## 5. Run `oracle.bat` on your laptop

1. **Close `start.bat` and `share.bat`** on your laptop, so the database isn't changing while it's copied.
2. In the RideSync folder, double-click **`oracle.bat`** and answer the four questions:
   - the server's **public IP**
   - the **path to the `.key` file** (drag the file into the window)
   - your **DuckDNS name**, e.g. `ridesync-vit.duckdns.org`
   - your **DuckDNS token**
3. Type `yes` if it asks whether to trust the server (first time only).

It copies your `.env`, `data` folder and `firebase-key.json` to the server, then sets everything up (5–10 minutes):

- installs Node.js 22, downloads RideSync from GitHub and builds it
- runs it as a service that starts on boot and restarts itself if it ever crashes
- installs Caddy, which gets a free HTTPS certificate and renews it automatically
- backs up the database every night at 03:30, keeping 14 days
- keeps your DuckDNS name pointed at the server

At the end it prints **`RideSync is online: https://your-name.duckdns.org`**.

<details>
<summary>Doing it by hand instead (Mac, Linux, or if oracle.bat fails)</summary>

```bash
# From the RideSync folder on your computer:
ssh -i path/to/ssh-key.key ubuntu@SERVER_IP "mkdir -p ~/upload"
scp -i path/to/ssh-key.key .env firebase-key.json ubuntu@SERVER_IP:upload/
scp -i path/to/ssh-key.key -r data ubuntu@SERVER_IP:upload/

# On the server:
ssh -i path/to/ssh-key.key ubuntu@SERVER_IP
curl -fsSL https://raw.githubusercontent.com/mastermac123/SB-PROJECT/main/deploy/oracle/setup.sh -o setup.sh
DUCKDNS_TOKEN=your-token bash setup.sh ridesync-vit.duckdns.org
```
On a Mac or Linux, first run `chmod 600 path/to/ssh-key.key`.
</details>

## 6. Check it works

Open **`https://your-name.duckdns.org`** on your phone (on mobile data too) and sign in. Your old users and rides are there, because the database came along.

If the page doesn't load, see **Troubleshooting** below.

## 7. Point the phone app at it

**Quick (each student types it once):** in the app, tap **Server: … · Change** on the sign-in screen (or **Profile → Change server**) and enter `https://your-name.duckdns.org`.

**Best (nothing to type):** build the link into the app:
1. On GitHub, open the repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**.
2. Name `RIDESYNC_SERVER_URL`, value `https://your-name.duckdns.org`.
3. Go to **Actions** → **Android app** → **Run workflow**. The new APK on the Releases page opens straight to sign-in.

## 8. Update login and payment settings

Anything that pointed at the laptop link should now point at the new one:

| Service | Where | Set to |
|---|---|---|
| Microsoft sign-in | Azure portal → App registrations → your app → Authentication → Redirect URIs | `https://your-name.duckdns.org/api/auth/microsoft/callback` |
| Google sign-in | Google Cloud console → Credentials → your OAuth client → Authorised JavaScript origins | `https://your-name.duckdns.org` |
| Razorpay (if used) | Razorpay dashboard → Settings → Webhooks | `https://your-name.duckdns.org/api/payments/razorpay/webhook` |

Email codes, maps, TomTom and Firebase need no change; their keys came along in `.env`.

## 9. Stop Oracle reclaiming the server

Oracle may **reclaim** an Always Free server that looks idle for 7 days: CPU, network and memory all under 20%. A small app like RideSync can look idle. To prevent it:

1. In the Oracle console, go to **Billing & Cost Management** → **Upgrade and Manage Payment** → **Upgrade to Pay As You Go**.
2. Then go to **Billing** → **Budgets** → **Create budget** of ₹100 with an email alert, as a safety net.

On Pay As You Go, the Always Free resources stay **free**. You pay only if you create something beyond the free limits, and the setup above doesn't. The upgrade stops Oracle reclaiming the server.

---

## Day to day

| To do this | Run on the server (`ssh -i key ubuntu@SERVER_IP`) |
|---|---|
| Update to the latest RideSync from GitHub | `bash /opt/ridesync/deploy/oracle/update.sh` (backs up first) |
| See live logs | `sudo journalctl -u ridesync -f` |
| Restart | `sudo systemctl restart ridesync` |
| Is it running? | `systemctl status ridesync` |
| Change settings | `sudo nano /opt/ridesync/.env`, then restart |
| Back up now | `sudo -u ridesync ridesync-backup` |

Backups are in `/opt/ridesync/backups/`. To download one to your laptop:

```bash
scp -i path/to/ssh-key.key ubuntu@SERVER_IP:/opt/ridesync/backups/ridesync-2026-10-11.db .
```

**Use only one server.** Once the Oracle server is live, don't also run `start.bat` for students. That would give two separate copies of the data.

## Troubleshooting

| Problem | Fix |
|---|---|
| `oracle.bat` says it couldn't connect | Check the IP and the key file. The instance must show **Running**. Wait a minute after creating it. |
| `Permissions … are too open` | `oracle.bat` fixes this itself. By hand: right-click the key → Properties → Security → leave only your user. |
| Page doesn't open, or HTTPS isn't answering | Check step 3 (both ingress rules, 80 **and** 443). Check DuckDNS shows the server's IP. Then on the server run `sudo systemctl restart caddy` and `sudo journalctl -u caddy -n 30`. |
| "Out of capacity" when creating the server | Try another availability domain, a different time of day, or the **E2.1.Micro** shape. |
| The app says it can't reach the server | Make sure the server link starts with `https://` and has no `/api` at the end. |
| Something broke after an update | `sudo journalctl -u ridesync -n 80` shows the error. Restore the last backup by copying it over `/opt/ridesync/data/ridesync.db` (with the service stopped). |
