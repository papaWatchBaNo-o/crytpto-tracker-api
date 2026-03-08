const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authorization = req.header('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};
