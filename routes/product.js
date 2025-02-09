// product.js (Route for product API)

const express = require('express');
const router = express.Router();
const { getDBPool } = require('../db');

// Get products
router.get('/products', async (req, res) => {
  try {
    const pool = await getDBPool(true);  // Use Cloud Database
    const [rows] = await pool.query('SELECT *  FROM tblproducts');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching products' });
  }
});

module.exports = router;
