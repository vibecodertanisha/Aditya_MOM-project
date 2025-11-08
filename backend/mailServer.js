const express = require('express');
const router = express.Router();

router.post('/send-email', (req, res) => {
  const { to, subject, text } = req.body || {};
  console.log('📧 send-email (stub)', { to, subject, text });
  res.json({ success: true });
});

module.exports = router;