const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_MS = 30 * 1000;
const API_TIMEOUT_MS = 12 * 1000;

const coinGecko = axios.create({
  baseURL: COINGECKO_BASE_URL,
  timeout: API_TIMEOUT_MS,
});

let topCache = { data: null, cachedAt: 0 };
const watchlistCache = {};

const getCachedPayload = (cacheEntry) => {
  if (!cacheEntry || !cacheEntry.data) {
    return null;
  }

  return Date.now() - cacheEntry.cachedAt < CACHE_TTL_MS ? cacheEntry.data : null;
};

const sanitizeCoinId = (value) => String(value || '').trim().toLowerCase();

router.get('/top', async (req, res) => {
  const cachedTop = getCachedPayload(topCache);
  if (cachedTop) {
    return res.json(cachedTop);
  }

  try {
    const response = await coinGecko.get('/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 100,
        page: 1,
        sparkline: true,
        price_change_percentage: '24h',
      },
    });

    topCache = { data: response.data, cachedAt: Date.now() };
    return res.json(response.data);
  } catch (error) {
    if (topCache.data) {
      return res.json(topCache.data);
    }

    return res.status(502).json({ error: 'Failed to fetch crypto market data' });
  }
});

router.get('/coin/:id', async (req, res) => {
  const coinId = sanitizeCoinId(req.params.id);

  if (!coinId) {
    return res.status(400).json({ error: 'Coin id is required' });
  }

  try {
    const response = await coinGecko.get(`/coins/${encodeURIComponent(coinId)}`);
    return res.json(response.data);
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'Coin not found' });
    }

    return res.status(502).json({ error: 'Failed to fetch coin data' });
  }
});

router.post('/watchlist', auth, async (req, res) => {
  try {
    const coinId = sanitizeCoinId(req.body.coinId);
    const coinName = String(req.body.coinName || '').trim();

    if (!coinId || !coinName) {
      return res.status(400).json({ error: 'coinId and coinName are required' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const alreadyInWatchlist = user.watchlist.some((item) => item.coinId === coinId);
    if (alreadyInWatchlist) {
      return res.status(400).json({ error: 'Coin already in watchlist' });
    }

    user.watchlist.push({ coinId, coinName });
    await user.save();

    return res.json({ message: 'Added to watchlist', watchlist: user.watchlist });
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist/:coinId', auth, async (req, res) => {
  try {
    const coinId = sanitizeCoinId(req.params.coinId);

    if (!coinId) {
      return res.status(400).json({ error: 'Coin id is required' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.watchlist = user.watchlist.filter((item) => item.coinId !== coinId);
    await user.save();

    return res.json({ message: 'Removed from watchlist', watchlist: user.watchlist });
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/watchlist', auth, async (req, res) => {
  let user;

  try {
    user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.watchlist.length) {
      return res.json([]);
    }

    const coinIds = user.watchlist
      .map((item) => sanitizeCoinId(item.coinId))
      .filter(Boolean)
      .sort();

    const coinIdsKey = coinIds.join(',');
    const cachedWatchlist = getCachedPayload(watchlistCache[coinIdsKey]);
    if (cachedWatchlist) {
      return res.json(cachedWatchlist);
    }

    const response = await coinGecko.get('/coins/markets', {
      params: {
        vs_currency: 'usd',
        ids: coinIdsKey,
        order: 'market_cap_desc',
        sparkline: true,
        price_change_percentage: '24h',
      },
    });

    watchlistCache[coinIdsKey] = { data: response.data, cachedAt: Date.now() };
    return res.json(response.data);
  } catch (error) {
    const fallbackCoinIdsKey = user
      ? user.watchlist.map((item) => sanitizeCoinId(item.coinId)).filter(Boolean).sort().join(',')
      : '';

    if (fallbackCoinIdsKey && watchlistCache[fallbackCoinIdsKey]?.data) {
      return res.json(watchlistCache[fallbackCoinIdsKey].data);
    }

    return res.status(502).json({ error: 'Failed to fetch watchlist data' });
  }
});

module.exports = router;
