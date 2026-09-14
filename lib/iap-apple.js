const PROD = process.env.APPLE_VERIFY_PROD || 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX = process.env.APPLE_VERIFY_SANDBOX || 'https://sandbox.itunes.apple.com/verifyReceipt';
const SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

async function call(url, body) {
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  return res.json();
}

async function verifyAppleReceipt(base64Receipt) {
  if (!SHARED_SECRET) {
    throw new Error('apple_config_missing: APPLE_SHARED_SECRET no configurado');
  }
  if (!base64Receipt || typeof base64Receipt !== 'string') {
    return { active: false, expiryMs: null, productId: undefined };
  }

  const body = { 'receipt-data': base64Receipt, password: SHARED_SECRET, 'exclude-old-transactions': true };
  let data = await call(PROD, body);
  if (data.status === 21007) data = await call(SANDBOX, body);
  if (data.status !== 0) return { active:false, expiryMs:null, productId:undefined };

  const infos = data.latest_receipt_info || data.receipt?.in_app || [];
  let max = 0, pid, originalTransactionId;
  for (const tx of infos) {
    const exp = parseInt(tx.expires_date_ms || '0', 10);
    if (exp > max) { max = exp; pid = tx.product_id; originalTransactionId = tx.original_transaction_id; }
  }
  return { active: max > Date.now(), expiryMs: max || null, productId: pid, originalTransactionId };
}

module.exports = { verifyAppleReceipt };
