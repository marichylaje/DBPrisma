const { google } = require('googleapis');
const PACKAGE_NAME = process.env.GOOGLE_PACKAGE_NAME;
const CREDS = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8'));
const auth = new google.auth.GoogleAuth({ credentials: CREDS, scopes:['https://www.googleapis.com/auth/androidpublisher']});
const svc = google.androidpublisher({ version: 'v3', auth });

async function verifyAndroidSub(productId, purchaseToken) {
  const resp = await svc.purchases.subscriptions.get({ packageName: PACKAGE_NAME, subscriptionId: productId, token: purchaseToken });
  const expiry = parseInt(resp.data.expiryTimeMillis || '0', 10);
  const active = expiry > Date.now() && resp.data.cancelReason !== 3;
  return { active, expiryMs: expiry || null };
}

module.exports = { verifyAndroidSub };
