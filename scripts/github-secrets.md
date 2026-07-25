# GitHub repository and deploy setup

## 1. Create the GitHub repository

If the repo does not exist yet, create an empty repository named `teleprompter` at:

https://github.com/new

Do not add a README, `.gitignore`, or license (this project already has files locally).

## 2. Push local files

From the project directory:

```bash
cd /Users/mathewshell/Documents/Cloud/Hobbies/Teleprompter/repository
git remote add origin git@github.com:MatthewShell1/teleprompter.git
git push -u origin main
```

Use HTTPS instead if you prefer:

```bash
git remote add origin https://github.com/MatthewShell1/teleprompter.git
git push -u origin main
```

## 3. Prepare the EC2 server (one time)

SSH into your AL2023 instance, then run:

```bash
sudo dnf install -y git
```

Copy `scripts/ec2-setup.sh` to the server (or paste its contents), then:

```bash
bash ec2-setup.sh /var/www/html/mshell-net/teleprompter git@github.com:MatthewShell1/teleprompter.git
```

Adjust the path to match where Apache should serve the teleprompter files.

### Apache example (optional)

```apache
Alias /teleprompter /var/www/html/mshell-net/teleprompter
<Directory /var/www/html/mshell-net/teleprompter>
    Options Indexes FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>
```

Then reload Apache:

```bash
sudo systemctl reload httpd
```

### Deploy user SSH access

The GitHub Action connects to EC2 over SSH. Options:

1. **Use `ec2-user`** (simplest): add the Action's public key to `~/.ssh/authorized_keys` on the server.
2. **Dedicated deploy user**: create a user limited to `git pull` in the deploy directory.

Generate a key pair for GitHub Actions (on your Mac):

```bash
ssh-keygen -t ed25519 -C "github-actions-teleprompter" -f ~/.ssh/teleprompter_deploy -N ""
```

Add the **public** key to the server:

```bash
cat ~/.ssh/teleprompter_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Give the deploy user write access to the deploy path:

```bash
sudo chown -R ec2-user:apache /var/www/html/mshell-net/teleprompter
sudo chmod -R g+w /var/www/html/mshell-net/teleprompter
```

For a **private** GitHub repo, also add a read-only deploy key in GitHub repo settings, or configure the server with a GitHub PAT / SSH key that can `git fetch`.

## 4. Add GitHub Actions secrets

In the repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Example | Description |
|--------|---------|-------------|
| `EC2_HOST` | `3.15.123.45` or `teleprompter.example.com` | Public hostname or IP of the EC2 instance |
| `EC2_USER` | `ec2-user` | SSH login user |
| `EC2_SSH_KEY` | contents of `teleprompter_deploy` (private key) | Private key for SSH |
| `EC2_DEPLOY_PATH` | `/var/www/html/mshell-net/teleprompter` | Directory containing the git clone |
| `EC2_SSH_PORT` | `22` | Optional; omit if using default port |

## 5. Test deployment

Push to `main` or run the workflow manually:

**Actions → Deploy to EC2 → Run workflow**

The workflow runs:

```bash
cd $EC2_DEPLOY_PATH
git fetch origin main
git reset --hard origin/main
```

This keeps the server exactly in sync with the latest commit on `main`.
