// category.js (Route for category API)

const express = require('express');
const router = express.Router();
const { getDBPool } = require('../db.js');

// Get categories
router.get('/categories', async (req, res) => {
  try {
    const pool = await getDBPool(true);  // Use Cloud Database
    const [rows] = await pool.query('SELECT MajorNo, MajorDescription FROM tblcategory');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

module.exports = router;
