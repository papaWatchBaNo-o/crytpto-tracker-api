const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

let topCache = { data: null, cachedAt: 0 };
let watchlistCache = {};

router.get('/top', async (req, res) => {
  // Check cache first
  const now = Date.now();
  if (topCache.data && (now - topCache.cachedAt) < 30000) {
    return res.json(topCache.data);
  }

  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h'
    );
    
    // save to cache and return
    topCache = { data: response.data, cachedAt: Date.now() };
    res.json(response.data);
  } catch (error) {
    // Use cached data if API fails
    if (topCache.data) {
      return res.json(topCache.data);
    }

    res.status(500).json({ error: 'Failed to fetch crypto data' });
  }
});

router.get('/coin/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${id}`
    );
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch coin data' });
  }
});

router.post('/watchlist', auth, async (req, res) => {
  try {
    const { coinId, coinName } = req.body;
    const user = await User.findById(req.userId);

    // if coin already in watchlist
    const alreadyInWatchlist = user.watchlist.some(item => item.coinId === coinId);
    if (alreadyInWatchlist) {
      return res.status(400).json({ error: 'Coin already in watchlist' });
    }

    user.watchlist.push({ coinId, coinName });
    await user.save();

    res.json({ message: 'Added to watchlist', watchlist: user.watchlist });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist/:coinId', auth, async (req, res) => {
  try {
    const { coinId } = req.params;
    const user = await User.findById(req.userId);

    user.watchlist = user.watchlist.filter(item => item.coinId !== coinId);
    await user.save();

    res.json({ message: 'Removed from watchlist', watchlist: user.watchlist });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/watchlist', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    if (user.watchlist.length === 0) {
      return res.json([]);
    }

    const coinIdsArr = user.watchlist.map(item => item.coinId);
    const sortedIds = [...coinIdsArr].sort();
    const coinIds = sortedIds.join(',');

    //show cached data if available and updated within 30 seconds
    const now = Date.now();
    const cached = watchlistCache[coinIds];
    if (cached && (now - cached.cachedAt) < 30000) {
      return res.json(cached.data);
    }

    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`
    );

    // save to cache and return
    watchlistCache[coinIds] = { data: response.data, cachedAt: Date.now() };
    res.json(response.data);
  } catch (error) {
    // show cached data if API fails
    const user = await User.findById(req.userId);
    const coinIdsKey = user.watchlist.map(i => i.coinId).sort().join(',');
    const stale = watchlistCache[coinIdsKey];
    
    if (stale) {
      return res.json(stale.data);
    }

    res.status(500).json({ error: 'Failed to fetch watchlist data' });
  }
});

module.exports = router;