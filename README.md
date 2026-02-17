# prime-hospital.
# ==================== .GITHUB/WORKFLOWS/DEPLOY.YML ====================
name: Deploy Prime Hospital

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Use Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18.x'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
      env:
        MONGODB_URI: mongodb://localhost:27017/test
        JWT_SECRET: test-secret

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Deploy to DigitalOcean
      uses: appleboy/ssh-action@v0.1.5
      with:
        host: ${{ secrets.DROPLET_IP }}
        username: ${{ secrets.DROPLET_USER }}
        key: ${{ secrets.SSH_PRIVATE_KEY }}
        script: |
          cd /var/www/primehospital
          git pull origin main
          docker-compose down
          docker-compose up -d --build
          echo "✅ Prime Hospital deployed with Plus Code CX7Q+8WF"
