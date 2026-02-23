export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body;

  // Simulate wallet creation
  const walletId = `wallet_${Date.now()}`;

  res.status(200).json({
    success: true,
    walletId
  });
}
