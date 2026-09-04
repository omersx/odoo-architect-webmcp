// GET /api/status -> { ai: true|false }. Never exposes key, URL, or model name.
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }
  const configured = !!(process.env.MODEL_BASE_URL && process.env.MODEL_API_KEY && process.env.MODEL_NAME);
  res.status(200).json({ ai: configured });
};
