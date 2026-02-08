const crypto = require("crypto");
const fetch = require("node-fetch"); // npm install node-fetch@2

const BYBIT_BASE = "https://api.bybit.com";
const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;

function generateSignature(params) {
  const sorted = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");
  return crypto
    .createHmac("sha256", BYBIT_API_SECRET)
    .update(sorted)
    .digest("hex");
}

async function checkPayment(order) {
  if (!order || !order.id) return false;

  const params = {
    api_key: BYBIT_API_KEY,
    timestamp: Date.now()
  };
  params.sign = generateSignature(params);

  try {
    const url = `${BYBIT_BASE}/v2/private/wallet/fund/records?${new URLSearchParams(params)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.result && Array.isArray(data.result.data)) {
      const paidTx = data.result.data.find(
        tx => tx.note === order.id && tx.status === "success"
      );
      return Boolean(paidTx);
    }

    return false;
  } catch (err) {
    console.log("Bybit API error:", err.message);
    return false;
  }
}

module.exports = { checkPayment };
