const express = require('express');
const router = express.Router();
const { getDBPool } = require('../db');

// Fetch store orders from both cloud and local databases
router.get("/store-orders", async (req, res) => {
  const storeName = req.headers["store"]; // Fetch storeName from request headers

  let cloudConnection;
  let localConnection;

  try {
    const cloudPool = getDBPool(true); // Cloud DB connection
    const localPool = getDBPool(false); // Local DB connection

    // Get individual connections from the pool
    cloudConnection = await cloudPool.getConnection();
    localConnection = await localPool.getConnection();

    // Cloud DB query: Fetch all order details from tblorders (cloud) in one table
    const cloudOrderQuery = `
      SELECT 
        o.OrderNo, 
        o.StoreName, 
        o.OrderComplete, 
        o.Order_Approved_By, 
        o.Order_Approved_Date, 
        o.Order_Packed_By, 
        o.Order_Packed_Date, 
        o.Order_Dispatch_By, 
        o.Order_Dispatched_Date, 
        o.Order_Rcvd_Date, 
        o.Order_Approved_Date, 
        o.User,
        o.StockCode,
        LEFT(o.StockDescription, 256) AS StockDescription,
        o.MajorNo,
        o.MajorName,
        o.Sub1No,
        o.Sub1Name,
        o.Order_Qty,
        o.Rcvd_Qty,
        o.Amended_Qty,
        o.Final_Qty,
        o.Amended_Shop
      FROM 
        tblorders o
      WHERE 
        o.StoreName = ?
    `;
    const [cloudOrders] = await cloudConnection.query(cloudOrderQuery, [storeName]);
    console.log("✅ Fetched Orders for Store from Cloud DB:", storeName);

    // Local DB query: Fetch order details from tblorder and tblorder_tran (local)
    const localOrderQuery = `
      SELECT 
        o.OrderNo, 
        o.StoreName, 
        o.OrderComplete, 
        o.Order_Approved_By, 
        o.Order_Approved_Date, 
        o.Order_Packed_By, 
        o.Order_Packed_Date, 
        o.Order_Dispatch_By, 
        o.Order_Dispatched_Date, 
        o.Order_Rcvd_Date, 
        o.User,
        t.StockCode,
        LEFT(t.StockDescription, 256) AS StockDescription,
        t.MajorNo,
        t.MajorName,
        t.Sub1No,
        t.Sub1Name,
        t.Order_Qty,
        t.Rcvd_Qty,
        t.Amended_Qty,
        t.Final_Qty,
        t.Amended_Shop
      FROM 
        tblorder o
      LEFT JOIN 
        tblorder_tran t ON o.OrderNo = t.OrderNo
      WHERE 
        o.StoreName = ?
    `;
    const [localOrders] = await localConnection.query(localOrderQuery, [storeName]);
    console.log("✅ Fetched Orders for Store from Local DB:", storeName);

    // Combine cloud and local data (merge or prioritize based on requirements)
    const orders = [...cloudOrders, ...localOrders];

    // Respond with the combined orders
    res.status(200).json({ orders });
    
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders", error: error.message });
  } finally {
    // Ensure connections are released in the finally block
    if (cloudConnection) {
      cloudConnection.release();
    }
    if (localConnection) {
      localConnection.release();
    }
  }
});
// API to update order status and received date
router.put('/update-order-status', async (req, res) => {
    const { OrderNo, status, receivedDate, amendedQty } = req.body;
  
    let cloudConnection;
    let localConnection;
  
    try {
      const cloudPool = getDBPool(true);  // Cloud DB
      const localPool = getDBPool(false); // Local DB
  
      // Get individual connections from the pool
      cloudConnection = await cloudPool.getConnection();
      localConnection = await localPool.getConnection();
  
      // Start transactions for both DBs
      await cloudConnection.beginTransaction();
      await localConnection.beginTransaction();
  
      // Update tblorders (Cloud DB) - received date and status
      const cloudOrderQuery = `
        UPDATE tblorders
        SET Order_Rcvd_Date = ?
        WHERE OrderNo = ?
      `;
      await cloudConnection.query(cloudOrderQuery, [receivedDate, status, OrderNo]);
  
      // Update tblorder_tran (Cloud DB) - amended quantity
      const cloudOrderTranQuery = `
        UPDATE tblorders
        SET Amended_Qty = ?
        WHERE OrderNo = ?
      `;
      await cloudConnection.query(cloudOrderTranQuery, [amendedQty, OrderNo]);
  
      // Update tblorders (Local DB) - received date and status
      const localOrderQuery = `
        UPDATE tblorder_tran
        SET Order_Rcvd_Date = ?, OrderStatus = ?
        WHERE OrderNo = ?
      `;
      await localConnection.query(localOrderQuery, [receivedDate, status, OrderNo]);
  
      // Update tblorder_tran (Local DB) - amended quantity
      const localOrderTranQuery = `
        UPDATE tblorder_tran
        SET Amended_Qty = ?
        WHERE OrderNo = ?
      `;
      await localConnection.query(localOrderTranQuery, [amendedQty, OrderNo]);
  
      // Commit the transactions for both databases
      await cloudConnection.commit();
      await localConnection.commit();
  
      res.status(200).json({ message: 'Order status and received date updated successfully!' });
  
    } catch (error) {
      // Rollback transactions in case of any error
      if (cloudConnection) await cloudConnection.rollback();
      if (localConnection) await localConnection.rollback();
      console.error('Error updating order status:', error);
      res.status(500).json({ message: 'Error updating order status', error: error.message });
    } finally {
      // Ensure connections are released in the finally block
      if (cloudConnection) {
        cloudConnection.release();
      }
      if (localConnection) {
        localConnection.release();
      }
    }
  });
  

module.exports = router;
