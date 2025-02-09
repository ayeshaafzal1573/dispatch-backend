// shop.js (Route for shop API)

const express = require('express');
const router = express.Router();
const { getDBPool } = require('../db');
const bcrypt = require('bcrypt');

router.post("/create-shop", async (req, res) => {
  const { StoreName, userName, Password, PortNo, HostIP, Email, Roles, Permission } = req.body;

  try {
      const localPool = getDBPool(false);
     
      // Insert into tblstores
      const shopQuery = `INSERT INTO tblstores (Storename, userName, Password, PortNo, HostIP) VALUES (?, ?, ?, ?, ?)`;
      const [shopResult] = await localPool.query(shopQuery, [StoreName, userName, Password, PortNo, HostIP]);
      const shopId = shopResult.insertId; // Get the inserted shop ID

      // Insert into tblusers
      const userQuery = `INSERT INTO tblusers (username, Email, Password, Roles, Permission, Created, StoreName) VALUES (?, ?, ?, ?, ?, NOW(), ?)`;
      const [userResult] = await localPool.query(userQuery, [userName, Email, Password, Roles, Permission, StoreName]);
      const userId = userResult.insertId; // Get the inserted user ID

      // Insert into tbluserstores
      const userStoreQuery = `INSERT INTO tbluserstores (userId, storeId) VALUES (?, ?)`;
      await localPool.query(userStoreQuery, [userId, shopId]);

      res.status(201).json({
          message: "Shop and user created successfully",
          shopId,
          userId
      });

  } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error creating shop", error: error.message });
  }
});
router.get('/shops', async (req, res) => {
  try {
    console.log("🔍 Fetching shops from local database...");
    
    const pool = await getDBPool(false);
    const connection = await pool.getConnection();
    console.log("✅ Database connection acquired.");

    const [rows] = await connection.execute('SELECT * FROM tblstores');
    connection.release();
    
    console.log("✅ Shops retrieved:", rows.length, "records found");

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "No shops found" });
    }

    res.json(rows);
  } catch (error) {
    console.error("❌ Error in /shops:", error);
    res.status(500).json({ message: 'Error fetching shops', error: error.toString() });
  }
});


module.exports = router;
